import { requireAdmin } from '../../../_lib/auth.js'
import { buildNodeConfigPreview } from '../../../_lib/artifact.js'
import {
  normalizeNodeTemplateIds,
  normalizeTemplateNodeTypes,
  resolveTemplateForApply,
  resolveTemplatesForPreview,
} from '../../../_lib/node-apply.js'
import { supportsTemplateCombination } from '../../../_lib/template-capability.js'
import { KEY, kvGetJson } from '../../../_lib/kv.js'
import { ok, fail } from '../../../_lib/response.js'

function calcNextVersion(node) {
  const currentVersion = Number(node.current_version || 0) || 0
  const desiredVersion = Number(node.desired_rev || 0) || 0
  return Math.max(currentVersion, desiredVersion, 0) + 1
}

export async function onRequestPost({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const node = await kvGetJson(kv, KEY.node(params.id))
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)

  const body = await request.json().catch(() => ({}))
  const rawTemplateIds = body.applied_template_ids !== undefined ? body.applied_template_ids : node.applied_template_ids
  const requestedTemplateIds = normalizeNodeTemplateIds(rawTemplateIds)
  const nextVersion = calcNextVersion(node)
  const validationErrors = []
  const validTemplateIds = []

  for (const id of requestedTemplateIds) {
    const template = await resolveTemplateForApply(kv, id)
    if (!template) {
      // Ignore deleted template ids in preview.
      continue
    }
    if (!normalizeTemplateNodeTypes(template.node_types).includes(node.node_type)) {
      continue
    }
    if (!supportsTemplateCombination(template.engine, template.protocol, template.transport, template.tls_mode)) {
      validationErrors.push(
        `template ${template.name || id} has unsupported protocol/tls/transport: ${template.protocol}/${template.tls_mode}/${template.transport}`,
      )
      continue
    }
    validTemplateIds.push(id)
  }

  let resolved
  if (validTemplateIds.length > 0) {
    try {
      resolved = await resolveTemplatesForPreview(kv, node.node_type, validTemplateIds)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to build publish preview'
      validationErrors.push(message)
      resolved = { ids: [], groups: [] }
    }
  } else {
    resolved = { ids: [], groups: [] }
  }

  const groupsMap = new Map((resolved.groups || []).map((group) => [group.engine, group.templates || []]))
  const previews = []
  const renderErrors = []

  for (const engine of ['sing-box', 'xray']) {
    const templates = groupsMap.get(engine) || []
    if (templates.length === 0) {
      previews.push({
        rev: nextVersion,
        engine,
        template_ids: [],
        template_names: [],
        config_name: engine === 'xray' ? 'xray.json' : 'sing-box.json',
        config_text: 'null\n',
      })
      continue
    }

    try {
      const preview = buildNodeConfigPreview({
        templates,
        params: {},
        engine,
        node,
      })

      previews.push({
        rev: nextVersion,
        engine,
        template_ids: resolved.ids.filter((id) => templates.some((template) => template.id === id)),
        template_names: templates.map((template) => String(template.name || template.id)),
        config_name: preview.config_name,
        config_text: preview.config_text,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to render preview'
      renderErrors.push(`${engine}: ${message}`)
      previews.push({
        rev: nextVersion,
        engine,
        template_ids: resolved.ids.filter((id) => templates.some((template) => template.id === id)),
        template_names: templates.map((template) => String(template.name || template.id)),
        config_name: engine === 'xray' ? 'xray.json' : 'sing-box.json',
        config_text: `# preview error\n# ${message}\n`,
      })
    }
  }

  return ok({
    node_id: node.id,
    node_name: String(node.name || ''),
    next_version: nextVersion,
    applied_template_ids: resolved.ids,
    publishable: validationErrors.length === 0 && renderErrors.length === 0,
    publish_message: [...validationErrors, ...renderErrors].join(' | '),
    previews,
  })
}
