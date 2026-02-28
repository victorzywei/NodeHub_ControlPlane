export type NodeKind = 'vps' | 'edge'

export interface NodeDesiredConfig {
  rev: number
  template_ids: string[]
  template_names: string[]
  templates: Array<{
    id: string
    name: string
    protocol: string
    transport: string
    tls_mode: string
    defaults: Record<string, unknown>
  }>
  params: Record<string, unknown>
  operation_id: string
  created_at: string
}

export interface NodeRecord {
  id: string
  name: string
  node_type: NodeKind
  region: string
  tags: string[]
  entry_cdn: string
  entry_direct: string
  entry_ip: string
  token: string
  online: boolean
  desired_version: number
  applied_version: number
  last_seen_at: string | null
  deploy_info: string
  protocol_app_version: string
  last_heartbeat_error: string
  cpu_usage_percent: number | null
  memory_used_mb: number | null
  memory_total_mb: number | null
  memory_usage_percent: number | null
  heartbeat_reported_at: string | null
  desired_config: NodeDesiredConfig | null
  desired_config_summary: string
  applied_config_summary: string
  last_release_status: 'idle' | 'pending' | 'ok' | 'failed'
  last_release_message: string
  created_at: string
  updated_at: string
}

export interface TemplateRecord {
  id: string
  name: string
  kind: 'builtin' | 'custom'
  protocol: string
  transport: string
  tls_mode: string
  node_types: NodeKind[]
  description: string
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

export interface ReleaseRecord {
  id: string
  mode: 'direct_apply'
  node_ids: string[]
  template_ids: string[]
  template_names: string[]
  summary: string
  params: Record<string, unknown>
  results: Array<{
    node_id: string
    node_name?: string
    status: 'queued' | 'failed'
    desired_version?: number
    reason?: string
  }>
  created_at: string
}

export interface RegistryOption {
  key: string
  label: string
}

export interface TemplateRegistry {
  protocols: RegistryOption[]
  transports: RegistryOption[]
  tls_modes: RegistryOption[]
}

export interface SystemStatus {
  app_version: string
  kv_available: boolean
  kv_namespace: string
  subscription_base_url: string
  uptime_hint: string
  now: string
}
