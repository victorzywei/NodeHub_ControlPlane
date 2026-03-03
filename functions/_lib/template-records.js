import { BUILTIN_TEMPLATES } from './constants.js'
import { KEY, kvGetJson, kvPutJson } from './kv.js'
import { normalizeTemplateEngine, normalizeTemplateNodeTypes } from './node-apply.js'
import { applyTemplateAutoDefaults } from './template.js'

export function toDefaults(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

export function engineSupportsProtocol(engine, protocol) {
  return true
}

const PROTOCOL_TLS_SUPPORT = {
  vless: ['none', 'tls', 'reality'],
  trojan: ['tls'],
  vmess: ['none', 'tls'],
  hysteria2: ['tls'],
  shadowsocks2022: ['none'],
}

const PROTOCOL_TRANSPORT_SUPPORT = {
  vless: ['tcp', 'mkcp', 'ws', 'grpc', 'httpupgrade', 'xhttp', 'h2'],
  trojan: ['tcp', 'mkcp', 'ws', 'grpc', 'httpupgrade', 'xhttp', 'h2'],
  vmess: ['tcp', 'mkcp', 'ws', 'grpc', 'httpupgrade', 'xhttp', 'h2'],
  hysteria2: ['udp'],
  shadowsocks2022: ['tcp', 'udp'],
}

export function supportsTemplateCombination(engine, protocol, transport, tlsMode) {
  const p = String(protocol || '').trim().toLowerCase()
  const t = String(transport || '').trim().toLowerCase()
  const tls = String(tlsMode || '').trim().toLowerCase()
  const e = normalizeTemplateEngine(engine)

  const allowedTls = PROTOCOL_TLS_SUPPORT[p]
  if (!allowedTls || !allowedTls.includes(tls)) return false

  const allowedTransport = PROTOCOL_TRANSPORT_SUPPORT[p]
  if (!allowedTransport || !allowedTransport.includes(t)) return false

  if (e !== 'xray' && (t === 'mkcp' || t === 'xhttp')) return false

  if (tls === 'reality') {
    if (p !== 'vless') return false
    if (e === 'xray') return t === 'tcp' || t === 'grpc' || t === 'xhttp'
    return t === 'tcp' || t === 'grpc'
  }

  return true
}

export function findBuiltinTemplate(id) {
  return BUILTIN_TEMPLATES.find((item) => item.id === id)
}

async function buildBuiltinRow(kv, base) {
  const now = new Date().toISOString()
  const override = await kvGetJson(kv, KEY.templateOverride(base.id), null)
  const engine = normalizeTemplateEngine(override?.engine || base.engine)
  const nodeTypes = normalizeTemplateNodeTypes(override?.node_types || base.node_types)
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
    engine,
    node_types: nodeTypes,
    defaults: {
      ...(base.defaults || {}),
      ...(effectiveOverride?.defaults || {}),
    },
    updated_at: effectiveOverride?.updated_at || base.updated_at || base.created_at || now,
  }
}

export async function getMergedBuiltinTemplate(kv, id) {
  const builtin = findBuiltinTemplate(id)
  if (!builtin) return null
  return buildBuiltinRow(kv, builtin)
}

export async function listBuiltinTemplates(kv) {
  return Promise.all(BUILTIN_TEMPLATES.map((base) => buildBuiltinRow(kv, base)))
}

export function normalizeCustomTemplate(row) {
  return {
    ...row,
    engine: normalizeTemplateEngine(row.engine),
    node_types: normalizeTemplateNodeTypes(row.node_types),
  }
}
