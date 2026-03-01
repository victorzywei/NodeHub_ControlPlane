import { buildNodeArtifactBundle } from './artifact.js'
import { BUILTIN_TEMPLATES } from './constants.js'
import { KEY, createId, kvGetJson, kvPutJson } from './kv.js'

const NODE_TYPES = new Set(['vps', 'edge'])
const ENGINES = new Set(['sing-box', 'xray'])

function uniqStringArray(values) {
  if (!Array.isArray(values)) return []
  const seen = new Set()
  const result = []
  for (const value of values) {
    const item = String(value || '').trim()
    if (!item || seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

export function normalizeTemplateNodeTypes(values) {
  const nodeTypes = uniqStringArray(values).filter((item) => NODE_TYPES.has(item))
  return nodeTypes.length > 0 ? nodeTypes : ['vps', 'edge']
}

export function normalizeTemplateEngine(value) {
  const engine = String(value || '').trim()
  return ENGINES.has(engine) ? engine : 'sing-box'
}

export function normalizeNodeTemplateIds(values) {
  return uniqStringArray(values)
}

async function getTemplateOverride(kv, templateId) {
  return kvGetJson(kv, KEY.templateOverride(templateId), null)
}

function mergeTemplate(base, override) {
  return {
    ...base,
    name: override?.name || base.name,
    description: override?.description || base.description,
    engine: normalizeTemplateEngine(override?.engine || base.engine),
    node_types: normalizeTemplateNodeTypes(override?.node_types || base.node_types),
    defaults: {
      ...(base.defaults || {}),
      ...(override?.defaults || {}),
    },
  }
}

export async function resolveTemplateForApply(kv, templateId) {
  const builtin = BUILTIN_TEMPLATES.find((item) => item.id === templateId)
  if (builtin) {
    const override = await getTemplateOverride(kv, templateId)
    return mergeTemplate(builtin, override)
  }

  const custom = await kvGetJson(kv, KEY.template(templateId), null)
  if (!custom) return null
  return {
    ...custom,
    engine: normalizeTemplateEngine(custom.engine),
    node_types: normalizeTemplateNodeTypes(custom.node_types),
  }
}

export async function resolveTemplatesForNode(kv, nodeType, templateIds) {
  const ids = normalizeNodeTemplateIds(templateIds)
  const templates = []

  for (const id of ids) {
    const template = await resolveTemplateForApply(kv, id)
    if (!template) {
      throw new Error(`template not found: ${id}`)
    }
    if (!normalizeTemplateNodeTypes(template.node_types).includes(nodeType)) {
      throw new Error(`template ${template.name || id} does not support node type ${nodeType}`)
    }
    templates.push(template)
  }

  const engines = new Set(templates.map((item) => normalizeTemplateEngine(item.engine)))
  if (engines.size > 1) {
    throw new Error('selected templates must use the same engine')
  }

  return {
    ids,
    templates,
    engine: engines.size === 1 ? [...engines][0] : 'sing-box',
  }
}

function buildTargetArtifact(artifactId, artifact, nowIso) {
  return {
    id: artifactId,
    rev: artifact.rev,
    engine: artifact.engine,
    reload_cmd: artifact.reload_cmd,
    sha256: artifact.sha256,
    summary: artifact.summary,
    template_names: artifact.template_names,
    params: artifact.params || {},
    subscription_outbounds: artifact.subscription_outbounds || [],
    created_at: nowIso,
  }
}

export async function queueNodeTemplateApply({ kv, node, templateIds, nowIso }) {
  const resolved = await resolveTemplatesForNode(kv, node.node_type, templateIds)
  const currentVersion = Number(node.current_version || 0) || 0
  const targetVersion = Number(node.target_version || 0) || 0
  const nextVersion = Math.max(currentVersion, targetVersion, 0) + 1
  const operationId = createId('op')
  const artifactId = createId('artifact')

  const artifact = await buildNodeArtifactBundle({
    node,
    rev: nextVersion,
    operationId,
    templates: resolved.templates,
    params: {},
    createdAt: nowIso,
    engine: resolved.engine,
  })

  await kvPutJson(kv, KEY.artifact(artifactId), {
    id: artifactId,
    node_id: node.id,
    rev: artifact.rev,
    engine: artifact.engine,
    reload_cmd: artifact.reload_cmd,
    sha256: artifact.sha256,
    bundle: artifact.bundle,
    created_at: nowIso,
  })

  node.applied_template_ids = resolved.ids
  node.target_version = nextVersion
  node.target_artifact = buildTargetArtifact(artifactId, artifact, nowIso)
  node.last_release_status = 'pending'
  node.last_release_error_code = ''
  node.last_release_message = resolved.templates.length > 0 ? `templates queued r${nextVersion}` : `templates cleared r${nextVersion}`
}
