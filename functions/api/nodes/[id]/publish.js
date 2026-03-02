import { requireAdmin } from '../../../_lib/auth.js'
import { ONLINE_WINDOW_MS } from '../../../_lib/constants.js'
import { normalizeNodeTemplateIds, queueNodeTemplateApply } from '../../../_lib/node-apply.js'
import { KEY, indexUpsert, kvGetJson, kvPutJson } from '../../../_lib/kv.js'
import { ok, fail } from '../../../_lib/response.js'

function normalizeNode(node) {
  const lastSeen = node.last_seen_at ? new Date(node.last_seen_at).getTime() : 0
  const online = Date.now() - lastSeen <= ONLINE_WINDOW_MS
  const cpuUsage = Number(node.cpu_usage_percent)
  const memoryUsed = Number(node.memory_used_mb)
  const memoryTotal = Number(node.memory_total_mb)
  const memoryUsage = Number(node.memory_usage_percent)
  const targetArtifact =
    node.target_artifact && typeof node.target_artifact === 'object' && !Array.isArray(node.target_artifact)
      ? node.target_artifact
      : null
  const currentArtifact =
    node.current_artifact && typeof node.current_artifact === 'object' && !Array.isArray(node.current_artifact)
      ? node.current_artifact
      : null
  const targetVersion = Number(node.target_version || 0) || 0
  const currentVersion = Number(node.current_version || 0) || 0

  return {
    id: String(node.id || ''),
    name: String(node.name || ''),
    node_type: String(node.node_type || ''),
    region: String(node.region || ''),
    tags: Array.isArray(node.tags) ? node.tags.map((item) => String(item)) : [],
    entry_cdn: String(node.entry_cdn || ''),
    entry_direct: String(node.entry_direct || ''),
    entry_ip: String(node.entry_ip || ''),
    github_mirror: String(node.github_mirror || ''),
    cf_api_token: String(node.cf_api_token || ''),
    token: String(node.token || ''),
    created_at: String(node.created_at || ''),
    updated_at: String(node.updated_at || ''),
    last_seen_at: node.last_seen_at ? String(node.last_seen_at) : null,
    deploy_info: String(node.deploy_info || ''),
    protocol_app_version: String(node.protocol_app_version || ''),
    last_heartbeat_error: String(node.last_heartbeat_error || ''),
    cpu_usage_percent: Number.isFinite(cpuUsage) ? cpuUsage : null,
    memory_used_mb: Number.isFinite(memoryUsed) ? memoryUsed : null,
    memory_total_mb: Number.isFinite(memoryTotal) ? memoryTotal : null,
    memory_usage_percent: Number.isFinite(memoryUsage) ? memoryUsage : null,
    heartbeat_reported_at: node.heartbeat_reported_at ? String(node.heartbeat_reported_at) : null,
    applied_template_ids: Array.isArray(node.applied_template_ids) ? node.applied_template_ids.map((item) => String(item)) : [],
    target_version: targetVersion,
    current_version: currentVersion,
    target_artifact: targetArtifact,
    current_artifact: currentArtifact,
    last_release_error_code: String(node.last_release_error_code || ''),
    last_release_status: String(node.last_release_status || 'idle'),
    last_release_message: String(node.last_release_message || ''),
    online,
  }
}

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
