import { KEY, kvGetJson } from '../_lib/kv.js'
import { fail } from '../_lib/response.js'

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const nodeId = String(url.searchParams.get('node_id') || '')
  const rev = Number(url.searchParams.get('rev') || 0)
  const token = request.headers.get('X-Node-Token') || ''

  if (!nodeId) return fail('VALIDATION', 'node_id is required', 400)
  if (!Number.isFinite(rev) || rev <= 0) return fail('VALIDATION', 'rev is required', 400)
  if (!token) return fail('UNAUTHORIZED', 'X-Node-Token is required', 401)

  const kv = env.NODEHUB_KV
  const node = await kvGetJson(kv, KEY.node(nodeId), null)
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)
  if (node.token !== token) return fail('UNAUTHORIZED', 'Invalid node token', 401)

  const targetArtifact =
    node.target_artifact && typeof node.target_artifact === 'object' && !Array.isArray(node.target_artifact)
      ? node.target_artifact
      : null
  if (!targetArtifact) return fail('NOT_FOUND', 'Artifact not found', 404)
  if (Number(targetArtifact.rev || 0) !== rev) return fail('NOT_FOUND', 'Artifact revision mismatch', 404)

  const artifactId = String(targetArtifact.id || '')
  if (!artifactId) return fail('NOT_FOUND', 'Artifact id missing', 404)

  const artifact = await kvGetJson(kv, KEY.artifact(artifactId), null)
  if (!artifact) return fail('NOT_FOUND', 'Artifact payload not found', 404)
  if (String(artifact.node_id || '') !== node.id || Number(artifact.rev || 0) !== rev) {
    return fail('NOT_FOUND', 'Artifact ownership mismatch', 404)
  }

  return new Response(String(artifact.bundle || ''), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-NodeHub-Artifact-Id': artifactId,
      'X-NodeHub-Artifact-SHA256': String(artifact.sha256 || ''),
      'X-NodeHub-Artifact-Engine': String(artifact.engine || ''),
    },
  })
}
