import { requireAdmin } from '../../_lib/auth.js'
import { ONLINE_WINDOW_MS } from '../../_lib/constants.js'
import { KEY, indexRemove, indexUpsert, kvDelete, kvGetJson, kvPutJson } from '../../_lib/kv.js'
import { ok, fail } from '../../_lib/response.js'

function normalizeNode(node) {
  const lastSeen = node.last_seen_at ? new Date(node.last_seen_at).getTime() : 0
  const online = Date.now() - lastSeen <= ONLINE_WINDOW_MS
  const cpuUsage = Number(node.cpu_usage_percent)
  const memoryUsed = Number(node.memory_used_mb)
  const memoryTotal = Number(node.memory_total_mb)
  const memoryUsage = Number(node.memory_usage_percent)

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
    online,
  }
}

export async function onRequestGet({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const node = await kvGetJson(kv, KEY.node(params.id))
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)
  return ok(normalizeNode(node))
}

export async function onRequestPatch({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const node = await kvGetJson(kv, KEY.node(params.id))
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)

  const body = await request.json().catch(() => ({}))
  const fields = ['name', 'region', 'tags', 'entry_cdn', 'entry_direct', 'entry_ip']
  fields.forEach((field) => {
    if (body[field] !== undefined) {
      node[field] = field === 'tags' ? body.tags : String(body[field])
    }
  })

  node.updated_at = new Date().toISOString()
  await kvPutJson(kv, KEY.node(node.id), node)
  await indexUpsert(kv, KEY.idxNodes, { id: node.id, name: node.name, updated_at: node.updated_at })

  return ok(normalizeNode(node))
}

export async function onRequestDelete({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  await kvDelete(kv, KEY.node(params.id))
  await indexRemove(kv, KEY.idxNodes, params.id)
  return ok({ deleted: params.id })
}
