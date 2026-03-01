import { KEY, kvGetJson, kvPutJson } from '../_lib/kv.js'
import { ok, fail } from '../_lib/response.js'

const APPLY_STATUSES = new Set(['pending', 'ok', 'failed'])

function normalizeMessage(value) {
  const message = String(value || '').trim()
  return message.slice(0, 512)
}

function normalizeErrorCode(value) {
  const code = String(value || '').trim().toUpperCase()
  if (!code) return ''
  return /^[A-Z0-9_:-]{1,64}$/.test(code) ? code : ''
}

function normalizeSha256(value) {
  const hash = String(value || '').trim().toLowerCase()
  if (!hash) return ''
  return /^[a-f0-9]{64}$/.test(hash) ? hash : ''
}

function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const type = String(raw.type || '')
  if (type !== 'apply_result') return null

  const status = String(raw.status || '')
  if (!APPLY_STATUSES.has(status)) return null

  const appliedVersionRaw = Number(raw.applied_version)
  const appliedVersion = Number.isFinite(appliedVersionRaw) ? Math.max(0, Math.floor(appliedVersionRaw)) : null

  return {
    event_id: String(raw.event_id || ''),
    type,
    status,
    applied_version: appliedVersion,
    artifact_sha256: normalizeSha256(raw.artifact_sha256 || raw.sha256),
    error_code: normalizeErrorCode(raw.error_code),
    message: normalizeMessage(raw.message),
    occurred_at: String(raw.occurred_at || ''),
  }
}

function getDesired(node) {
  const desiredArtifact =
    node.desired_artifact && typeof node.desired_artifact === 'object' && !Array.isArray(node.desired_artifact)
      ? node.desired_artifact
      : null
  const desiredVersion = desiredArtifact ? Number(desiredArtifact.rev || 0) : Number(node.desired_version || 0)
  return { desiredArtifact, desiredVersion }
}

function eventMatchesDesired(node, event) {
  const { desiredArtifact, desiredVersion } = getDesired(node)
  if (!desiredArtifact || desiredVersion <= 0) return false

  if (event.applied_version !== null && event.applied_version !== desiredVersion) return false

  if (event.artifact_sha256) {
    const expected = String(desiredArtifact.sha256 || '').trim().toLowerCase()
    if (!expected || event.artifact_sha256 !== expected) return false
  }

  return true
}

function setAppliedFromDesired(node, appliedAt) {
  const { desiredArtifact, desiredVersion } = getDesired(node)
  if (!desiredArtifact || desiredVersion <= 0) return false

  node.applied_version = desiredVersion
  node.applied_artifact = {
    id: String(desiredArtifact.id || ''),
    rev: desiredVersion,
    engine: String(desiredArtifact.engine || ''),
    sha256: String(desiredArtifact.sha256 || ''),
    summary: String(desiredArtifact.summary || ''),
    applied_at: appliedAt,
  }
  return true
}

function applyEvent(node, event, nowIso) {
  if (!eventMatchesDesired(node, event)) return false

  if (event.status === 'ok') {
    if (event.applied_version === null) return false
    if (!setAppliedFromDesired(node, nowIso)) return false

    node.last_release_status = 'ok'
    node.last_release_message = event.message || `release applied r${Number(node.applied_version || 0)}`
    node.last_release_error_code = ''
    return true
  }

  if (event.status === 'failed') {
    node.last_release_status = 'failed'
    node.last_release_error_code = event.error_code || ''
    node.last_release_message = event.message || 'release apply failed'
    return true
  }

  node.last_release_status = 'pending'
  node.last_release_error_code = ''
  node.last_release_message = event.message || 'release apply pending'
  return true
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

  let accepted = 0
  let rejected = 0
  const nowIso = new Date().toISOString()

  for (const rawEvent of rawEvents) {
    const event = normalizeEvent(rawEvent)
    if (!event) {
      rejected += 1
      continue
    }

    if (!applyEvent(node, event, nowIso)) {
      rejected += 1
      continue
    }

    accepted += 1
  }

  if (accepted > 0) {
    node.updated_at = nowIso
    await kvPutJson(kv, KEY.node(node.id), node)
  }

  return ok({
    node_id: node.id,
    accepted,
    rejected,
    applied_version: Number(node.applied_version || 0),
    last_release_status: node.last_release_status,
    last_release_message: node.last_release_message,
    last_release_error_code: String(node.last_release_error_code || ''),
  })
}
