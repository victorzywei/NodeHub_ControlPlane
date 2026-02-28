import { KEY, kvGetJson, kvPutJson } from '../_lib/kv.js'
import { ok, fail } from '../_lib/response.js'

const APPLY_STATUSES = new Set(['pending', 'ok', 'failed'])

function normalizeMessage(value) {
  const message = String(value || '').trim()
  return message.slice(0, 512)
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
    message: normalizeMessage(raw.message),
    occurred_at: String(raw.occurred_at || ''),
  }
}

function applyEvent(node, event) {
  if (event.applied_version !== null) {
    node.applied_version = Math.max(Number(node.applied_version || 0), event.applied_version)
    if (Number(node.applied_version || 0) >= Number(node.desired_version || 0) && node.desired_config_summary) {
      node.applied_config_summary = String(node.desired_config_summary || '')
    }
  }

  if (event.status === 'ok') {
    node.last_release_status = 'ok'
    node.last_release_message = event.message || `release applied v${Number(node.applied_version || 0)}`
    if (node.desired_config_summary) {
      node.applied_config_summary = String(node.desired_config_summary || '')
    }
    return
  }

  if (event.status === 'failed') {
    node.last_release_status = 'failed'
    node.last_release_message = event.message || 'release apply failed'
    return
  }

  node.last_release_status = 'pending'
  node.last_release_message = event.message || 'release apply pending'
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

  for (const rawEvent of rawEvents) {
    const event = normalizeEvent(rawEvent)
    if (!event) {
      rejected += 1
      continue
    }

    applyEvent(node, event)
    accepted += 1
  }

  if (accepted > 0) {
    node.updated_at = new Date().toISOString()
    await kvPutJson(kv, KEY.node(node.id), node)
  }

  return ok({
    node_id: node.id,
    accepted,
    rejected,
    applied_version: Number(node.applied_version || 0),
    applied_config_summary: String(node.applied_config_summary || ''),
    last_release_status: node.last_release_status,
    last_release_message: node.last_release_message,
  })
}
