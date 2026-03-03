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
