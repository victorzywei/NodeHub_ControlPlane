import { requireAdmin } from '../../_lib/auth.js'
import { TEMPLATE_REGISTRY } from '../../_lib/constants.js'
import { normalizeTemplateEngine, normalizeTemplateNodeTypes } from '../../_lib/node-apply.js'
import { supportsTemplateCombination } from '../../_lib/template-capability.js'
import { applyTemplateAutoDefaults } from '../../_lib/template.js'
import {
  engineSupportsProtocol,
  findBuiltinTemplate,
  getMergedBuiltinTemplate,
  toDefaults,
} from '../../_lib/template-records.js'
import { KEY, kvDelete, kvGetJson, kvPutJson } from '../../_lib/kv.js'
import { ok, fail } from '../../_lib/response.js'

function resolvePatchEngine(value, fallback) {
  if (value === undefined) return normalizeTemplateEngine(fallback)
  const engine = String(value || '').trim()
  const valid = TEMPLATE_REGISTRY.engines.some((item) => item.key === engine)
  if (!valid) throw new Error('Unknown engine')
  return engine
}

function resolvePatchTransport(value, fallback) {
  if (value === undefined) return String(fallback || '').trim()
  return String(value || '').trim()
}

function resolvePatchTlsMode(value, fallback) {
  if (value === undefined) return String(fallback || '').trim()
  return String(value || '').trim()
}

export async function onRequestGet({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const builtin = await getMergedBuiltinTemplate(kv, params.id)
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

  const builtin = findBuiltinTemplate(params.id)
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
    const nextTransport = resolvePatchTransport(body.transport, builtin.transport)
    const nextTlsMode = resolvePatchTlsMode(body.tls_mode, builtin.tls_mode)
    if (!supportsTemplateCombination(nextEngine, builtin.protocol, nextTransport, nextTlsMode)) {
      return fail('VALIDATION', 'selected protocol/tls_mode/transport combination is not supported', 400)
    }
    const nextNodeTypes =
      body.node_types !== undefined
        ? normalizeTemplateNodeTypes(body.node_types)
        : normalizeTemplateNodeTypes(existing.node_types || builtin.node_types)
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
      warp_exit: body.warp_exit !== undefined ? body.warp_exit === true : (existing.warp_exit || false),
      warp_route_mode: body.warp_route_mode !== undefined ? String(body.warp_route_mode) : (existing.warp_route_mode || 'all'),
      defaults: applyTemplateAutoDefaults({
        protocol: builtin.protocol,
        transport: builtin.transport,
        tlsMode: builtin.tls_mode,
        defaults: mergedDefaults,
      }),
      updated_at: now,
    }
    await kvPutJson(kv, KEY.templateOverride(params.id), override)
    return ok(await getMergedBuiltinTemplate(kv, params.id))
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
  const nextTransport = resolvePatchTransport(body.transport, current.transport)
  const nextTlsMode = resolvePatchTlsMode(body.tls_mode, current.tls_mode)
  if (!supportsTemplateCombination(current.engine, current.protocol, nextTransport, nextTlsMode)) {
    return fail('VALIDATION', 'selected protocol/tls_mode/transport combination is not supported', 400)
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

  if (body.warp_exit !== undefined) current.warp_exit = body.warp_exit === true
  if (body.warp_route_mode !== undefined) current.warp_route_mode = String(body.warp_route_mode)

  current.updated_at = now
  await kvPutJson(kv, KEY.template(current.id), current)
  return ok(current)
}

export async function onRequestDelete({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const builtin = findBuiltinTemplate(params.id)

  if (builtin) {
    await kvDelete(kv, KEY.templateOverride(params.id))
    return ok({ deleted: params.id, action: 'reset_builtin' })
  }

  await kvDelete(kv, KEY.template(params.id))
  return ok({ deleted: params.id })
}
