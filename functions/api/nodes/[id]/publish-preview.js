import { requireAdmin } from '../../../_lib/auth.js'
import { buildNodeConfigPreview } from '../../../_lib/artifact.js'
import { normalizeNodeTemplateIds, resolveTemplatesForPreview } from '../../../_lib/node-apply.js'
import { KEY, kvGetJson } from '../../../_lib/kv.js'
import { ok, fail } from '../../../_lib/response.js'

function calcNextVersion(node) {
  const currentVersion = Number(node.current_version || 0) || 0
  const targetVersion = Number(node.target_version || 0) || 0
  return Math.max(currentVersion, targetVersion, 0) + 1
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

  let resolved
  try {
    resolved = await resolveTemplatesForPreview(kv, node.node_type, requestedTemplateIds)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to build publish preview'
    return fail('VALIDATION', message, 400)
  }

  const nextVersion = calcNextVersion(node)
  const groupsMap = new Map((resolved.groups || []).map((group) => [group.engine, group.templates || []]))

  const previews = ['sing-box', 'xray'].map((engine) => {
    const templates = groupsMap.get(engine) || []
    if (templates.length === 0) {
      return {
        rev: nextVersion,
        engine,
        template_ids: [],
        template_names: [],
        config_name: engine === 'xray' ? 'xray.json' : 'sing-box.json',
        config_text: 'null\n',
      }
    }

    const preview = buildNodeConfigPreview({
      templates,
      params: {},
      engine,
      node,
    })

    return {
      rev: nextVersion,
      engine,
      template_ids: resolved.ids.filter((id) => templates.some((template) => template.id === id)),
      template_names: templates.map((template) => String(template.name || template.id)),
      config_name: preview.config_name,
      config_text: preview.config_text,
    }
  })

  return ok({
    node_id: node.id,
    node_name: String(node.name || ''),
    next_version: nextVersion,
    applied_template_ids: resolved.ids,
    publishable: true,
    publish_message: '',
    previews,
  })
}
