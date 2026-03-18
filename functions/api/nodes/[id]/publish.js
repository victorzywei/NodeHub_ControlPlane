import { requireAdmin } from '../../../_lib/auth.js'
import { normalizeNodeTemplateIds, queueNodeTemplateApply } from '../../../_lib/node-apply.js'
import { normalizeNode } from '../../../_lib/node.js'
import { loadNodeRecord, saveNodeDesired } from '../../../_lib/node-store.js'
import { ok, fail } from '../../../_lib/response.js'

export async function onRequestPost({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const node = await loadNodeRecord(kv, params.id)
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
  await saveNodeDesired(kv, node)

  return ok(normalizeNode(node))
}
