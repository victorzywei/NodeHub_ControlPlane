import { ONLINE_WINDOW_MS } from './constants.js'

function toString(value) {
  return String(value || '')
}

function toNullableString(value) {
  return value ? String(value) : null
}

function toStringArray(values) {
  if (!Array.isArray(values)) return []
  return values.map((item) => String(item))
}

function toNullableNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function toBool(value) {
  return value === true || value === 'true'
}

function toNumberArray(values) {
  if (!Array.isArray(values)) return []
  return values.map((v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  })
}

function toPort(value, fallback = 0) {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0 || num > 65535) return fallback
  return Math.floor(num)
}

function toVersion(value) {
  return Number(value || 0) || 0
}

function toArtifactRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

export function normalizeNode(node) {
  const nowMs = Date.now()
  const lastSeen = node.last_seen_at ? new Date(node.last_seen_at).getTime() : 0
  const online = nowMs - lastSeen <= ONLINE_WINDOW_MS
  const targetArtifact = toArtifactRef(node.target_artifact)
  const currentArtifact = toArtifactRef(node.current_artifact)
  const targetVersion = toVersion(node.target_version)
  const currentVersion = toVersion(node.current_version)
  const installWarp = node.install_warp !== undefined
    ? toBool(node.install_warp)
    : toString(node.warp_license).trim().length > 0
  const installArgo = node.install_argo !== undefined
    ? toBool(node.install_argo)
    : (toString(node.argo_token).trim().length > 0 || toString(node.argo_domain).trim().length > 0)

  return {
    id: toString(node.id),
    name: toString(node.name),
    node_type: toString(node.node_type),
    region: toString(node.region),
    tags: toStringArray(node.tags),
    entry_cdn: toString(node.entry_cdn),
    entry_direct: toString(node.entry_direct),
    entry_ip: toString(node.entry_ip),
    github_mirror: toString(node.github_mirror),
    cf_api_token: toString(node.cf_api_token),
    token: toString(node.token),
    created_at: toString(node.created_at),
    updated_at: toString(node.updated_at),
    last_seen_at: toNullableString(node.last_seen_at),
    deploy_info: toString(node.deploy_info),
    protocol_app_version: toString(node.protocol_app_version),
    last_heartbeat_error: toString(node.last_heartbeat_error),
    cpu_usage_percent: toNullableNumber(node.cpu_usage_percent),
    memory_used_mb: toNullableNumber(node.memory_used_mb),
    memory_total_mb: toNullableNumber(node.memory_total_mb),
    memory_usage_percent: toNullableNumber(node.memory_usage_percent),
    heartbeat_reported_at: toNullableString(node.heartbeat_reported_at),
    applied_template_ids: toStringArray(node.applied_template_ids),
    target_version: targetVersion,
    current_version: currentVersion,
    target_artifact: targetArtifact,
    current_artifact: currentArtifact,
    last_release_error_code: toString(node.last_release_error_code),
    last_release_status: toString(node.last_release_status || 'idle'),
    last_release_message: toString(node.last_release_message),

    // WARP - user config
    install_warp: installWarp,
    warp_license: toString(node.warp_license),
    // WARP - agent-reported
    warp_private_key: toString(node.warp_private_key),
    warp_v6: toString(node.warp_v6),
    warp_reserved: toNumberArray(node.warp_reserved),
    warp_endpoint: toString(node.warp_endpoint),
    warp_status: toString(node.warp_status),

    // Argo - user config
    install_argo: installArgo,
    argo_token: toString(node.argo_token),
    argo_domain: toString(node.argo_domain),
    // Argo - agent-reported
    argo_status: toString(node.argo_status),
    argo_temp_domain: toString(node.argo_temp_domain),

    online,
  }
}
