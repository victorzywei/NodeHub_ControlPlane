import { requireAdmin } from '../../_lib/auth.js'
import { KEY, indexUpsert, kvGetJson, kvPutJson, readIndex } from '../../_lib/kv.js'
import { normalizeNodeTemplateIds, normalizeTemplateNodeTypes, resolveTemplateForApply } from '../../_lib/node-apply.js'
import { supportsTemplateCombination } from '../../_lib/template-capability.js'
import { ok, fail } from '../../_lib/response.js'

function differs(a, b) {
  if (a.length !== b.length) return true
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return true
  }
  return false
}

function toBoolean(value, fallback) {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return fallback
}

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  if (!kv) return fail('CONFIG_ERROR', 'NODEHUB_KV is missing', 500)

  const body = await request.json().catch(() => ({}))
  const dryRun = toBoolean(body?.dry_run, true)
  const nowIso = new Date().toISOString()

  const indexRows = await readIndex(kv, KEY.idxNodes)
  const details = []

  let processed = 0
  let changed = 0
  let removedRefs = 0
  let updated = 0

  for (const row of indexRows) {
    const nodeId = String(row?.id || '')
    if (!nodeId) continue

    const node = await kvGetJson(kv, KEY.node(nodeId), null)
    if (!node || typeof node !== 'object') continue
    processed += 1

    const oldIds = normalizeNodeTemplateIds(node.applied_template_ids)
    const keptIds = []
    const removed = []

    for (const templateId of oldIds) {
      const template = await resolveTemplateForApply(kv, templateId)
      if (!template) {
        removed.push({ template_id: templateId, reason: 'missing' })
        continue
      }

      if (!normalizeTemplateNodeTypes(template.node_types).includes(String(node.node_type || ''))) {
        removed.push({ template_id: templateId, reason: 'node_type_mismatch' })
        continue
      }

      if (!supportsTemplateCombination(template.engine, template.protocol, template.transport, template.tls_mode)) {
        removed.push({ template_id: templateId, reason: 'unsupported_combination' })
        continue
      }

      keptIds.push(templateId)
    }

    if (!differs(oldIds, keptIds)) continue

    changed += 1
    removedRefs += removed.length
    details.push({
      node_id: String(node.id || nodeId),
      node_name: String(node.name || ''),
      before_count: oldIds.length,
      after_count: keptIds.length,
      removed,
    })

    if (dryRun) continue

    node.applied_template_ids = keptIds
    node.updated_at = nowIso
    await kvPutJson(kv, KEY.node(node.id), node)
    await indexUpsert(kv, KEY.idxNodes, { id: node.id, name: node.name, updated_at: nowIso })
    updated += 1
  }

  return ok({
    dry_run: dryRun,
    processed_nodes: processed,
    changed_nodes: changed,
    removed_template_refs: removedRefs,
    updated_nodes: updated,
    details,
  })
}
