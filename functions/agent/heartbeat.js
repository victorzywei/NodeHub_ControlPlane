import { KEY, kvGetJson, kvPutJson } from '../_lib/kv.js'
import { ok, fail } from '../_lib/response.js'

function toText(value, maxLength = 512) {
  const text = String(value || '').trim()
  return text.slice(0, maxLength)
}

function toMetric(value, { min = 0, max = null } = {}) {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  if (num < min) return null
  if (max !== null && num > max) return null
  return Math.round(num * 100) / 100
}

async function loadAndAuthNode(kv, nodeId, token) {
  const node = await kvGetJson(kv, KEY.node(nodeId), null)
  if (!node) return { ok: false, response: fail('NOT_FOUND', 'Node not found', 404) }
  if (node.token !== token) return { ok: false, response: fail('UNAUTHORIZED', 'Invalid node token', 401) }
  return { ok: true, node }
}

async function applyHeartbeat(node, report, kv) {
  const now = new Date().toISOString()
  node.last_seen_at = now
  node.updated_at = now

  if (report) {
    node.deploy_info = toText(report.deploy_info, 1024)
    node.protocol_app_version = toText(report.protocol_app_version, 256)
    node.last_heartbeat_error = toText(report.error_message, 1024)
    node.cpu_usage_percent = toMetric(report.cpu_usage_percent, { min: 0, max: 100 })
    node.memory_used_mb = toMetric(report.memory_used_mb, { min: 0 })
    node.memory_total_mb = toMetric(report.memory_total_mb, { min: 0 })
    node.memory_usage_percent = toMetric(report.memory_usage_percent, { min: 0, max: 100 })
    node.heartbeat_reported_at = now
  }

  await kvPutJson(kv, KEY.node(node.id), node)

  return ok({
    node_id: node.id,
    desired_version: Number(node.desired_version || 0),
    applied_version: Number(node.applied_version || 0),
    last_seen_at: node.last_seen_at,
    heartbeat_reported_at: node.heartbeat_reported_at || null,
  })
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const nodeId = String(url.searchParams.get('node_id') || '')
  const token = request.headers.get('X-Node-Token') || ''

  if (!nodeId) return fail('VALIDATION', 'node_id is required', 400)
  if (!token) return fail('UNAUTHORIZED', 'X-Node-Token is required', 401)

  const kv = env.NODEHUB_KV
  const auth = await loadAndAuthNode(kv, nodeId, token)
  if (!auth.ok) return auth.response
  return applyHeartbeat(auth.node, null, kv)
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}))
  const nodeId = toText(body.node_id, 128)
  const token = request.headers.get('X-Node-Token') || ''

  if (!nodeId) return fail('VALIDATION', 'node_id is required', 400)
  if (!token) return fail('UNAUTHORIZED', 'X-Node-Token is required', 401)

  const kv = env.NODEHUB_KV
  const auth = await loadAndAuthNode(kv, nodeId, token)
  if (!auth.ok) return auth.response

  const report = {
    deploy_info: body.deploy_info,
    protocol_app_version: body.protocol_app_version,
    error_message: body.error_message,
    cpu_usage_percent: body.cpu_usage_percent,
    memory_used_mb: body.memory_used_mb,
    memory_total_mb: body.memory_total_mb,
    memory_usage_percent: body.memory_usage_percent,
  }

  return applyHeartbeat(auth.node, report, kv)
}
