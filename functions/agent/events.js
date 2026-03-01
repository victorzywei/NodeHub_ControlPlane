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

  const currentVersionRaw = Number(raw.current_version)
  const currentVersion = Number.isFinite(currentVersionRaw) ? Math.max(0, Math.floor(currentVersionRaw)) : null

  return {
    event_id: String(raw.event_id || ''),
    type,
    status,
    current_version: currentVersion,
    artifact_sha256: normalizeSha256(raw.artifact_sha256 || raw.sha256),
    error_code: normalizeErrorCode(raw.error_code),
    message: normalizeMessage(raw.message),
    occurred_at: String(raw.occurred_at || ''),
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

function eventMatchesTarget(node, event) {
  const { targetArtifact, targetVersion } = getTarget(node)
  if (!targetArtifact || targetVersion <= 0) return false

  if (event.current_version !== null && event.current_version !== targetVersion) return false

  if (event.artifact_sha256) {
    const expected = String(targetArtifact.sha256 || '').trim().toLowerCase()
    if (!expected || event.artifact_sha256 !== expected) return false
  }

  return true
}

function setCurrentFromTarget(node, appliedAt) {
  const { targetArtifact, targetVersion } = getTarget(node)
  if (!targetArtifact || targetVersion <= 0) return false

  node.target_version = targetVersion
  node.target_artifact = targetArtifact
  node.current_version = targetVersion
  const currentArtifact = {
    id: String(targetArtifact.id || ''),
    rev: targetVersion,
    engine: String(targetArtifact.engine || ''),
    sha256: String(targetArtifact.sha256 || ''),
    summary: String(targetArtifact.summary || ''),
    applied_at: appliedAt,
  }
  node.current_artifact = currentArtifact
  return true
}

function applyEvent(node, event, nowIso) {
  if (!eventMatchesTarget(node, event)) return false

  if (event.status === 'ok') {
    if (event.current_version === null) return false
    if (!setCurrentFromTarget(node, nowIso)) return false

    node.last_release_status = 'ok'
    node.last_release_message = event.message || `release applied r${Number(node.current_version || 0)}`
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

  node.target_version = Number(node.target_version || 0) || 0
  node.current_version = Number(node.current_version || 0) || 0

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
    current_version: Number(node.current_version || 0),
    last_release_status: node.last_release_status,
    last_release_message: node.last_release_message,
    last_release_error_code: String(node.last_release_error_code || ''),
  })
}
