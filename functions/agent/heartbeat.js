import { KEY, kvGetJson, kvPutJson } from '../_lib/kv.js'
import { ok, fail } from '../_lib/response.js'

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const nodeId = String(url.searchParams.get('node_id') || '')
  const token = request.headers.get('X-Node-Token') || ''

  if (!nodeId) return fail('VALIDATION', 'node_id is required', 400)
  if (!token) return fail('UNAUTHORIZED', 'X-Node-Token is required', 401)

  const kv = env.NODEHUB_KV
  const node = await kvGetJson(kv, KEY.node(nodeId), null)
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)
  if (node.token !== token) return fail('UNAUTHORIZED', 'Invalid node token', 401)

  const now = new Date().toISOString()
  node.last_seen_at = now
  node.updated_at = now
  await kvPutJson(kv, KEY.node(node.id), node)

  return ok({
    node_id: node.id,
    desired_version: Number(node.desired_version || 0),
    applied_version: Number(node.applied_version || 0),
    last_seen_at: node.last_seen_at,
  })
}
