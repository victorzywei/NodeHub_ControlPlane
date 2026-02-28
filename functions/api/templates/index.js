import { requireAdmin } from '../../_lib/auth.js'
import { BUILTIN_TEMPLATES, TEMPLATE_REGISTRY } from '../../_lib/constants.js'
import { applyTemplateAutoDefaults } from '../../_lib/template.js'
import { KEY, createId, hydrateByIndex, indexUpsert, kvGetJson, kvPutJson } from '../../_lib/kv.js'
import { ok, fail } from '../../_lib/response.js'

function toDefaults(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

async function buildBuiltinRow(kv, base) {
  const now = new Date().toISOString()
  const override = await kvGetJson(kv, KEY.templateOverride(base.id), null)
  const mergedDefaults = {
    ...(base.defaults || {}),
    ...(override?.defaults || {}),
  }

  const defaults = applyTemplateAutoDefaults({
    protocol: base.protocol,
    transport: base.transport,
    tlsMode: base.tls_mode,
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
    await kvPutJson(kv, KEY.templateOverride(base.id), effectiveOverride)
  }

  return {
    ...base,
    name: effectiveOverride?.name || base.name,
    description: effectiveOverride?.description || base.description,
    defaults: {
      ...(base.defaults || {}),
      ...(effectiveOverride?.defaults || {}),
    },
    updated_at: effectiveOverride?.updated_at || base.updated_at || base.created_at || now,
  }
}

async function listBuiltinTemplates(kv) {
  return Promise.all(BUILTIN_TEMPLATES.map((base) => buildBuiltinRow(kv, base)))
}

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const builtinRows = await listBuiltinTemplates(kv)
  const customRows = await hydrateByIndex(kv, KEY.idxTemplates, KEY.template)

  const all = [...builtinRows, ...customRows]
  all.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind)))
  return ok(all)
}

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const body = await request.json().catch(() => ({}))

  const name = String(body.name || '').trim()
  const protocol = String(body.protocol || '').trim()
  const transport = String(body.transport || '').trim()
  const tlsMode = String(body.tls_mode || '').trim()

  if (!name) return fail('VALIDATION', 'name is required', 400)
  if (!protocol) return fail('VALIDATION', 'protocol is required', 400)
  if (!transport) return fail('VALIDATION', 'transport is required', 400)
  if (!tlsMode) return fail('VALIDATION', 'tls_mode is required', 400)

  const protocolKnown = TEMPLATE_REGISTRY.protocols.some((item) => item.key === protocol)
  const transportKnown = TEMPLATE_REGISTRY.transports.some((item) => item.key === transport)
  const tlsKnown = TEMPLATE_REGISTRY.tls_modes.some((item) => item.key === tlsMode)

  if (!protocolKnown || !transportKnown || !tlsKnown) {
    return fail('VALIDATION', 'Unknown protocol/transport/tls_mode', 400)
  }

  const id = createId('tpl')
  const now = new Date().toISOString()
  const defaults = applyTemplateAutoDefaults({
    protocol,
    transport,
    tlsMode,
    defaults: toDefaults(body.defaults),
  })

  const template = {
    id,
    kind: 'custom',
    name,
    protocol,
    transport,
    tls_mode: tlsMode,
    node_types: Array.isArray(body.node_types) && body.node_types.length > 0 ? body.node_types : ['vps', 'edge'],
    description: String(body.description || ''),
    defaults,
    created_at: now,
    updated_at: now,
  }

  await kvPutJson(kv, KEY.template(id), template)
  await indexUpsert(kv, KEY.idxTemplates, { id, name: template.name, updated_at: now })
  return ok(template, { status: 201 })
}