export const APP_VERSION = '2.0.0'
export const ONLINE_WINDOW_MS = 2 * 60 * 1000

export const BUILTIN_TEMPLATES = [
  {
    id: 'tpl_builtin_vless_reality_tcp',
    kind: 'builtin',
    name: 'VLESS + Reality + TCP',
    protocol: 'vless',
    transport: 'tcp',
    tls_mode: 'reality',
    node_types: ['vps'],
    description: 'Reality 直连模板',
    defaults: {
      port: 49443,
      flow: 'xtls-rprx-vision',
      server_name: '',
      reality_private_key: '',
      reality_short_id: '',
    },
  },
  {
    id: 'tpl_builtin_hysteria2_udp_tls',
    kind: 'builtin',
    name: 'Hysteria2',
    protocol: 'hysteria2',
    transport: 'udp',
    tls_mode: 'tls',
    node_types: ['vps'],
    description: 'Hysteria2 UDP 模板',
    defaults: {
      port: 49444,
      password: '',
      obfs: 'none',
      sni: '',
    },
  },
  {
    id: 'tpl_builtin_ss2022_tcp',
    kind: 'builtin',
    name: 'Shadowsocks 2022',
    protocol: 'shadowsocks2022',
    transport: 'tcp',
    tls_mode: 'none',
    node_types: ['vps'],
    description: 'Shadowsocks 2022 模板',
    defaults: {
      port: 49445,
      method: '2022-blake3-aes-128-gcm',
      password: '',
    },
  },
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
      port: 2053,
      path: '/ws',
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
      port: 2087,
      password: '',
      sni: '',
    },
  },
]

export const TEMPLATE_REGISTRY = {
  protocols: [
    { key: 'vless', label: 'VLESS' },
    { key: 'trojan', label: 'Trojan' },
    { key: 'hysteria2', label: 'Hysteria2' },
    { key: 'shadowsocks2022', label: 'Shadowsocks 2022' },
    { key: 'vmess', label: 'VMess' },
  ],
  transports: [
    { key: 'ws', label: 'WebSocket' },
    { key: 'grpc', label: 'gRPC' },
    { key: 'tcp', label: 'TCP' },
    { key: 'udp', label: 'UDP' },
  ],
  tls_modes: [
    { key: 'tls', label: 'TLS' },
    { key: 'reality', label: 'Reality' },
    { key: 'none', label: 'None' },
  ],
}
