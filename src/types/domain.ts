export type NodeKind = 'vps' | 'edge'
export type TemplateEngine = 'sing-box' | 'xray'

export interface ArtifactSubscriptionOutbound {
  template_id?: string
  template_name?: string
  protocol: string
  transport: string
  tls_mode: string
  port: number
  settings: Record<string, unknown>
}

export interface NodePublishPreviewItem {
  rev: number
  engine: string
  template_ids: string[]
  template_names: string[]
  config_name: string
  config_text: string
}

export interface NodePublishPreview {
  node_id: string
  node_name: string
  next_version: number
  applied_template_ids: string[]
  publishable: boolean
  publish_message: string
  previews: NodePublishPreviewItem[]
}

export interface NodeRecord {
  id: string
  name: string
  node_type: NodeKind
  region: string
  tags: string[]
  install_cert: boolean
  entry_cdn: string
  entry_direct: string
  entry_ip: string
  github_mirror?: string
  cf_api_token?: string
  token: string
  online: boolean
  current_version: number
  last_seen_at: string | null
  deploy_info: string
  protocol_app_version: string
  last_heartbeat_error: string
  cpu_usage_percent: number | null
  cpu_cores: number | null
  memory_used_mb: number | null
  memory_total_mb: number | null
  memory_usage_percent: number | null
  disk_used_gb: number | null
  disk_total_gb: number | null
  disk_usage_percent: number | null
  heartbeat_reported_at: string | null
  sing_box_version: string
  sing_box_status: string
  xray_version: string
  xray_status: string
  applied_template_ids: string[]
  desired_rev: number
  desired_artifact_id: string
  desired_sha256: string
  current_artifact: {
    id: string
    rev: number
    engine: string
    sha256: string
    summary: string
    applied_at: string
  } | null
  last_release_status: 'idle' | 'pending' | 'applied' | 'healthy' | 'failed'
  last_release_error_code: string
  last_release_message: string
  last_release_version?: number

  // WARP - user config (install param)
  install_warp: boolean
  warp_license: string
  // WARP - agent-reported (heartbeat)
  warp_private_key: string
  warp_v6: string
  warp_reserved: number[]
  warp_endpoint: string
  warp_status: string

  // Argo - user config (install param)
  install_argo: boolean
  argo_token: string
  argo_domain: string
  argo_port: number
  // Argo - agent-reported (heartbeat)
  argo_status: string
  argo_temp_domain: string

  created_at: string
  updated_at: string
}

export interface TemplateRecord {
  id: string
  name: string
  kind: 'builtin' | 'custom'
  engine: TemplateEngine
  protocol: string
  transport: string
  tls_mode: string
  node_types: NodeKind[]
  description: string
  warp_exit: boolean
  warp_route_mode: 'all' | 'ipv4' | 'ipv6'
  defaults: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface SubscriptionRecord {
  token: string
  name: string
  enabled: boolean
  visible_node_ids: string[]
  remark: string
  created_at: string
  updated_at: string
}

export interface RegistryOption {
  key: string
  label: string
}

export interface TemplateRegistry {
  engines: RegistryOption[]
  protocols: RegistryOption[]
  transports: RegistryOption[]
  tls_modes: RegistryOption[]
  node_types: RegistryOption[]
}

export interface SystemStatus {
  app_version: string
  kv_available: boolean
  kv_namespace: string
  subscription_base_url: string
  uptime_hint: string
  now: string
}

export interface TemplateRefCleanupDetail {
  node_id: string
  node_name: string
  before_count: number
  after_count: number
  removed: Array<{
    template_id: string
    reason: 'missing' | 'node_type_mismatch' | 'unsupported_combination' | string
  }>
}

export interface TemplateRefCleanupResult {
  dry_run: boolean
  processed_nodes: number
  changed_nodes: number
  removed_template_refs: number
  updated_nodes: number
  details: TemplateRefCleanupDetail[]
}
