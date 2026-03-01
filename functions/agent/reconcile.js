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

  const desiredArtifact =
    node.desired_artifact && typeof node.desired_artifact === 'object' && !Array.isArray(node.desired_artifact)
      ? node.desired_artifact
      : null
  const desiredVersion = desiredArtifact ? Number(desiredArtifact.rev || 0) : Number(node.desired_version || 0)

  const origin = new URL(request.url).origin
  const artifactUrl =
    desiredArtifact && desiredVersion > 0
      ? `${origin}/agent/artifact?node_id=${encodeURIComponent(node.id)}&rev=${encodeURIComponent(desiredVersion)}`
      : ''

  return ok({
    node_id: node.id,
    current_version: Number(node.applied_version || 0),
    desired_version: desiredVersion,
    rev: desiredVersion,
    artifact_url: artifactUrl,
    sha256: desiredArtifact ? String(desiredArtifact.sha256 || '') : '',
    engine: desiredArtifact ? String(desiredArtifact.engine || '') : '',
    reload_cmd: desiredArtifact ? String(desiredArtifact.reload_cmd || '') : '',
    needs_update: desiredVersion > Number(node.applied_version || 0),
  })
}
