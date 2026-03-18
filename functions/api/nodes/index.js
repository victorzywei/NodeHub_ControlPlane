import { requireAdmin } from '../../_lib/auth.js'
import { createId, createToken } from '../../_lib/kv.js'
import { normalizeNode } from '../../_lib/node.js'
import { createNodeRecord, listNodeRecords } from '../../_lib/node-store.js'
import { ok, fail } from '../../_lib/response.js'

function toPort(value, fallback = 2053) {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 1 || num > 65535) return fallback
  return Math.floor(num)
}

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  if (!kv) return fail('CONFIG_ERROR', 'NODEHUB_KV is missing', 500)

  const nodes = await listNodeRecords(kv)
  nodes.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  return ok(nodes.map(normalizeNode))
}

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env)
  if (!auth.ok) return auth.response

  const kv = env.NODEHUB_KV
  if (!kv) return fail('CONFIG_ERROR', 'NODEHUB_KV is missing', 500)

  const body = await request.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  const nodeType = String(body.node_type || '').trim()
  const primaryDomain = String(body.primary_domain || '')
  const backupDomain = String(body.backup_domain || '')
  const warpLicense = String(body.warp_license || '')
  const argoToken = String(body.argo_token || '')
  const argoDomain = String(body.argo_domain || '')
  const installCert = body.install_cert !== undefined ? body.install_cert === true : true
  const installWarp = body.install_warp === true
  const installArgo = body.install_argo === true
  const argoPort = toPort(body.argo_port, 2053)

  if (!name) return fail('VALIDATION', 'name is required', 400)
  if (!['vps', 'edge'].includes(nodeType)) {
    return fail('VALIDATION', 'node_type must be vps or edge', 400)
  }

  const id = createId('node')
  const now = new Date().toISOString()
  const node = {
    id,
    name,
    node_type: nodeType,
    region: String(body.region || ''),
    tags: Array.isArray(body.tags) ? body.tags.map((item) => String(item)) : [],
    install_cert: installCert,
    primary_domain: primaryDomain,
    backup_domain: backupDomain,
    entry_ip: String(body.entry_ip || ''),
    github_mirror: String(body.github_mirror || ''),
    cf_api_token: String(body.cf_api_token || ''),
    token: createToken(),
    applied_template_ids: [],
    desired_rev: 0,
    desired_artifact_id: '',
    desired_sha256: '',
    current_version: 0,
    last_seen_at: null,
    deploy_info: '',
    protocol_app_version: '',
    last_heartbeat_error: '',
    cpu_usage_percent: null,
    cpu_cores: null,
    memory_used_mb: null,
    memory_total_mb: null,
    memory_usage_percent: null,
    disk_used_gb: null,
    disk_total_gb: null,
    disk_usage_percent: null,
    heartbeat_reported_at: null,
    sing_box_version: '',
    sing_box_status: '',
    xray_version: '',
    xray_status: '',
    current_artifact: null,
    last_release_status: 'idle',
    last_release_error_code: '',
    last_release_message: '',
    last_release_version: 0,

    // WARP - user config
    install_warp: installWarp,
    warp_license: warpLicense,
    // WARP - agent-reported
    warp_private_key: '',
    warp_v6: '',
    warp_reserved: [],
    warp_endpoint: '',
    warp_status: '',

    // Argo - user config
    install_argo: installArgo,
    argo_token: argoToken,
    argo_domain: argoDomain,
    argo_port: argoPort,
    // Argo - agent-reported
    argo_status: '',
    argo_temp_domain: '',

    created_at: now,
    updated_at: now,
  }

  await createNodeRecord(kv, node)

  return ok(normalizeNode(node), { status: 201 })
}
