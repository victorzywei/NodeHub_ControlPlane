const PROFILE_DEFAULT_PORTS = {
  'vless:tcp:reality': 49443,
  'hysteria2:udp:tls': 49444,
  'shadowsocks2022:tcp:none': 49445,
  'vless:ws:tls': 2053,
  'trojan:tcp:tls': 2087,
}

function profileKey(protocol, transport, tlsMode) {
  return `${String(protocol || '').trim()}:${String(transport || '').trim()}:${String(tlsMode || '').trim()}`
}

function normalizeDefaults(defaults) {
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) return {}
  return { ...defaults }
}

function isEmptyValue(value) {
  if (value === undefined || value === null) return true
  if (typeof value === 'string' && value.trim() === '') return true
  return false
}

function randomHex(bytes = 16) {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(buffer, (item) => item.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64(bytes) {
  let binary = ''
  for (const value of bytes) binary += String.fromCharCode(value)
  return btoa(binary)
}

function randomBase64Url(bytes = 32) {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes))
  return bytesToBase64(buffer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function hexToBytes(hex) {
  const value = String(hex || '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(value)) return null
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function normalizeRealityPrivateKey(value) {
  const raw = String(value || '').trim()
  if (!raw) return randomBase64Url(32)

  if (/^[A-Za-z0-9_-]{43}$/.test(raw)) return raw
  if (/^[A-Za-z0-9+/]{43}=$/.test(raw) || /^[A-Za-z0-9+/]{44}$/.test(raw)) {
    return raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }

  const hexBytes = hexToBytes(raw)
  if (hexBytes) {
    return bytesToBase64(hexBytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }

  return randomBase64Url(32)
}

function ensureValue(target, key, valueFactory) {
  if (!isEmptyValue(target[key])) return
  target[key] = valueFactory()
}

export function applyTemplateAutoDefaults({ protocol, transport, tlsMode, defaults }) {
  const next = normalizeDefaults(defaults)
  const p = String(protocol || '').trim()
  const t = String(transport || '').trim()
  const tls = String(tlsMode || '').trim()

  const key = profileKey(p, t, tls)
  const defaultPort = PROFILE_DEFAULT_PORTS[key]
  if (defaultPort !== undefined && isEmptyValue(next.port)) {
    next.port = defaultPort
  }

  if (p === 'vless' && t === 'ws' && tls === 'tls') {
    ensureValue(next, 'path', () => '/ws')
    ensureValue(next, 'host', () => '')
  }

  if (t === 'httpupgrade' || t === 'xhttp') {
    ensureValue(next, 'path', () => '/')
    ensureValue(next, 'host', () => '')
  }

  if (t === 'grpc') {
    ensureValue(next, 'service_name', () => 'grpc')
  }

  if (p === 'vless' && tls === 'reality') {
    ensureValue(next, 'flow', () => 'xtls-rprx-vision')
    ensureValue(next, 'server_name', () => '')
    next.reality_private_key = normalizeRealityPrivateKey(next.reality_private_key)
    ensureValue(next, 'reality_short_id', () => randomHex(8))
  }

  if (p === 'trojan') {
    ensureValue(next, 'password', () => randomHex(16))
    ensureValue(next, 'sni', () => '')
  }

  if (p === 'hysteria2') {
    ensureValue(next, 'password', () => randomHex(16))
    ensureValue(next, 'obfs', () => 'none')
    ensureValue(next, 'sni', () => '')
  }

  if (p === 'shadowsocks2022') {
    ensureValue(next, 'method', () => '2022-blake3-aes-128-gcm')
    ensureValue(next, 'password', () => randomHex(32))
  }

  return next
}
