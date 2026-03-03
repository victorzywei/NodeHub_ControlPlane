export const PROTOCOL_TLS_SUPPORT: Record<string, string[]> = {
  vless: ['none', 'tls', 'reality'],
  trojan: ['tls'],
  vmess: ['none', 'tls'],
  hysteria2: ['tls'],
  shadowsocks2022: ['none'],
}

export const PROTOCOL_TRANSPORT_SUPPORT: Record<string, string[]> = {
  vless: ['tcp', 'mkcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'],
  trojan: ['tcp', 'mkcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'],
  vmess: ['tcp', 'mkcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'],
  hysteria2: ['udp'],
  shadowsocks2022: ['tcp', 'udp'],
}

function normalize(value: string): string {
  return String(value || '').trim().toLowerCase()
}

function normalizeEngine(value: string): string {
  return normalize(value) === 'xray' ? 'xray' : 'sing-box'
}

export function supportsProtocolTls(protocol: string, tlsMode: string): boolean {
  const allowed = PROTOCOL_TLS_SUPPORT[normalize(protocol)]
  if (!allowed) return false
  return allowed.includes(normalize(tlsMode))
}

export function supportsProtocolTransport(protocol: string, transport: string): boolean {
  const allowed = PROTOCOL_TRANSPORT_SUPPORT[normalize(protocol)]
  if (!allowed) return false
  return allowed.includes(normalize(transport))
}

export function supportsTemplateCombination(engine: string, protocol: string, transport: string, tlsMode: string): boolean {
  const e = normalizeEngine(engine)
  const p = normalize(protocol)
  const t = normalize(transport)
  const tls = normalize(tlsMode)

  if (!supportsProtocolTls(p, tls) || !supportsProtocolTransport(p, t)) return false
  if (e !== 'xray' && t === 'mkcp') return false

  if (tls === 'reality') {
    if (p !== 'vless') return false
    return t === 'tcp' || t === 'grpc' || t === 'xhttp'
  }

  return true
}
