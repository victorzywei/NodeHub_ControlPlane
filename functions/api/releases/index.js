import { requireAdmin } from '../../_lib/auth.js'
import { BUILTIN_TEMPLATES } from '../../_lib/constants.js'
import {
  KEY,
  createId,
  kvDelete,
  kvGetJson,
  kvPutJson,
  readIndex,
  writeIndex,
} from '../../_lib/kv.js'
import { ok, fail } from '../../_lib/response.js'

function toParams(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

function summarizeParams(params) {
  const entries = Object.entries(params)
  if (entries.length === 0) return ''
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ')
}

function summarizeConfig(templateNames, params) {
  const templateText = templateNames.length > 0 ? templateNames.join('、') : 'no-template'
  const paramsText = summarizeParams(params)
  return paramsText ? `${templateText} | ${paramsText}` : templateText
}

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

function sortByCreatedDesc(rows) {
  return [...rows].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
}

async function readRecentOperations(kv) {
  const indexRows = await readIndex(kv, KEY.idxReleases)
  const sortedRows = sortByCreatedDesc(indexRows)
  const recentRows = sortedRows.slice(0, 10)

  if (recentRows.length !== indexRows.length || JSON.stringify(recentRows) !== JSON.stringify(indexRows)) {
    await writeIndex(kv, KEY.idxReleases, recentRows)

    const keepSet = new Set(recentRows.map((item) => item.id))
    const oldRows = sortedRows.slice(10)
    await Promise.all(oldRows.filter((item) => !keepSet.has(item.id)).map((item) => kvDelete(kv, KEY.release(item.id))))
  }

  const operations = await Promise.all(recentRows.map((row) => kvGetJson(kv, KEY.release(row.id), null)))
  return operations.filter(Boolean).sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
}

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const operations = await readRecentOperations(kv)
  return ok(operations)
}

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const body = await request.json().catch(() => ({}))

  const nodeIds = Array.isArray(body.node_ids) ? body.node_ids.map((item) => String(item)) : []
  const templateIds = Array.isArray(body.template_ids) ? body.template_ids.map((item) => String(item)) : []
  const params = toParams(body.params)

  if (nodeIds.length === 0) return fail('VALIDATION', 'node_ids must be a non-empty array', 400)
  if (templateIds.length === 0) return fail('VALIDATION', 'template_ids must be a non-empty array', 400)

  const templates = (await Promise.all(templateIds.map((tplId) => resolveTemplate(kv, tplId)))).filter(Boolean)
  if (templates.length === 0) return fail('VALIDATION', 'No valid templates found', 400)

  const id = createId('op')
  const now = new Date().toISOString()
  const templateNames = templates.map((item) => item.name)
  const summary = summarizeConfig(templateNames, params)
  const templateSnapshot = templates.map((item) => ({
    id: item.id,
    name: item.name,
    protocol: item.protocol,
    transport: item.transport,
    tls_mode: item.tls_mode,
    defaults: item.defaults || {},
  }))

  const results = []

  for (const nodeId of nodeIds) {
    const node = await kvGetJson(kv, KEY.node(nodeId), null)
    if (!node) {
      results.push({ node_id: nodeId, status: 'failed', reason: 'node not found' })
      continue
    }

    const nextVersion = Math.max(Number(node.desired_version || 0), Number(node.applied_version || 0)) + 1

    node.desired_version = nextVersion
    node.desired_config = {
      rev: nextVersion,
      template_ids: templateIds,
      template_names: templateNames,
      templates: templateSnapshot,
      params,
      operation_id: id,
      created_at: now,
    }
    node.desired_config_summary = summary
    node.last_release_status = 'pending'
    node.last_release_message = `config queued r${nextVersion}`
    node.updated_at = now

    await kvPutJson(kv, KEY.node(node.id), node)
    results.push({ node_id: node.id, node_name: node.name, status: 'queued', desired_version: nextVersion })
  }

  const operation = {
    id,
    mode: 'direct_apply',
    node_ids: nodeIds,
    template_ids: templateIds,
    template_names: templateNames,
    summary,
    params,
    results,
    created_at: now,
  }

  await kvPutJson(kv, KEY.release(id), operation)

  const indexRows = await readIndex(kv, KEY.idxReleases)
  const nextRows = sortByCreatedDesc([{ id, created_at: now }, ...indexRows.filter((item) => item.id !== id)]).slice(0, 10)
  await writeIndex(kv, KEY.idxReleases, nextRows)

  return ok(operation, { status: 201 })
}
