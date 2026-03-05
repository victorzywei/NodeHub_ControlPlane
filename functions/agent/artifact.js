import { KEY, kvGetJson } from '../_lib/kv.js'
import { fail } from '../_lib/response.js'

function text(value) {
  return String(value || '').trim()
}

function toVersion(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.floor(num)
}

function decodeBase64ToBytes(value) {
  const binary = atob(String(value || ''))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

function isEtagMatch(ifNoneMatchHeader, sha256) {
  const target = text(sha256).toLowerCase()
  if (!target) return false
  const raw = text(ifNoneMatchHeader)
  if (!raw) return false
  return raw
    .split(',')
    .map((item) => item.trim())
    .map((item) => item.replace(/^W\//, '').replace(/^"|"$/g, '').toLowerCase())
    .includes(target)
}

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

  const desiredRev = toVersion(node.desired_rev)
  if (desiredRev <= 0 || desiredRev !== rev) return fail('NOT_FOUND', 'Artifact revision mismatch', 404)
  const artifactId = text(node.desired_artifact_id)
  if (!artifactId) return fail('NOT_FOUND', 'Artifact id missing', 404)

  const artifact = await kvGetJson(kv, KEY.artifact(artifactId), null)
  if (!artifact) return fail('NOT_FOUND', 'Artifact payload not found', 404)
  if (String(artifact.node_id || '') !== node.id || Number(artifact.rev || 0) !== rev) {
    return fail('NOT_FOUND', 'Artifact ownership mismatch', 404)
  }

  const sha256 = text(artifact.sha256)
  if (isEtagMatch(request.headers.get('If-None-Match') || '', sha256)) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: `"${sha256}"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const packageBase64 = text(artifact.package_base64)
  if (!packageBase64) return fail('INTERNAL', 'Artifact tar payload missing', 500)
  let bytes
  try {
    bytes = decodeBase64ToBytes(packageBase64)
  } catch {
    return fail('INTERNAL', 'Artifact payload corrupted', 500)
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-tar',
      'Cache-Control': 'no-store',
      ETag: `"${sha256}"`,
      'X-NodeHub-Artifact-Id': artifactId,
      'X-NodeHub-Artifact-SHA256': sha256,
      'X-NodeHub-Artifact-Engine': String(artifact.engine || ''),
      'X-NodeHub-Artifact-Format': String(artifact.package_format || 'tar'),
    },
  })
}
