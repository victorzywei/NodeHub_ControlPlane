import { loadNodeRecord, saveNodeRuntime } from '../_lib/node-store.js'
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

function toIntegerMetric(value, { min = 0, max = null } = {}) {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  const intNum = Math.floor(num)
  if (intNum < min) return null
  if (max !== null && intNum > max) return null
  return intNum
}

async function loadAndAuthNode(kv, nodeId, token) {
  const node = await loadNodeRecord(kv, nodeId)
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
    node.cpu_cores = toIntegerMetric(report.cpu_cores, { min: 1, max: 1024 })
    node.memory_used_mb = toMetric(report.memory_used_mb, { min: 0 })
    node.memory_total_mb = toMetric(report.memory_total_mb, { min: 0 })
    node.memory_usage_percent = toMetric(report.memory_usage_percent, { min: 0, max: 100 })
    node.disk_used_gb = toMetric(report.disk_used_gb, { min: 0 })
    node.disk_total_gb = toMetric(report.disk_total_gb, { min: 0 })
    node.disk_usage_percent = toMetric(report.disk_usage_percent, { min: 0, max: 100 })
    node.heartbeat_reported_at = now
    node.sing_box_version = toText(report.sing_box_version, 256)
    node.sing_box_status = toText(report.sing_box_status, 128)
    node.xray_version = toText(report.xray_version, 256)
    node.xray_status = toText(report.xray_status, 128)

    // WARP registration data + status
    if (report.warp_private_key !== undefined) node.warp_private_key = toText(report.warp_private_key, 256)
    if (report.warp_v6 !== undefined) node.warp_v6 = toText(report.warp_v6, 256)
    if (report.warp_reserved !== undefined) {
      node.warp_reserved = Array.isArray(report.warp_reserved) ? report.warp_reserved.map(Number) : []
    }
    if (report.warp_endpoint !== undefined) node.warp_endpoint = toText(report.warp_endpoint, 256)
    if (report.warp_status !== undefined) node.warp_status = toText(report.warp_status, 256)

    // Argo status
    if (report.argo_status !== undefined) node.argo_status = toText(report.argo_status, 256)
    if (report.argo_temp_domain !== undefined) {
      const nextArgoDomain = toText(report.argo_temp_domain, 256)
      if (nextArgoDomain) {
        node.argo_temp_domain = nextArgoDomain
      } else if (!node.argo_temp_domain) {
        node.argo_temp_domain = ''
      }
    }
  }

  await saveNodeRuntime(kv, node)

  return ok({
    node_id: node.id,
    desired_rev: Number(node.desired_rev || 0) || 0,
    current_version: Number(node.current_version || 0) || 0,
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
    cpu_cores: body.cpu_cores,
    memory_used_mb: body.memory_used_mb,
    memory_total_mb: body.memory_total_mb,
    memory_usage_percent: body.memory_usage_percent,
    disk_used_gb: body.disk_used_gb,
    disk_total_gb: body.disk_total_gb,
    disk_usage_percent: body.disk_usage_percent,
    sing_box_version: body.sing_box_version,
    sing_box_status: body.sing_box_status,
    xray_version: body.xray_version,
    xray_status: body.xray_status,
    warp_private_key: body.warp_private_key,
    warp_v6: body.warp_v6,
    warp_reserved: body.warp_reserved,
    warp_endpoint: body.warp_endpoint,
    warp_status: body.warp_status,
    argo_status: body.argo_status,
    argo_temp_domain: body.argo_temp_domain,
  }

  return applyHeartbeat(auth.node, report, kv)
}
