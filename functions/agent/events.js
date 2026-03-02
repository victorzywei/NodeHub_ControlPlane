import { KEY, kvGetJson, kvPutJson } from '../_lib/kv.js'
import { ok, fail } from '../_lib/response.js'

const APPLY_STATUSES = new Set(['pending', 'ok', 'failed'])

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

function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const type = String(raw.type || 'apply_result')
  if (type !== 'apply_result') return null

  const status = String(raw.status || '')
  if (!APPLY_STATUSES.has(status)) return null

  const targetVersion = normalizeVersion(raw.target_version ?? raw.version ?? raw.rev)
  const currentVersion = normalizeVersion(raw.current_version)

  return {
    status,
    error_code: normalizeErrorCode(raw.error_code),
    message: normalizeMessage(raw.message || raw.log || raw.detail),
    target_version: targetVersion,
    current_version: currentVersion,
  }
}

function getTarget(node) {
  const targetArtifact =
    node.target_artifact && typeof node.target_artifact === 'object' && !Array.isArray(node.target_artifact)
      ? node.target_artifact
      : null
  const targetVersion = targetArtifact
    ? Number(targetArtifact.rev || 0)
    : Number(node.target_version || 0)
  return { targetArtifact, targetVersion }
}

function setCurrentFromTarget(node, appliedAt) {
  const { targetArtifact, targetVersion } = getTarget(node)
  if (!targetArtifact || targetVersion <= 0) return false

  node.current_version = targetVersion
  node.current_artifact = {
    id: String(targetArtifact.id || ''),
    rev: targetVersion,
    engine: String(targetArtifact.engine || ''),
    sha256: String(targetArtifact.sha256 || ''),
    summary: String(targetArtifact.summary || ''),
    applied_at: appliedAt,
  }
  return true
}

function resolveEventVersion(node, event) {
  const { targetVersion: nodeTargetVersion } = getTarget(node)
  const targetVersion = event.target_version ?? nodeTargetVersion
  // Older agents may not send current_version; treat as reporting the target release.
  const currentVersion = event.current_version ?? targetVersion
  return {
    nodeTargetVersion,
    targetVersion,
    currentVersion,
  }
}

function isSameVersionStatus(node, event, releaseVersion) {
  const status = String(node.last_release_status || '')
  const version = Number(node.last_release_version || 0) || 0
  return version === releaseVersion && status === event.status
}

function applyEvent(node, event, nowIso, releaseVersion) {
  if (event.status === 'ok') {
    setCurrentFromTarget(node, nowIso)
    node.last_release_status = 'ok'
    node.last_release_error_code = ''
    node.last_release_message = event.message || `release applied r${Number(node.current_version || 0)}`
    node.last_release_version = releaseVersion
    return true
  }

  if (event.status === 'failed') {
    node.last_release_status = 'failed'
    node.last_release_error_code = event.error_code || ''
    node.last_release_message = event.message || 'release apply failed'
    node.last_release_version = releaseVersion
    return true
  }

  node.last_release_status = 'pending'
  node.last_release_error_code = ''
  node.last_release_message = event.message || 'release apply pending'
  node.last_release_version = releaseVersion
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

  node.target_version = Number(node.target_version || 0) || 0
  node.current_version = Number(node.current_version || 0) || 0
  node.last_release_version = Number(node.last_release_version || 0) || 0

  let accepted = 0
  let rejected = 0
  const nowIso = new Date().toISOString()

  for (const rawEvent of rawEvents) {
    const event = normalizeEvent(rawEvent)
    if (!event) {
      rejected += 1
      continue
    }

    const versions = resolveEventVersion(node, event)
    if (
      versions.targetVersion <= 0 ||
      versions.currentVersion !== versions.targetVersion ||
      versions.targetVersion !== versions.nodeTargetVersion
    ) {
      rejected += 1
      continue
    }

    if (isSameVersionStatus(node, event, versions.targetVersion)) {
      rejected += 1
      continue
    }

    if (!applyEvent(node, event, nowIso, versions.targetVersion)) {
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
    current_version: Number(node.current_version || 0),
    last_release_status: node.last_release_status,
    last_release_message: node.last_release_message,
    last_release_error_code: String(node.last_release_error_code || ''),
    last_release_version: Number(node.last_release_version || 0),
  })
}
