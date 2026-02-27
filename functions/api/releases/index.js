import { requireAdmin } from '../../_lib/auth.js'
import { BUILTIN_TEMPLATES } from '../../_lib/constants.js'
import {
  KEY,
  createId,
  hydrateByIndex,
  indexUpsert,
  kvGetJson,
  kvPutJson,
  readIndex,
} from '../../_lib/kv.js'
import { ok, fail } from '../../_lib/response.js'

async function resolveTemplate(kv, id) {
  const builtin = BUILTIN_TEMPLATES.find((item) => item.id === id)
  if (builtin) {
    const override = await kvGetJson(kv, KEY.templateOverride(id), null)
    if (!override) return { ...builtin }
    return {
      ...builtin,
      name: override.name || builtin.name,
      description: override.description || builtin.description,
      defaults: {
        ...(builtin.defaults || {}),
        ...(override.defaults || {}),
      },
    }
  }

  return kvGetJson(kv, KEY.template(id), null)
}

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const releases = await hydrateByIndex(kv, KEY.idxReleases, KEY.release)
  releases.sort((a, b) => Number(b.version || 0) - Number(a.version || 0))
  return ok(releases)
}

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const body = await request.json().catch(() => ({}))

  const nodeIds = Array.isArray(body.node_ids) ? body.node_ids : []
  const templateIds = Array.isArray(body.template_ids) ? body.template_ids : []
  const params = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {}

  if (nodeIds.length === 0) return fail('VALIDATION', 'node_ids must be a non-empty array', 400)
  if (templateIds.length === 0) return fail('VALIDATION', 'template_ids must be a non-empty array', 400)

  const indexRows = await readIndex(kv, KEY.idxReleases)
  const version = indexRows.length > 0 ? Math.max(...indexRows.map((item) => Number(item.version || 0))) + 1 : 1
  const id = createId('rel')
  const now = new Date().toISOString()

  const templates = (await Promise.all(templateIds.map((tplId) => resolveTemplate(kv, tplId)))).filter(Boolean)
  if (templates.length === 0) return fail('VALIDATION', 'No valid templates found', 400)

  const results = []

  for (const nodeId of nodeIds) {
    const node = await kvGetJson(kv, KEY.node(nodeId), null)
    if (!node) {
      results.push({ node_id: nodeId, status: 'failed', reason: 'node not found' })
      continue
    }

    node.desired_version = version
    node.last_release_status = 'pending'
    node.last_release_message = `release queued v${version}`
    node.updated_at = now

    await kvPutJson(kv, KEY.node(node.id), node)
    results.push({ node_id: node.id, status: 'queued' })
  }

  const release = {
    id,
    version,
    node_ids: nodeIds,
    template_ids: templateIds,
    template_names: templates.map((item) => item.name),
    params,
    results,
    created_at: now,
  }

  await kvPutJson(kv, KEY.release(id), release)
  await indexUpsert(kv, KEY.idxReleases, { id, version, created_at: now })

  return ok(release, { status: 201 })
}
