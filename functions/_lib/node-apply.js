import { buildNodeArtifactBundle } from './artifact.js'
import { BUILTIN_TEMPLATES } from './constants.js'
import { KEY, createId, kvGetJson, kvPutJson } from './kv.js'
import { supportsTemplateCombination } from './template-capability.js'

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

function normalizePort(value, fallback = 443) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  const port = Math.floor(num)
  if (port < 1 || port > 65535) return fallback
  return port
}

function ensureUniqueTemplatePorts(templates) {
  const byPort = new Map()
  for (const template of templates) {
    const port = normalizePort(template?.defaults?.port, 443)
    if (!byPort.has(port)) byPort.set(port, [])
    byPort.get(port).push(template)
  }

  const duplicated = Array.from(byPort.entries()).filter(([, rows]) => rows.length > 1)
  if (duplicated.length === 0) return

  const message = duplicated
    .map(([port, rows]) => `${port}(${rows.map((row) => row.name || row.id).join('/')})`)
    .join(', ')
  throw new Error(`模板端口冲突: ${message}`)
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
  const preview = await resolveTemplatesForPreview(kv, nodeType, templateIds)
  return {
    ids: preview.ids,
    templates: preview.templates,
    groups: preview.groups,
    engine: preview.groups.length === 1 ? preview.groups[0].engine : 'multi',
  }
}

export async function resolveTemplatesForPreview(kv, nodeType, templateIds) {
  const ids = normalizeNodeTemplateIds(templateIds)
  const acceptedIds = []
  const templates = []

  for (const id of ids) {
    const template = await resolveTemplateForApply(kv, id)
    if (!template) {
      continue
    }
    if (!normalizeTemplateNodeTypes(template.node_types).includes(nodeType)) {
      continue
    }
    if (!supportsTemplateCombination(template.engine, template.protocol, template.transport, template.tls_mode)) {
      throw new Error(
        `template ${template.name || id} has unsupported protocol/tls/transport combination: ${template.protocol}/${template.tls_mode}/${template.transport}`,
      )
    }
    acceptedIds.push(id)
    templates.push(template)
  }

  ensureUniqueTemplatePorts(templates)

  const groupsMap = new Map()
  for (const template of templates) {
    const engine = normalizeTemplateEngine(template.engine)
    if (!groupsMap.has(engine)) groupsMap.set(engine, [])
    groupsMap.get(engine).push(template)
  }
  const groups = Array.from(groupsMap.entries()).map(([engine, rows]) => ({ engine, templates: rows }))

  return {
    ids: acceptedIds,
    templates,
    groups,
  }
}

function buildTargetArtifact(artifactId, artifact, nowIso) {
  return {
    id: artifactId,
    rev: artifact.rev,
    engine: artifact.engine,
    engines: Array.isArray(artifact.engines) ? artifact.engines : [],
    action_sing_box: String(artifact.action_sing_box || ''),
    action_xray: String(artifact.action_xray || ''),
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
  const templateGroups = Array.isArray(resolved.groups) ? resolved.groups : []
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
    templateGroups,
    params: {},
    createdAt: nowIso,
    engine: resolved.engine,
  })

  await kvPutJson(kv, KEY.artifact(artifactId), {
    id: artifactId,
    node_id: node.id,
    rev: artifact.rev,
    engine: artifact.engine,
    engines: artifact.engines || [],
    action_sing_box: String(artifact.action_sing_box || ''),
    action_xray: String(artifact.action_xray || ''),
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

