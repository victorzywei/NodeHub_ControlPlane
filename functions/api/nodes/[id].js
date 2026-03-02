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
  const stringFields = ['name', 'region', 'entry_cdn', 'entry_direct', 'entry_ip', 'github_mirror', 'cf_api_token']

  stringFields.forEach((field) => {
    if (body[field] !== undefined) {
      node[field] = String(body[field])
    }
  })

  if (body.tags !== undefined) {
    node.tags = Array.isArray(body.tags) ? body.tags.map((item) => String(item)) : []
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
