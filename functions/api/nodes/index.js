import { requireAdmin } from '../../_lib/auth.js'
import { ONLINE_WINDOW_MS } from '../../_lib/constants.js'
import { KEY, createId, createToken, hydrateByIndex, indexUpsert, kvPutJson } from '../../_lib/kv.js'
import { ok, fail } from '../../_lib/response.js'

function normalizeNode(node) {
  const lastSeen = node.last_seen_at ? new Date(node.last_seen_at).getTime() : 0
  const online = Date.now() - lastSeen <= ONLINE_WINDOW_MS

  const cpuUsage = Number(node.cpu_usage_percent)
  const memoryUsed = Number(node.memory_used_mb)
  const memoryTotal = Number(node.memory_total_mb)
  const memoryUsage = Number(node.memory_usage_percent)
  const desiredConfig =
    node.desired_config && typeof node.desired_config === 'object' && !Array.isArray(node.desired_config)
      ? node.desired_config
      : null

  return {
    ...node,
    deploy_info: String(node.deploy_info || ''),
    protocol_app_version: String(node.protocol_app_version || ''),
    last_heartbeat_error: String(node.last_heartbeat_error || ''),
    cpu_usage_percent: Number.isFinite(cpuUsage) ? cpuUsage : null,
    memory_used_mb: Number.isFinite(memoryUsed) ? memoryUsed : null,
    memory_total_mb: Number.isFinite(memoryTotal) ? memoryTotal : null,
    memory_usage_percent: Number.isFinite(memoryUsage) ? memoryUsage : null,
    heartbeat_reported_at: node.heartbeat_reported_at ? String(node.heartbeat_reported_at) : null,
    desired_config: desiredConfig,
    desired_config_summary: String(node.desired_config_summary || ''),
    applied_config_summary: String(node.applied_config_summary || ''),
    github_mirror: String(node.github_mirror || ''),
    cf_api_token: String(node.cf_api_token || ''),
    online,
  }
}

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  if (!kv) return fail('CONFIG_ERROR', 'NODEHUB_KV is missing', 500)

  const nodes = await hydrateByIndex(kv, KEY.idxNodes, KEY.node)
  nodes.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  return ok(nodes.map(normalizeNode))
}

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  if (!kv) return fail('CONFIG_ERROR', 'NODEHUB_KV is missing', 500)

  const body = await request.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  const nodeType = String(body.node_type || '').trim()

  if (!name) return fail('VALIDATION', 'name is required', 400)
  if (!['vps', 'edge'].includes(nodeType)) {
    return fail('VALIDATION', 'node_type must be vps or edge', 400)
  }

  const id = createId('node')
  const now = new Date().toISOString()
  const node = {
    id,
    name,
    node_type: nodeType,
    region: String(body.region || ''),
    tags: Array.isArray(body.tags) ? body.tags.map((item) => String(item)) : [],
    entry_cdn: String(body.entry_cdn || ''),
    entry_direct: String(body.entry_direct || ''),
    entry_ip: String(body.entry_ip || ''),
    github_mirror: String(body.github_mirror || ''),
    cf_api_token: String(body.cf_api_token || ''),
    token: createToken(),
    desired_version: 0,
    applied_version: 0,
    last_seen_at: null,
    deploy_info: '',
    protocol_app_version: '',
    last_heartbeat_error: '',
    cpu_usage_percent: null,
    memory_used_mb: null,
    memory_total_mb: null,
    memory_usage_percent: null,
    heartbeat_reported_at: null,
    desired_config: null,
    desired_config_summary: '',
    applied_config_summary: '',
    last_release_status: 'idle',
    last_release_message: '',
    created_at: now,
    updated_at: now,
  }

  await kvPutJson(kv, KEY.node(id), node)
  await indexUpsert(kv, KEY.idxNodes, { id, name: node.name, updated_at: now })

  return ok(normalizeNode(node), { status: 201 })
}
