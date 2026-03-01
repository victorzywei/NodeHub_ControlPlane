import { requireAdmin } from '../../_lib/auth.js'
import { BUILTIN_TEMPLATES, TEMPLATE_REGISTRY } from '../../_lib/constants.js'
import { normalizeTemplateEngine, normalizeTemplateNodeTypes } from '../../_lib/node-apply.js'
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

function resolvePatchEngine(value, fallback) {
  if (value === undefined) return normalizeTemplateEngine(fallback)
  const engine = String(value || '').trim()
  const valid = TEMPLATE_REGISTRY.engines.some((item) => item.key === engine)
  if (!valid) throw new Error('Unknown engine')
  return engine
}

function engineSupportsProtocol(engine, protocol) {
  if (engine === 'xray' && protocol === 'hysteria2') return false
  return true
}

async function getMergedBuiltin(kv, id) {
  const builtin = findBuiltin(id)
  if (!builtin) return null

  const now = new Date().toISOString()
  const override = await kvGetJson(kv, KEY.templateOverride(id), null)
  const engine = normalizeTemplateEngine(override?.engine || builtin.engine)
  const nodeTypes = normalizeTemplateNodeTypes(override?.node_types || builtin.node_types)
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
    engine,
    node_types: nodeTypes,
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
  return ok({
    ...template,
    engine: normalizeTemplateEngine(template.engine),
    node_types: normalizeTemplateNodeTypes(template.node_types),
  })
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
    let nextEngine
    try {
      nextEngine = resolvePatchEngine(body.engine, existing.engine || builtin.engine)
    } catch {
      return fail('VALIDATION', 'Unknown engine', 400)
    }
    if (!engineSupportsProtocol(nextEngine, builtin.protocol)) {
      return fail('VALIDATION', 'selected engine does not support the protocol', 400)
    }
    const nextNodeTypes = body.node_types !== undefined ? normalizeTemplateNodeTypes(body.node_types) : normalizeTemplateNodeTypes(existing.node_types || builtin.node_types)
    const mergedDefaults = {
      ...(builtin.defaults || {}),
      ...(existing.defaults || {}),
      ...toDefaults(body.defaults),
    }

    const override = {
      ...existing,
      name: body.name !== undefined ? String(body.name) : existing.name,
      description: body.description !== undefined ? String(body.description) : existing.description,
      engine: nextEngine,
      node_types: nextNodeTypes,
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
  try {
    current.engine = resolvePatchEngine(body.engine, current.engine)
  } catch {
    return fail('VALIDATION', 'Unknown engine', 400)
  }
  if (!engineSupportsProtocol(current.engine, current.protocol)) {
    return fail('VALIDATION', 'selected engine does not support the protocol', 400)
  }
  if (body.node_types !== undefined) current.node_types = normalizeTemplateNodeTypes(body.node_types)
  current.node_types = normalizeTemplateNodeTypes(current.node_types)

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
