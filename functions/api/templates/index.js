import { requireAdmin } from '../../_lib/auth.js'
import { TEMPLATE_REGISTRY } from '../../_lib/constants.js'
import { normalizeTemplateNodeTypes } from '../../_lib/node-apply.js'
import { applyTemplateAutoDefaults } from '../../_lib/template.js'
import {
  engineSupportsProtocol,
  listBuiltinTemplates,
  normalizeCustomTemplate,
  supportsTemplateCombination,
  toDefaults,
} from '../../_lib/template-records.js'
import { KEY, createId, hydrateByIndex, indexUpsert, kvPutJson } from '../../_lib/kv.js'
import { ok, fail } from '../../_lib/response.js'

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const builtinRows = await listBuiltinTemplates(kv)
  const customRows = (await hydrateByIndex(kv, KEY.idxTemplates, KEY.template)).map(normalizeCustomTemplate)

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
  const engine = String(body.engine || '').trim()
  const protocol = String(body.protocol || '').trim()
  const transport = String(body.transport || '').trim()
  const tlsMode = String(body.tls_mode || '').trim()

  if (!name) return fail('VALIDATION', 'name is required', 400)
  if (!engine) return fail('VALIDATION', 'engine is required', 400)
  if (!protocol) return fail('VALIDATION', 'protocol is required', 400)
  if (!transport) return fail('VALIDATION', 'transport is required', 400)
  if (!tlsMode) return fail('VALIDATION', 'tls_mode is required', 400)

  const engineKnown = TEMPLATE_REGISTRY.engines.some((item) => item.key === engine)
  const protocolKnown = TEMPLATE_REGISTRY.protocols.some((item) => item.key === protocol)
  const transportKnown = TEMPLATE_REGISTRY.transports.some((item) => item.key === transport)
  const tlsKnown = TEMPLATE_REGISTRY.tls_modes.some((item) => item.key === tlsMode)

  if (!engineKnown || !protocolKnown || !transportKnown || !tlsKnown) {
    return fail('VALIDATION', 'Unknown engine/protocol/transport/tls_mode', 400)
  }
  if (!engineSupportsProtocol(engine, protocol)) {
    return fail('VALIDATION', 'selected engine does not support the protocol', 400)
  }
  if (!supportsTemplateCombination(engine, protocol, transport, tlsMode)) {
    return fail('VALIDATION', 'selected protocol/tls_mode/transport combination is not supported', 400)
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
    engine,
    protocol,
    transport,
    tls_mode: tlsMode,
    node_types: normalizeTemplateNodeTypes(body.node_types),
    description: String(body.description || ''),
    defaults,
    created_at: now,
    updated_at: now,
  }

  await kvPutJson(kv, KEY.template(id), template)
  await indexUpsert(kv, KEY.idxTemplates, { id, name: template.name, updated_at: now })
  return ok(template, { status: 201 })
}
