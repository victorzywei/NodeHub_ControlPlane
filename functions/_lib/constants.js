export const APP_VERSION = '2.0.0'
export const ONLINE_WINDOW_MS = 2 * 60 * 1000

export const BUILTIN_TEMPLATES = [
  {
    id: 'tpl_builtin_vless_ws_tls',
    kind: 'builtin',
    name: 'VLESS + WS + TLS',
    protocol: 'vless',
    transport: 'ws',
    tls_mode: 'tls',
    node_types: ['vps', 'edge'],
    description: '默认 WebSocket TLS 模板',
    defaults: {
      port: 443,
      path: '/connect',
      host: '',
    },
  },
  {
    id: 'tpl_builtin_trojan_tcp_tls',
    kind: 'builtin',
    name: 'Trojan + TCP + TLS',
    protocol: 'trojan',
    transport: 'tcp',
    tls_mode: 'tls',
    node_types: ['vps'],
    description: '经典 Trojan TLS 模板',
    defaults: {
      port: 443,
      sni: '',
    },
  },
]

export const TEMPLATE_REGISTRY = {
  protocols: [
    { key: 'vless', label: 'VLESS' },
    { key: 'trojan', label: 'Trojan' },
    { key: 'vmess', label: 'VMess' },
  ],
  transports: [
    { key: 'ws', label: 'WebSocket' },
    { key: 'grpc', label: 'gRPC' },
    { key: 'tcp', label: 'TCP' },
  ],
  tls_modes: [
    { key: 'tls', label: 'TLS' },
    { key: 'reality', label: 'Reality' },
    { key: 'none', label: 'None' },
  ],
}
