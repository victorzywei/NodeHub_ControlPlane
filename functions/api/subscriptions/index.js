import { requireAdmin } from '../../_lib/auth.js'
import { KEY, createToken, hydrateByIndex, indexUpsert, kvPutJson } from '../../_lib/kv.js'
import { ok, fail } from '../../_lib/response.js'

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const rows = await hydrateByIndex(kv, KEY.idxSubscriptions, KEY.subscription)
  rows.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
  return ok(rows)
}

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const body = await request.json().catch(() => ({}))
  const token = createToken()
  const now = new Date().toISOString()

  const sub = {
    token,
    name: String(body.name || ''),
    enabled: body.enabled === false ? false : true,
    visible_node_ids: Array.isArray(body.visible_node_ids) ? body.visible_node_ids : [],
    remark: String(body.remark || ''),
    created_at: now,
    updated_at: now,
  }

  if (!sub.name) return fail('VALIDATION', 'name is required', 400)

  await kvPutJson(kv, KEY.subscription(token), sub)
  await indexUpsert(kv, KEY.idxSubscriptions, { id: token, name: sub.name, updated_at: now })
  return ok(sub, { status: 201 })
}
