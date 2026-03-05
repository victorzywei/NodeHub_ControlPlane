import { KEY, kvGetJson, kvPutJson } from '../_lib/kv.js'
import { canAdvanceStatus, getRelease, putRelease } from '../_lib/release.js'
import { ok, fail } from '../_lib/response.js'

const APPLY_STATUSES = new Set(['pending', 'applied', 'healthy', 'failed'])
const GENERIC_EVENT_MESSAGES = new Set([
  'artifact applied',
  'release apply failed',
  'release apply pending',
  'artifact apply failed',
  'failed to persist version',
  'invalid reconcile response',
  'artifact metadata missing',
  'apply hook missing',
])

function normalizeMessage(value) {
  const message = String(value || '').trim()
  return message.slice(0, 4096)
}

function normalizeErrorCode(value) {
  const code = String(value || '').trim().toUpperCase()
  if (!code) return ''
  return /^[A-Z0-9_:-]{1,64}$/.test(code) ? code : ''
}

function normalizeVersion(value) {
  if (value === undefined || value === null || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return null
  return Math.floor(num)
}

function normalizeStatus(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!APPLY_STATUSES.has(raw)) return ''
  return raw
}

function joinMessage(parts) {
  return normalizeMessage(parts.filter(Boolean).join('; '))
}

function resolveDesired(node) {
  const rev = Number(node.desired_rev || 0) || 0
  const artifactId = String(node.desired_artifact_id || '').trim()
  const sha256 = String(node.desired_sha256 || '').trim()
  return { rev, artifactId, sha256 }
}

function buildStatusMessage(node, event, releaseVersion) {
  const release = `rev=r${releaseVersion}`
  const current = `current=r${Number(node.current_version || 0)}`
  const desired = `desired=r${Number(node.desired_rev || 0)}`
  const code = event.error_code ? `code=${event.error_code}` : ''

  if (event.status === 'healthy') return joinMessage(['health ok', release, current, desired])
  if (event.status === 'applied') return joinMessage(['apply ok', release, current, desired])
  if (event.status === 'failed') return joinMessage(['apply failed', release, current, desired, code || 'code=E_APPLY'])
  return joinMessage(['apply pending', release, current, desired])
}

function resolveEventMessage(node, event, releaseVersion) {
  const message = normalizeMessage(event.message)
  const fallback = buildStatusMessage(node, event, releaseVersion)
  if (!message) return fallback
  if (!GENERIC_EVENT_MESSAGES.has(message.toLowerCase())) return message
  return joinMessage([fallback, `reason=${message}`])
}

function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const type = String(raw.type || 'apply_result')
  if (type !== 'apply_result') return null

  const status = normalizeStatus(raw.status)
  if (!status) return null

  const rev = normalizeVersion(raw.rev)
  const currentVersion = normalizeVersion(raw.current_version)

  return {
    status,
    error_code: normalizeErrorCode(raw.error_code),
    message: normalizeMessage(raw.message || raw.log || raw.detail),
    rev,
    current_version: currentVersion,
  }
}

function setNodeCurrentFromDesired(node, desired, artifact, nowIso) {
  if (!desired.artifactId || desired.rev <= 0) return false
  node.current_version = desired.rev
  node.current_artifact = {
    id: desired.artifactId,
    rev: desired.rev,
    engine: String(artifact?.engine || ''),
    sha256: desired.sha256,
    summary: String(artifact?.summary || ''),
    applied_at: nowIso,
  }
  return true
}

function updateReleaseStatus(release, event, message, nowIso) {
  const next = { ...(release || {}) }
  next.status = event.status
  next.error_code = event.status === 'failed' ? event.error_code || '' : ''
  next.message = message
  next.updated_at = nowIso
  if (event.status === 'applied') next.applied_at = nowIso
  if (event.status === 'healthy') {
    if (!next.applied_at) next.applied_at = nowIso
    next.healthy_at = nowIso
  }
  if (event.status === 'failed') next.failed_at = nowIso
  return next
}

function isDuplicateEvent(release, event) {
  const currentStatus = String(release?.status || '')
  if (!currentStatus) return false
  if (currentStatus === event.status) return true
  return !canAdvanceStatus(currentStatus, event.status)
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}))
  const nodeId = String(body.node_id || '')
  const token = request.headers.get('X-Node-Token') || ''

  if (!nodeId) return fail('VALIDATION', 'node_id is required', 400)
  if (!token) return fail('UNAUTHORIZED', 'X-Node-Token is required', 401)

  const rawEvents = Array.isArray(body.events) ? body.events : []
  if (rawEvents.length === 0) return fail('VALIDATION', 'events must be a non-empty array', 400)

  const kv = env.NODEHUB_KV
  const node = await kvGetJson(kv, KEY.node(nodeId), null)
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)
  if (node.token !== token) return fail('UNAUTHORIZED', 'Invalid node token', 401)

  node.desired_rev = Number(node.desired_rev || 0) || 0
  node.current_version = Number(node.current_version || 0) || 0
  node.last_release_version = Number(node.last_release_version || 0) || 0

  let accepted = 0
  let rejected = 0
  const nowIso = new Date().toISOString()
  const desired = resolveDesired(node)

  for (const rawEvent of rawEvents) {
    const event = normalizeEvent(rawEvent)
    if (!event) {
      rejected += 1
      continue
    }

    const rev = event.rev
    if (rev === null || rev <= 0 || rev !== desired.rev) {
      rejected += 1
      continue
    }

    const desiredArtifact = desired.artifactId
      ? await kvGetJson(kv, KEY.artifact(desired.artifactId), null)
      : null
    if (!desiredArtifact) {
      rejected += 1
      continue
    }

    const message = resolveEventMessage(node, event, rev)
    const currentRelease = await getRelease(kv, node.id, rev)
    const baseRelease = currentRelease || {
      id: `${node.id}:r${rev}`,
      node_id: node.id,
      rev,
      artifact_id: desired.artifactId,
      artifact_sha256: desired.sha256,
      status: 'pending',
      summary: '',
      template_names: [],
      error_code: '',
      message: '',
      desired_at: nowIso,
      applied_at: '',
      healthy_at: '',
      failed_at: '',
      updated_at: nowIso,
    }

    if (isDuplicateEvent(baseRelease, event)) {
      rejected += 1
      continue
    }

    const nextRelease = updateReleaseStatus(baseRelease, event, message, nowIso)
    await putRelease(kv, nextRelease)

    if (event.status === 'healthy') {
      setNodeCurrentFromDesired(node, desired, desiredArtifact, nowIso)
    }

    node.last_release_status = event.status
    node.last_release_error_code = event.status === 'failed' ? (event.error_code || '') : ''
    node.last_release_message = message
    node.last_release_version = rev
    node.updated_at = nowIso
    accepted += 1
  }

  if (accepted > 0) {
    await kvPutJson(kv, KEY.node(node.id), node)
  }

  return ok({
    node_id: node.id,
    accepted,
    rejected,
    current_version: Number(node.current_version || 0),
    last_release_status: String(node.last_release_status || ''),
    last_release_message: String(node.last_release_message || ''),
    last_release_error_code: String(node.last_release_error_code || ''),
    last_release_version: Number(node.last_release_version || 0),
  })
}
