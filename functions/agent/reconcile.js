import { KEY, kvGetJson } from '../_lib/kv.js'
import { ok, fail } from '../_lib/response.js'

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const nodeId = String(url.searchParams.get('node_id') || '')
  const token = request.headers.get('X-Node-Token') || ''

  if (!nodeId) return fail('VALIDATION', 'node_id is required', 400)
  if (!token) return fail('UNAUTHORIZED', 'X-Node-Token is required', 401)

  const kv = env.NODEHUB_KV
  const node = await kvGetJson(kv, KEY.node(nodeId), null)
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)
  if (node.token !== token) return fail('UNAUTHORIZED', 'Invalid node token', 401)

  const targetArtifact =
    node.target_artifact && typeof node.target_artifact === 'object' && !Array.isArray(node.target_artifact)
      ? node.target_artifact
      : null
  const targetVersion = targetArtifact
    ? Number(targetArtifact.rev || 0)
    : Number(node.target_version || 0)
  const currentVersion = Number(node.current_version || 0) || 0

  const origin = new URL(request.url).origin
  const artifactUrl =
    targetArtifact && targetVersion > 0
      ? `${origin}/agent/artifact?node_id=${encodeURIComponent(node.id)}&rev=${encodeURIComponent(targetVersion)}`
      : ''

  return ok({
    node_id: node.id,
    current_version: currentVersion,
    target_version: targetVersion,
    rev: targetVersion,
    artifact_url: artifactUrl,
    sha256: targetArtifact ? String(targetArtifact.sha256 || '') : '',
    engine: targetArtifact ? String(targetArtifact.engine || '') : '',
    reload_cmd: targetArtifact ? String(targetArtifact.reload_cmd || '') : '',
    needs_update: targetVersion > currentVersion,
  })
}
