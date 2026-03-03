import { requireAdmin } from '../../_lib/auth.js'
import { KEY, indexRemove, indexUpsert, kvDelete, kvGetJson, kvPutJson } from '../../_lib/kv.js'
import { normalizeNode } from '../../_lib/node.js'
import { ok, fail } from '../../_lib/response.js'

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
  const stringFields = ['name', 'region', 'entry_cdn', 'entry_direct', 'entry_ip', 'github_mirror', 'cf_api_token',
    'warp_mode', 'warp_private_key', 'warp_v6', 'warp_endpoint', 'argo_token', 'argo_domain']

  stringFields.forEach((field) => {
    if (body[field] !== undefined) {
      node[field] = String(body[field])
    }
  })

  if (body.tags !== undefined) {
    node.tags = Array.isArray(body.tags) ? body.tags.map((item) => String(item)) : []
  }

  // Boolean fields
  if (body.warp_enabled !== undefined) node.warp_enabled = body.warp_enabled === true
  if (body.argo_enabled !== undefined) node.argo_enabled = body.argo_enabled === true

  // Array/Number fields
  if (body.warp_reserved !== undefined) {
    node.warp_reserved = Array.isArray(body.warp_reserved) ? body.warp_reserved.map(Number) : []
  }
  if (body.argo_port !== undefined) {
    node.argo_port = Number(body.argo_port) || 0
  }

  const nowIso = new Date().toISOString()
  node.updated_at = nowIso
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
