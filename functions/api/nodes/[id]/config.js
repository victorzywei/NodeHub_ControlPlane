import { requireAdmin } from '../../../_lib/auth.js'
import { KEY, kvGetJson } from '../../../_lib/kv.js'
import { ok, fail } from '../../../_lib/response.js'

function decodeBase64Utf8(value) {
  try {
    const binary = atob(String(value || ''))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}

function parseBundleFiles(bundleText) {
  const files = {}
  const text = String(bundleText || '')
  if (!text) return files

  const lines = text.split(/\r?\n/)
  if (lines[0] !== 'NODEHUB-BUNDLE-V1') return files

  for (const line of lines) {
    if (!line.startsWith('file=')) continue
    const entry = line.slice(5)
    const sep = entry.indexOf('|')
    if (sep <= 0) continue

    const path = entry.slice(0, sep)
    const encoded = entry.slice(sep + 1)
    if (!path || path.startsWith('/') || path.includes('..')) continue

    files[path] = decodeBase64Utf8(encoded)
  }

  return files
}

function extractConfigFile(files, engineHint) {
  if (files['sing-box.json']) {
    return { name: 'sing-box.json', text: String(files['sing-box.json'] || '') }
  }
  if (files['xray.json']) {
    return { name: 'xray.json', text: String(files['xray.json'] || '') }
  }

  const hint = String(engineHint || '').toLowerCase()
  if (hint === 'xray') return { name: 'xray.json', text: '' }
  return { name: 'sing-box.json', text: '' }
}

async function buildArtifactView(kv, nodeId, artifactRef) {
  if (!artifactRef || typeof artifactRef !== 'object') return null

  const artifactId = String(artifactRef.id || '').trim()
  if (!artifactId) return null

  const artifact = await kvGetJson(kv, KEY.artifact(artifactId), null)
  if (!artifact || String(artifact.node_id || '') !== String(nodeId || '')) {
    return {
      id: artifactId,
      rev: Number(artifactRef.rev || 0),
      engine: String(artifactRef.engine || ''),
      sha256: String(artifactRef.sha256 || ''),
      missing: true,
      config_name: '',
      config_text: '',
      manifest_json: '',
      manifest_env: '',
      created_at: '',
    }
  }

  const files = parseBundleFiles(artifact.bundle)
  const configFile = extractConfigFile(files, artifact.engine || artifactRef.engine)

  return {
    id: String(artifact.id || artifactId),
    rev: Number(artifact.rev || artifactRef.rev || 0),
    engine: String(artifact.engine || artifactRef.engine || ''),
    sha256: String(artifact.sha256 || artifactRef.sha256 || ''),
    missing: false,
    config_name: configFile.name,
    config_text: configFile.text,
    manifest_json: String(files['manifest.json'] || ''),
    manifest_env: String(files['manifest.env'] || ''),
    created_at: String(artifact.created_at || artifactRef.created_at || ''),
  }
}

export async function onRequestGet({ request, env, params }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  const node = await kvGetJson(kv, KEY.node(params.id), null)
  if (!node) return fail('NOT_FOUND', 'Node not found', 404)

  const targetArtifact =
    node.target_artifact && typeof node.target_artifact === 'object' && !Array.isArray(node.target_artifact)
      ? node.target_artifact
      : null
  const currentArtifact =
    node.current_artifact && typeof node.current_artifact === 'object' && !Array.isArray(node.current_artifact)
      ? node.current_artifact
      : null

  const [target, current] = await Promise.all([
    buildArtifactView(kv, node.id, targetArtifact),
    buildArtifactView(kv, node.id, currentArtifact),
  ])

  return ok({
    node_id: node.id,
    node_name: String(node.name || ''),
    target,
    current,
  })
}
