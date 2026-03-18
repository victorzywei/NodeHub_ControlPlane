import { KEY, kvGetJson } from '../_lib/kv.js'
import { loadNodeRecord } from '../_lib/node-store.js'
import { ok, fail } from '../_lib/response.js'

function text(value) {
  return String(value || '').trim()
}

function toVersion(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.floor(num)
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const nodeId = String(url.searchParams.get('node_id') || '')
  const token = request.headers.get('X-Node-Token') || ''

  if (!nodeId) return fail('VALIDATION', 'node_id is required', 400)
  if (!token) return fail('UNAUTHORIZED', 'X-Node-Token is required', 401)

  const kv = env.NODEHUB_KV
  const node = await loadNodeRecord(kv, nodeId)
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)
  if (node.token !== token) return fail('UNAUTHORIZED', 'Invalid node token', 401)

  const desiredRev = toVersion(node.desired_rev)
  const currentVersion = Number(node.current_version || 0) || 0
  const artifactId = text(node.desired_artifact_id)
  const desiredArtifact = artifactId ? await kvGetJson(kv, KEY.artifact(artifactId), null) : null

  const origin = new URL(request.url).origin
  const artifactUrl =
    artifactId && desiredArtifact && desiredRev > 0
      ? `${origin}/agent/artifact?node_id=${encodeURIComponent(node.id)}&rev=${encodeURIComponent(desiredRev)}`
      : ''
  const desiredSha = text(node.desired_sha256)
  const needsUpdate = Boolean(artifactUrl) && desiredRev > currentVersion

  return ok({
    node_id: node.id,
    current_version: currentVersion,
    desired_rev: desiredRev,
    desired_artifact_id: artifactId,
    desired_sha256: desiredSha,
    artifact_url: artifactUrl,
    engine: desiredArtifact ? String(desiredArtifact.engine || '') : '',
    reload_cmd: desiredArtifact ? String(desiredArtifact.reload_cmd || '') : '',
    needs_update: needsUpdate,
  })
}
