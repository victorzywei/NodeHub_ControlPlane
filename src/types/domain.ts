export type NodeKind = 'vps' | 'edge'

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
  version: number
  node_ids: string[]
  template_ids: string[]
  results: Array<{
    node_id: string
    status: 'queued' | 'failed'
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
  uptime_hint: string
  now: string
}
