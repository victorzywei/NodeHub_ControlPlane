import { requireAdmin } from '../../_lib/auth.js'
import { BUILTIN_TEMPLATES } from '../../_lib/constants.js'
import { applyTemplateAutoDefaults } from '../../_lib/template.js'
import { KEY, indexRemove, kvDelete, kvGetJson, kvPutJson } from '../../_lib/kv.js'
import { ok, fail } from '../../_lib/response.js'

function findBuiltin(id) {
  return BUILTIN_TEMPLATES.find((item) => item.id === id)
}

function toDefaults(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

async function getMergedBuiltin(kv, id) {
  const builtin = findBuiltin(id)
  if (!builtin) return null

  const now = new Date().toISOString()
  const override = await kvGetJson(kv, KEY.templateOverride(id), null)
  const mergedDefaults = {
    ...(builtin.defaults || {}),
    ...(override?.defaults || {}),
  }

  const defaults = applyTemplateAutoDefaults({
    protocol: builtin.protocol,
    transport: builtin.transport,
    tlsMode: builtin.tls_mode,
    defaults: mergedDefaults,
  })

  let effectiveOverride = override
  if (JSON.stringify(defaults) !== JSON.stringify(mergedDefaults)) {
    effectiveOverride = {
      ...(override || {}),
      defaults: {
        ...(override?.defaults || {}),
        ...defaults,
      },
      updated_at: now,
    }
    await kvPutJson(kv, KEY.templateOverride(id), effectiveOverride)
  }

  return {
    ...builtin,
    name: effectiveOverride?.name || builtin.name,
    description: effectiveOverride?.description || builtin.description,
    defaults: {
      ...(builtin.defaults || {}),
      ...(effectiveOverride?.defaults || {}),
    },
    updated_at: effectiveOverride?.updated_at || builtin.updated_at || builtin.created_at || now,
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
    const mergedDefaults = {
      ...(builtin.defaults || {}),
      ...(existing.defaults || {}),
      ...toDefaults(body.defaults),
    }

    const override = {
      ...existing,
      name: body.name !== undefined ? String(body.name) : existing.name,
      description: body.description !== undefined ? String(body.description) : existing.description,
      defaults: applyTemplateAutoDefaults({
        protocol: builtin.protocol,
        transport: builtin.transport,
        tlsMode: builtin.tls_mode,
        defaults: mergedDefaults,
      }),
      updated_at: now,
    }
    await kvPutJson(kv, KEY.templateOverride(params.id), override)
    return ok(await getMergedBuiltin(kv, params.id))
  }

  const current = await kvGetJson(kv, KEY.template(params.id), null)
  if (!current) return fail('NOT_FOUND', 'Template not found', 404)

  if (body.name !== undefined) current.name = String(body.name)
  if (body.description !== undefined) current.description = String(body.description)
  if (body.node_types !== undefined) current.node_types = body.node_types

  const mergedDefaults = {
    ...(current.defaults || {}),
    ...toDefaults(body.defaults),
  }

  current.defaults = applyTemplateAutoDefaults({
    protocol: current.protocol,
    transport: current.transport,
    tlsMode: current.tls_mode,
    defaults: mergedDefaults,
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