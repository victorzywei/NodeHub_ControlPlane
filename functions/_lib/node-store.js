import { KEY, kvDelete, kvGetJson, kvPutJson, listKeysByPrefix } from './kv.js'

const CFG_FIELDS = [
  'id',
  'name',
  'node_type',
  'region',
  'tags',
  'install_cert',
  'primary_domain',
  'backup_domain',
  'entry_ip',
  'github_mirror',
  'cf_api_token',
  'token',
  'install_warp',
  'warp_license',
  'install_argo',
  'argo_token',
  'argo_domain',
  'argo_port',
  'created_at',
  'updated_at',
]

const RUNTIME_FIELDS = [
  'id',
  'last_seen_at',
  'deploy_info',
  'protocol_app_version',
  'last_heartbeat_error',
  'cpu_usage_percent',
  'cpu_cores',
  'memory_used_mb',
  'memory_total_mb',
  'memory_usage_percent',
  'disk_used_gb',
  'disk_total_gb',
  'disk_usage_percent',
  'heartbeat_reported_at',
  'sing_box_version',
  'sing_box_status',
  'xray_version',
  'xray_status',
  'warp_private_key',
  'warp_v6',
  'warp_reserved',
  'warp_endpoint',
  'warp_status',
  'argo_status',
  'argo_temp_domain',
  'updated_at',
]

const DESIRED_FIELDS = [
  'id',
  'applied_template_ids',
  'desired_rev',
  'desired_artifact_id',
  'desired_sha256',
  'last_release_status',
  'last_release_error_code',
  'last_release_message',
  'last_release_version',
  'updated_at',
]

const CURRENT_FIELDS = [
  'id',
  'current_version',
  'current_artifact',
  'updated_at',
]

function text(value) {
  return String(value || '').trim()
}

function pickFields(source, fields) {
  const out = {}
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source || {}, field)) {
      out[field] = source[field]
    }
  }
  return out
}

function latestIso(values) {
  let latest = ''
  let latestMs = -1
  for (const value of values || []) {
    const iso = text(value)
    if (!iso) continue
    const ms = new Date(iso).getTime()
    if (!Number.isFinite(ms)) continue
    if (ms > latestMs) {
      latestMs = ms
      latest = iso
    }
  }
  return latest
}

function stripPrefix(value, prefix) {
  const raw = text(value)
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : ''
}

function mergeNodeParts(parts) {
  const legacy = parts.legacy && typeof parts.legacy === 'object' ? parts.legacy : {}
  const cfg = parts.cfg && typeof parts.cfg === 'object' ? parts.cfg : {}
  const runtime = parts.runtime && typeof parts.runtime === 'object' ? parts.runtime : {}
  const desired = parts.desired && typeof parts.desired === 'object' ? parts.desired : {}
  const current = parts.current && typeof parts.current === 'object' ? parts.current : {}

  const merged = {
    ...legacy,
    ...cfg,
    ...runtime,
    ...desired,
    ...current,
  }

  merged.id = text(merged.id || cfg.id || runtime.id || desired.id || current.id || legacy.id)
  merged.created_at = text(merged.created_at || cfg.created_at || legacy.created_at)
  merged.updated_at = latestIso([
    cfg.updated_at,
    runtime.updated_at,
    desired.updated_at,
    current.updated_at,
    legacy.updated_at,
  ]) || merged.updated_at || merged.created_at

  return merged
}

export async function loadNodeParts(kv, nodeId) {
  const id = text(nodeId)
  if (!id) return null

  const [cfg, runtime, desired, current, legacy] = await Promise.all([
    kvGetJson(kv, KEY.nodeCfg(id), null),
    kvGetJson(kv, KEY.nodeRuntime(id), null),
    kvGetJson(kv, KEY.nodeDesired(id), null),
    kvGetJson(kv, KEY.nodeCurrent(id), null),
    kvGetJson(kv, KEY.node(id), null),
  ])

  if (!cfg && !legacy) return null
  return { cfg, runtime, desired, current, legacy }
}

export async function loadNodeRecord(kv, nodeId) {
  const parts = await loadNodeParts(kv, nodeId)
  if (!parts) return null
  return mergeNodeParts(parts)
}

export async function listNodeIds(kv) {
  const [cfgKeys, legacyKeys] = await Promise.all([
    listKeysByPrefix(kv, 'node_cfg:'),
    listKeysByPrefix(kv, 'node:'),
  ])

  const ids = new Set()
  for (const key of cfgKeys) ids.add(stripPrefix(key, 'node_cfg:'))
  for (const key of legacyKeys) ids.add(stripPrefix(key, 'node:'))
  return Array.from(ids).filter(Boolean)
}

export async function listNodeRecords(kv) {
  const ids = await listNodeIds(kv)
  const rows = await Promise.all(ids.map((id) => loadNodeRecord(kv, id)))
  return rows.filter(Boolean)
}

export function nodeCfgFromRecord(node) {
  return pickFields(node, CFG_FIELDS)
}

export function nodeRuntimeFromRecord(node) {
  return pickFields(node, RUNTIME_FIELDS)
}

export function nodeDesiredFromRecord(node) {
  return pickFields(node, DESIRED_FIELDS)
}

export function nodeCurrentFromRecord(node) {
  return pickFields(node, CURRENT_FIELDS)
}

export async function saveNodeCfg(kv, node) {
  const cfg = nodeCfgFromRecord(node)
  await kvPutJson(kv, KEY.nodeCfg(cfg.id), cfg)
  return cfg
}

export async function saveNodeRuntime(kv, node) {
  const runtime = nodeRuntimeFromRecord(node)
  await kvPutJson(kv, KEY.nodeRuntime(runtime.id), runtime)
  return runtime
}

export async function saveNodeDesired(kv, node) {
  const desired = nodeDesiredFromRecord(node)
  await kvPutJson(kv, KEY.nodeDesired(desired.id), desired)
  return desired
}

export async function saveNodeCurrent(kv, node) {
  const current = nodeCurrentFromRecord(node)
  await kvPutJson(kv, KEY.nodeCurrent(current.id), current)
  return current
}

export async function createNodeRecord(kv, node) {
  await Promise.all([
    saveNodeCfg(kv, node),
    saveNodeRuntime(kv, node),
    saveNodeDesired(kv, node),
    saveNodeCurrent(kv, node),
  ])
}

export async function deleteNodeRecord(kv, nodeId) {
  const id = text(nodeId)
  if (!id) return

  await Promise.all([
    kvDelete(kv, KEY.nodeCfg(id)),
    kvDelete(kv, KEY.nodeRuntime(id)),
    kvDelete(kv, KEY.nodeDesired(id)),
    kvDelete(kv, KEY.nodeCurrent(id)),
    kvDelete(kv, KEY.node(id)),
  ])
}
