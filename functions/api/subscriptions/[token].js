import { requireAdmin } from '../../_lib/auth.js'
import { KEY, indexRemove, kvDelete, kvGetJson, kvPutJson } from '../../_lib/kv.js'
import { ok, fail } from '../../_lib/response.js'

export async function onRequestGet({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const sub = await kvGetJson(kv, KEY.subscription(params.token), null)
  if (!sub) return fail('NOT_FOUND', 'Subscription not found', 404)
  return ok(sub)
}

export async function onRequestPatch({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const sub = await kvGetJson(kv, KEY.subscription(params.token), null)
  if (!sub) return fail('NOT_FOUND', 'Subscription not found', 404)

  const body = await request.json().catch(() => ({}))
  const fields = ['name', 'enabled', 'visible_node_ids', 'remark']
  fields.forEach((field) => {
    if (body[field] !== undefined) sub[field] = body[field]
  })
  sub.updated_at = new Date().toISOString()

  await kvPutJson(kv, KEY.subscription(sub.token), sub)
  return ok(sub)
}

export async function onRequestDelete({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  await kvDelete(kv, KEY.subscription(params.token))
  await indexRemove(kv, KEY.idxSubscriptions, params.token)
  return ok({ deleted: params.token })
}
