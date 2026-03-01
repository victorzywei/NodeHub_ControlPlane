import { requireAdmin } from '../../_lib/auth.js'
import { buildNodeArtifactBundle, summarizeConfig } from '../../_lib/artifact.js'
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

function collectArtifactIdsFromOperation(operation) {
  if (!operation || typeof operation !== 'object' || !Array.isArray(operation.results)) return []
  const ids = []
  for (const item of operation.results) {
    const artifactId = String(item?.artifact_id || '').trim()
    if (artifactId) ids.push(artifactId)
  }
  return ids
}

async function collectReferencedArtifactIds(kv) {
  const rows = await readIndex(kv, KEY.idxNodes)
  if (rows.length === 0) return new Set()

  const nodes = await Promise.all(rows.map((row) => kvGetJson(kv, KEY.node(row.id), null)))
  const ids = new Set()

  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue

    const desiredId = String(node.desired_artifact?.id || '').trim()
    const appliedId = String(node.applied_artifact?.id || '').trim()
    if (desiredId) ids.add(desiredId)
    if (appliedId) ids.add(appliedId)
  }

  return ids
}

async function readRecentOperations(kv) {
  const indexRows = await readIndex(kv, KEY.idxReleases)
  const sortedRows = sortByCreatedDesc(indexRows)
  const recentRows = sortedRows.slice(0, 10)

  if (recentRows.length !== indexRows.length || JSON.stringify(recentRows) !== JSON.stringify(indexRows)) {
    await writeIndex(kv, KEY.idxReleases, recentRows)

    const oldRows = sortedRows.slice(10)
    if (oldRows.length > 0) {
      const oldOperations = await Promise.all(oldRows.map((item) => kvGetJson(kv, KEY.release(item.id), null)))
      const referencedArtifactIds = await collectReferencedArtifactIds(kv)
      const staleArtifactIds = new Set()

      for (const operation of oldOperations) {
        for (const artifactId of collectArtifactIdsFromOperation(operation)) {
          if (!referencedArtifactIds.has(artifactId)) staleArtifactIds.add(artifactId)
        }
      }

      await Promise.all([
        ...oldRows.map((item) => kvDelete(kv, KEY.release(item.id))),
        ...[...staleArtifactIds].map((artifactId) => kvDelete(kv, KEY.artifact(artifactId))),
      ])
    }
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
  const results = []

  for (const nodeId of nodeIds) {
    const node = await kvGetJson(kv, KEY.node(nodeId), null)
    if (!node) {
      results.push({ node_id: nodeId, status: 'failed', reason: 'node not found' })
      continue
    }

    const nextVersion = Math.max(Number(node.desired_version || 0), Number(node.applied_version || 0)) + 1

    try {
      const artifact = await buildNodeArtifactBundle({
        node,
        rev: nextVersion,
        operationId: id,
        templates,
        params,
        createdAt: now,
      })
      const artifactId = createId('artifact')

      await kvPutJson(kv, KEY.artifact(artifactId), {
        id: artifactId,
        node_id: node.id,
        rev: artifact.rev,
        engine: artifact.engine,
        reload_cmd: artifact.reload_cmd,
        sha256: artifact.sha256,
        bundle: artifact.bundle,
        created_at: now,
      })

      node.desired_version = nextVersion
      node.desired_artifact = {
        id: artifactId,
        rev: artifact.rev,
        engine: artifact.engine,
        reload_cmd: artifact.reload_cmd,
        sha256: artifact.sha256,
        summary: artifact.summary,
        template_names: artifact.template_names,
        params: artifact.params || {},
        subscription_outbounds: artifact.subscription_outbounds || [],
        created_at: now,
      }
      node.last_release_status = 'pending'
      node.last_release_error_code = ''
      node.last_release_message = `artifact queued r${nextVersion}`
      node.updated_at = now

      await kvPutJson(kv, KEY.node(node.id), node)
      results.push({
        node_id: node.id,
        node_name: node.name,
        status: 'queued',
        desired_version: nextVersion,
        artifact_id: artifactId,
        artifact_sha256: artifact.sha256,
        engine: artifact.engine,
      })
    } catch (error) {
      results.push({
        node_id: node.id,
        node_name: node.name,
        status: 'failed',
        reason: error instanceof Error ? error.message : 'artifact generation failed',
      })
    }
  }

  const operation = {
    id,
    mode: 'artifact_apply',
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
