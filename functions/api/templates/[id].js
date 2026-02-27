import { requireAdmin } from '../../_lib/auth.js'
import { BUILTIN_TEMPLATES } from '../../_lib/constants.js'
import { KEY, indexRemove, kvDelete, kvGetJson, kvPutJson } from '../../_lib/kv.js'
import { ok, fail } from '../../_lib/response.js'

function findBuiltin(id) {
  return BUILTIN_TEMPLATES.find((item) => item.id === id)
}

async function getMergedBuiltin(kv, id) {
  const builtin = findBuiltin(id)
  if (!builtin) return null
  const override = await kvGetJson(kv, KEY.templateOverride(id), null)
  if (!override) return { ...builtin }
  return {
    ...builtin,
    name: override.name || builtin.name,
    description: override.description || builtin.description,
    defaults: {
      ...(builtin.defaults || {}),
      ...(override.defaults || {}),
    },
    updated_at: override.updated_at || builtin.updated_at || builtin.created_at || new Date().toISOString(),
  }
}

export async function onRequestGet({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const builtin = await getMergedBuiltin(kv, params.id)
  if (builtin) return ok(builtin)

  const template = await kvGetJson(kv, KEY.template(params.id), null)
  if (!template) return fail('NOT_FOUND', 'Template not found', 404)
  return ok(template)
}

export async function onRequestPatch({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const body = await request.json().catch(() => ({}))
  const now = new Date().toISOString()

  const builtin = findBuiltin(params.id)
  if (builtin) {
    const existing = await kvGetJson(kv, KEY.templateOverride(params.id), {})
    const override = {
      ...existing,
      name: body.name !== undefined ? String(body.name) : existing.name,
      description: body.description !== undefined ? String(body.description) : existing.description,
      defaults: {
        ...(existing.defaults || {}),
        ...(body.defaults || {}),
      },
      updated_at: now,
    }
    await kvPutJson(kv, KEY.templateOverride(params.id), override)
    return ok(await getMergedBuiltin(kv, params.id))
  }

  const current = await kvGetJson(kv, KEY.template(params.id), null)
  if (!current) return fail('NOT_FOUND', 'Template not found', 404)

  const fields = ['name', 'description', 'defaults', 'node_types']
  fields.forEach((field) => {
    if (body[field] !== undefined) current[field] = body[field]
  })

  current.updated_at = now
  await kvPutJson(kv, KEY.template(current.id), current)
  return ok(current)
}

export async function onRequestDelete({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const builtin = findBuiltin(params.id)

  if (builtin) {
    await kvDelete(kv, KEY.templateOverride(params.id))
    return ok({ deleted: params.id, action: 'reset_builtin' })
  }

  await kvDelete(kv, KEY.template(params.id))
  await indexRemove(kv, KEY.idxTemplates, params.id)
  return ok({ deleted: params.id })
}
