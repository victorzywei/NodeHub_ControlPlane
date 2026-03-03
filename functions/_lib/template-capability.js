function normalizeEngine(value) {
  return String(value || '').trim().toLowerCase() === 'xray' ? 'xray' : 'sing-box'
}

function normalizeProtocol(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeTransport(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeTlsMode(value) {
  return String(value || '').trim().toLowerCase()
}

export const PROTOCOL_TLS_SUPPORT = {
  vless: ['none', 'tls', 'reality'],
  trojan: ['tls'],
  vmess: ['none', 'tls'],
  hysteria2: ['tls'],
  shadowsocks2022: ['none'],
}

export const PROTOCOL_TRANSPORT_SUPPORT = {
  vless: ['tcp', 'mkcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'],
  trojan: ['tcp', 'mkcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'],
  vmess: ['tcp', 'mkcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'],
  hysteria2: ['udp'],
  shadowsocks2022: ['tcp', 'udp'],
}

export function supportsProtocolTls(protocol, tlsMode) {
  const p = normalizeProtocol(protocol)
  const tls = normalizeTlsMode(tlsMode)
  const allowed = PROTOCOL_TLS_SUPPORT[p]
  if (!allowed) return false
  return allowed.includes(tls)
}

export function supportsProtocolTransport(protocol, transport) {
  const p = normalizeProtocol(protocol)
  const t = normalizeTransport(transport)
  const allowed = PROTOCOL_TRANSPORT_SUPPORT[p]
  if (!allowed) return false
  return allowed.includes(t)
}

export function supportsTemplateCombination(engine, protocol, transport, tlsMode) {
  const e = normalizeEngine(engine)
  const p = normalizeProtocol(protocol)
  const t = normalizeTransport(transport)
  const tls = normalizeTlsMode(tlsMode)

  if (!supportsProtocolTls(p, tls) || !supportsProtocolTransport(p, t)) return false
  if (e !== 'xray' && (t === 'mkcp' || t === 'xhttp')) return false

  if (tls === 'reality') {
    if (p !== 'vless') return false
    if (e === 'xray') return t === 'tcp' || t === 'grpc' || t === 'xhttp'
    return t === 'tcp' || t === 'grpc'
  }

  return true
}
