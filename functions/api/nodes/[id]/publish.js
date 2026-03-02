import { requireAdmin } from '../../../_lib/auth.js'
import { normalizeNodeTemplateIds, queueNodeTemplateApply } from '../../../_lib/node-apply.js'
import { KEY, indexUpsert, kvGetJson, kvPutJson } from '../../../_lib/kv.js'
import { normalizeNode } from '../../../_lib/node.js'
import { ok, fail } from '../../../_lib/response.js'

export async function onRequestPost({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const node = await kvGetJson(kv, KEY.node(params.id))
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)

  const body = await request.json().catch(() => ({}))
  const rawTemplateIds = body.applied_template_ids !== undefined ? body.applied_template_ids : body.template_ids
  if (rawTemplateIds === undefined) {
    return fail('VALIDATION', 'applied_template_ids is required', 400)
  }

  const templateIds = normalizeNodeTemplateIds(rawTemplateIds)
  const nowIso = new Date().toISOString()

  try {
    await queueNodeTemplateApply({
      kv,
      node,
      templateIds,
      nowIso,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to publish templates'
    return fail('VALIDATION', message, 400)
  }

  node.updated_at = nowIso
  await kvPutJson(kv, KEY.node(node.id), node)
  await indexUpsert(kv, KEY.idxNodes, { id: node.id, name: node.name, updated_at: nowIso })

  return ok(normalizeNode(node))
}
