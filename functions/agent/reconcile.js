import { KEY, kvGetJson, kvPutJson } from '../_lib/kv.js'
import { ok, fail } from '../_lib/response.js'

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const nodeId = String(url.searchParams.get('node_id') || '')
  const currentVersion = Number(url.searchParams.get('current_version') || 0)
  const token = request.headers.get('X-Node-Token') || ''

  if (!nodeId) return fail('VALIDATION', 'node_id is required', 400)
  if (!token) return fail('UNAUTHORIZED', 'X-Node-Token is required', 401)

  const kv = env.NODEHUB_KV
  const node = await kvGetJson(kv, KEY.node(nodeId), null)
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)
  if (node.token !== token) return fail('UNAUTHORIZED', 'Invalid node token', 401)

  const nextAppliedVersion = Number.isFinite(currentVersion) ? Math.max(0, Math.floor(currentVersion)) : 0
  if (nextAppliedVersion !== Number(node.applied_version || 0)) {
    node.applied_version = nextAppliedVersion
    if (nextAppliedVersion >= Number(node.desired_version || 0) && node.desired_config_summary) {
      node.applied_config_summary = String(node.desired_config_summary || '')
    }
    node.updated_at = new Date().toISOString()
    await kvPutJson(kv, KEY.node(node.id), node)
  }

  return ok({
    node_id: node.id,
    current_version: Number(node.applied_version || 0),
    desired_version: Number(node.desired_version || 0),
    desired_config: node.desired_config && typeof node.desired_config === 'object' ? node.desired_config : null,
    desired_config_summary: String(node.desired_config_summary || ''),
    needs_update: Number(node.desired_version || 0) > Number(node.applied_version || 0),
  })
}
