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

function parseManifestEnv(text) {
  const result = {}
  const lines = String(text || '').split(/\r?\n/)
  for (const line of lines) {
    const raw = String(line || '')
    if (!raw || raw.startsWith('#')) continue
    const idx = raw.indexOf('=')
    if (idx <= 0) continue
    const key = raw.slice(0, idx).trim()
    const value = raw.slice(idx + 1).trim()
    if (!key) continue
    result[key] = value
  }
  return result
}

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function buildConfigViews(files) {
  return [
    { engine: 'sing-box', config_name: 'sing-box.json' },
    { engine: 'xray', config_name: 'xray.json' },
  ].map((item) => ({
    ...item,
    config_text: Object.prototype.hasOwnProperty.call(files, item.config_name) ? String(files[item.config_name] || '') : 'null\n',
  }))
}

function pickPrimaryConfig(configs, engineHint) {
  const rows = Array.isArray(configs) ? configs : []
  if (rows.length === 0) return { config_name: '', config_text: '' }

  const hint = String(engineHint || '').toLowerCase()
  if (hint === 'xray') return rows.find((item) => item.engine === 'xray') || rows[0]
  if (hint === 'sing-box') return rows.find((item) => item.engine === 'sing-box') || rows[0]

  return rows.find((item) => item.config_text !== 'null\n') || rows[0]
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
      engines: Array.isArray(artifactRef.engines) ? artifactRef.engines.map((item) => String(item)) : [],
      action_sing_box: String(artifactRef.action_sing_box || ''),
      action_xray: String(artifactRef.action_xray || ''),
      sha256: String(artifactRef.sha256 || ''),
      missing: true,
      config_name: '',
      config_text: '',
      configs: [],
      created_at: '',
    }
  }

  const files = parseBundleFiles(artifact.bundle)
  const manifestEnv = parseManifestEnv(files['manifest.env'] || '')
  const configs = buildConfigViews(files)
  const configFile = pickPrimaryConfig(configs, artifact.engine || artifactRef.engine)
  const engines =
    Array.isArray(artifact.engines) && artifact.engines.length > 0
      ? artifact.engines.map((item) => String(item))
      : parseCsvList(manifestEnv.ENGINES)
  const actionSingBox = String(artifact.action_sing_box || manifestEnv.ACTION_SING_BOX || '')
  const actionXray = String(artifact.action_xray || manifestEnv.ACTION_XRAY || '')

  return {
    id: String(artifact.id || artifactId),
    rev: Number(artifact.rev || artifactRef.rev || 0),
    engine: String(artifact.engine || artifactRef.engine || ''),
    engines,
    action_sing_box: actionSingBox,
    action_xray: actionXray,
    sha256: String(artifact.sha256 || artifactRef.sha256 || ''),
    missing: false,
    config_name: configFile.config_name,
    config_text: configFile.config_text,
    configs,
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
