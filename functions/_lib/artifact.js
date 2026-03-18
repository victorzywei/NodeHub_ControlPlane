function text(value) {
  return String(value ?? '').trim()
}

function toHost(value) {
  const raw = text(value)
  if (!raw) return ''

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      return new URL(raw).hostname || ''
    } catch {
      return ''
    }
  }

  return raw.replace(/\/.*$/, '').trim()
}

function firstHost(candidates) {
  for (const candidate of candidates || []) {
    const host = toHost(candidate)
    if (host) return host
  }
  return ''
}

function resolveServerDomain(node) {
  const argoHost = firstHost([node?.argo_domain, node?.argo_temp_domain])
  const publicHost = firstHost([node?.primary_domain, node?.backup_domain])
  if (node?.install_argo === true) return argoHost || publicHost || ''
  return publicHost || argoHost || ''
}

function supportsArgoTlsOffloadTransport(template) {
  const transport = text(template?.transport).toLowerCase()
  return transport === 'ws' || transport === 'httpupgrade' || transport === 'xhttp' || transport === 'grpc'
}

function shouldUseArgoTlsOffload(template, node) {
  const tlsMode = text(template?.tls_mode).toLowerCase()
  return node?.install_argo === true && tlsMode === 'tls' && supportsArgoTlsOffloadTransport(template)
}

function resolveInboundTlsMode(template, node) {
  if (shouldUseArgoTlsOffload(template, node)) return 'none'
  return text(template?.tls_mode).toLowerCase() || 'none'
}

function resolveClientTlsMode(template, node) {
  const tlsMode = text(template?.tls_mode).toLowerCase() || 'none'
  if (tlsMode === 'reality') return 'reality'
  if (node?.install_argo === true && supportsArgoTlsOffloadTransport(template)) return 'tls'
  return tlsMode
}

function resolveSubscriptionPort(template, settings, node, clientTlsMode) {
  const listenPort = Math.max(1, Math.min(65535, Math.floor(num(settings?.port, 443))))
  if (node?.install_argo === true && clientTlsMode === 'tls' && supportsArgoTlsOffloadTransport(template)) {
    return 443
  }
  return listenPort
}

function num(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function hash32(input) {
  // FNV-1a 32-bit hash, deterministic and fast for seeded fallback values.
  let hash = 0x811c9dc5
  const textInput = String(input ?? '')
  for (let i = 0; i < textInput.length; i += 1) {
    hash ^= textInput.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

function seededHex(seed, bytes) {
  let out = ''
  let idx = 0
  while (out.length < bytes * 2) {
    const h = hash32(`${seed}:${idx}`).toString(16).padStart(8, '0')
    out += h
    idx += 1
  }
  return out.slice(0, bytes * 2)
}

function deterministicUuid(seed) {
  const hex = seededHex(seed, 16).split('')
  // UUID v4 layout bits
  hex[12] = '4'
  const variant = Number.parseInt(hex[16], 16)
  hex[16] = ((variant & 0x3) | 0x8).toString(16)
  const value = hex.join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`
}

function randomHex(bytes) {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array, (value) => value.toString(16).padStart(2, '0')).join('')
}

function randomUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const hex = randomHex(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function base64EncodeBytes(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64EncodeUtf8(input) {
  return base64EncodeBytes(new TextEncoder().encode(input))
}

async function sha256HexFromBytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256Hex(input) {
  return sha256HexFromBytes(new TextEncoder().encode(input))
}

function writeTarString(target, offset, size, value) {
  const source = new TextEncoder().encode(String(value || ''))
  const limit = Math.min(size, source.length)
  for (let i = 0; i < limit; i += 1) target[offset + i] = source[i]
}

function writeTarOctal(target, offset, size, value) {
  const oct = Math.max(0, Math.floor(Number(value) || 0)).toString(8).padStart(Math.max(1, size - 1), '0')
  writeTarString(target, offset, size, oct)
  target[offset + size - 1] = 0
}

function buildTarHeader(path, size) {
  const safePath = String(path || '')
  if (!safePath || safePath.length > 100 || safePath.startsWith('/') || safePath.includes('..')) {
    throw new Error(`invalid tar entry path: ${safePath}`)
  }

  const header = new Uint8Array(512)
  writeTarString(header, 0, 100, safePath)
  writeTarOctal(header, 100, 8, 0o644)
  writeTarOctal(header, 108, 8, 0)
  writeTarOctal(header, 116, 8, 0)
  writeTarOctal(header, 124, 12, size)
  writeTarOctal(header, 136, 12, 0)
  for (let i = 148; i < 156; i += 1) header[i] = 0x20
  header[156] = '0'.charCodeAt(0)
  writeTarString(header, 257, 6, 'ustar')
  writeTarString(header, 263, 2, '00')
  writeTarString(header, 265, 32, 'nodehub')
  writeTarString(header, 297, 32, 'nodehub')

  let checksum = 0
  for (let i = 0; i < header.length; i += 1) checksum += header[i]
  const oct = checksum.toString(8).padStart(6, '0')
  writeTarString(header, 148, 6, oct)
  header[154] = 0
  header[155] = 0x20
  return header
}

function buildTarArchive(files) {
  const encoder = new TextEncoder()
  const chunks = []
  let total = 0
  const ordered = [...(files || [])].sort((a, b) => String(a.path || '').localeCompare(String(b.path || '')))

  for (const file of ordered) {
    const path = String(file.path || '')
    const content = String(file.content || '')
    const body = encoder.encode(content)
    const header = buildTarHeader(path, body.length)
    const pad = (512 - (body.length % 512)) % 512

    chunks.push(header)
    chunks.push(body)
    if (pad > 0) chunks.push(new Uint8Array(pad))
    total += header.length + body.length + pad
  }

  const footer = new Uint8Array(1024)
  chunks.push(footer)
  total += footer.length

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function summarizeParams(params) {
  const entries = Object.entries(params || {})
  if (entries.length === 0) return ''
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ')
}

export function summarizeConfig(templateNames, params) {
  const templateText = templateNames.length > 0 ? templateNames.join(' / ') : 'no-template'
  const paramsText = summarizeParams(params)
  return paramsText ? `${templateText} | ${paramsText}` : templateText
}

function normalizeEngine(value) {
  const engine = text(value)
  return engine === 'xray' ? 'xray' : 'sing-box'
}

function requireField(name, value) {
  if (text(value)) return text(value)
  throw new Error(`missing required field: ${name}`)
}

function resolveRealityHandshake(serverName) {
  return {
    server: text(serverName || 'www.cloudflare.com'),
    server_port: 443,
  }
}

function resolveRequiredValue(settings, keys, generator) {
  for (const key of keys) {
    const value = text(settings[key])
    if (value) return value
  }
  const generated = generator()
  settings[keys[0]] = generated
  return generated
}

function toUser(template, settings, seedBase = '') {
  const seeded = (suffix, randomFactory, bytes = 16) => {
    if (seedBase) return seededHex(`${seedBase}:${suffix}`, bytes)
    return randomFactory()
  }
  const seededUuidValue = (suffix) => {
    if (seedBase) return deterministicUuid(`${seedBase}:${suffix}`)
    return randomUuid()
  }

  const protocol = text(template.protocol).toLowerCase()
  if (protocol === 'vless') {
    return {
      uuid: resolveRequiredValue(settings, ['uuid', 'user_id', 'id'], () => seededUuidValue('uuid')),
      flow: text(settings.flow) || undefined,
    }
  }
  if (protocol === 'vmess') {
    return {
      uuid: resolveRequiredValue(settings, ['uuid', 'user_id', 'id'], () => seededUuidValue('uuid')),
      alter_id: Math.max(0, Math.floor(num(settings.alter_id, 0))),
    }
  }
  if (protocol === 'trojan' || protocol === 'hysteria2') {
    return { password: resolveRequiredValue(settings, ['password'], () => seeded('password', () => randomHex(16), 16)) }
  }
  if (protocol === 'shadowsocks2022') {
    return {
      method: text(settings.method) || '2022-blake3-aes-128-gcm',
      password: resolveRequiredValue(settings, ['password'], () => seeded('password', () => randomHex(16), 16)),
    }
  }
  throw new Error(`unsupported protocol: ${template.protocol}`)
}

function buildTemplateSettings(template, params) {
  return {
    ...(template?.defaults || {}),
    ...(params || {}),
  }
}

function normalizeTemplateSettings(template, sourceSettings, node) {
  const settings = { ...(sourceSettings || {}) }
  const protocol = text(template?.protocol).toLowerCase()
  const transport = text(template?.transport).toLowerCase()
  const tlsMode = text(template?.tls_mode).toLowerCase()
  const fallbackDomain = node ? resolveServerDomain(node) : ''
  const templateId = text(template?.id || template?.name || 'tpl')
  const nodeId = node ? text(node.id) : ''
  const nodeToken = node ? text(node.token) : ''
  const credentialSeed = nodeId && nodeToken ? `${nodeId}:${nodeToken}:${templateId}:${protocol}` : ''

  if (protocol === 'vless' || protocol === 'vmess') {
    const user = toUser(template, settings, credentialSeed)
    settings.uuid = user.uuid
    if (protocol === 'vless' && transport !== 'tcp') {
      // Flow is only meaningful for VLESS over plain TCP/raw branches.
      delete settings.flow
    } else if (protocol === 'vless' && user.flow && !text(settings.flow)) {
      settings.flow = user.flow
    }
    if (protocol === 'vmess') {
      settings.alter_id = user.alter_id
      if (!text(settings.encryption)) settings.encryption = 'auto'
    }
  } else if (protocol === 'trojan' || protocol === 'hysteria2') {
    const user = toUser(template, settings, credentialSeed)
    settings.password = user.password
  } else if (protocol === 'shadowsocks2022') {
    const user = toUser(template, settings, credentialSeed)
    settings.method = user.method
    settings.password = user.password
  }

  if (transport === 'ws' || transport === 'httpupgrade' || transport === 'xhttp') {
    if (!text(settings.path)) settings.path = '/'
    if (settings.host === undefined || settings.host === null || text(settings.host) === '') settings.host = fallbackDomain
  } else if (transport === 'grpc') {
    if (!text(settings.service_name)) settings.service_name = 'grpc'
  }

  if (tlsMode === 'reality') {
    const shortId = text(settings.reality_short_id || settings.short_id)
    if (shortId) {
      settings.short_id = shortId
      settings.reality_short_id = shortId
    }
    const publicKey = text(settings.public_key || settings.reality_public_key)
    if (publicKey) {
      settings.public_key = publicKey
      settings.reality_public_key = publicKey
    }
  }

  if (protocol === 'hysteria2') {
    settings.up_mbps = num(settings.up_mbps, 100)
    settings.down_mbps = num(settings.down_mbps, 100)
  }

  if (fallbackDomain) {
    if (tlsMode === 'tls' && !text(settings.sni)) settings.sni = fallbackDomain
    if (tlsMode === 'reality' && !text(settings.server_name)) settings.server_name = fallbackDomain
  }

  return settings
}

function decorateTemplateWithResolvedSettings(template, params, node) {
  return {
    ...template,
    __resolved_settings: normalizeTemplateSettings(template, buildTemplateSettings(template, params), node),
  }
}

function getEffectiveTemplateSettings(template, params, node) {
  if (
    template &&
    typeof template === 'object' &&
    template.__resolved_settings &&
    typeof template.__resolved_settings === 'object' &&
    !Array.isArray(template.__resolved_settings)
  ) {
    return { ...template.__resolved_settings }
  }
  return normalizeTemplateSettings(template, buildTemplateSettings(template, params), node)
}

function applyTlsForSingbox(template, settings, node) {
  const tlsMode = resolveInboundTlsMode(template, node)
  if (!tlsMode || tlsMode === 'none') return undefined

  if (tlsMode === 'reality') {
    const serverName = text(settings.server_name || settings.sni || settings.host || 'www.cloudflare.com')
    const shortId = text(settings.reality_short_id || settings.short_id)
    const handshake = resolveRealityHandshake(serverName)
    return {
      enabled: true,
      server_name: serverName,
      reality: {
        enabled: true,
        handshake,
        private_key: requireField('reality_private_key', settings.reality_private_key || settings.private_key),
        short_id: shortId ? [shortId] : [],
      },
    }
  }

  return {
    enabled: true,
    certificate_path: '__NODEHUB_CERT_CRT__',
    key_path: '__NODEHUB_CERT_KEY__',
    server_name: text(settings.server_name || settings.sni || settings.host || ''),
    alpn: settings.alpn ? (Array.isArray(settings.alpn) ? settings.alpn : [settings.alpn]) : undefined,
  }
}

function applyTransportForSingbox(template, settings) {
  const transport = text(template.transport).toLowerCase()
  if (!transport || transport === 'tcp' || transport === 'udp') return undefined

  if (transport === 'mkcp') {
    throw new Error(`sing-box does not support transport: ${transport}`)
  }

  if (transport === 'ws') {
    return {
      type: 'ws',
      path: text(settings.path || '/'),
      headers: { Host: text(settings.host) || undefined },
    }
  }

  if (transport === 'grpc') {
    return {
      type: 'grpc',
      service_name: text(settings.service_name || 'grpc'),
    }
  }

  if (transport === 'httpupgrade') {
    return {
      type: 'httpupgrade',
      path: text(settings.path || '/'),
      host: text(settings.host),
    }
  }

  if (transport === 'xhttp') {
    return {
      type: 'xhttp',
      path: text(settings.path || '/'),
      host: text(settings.host) || undefined,
    }
  }

  throw new Error(`unsupported transport for sing-box: ${transport}`)
}

function buildSingboxInbound(template, params, idx, node) {
  const settings = getEffectiveTemplateSettings(template, params, node)
  const protocol = text(template.protocol).toLowerCase()
  const listenPort = Math.max(1, Math.min(65535, Math.floor(num(settings.port, 443))))
  if (!listenPort) throw new Error(`invalid port for template: ${template.name}`)

  if (protocol === 'vless') {
    return {
      type: 'vless',
      tag: `in-${idx + 1}-vless`,
      listen: '::',
      listen_port: listenPort,
      users: [toUser(template, settings)],
      tls: applyTlsForSingbox(template, settings, node),
      transport: applyTransportForSingbox(template, settings),
    }
  }

  if (protocol === 'trojan') {
    return {
      type: 'trojan',
      tag: `in-${idx + 1}-trojan`,
      listen: '::',
      listen_port: listenPort,
      users: [toUser(template, settings)],
      tls: applyTlsForSingbox(template, settings, node),
      transport: applyTransportForSingbox(template, settings),
    }
  }

  if (protocol === 'vmess') {
    const user = toUser(template, settings)
    return {
      type: 'vmess',
      tag: `in-${idx + 1}-vmess`,
      listen: '::',
      listen_port: listenPort,
      users: [{ uuid: user.uuid }],
      tls: applyTlsForSingbox(template, settings, node),
      transport: applyTransportForSingbox(template, settings),
    }
  }

  if (protocol === 'hysteria2') {
    const inbound = {
      type: 'hysteria2',
      tag: `in-${idx + 1}-hysteria2`,
      listen: '::',
      listen_port: listenPort,
      users: [toUser(template, settings)],
      tls: applyTlsForSingbox(template, settings, node) || {
        enabled: true,
        certificate_path: '__NODEHUB_CERT_CRT__',
        key_path: '__NODEHUB_CERT_KEY__',
      },
      up_mbps: num(settings.up_mbps, 100),
      down_mbps: num(settings.down_mbps, 100),
    }

    const obfs = text(settings.obfs || settings.obfs_type)
    if (obfs && obfs !== 'none') {
      inbound.obfs = {
        type: obfs,
        password: text(settings.obfs_password || ''),
      }
    }
    return inbound
  }

  if (protocol === 'shadowsocks2022') {
    const user = toUser(template, settings)
    return {
      type: 'shadowsocks',
      tag: `in-${idx + 1}-ss2022`,
      listen: '::',
      listen_port: listenPort,
      method: user.method,
      password: user.password,
      network: text(template.transport || 'tcp') || 'tcp',
    }
  }

  throw new Error(`unsupported template protocol for sing-box: ${template.protocol}`)
}

// ── WARP helpers ──
const DEFAULT_WARP_SERVER = 'engage.cloudflareclient.com'
const DEFAULT_WARP_SERVER_PORT = 2408
const DEFAULT_WARP_PEER_PUBLIC_KEY = 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo='
const DEFAULT_WARP_LOCAL_ADDRESS_IPV4 = '172.16.0.2/32'
const DEFAULT_WARP_LOCAL_ADDRESS_IPV6 = '2606:4700:110:8d8d:1845:c39f:2dd5:a03a/128'

function toBool(value, fallback = false) {
  if (value === true || value === false) return value
  const raw = text(value).toLowerCase()
  if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return true
  if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false
  return fallback
}

function toPortNumber(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const port = Math.floor(n)
  if (port < 1 || port > 65535) return fallback
  return port
}

function normalizeV6Cidr(value, fallback) {
  const raw = text(value)
  if (!raw) return fallback
  return raw.includes('/') ? raw : `${raw}/128`
}

function parseHostPort(value, fallbackHost, fallbackPort) {
  const raw = text(value)
  if (!raw) return { host: fallbackHost, port: fallbackPort }

  const bracketMatch = raw.match(/^\[(.+)\]:(\d+)$/)
  if (bracketMatch) {
    return {
      host: bracketMatch[1] || fallbackHost,
      port: toPortNumber(bracketMatch[2], fallbackPort),
    }
  }

  const sep = raw.lastIndexOf(':')
  if (sep <= 0 || sep >= raw.length - 1) {
    return { host: raw, port: fallbackPort }
  }

  const host = raw.slice(0, sep)
  const portRaw = raw.slice(sep + 1)
  if (!host || !/^\d+$/.test(portRaw)) {
    return { host: raw, port: fallbackPort }
  }

  return {
    host,
    port: toPortNumber(portRaw, fallbackPort),
  }
}

function normalizeReserved(value, fallback) {
  if (Array.isArray(value) && value.length === 3) {
    const reserved = value.map((item) => Number(item))
    if (reserved.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) return reserved
  }

  const raw = text(value)
  if (raw) {
    const reserved = raw.split(',').map((item) => Number(item.trim()))
    if (reserved.length === 3 && reserved.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) return reserved
  }

  return fallback
}

function resolveWarpRouteCidrs(value) {
  const mode = text(value).toLowerCase()
  if (mode === 'ipv4') return ['0.0.0.0/0']
  if (mode === 'ipv6') return ['::/0']
  return ['0.0.0.0/0', '::/0']
}

function resolveXrayWarpDomainStrategy(value) {
  const mode = text(value).toLowerCase()
  if (mode === 'ipv4') return 'ForceIPv4'
  if (mode === 'ipv6') return 'ForceIPv6'
  return 'ForceIP'
}

function isIpv4Address(value) {
  const raw = text(value)
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return false
  return raw.split('.').every((part) => {
    const n = Number(part)
    return Number.isInteger(n) && n >= 0 && n <= 255
  })
}

function isIpv6Address(value) {
  const raw = text(value)
  if (!raw || !raw.includes(':')) return false
  if (!/^[0-9a-fA-F:]+$/.test(raw)) return false
  return true
}

function buildWarpEndpointBypassRule(server) {
  const host = text(server)
  if (!host) return null
  if (isIpv4Address(host)) {
    return { action: 'route', ip_cidr: [`${host}/32`], outbound: 'direct' }
  }
  if (isIpv6Address(host)) {
    return { action: 'route', ip_cidr: [`${host}/128`], outbound: 'direct' }
  }
  return { action: 'route', domain: [host], outbound: 'direct' }
}

function inboundTagSuffix(protocol) {
  const normalized = text(protocol).toLowerCase()
  if (normalized === 'vless') return 'vless'
  if (normalized === 'trojan') return 'trojan'
  if (normalized === 'vmess') return 'vmess'
  if (normalized === 'hysteria2') return 'hysteria2'
  if (normalized === 'shadowsocks2022') return 'ss2022'
  return ''
}

function resolveInboundTagsByWarp(templates) {
  const result = { warpTags: [], directTags: [] }
  ;(templates || []).forEach((template, idx) => {
    const suffix = inboundTagSuffix(template?.protocol)
    if (!suffix) return
    const tag = `in-${idx + 1}-${suffix}`
    const useWarp = template?.warp_exit === true || template?.defaults?.warp_exit === true
    if (useWarp) result.warpTags.push(tag)
    else result.directTags.push(tag)
  })
  return result
}

function resolveWarpRoute(templates, node) {
  const primaryTemplate = (templates || []).find((t) => t.warp_exit === true || t.defaults?.warp_exit === true)
  if (!primaryTemplate) return null
  const settings = getEffectiveTemplateSettings(primaryTemplate, {}, node)

  const routeMode = text(primaryTemplate.warp_route_mode || primaryTemplate.defaults?.warp_route_mode || 'all').toLowerCase() || 'all'
  const ipCidrs = resolveWarpRouteCidrs(routeMode)

  const fallbackReserved = Array.isArray(node?.warp_reserved) && node.warp_reserved.length === 3
    ? node.warp_reserved.map(Number)
    : [0, 0, 0]

  const endpointFallback = parseHostPort(node?.warp_endpoint, DEFAULT_WARP_SERVER, DEFAULT_WARP_SERVER_PORT)
  const nodeV6 = normalizeV6Cidr(text(node?.warp_v6), DEFAULT_WARP_LOCAL_ADDRESS_IPV6)

  const localAddressV4 = text(settings.warp_local_address_ipv4 || settings.local_address_ipv4 || DEFAULT_WARP_LOCAL_ADDRESS_IPV4)
  const localAddressV6 = normalizeV6Cidr(
    settings.warp_local_address_ipv6 || settings.local_address_ipv6 || nodeV6,
    DEFAULT_WARP_LOCAL_ADDRESS_IPV6,
  )
  const localAddress = [localAddressV4, localAddressV6].filter(Boolean)

  const privateKey = requireField('warp_private_key', settings.warp_private_key || settings.private_key || node?.warp_private_key)

  const server = text(settings.warp_server || settings.server || endpointFallback.host || DEFAULT_WARP_SERVER)
  const serverPort = toPortNumber(settings.warp_server_port || settings.server_port, endpointFallback.port)
  const peerPublicKey = text(settings.warp_peer_public_key || settings.peer_public_key || DEFAULT_WARP_PEER_PUBLIC_KEY)
  const systemInterface = toBool(settings.warp_system_interface ?? settings.system_interface, false)
  const mtu = Math.max(576, Math.min(65535, Math.floor(num(settings.warp_mtu, 1280))))
  const reserved = normalizeReserved(settings.warp_reserved, fallbackReserved)

  return {
    ipCidrs,
    routeMode,
    server,
    serverPort,
    localAddress,
    privateKey,
    peerPublicKey,
    systemInterface,
    mtu,
    reserved,
  }
}

function buildSingboxConfig(templates, params, node) {
  const inbounds = templates.map((tpl, idx) => buildSingboxInbound(tpl, params, idx, node))
  const outbounds = [{ type: 'direct', tag: 'direct' }]
  const endpoints = []
  const route = { final: 'direct' }

  const warp = resolveWarpRoute(templates, node)
  if (warp) {
    const inboundTags = resolveInboundTagsByWarp(templates)
    const endpointBypassRule = buildWarpEndpointBypassRule(warp.server)
    const rules = [
      { action: 'sniff' },
      { action: 'resolve', strategy: 'prefer_ipv4' },
      ...(endpointBypassRule ? [endpointBypassRule] : []),
    ]
    if (inboundTags.warpTags.length > 0) {
      // Route only WARP-enabled template inbounds through WARP.
      rules.push({ action: 'route', inbound: inboundTags.warpTags, ip_cidr: warp.ipCidrs, outbound: 'warp-ep' })
    } else {
      rules.push({ action: 'route', ip_cidr: warp.ipCidrs, outbound: 'warp-ep' })
    }
    if (inboundTags.directTags.length > 0) {
      // Force non-WARP templates to direct, independent of global IP rules.
      rules.push({ action: 'route', inbound: inboundTags.directTags, outbound: 'direct' })
    }

    endpoints.push({
      type: 'wireguard',
      tag: 'warp-ep',
      system: warp.systemInterface,
      mtu: warp.mtu,
      address: warp.localAddress,
      private_key: warp.privateKey,
      peers: [
        {
          address: warp.server,
          port: warp.serverPort,
          public_key: warp.peerPublicKey,
          allowed_ips: ['0.0.0.0/0', '::/0'],
          persistent_keepalive_interval: 30,
          reserved: warp.reserved,
        },
      ],
    })
    route.rules = rules
  }

  return {
    log: { level: 'info', timestamp: true },
    ...(endpoints.length > 0 ? { endpoints } : {}),
    inbounds,
    outbounds,
    route,
  }
}

function buildXrayStreamSettings(template, settings, node) {
  const protocol = text(template.protocol).toLowerCase()
  const tlsMode = resolveInboundTlsMode(template, node)
  let transport = protocol === 'hysteria2' ? 'hysteria' : (text(template.transport).toLowerCase() || 'tcp')

  // Xray REALITY in recent versions requires raw/xhttp/grpc, while templates
  // still model plain TCP as "tcp". Map it to "raw" at render time.
  if (tlsMode === 'reality' && transport === 'tcp') {
    transport = 'raw'
  }

  if (tlsMode === 'reality' && !['raw', 'grpc', 'xhttp'].includes(transport)) {
    throw new Error(`xray reality does not support transport: ${transport}`)
  }

  if (transport === 'mkcp') {
    transport = 'kcp'
  }
  const stream = { network: transport }

  if (transport === 'ws') {
    stream.wsSettings = {
      path: text(settings.path || '/'),
      headers: { Host: text(settings.host || '') },
    }
  } else if (transport === 'grpc') {
    stream.grpcSettings = {
      serviceName: text(settings.service_name || 'grpc'),
    }
  } else if (transport === 'httpupgrade') {
    stream.httpupgradeSettings = {
      host: text(settings.host || ''),
      path: text(settings.path || '/'),
    }
  } else if (transport === 'xhttp') {
    stream.xhttpSettings = {
      path: text(settings.path || '/'),
      host: text(settings.host || '') || undefined,
    }
  } else if (transport === 'kcp') {
    stream.kcpSettings = {
      seed: text(settings.seed || '') || undefined,
    }
  } else if (transport === 'hysteria') {
    stream.hysteriaSettings = {
      version: 2,
      auth: text(settings.password || ''),
    }
  }

  if (tlsMode === 'tls') {
    stream.security = 'tls'
    stream.tlsSettings = {
      serverName: text(settings.server_name || settings.sni || settings.host || ''),
      certificates: [{
        certificateFile: '__NODEHUB_CERT_CRT__',
        keyFile: '__NODEHUB_CERT_KEY__',
      }],
    }
  } else if (tlsMode === 'reality') {
    const serverName = text(settings.server_name || settings.sni || settings.host || 'www.cloudflare.com')
    const shortId = text(settings.reality_short_id || settings.short_id)
    const realityDest = `${serverName}:443`
    stream.security = 'reality'
    stream.realitySettings = {
      show: false,
      dest: realityDest,
      xver: 0,
      serverNames: [serverName],
      privateKey: requireField('reality_private_key', settings.reality_private_key || settings.private_key),
      shortIds: shortId ? [shortId] : [],
    }
  }

  return stream
}

function buildXrayInbound(template, params, idx, node) {
  const settings = getEffectiveTemplateSettings(template, params, node)
  const protocol = text(template.protocol).toLowerCase()
  const listenPort = Math.max(1, Math.min(65535, Math.floor(num(settings.port, 443))))
  const streamSettings = buildXrayStreamSettings(template, settings, node)

  if (protocol === 'vless') {
    const user = toUser(template, settings)
    return {
      tag: `in-${idx + 1}-vless`,
      listen: '::',
      port: listenPort,
      protocol: 'vless',
      settings: {
        decryption: 'none',
        clients: [{
          id: user.uuid,
          flow: user.flow,
        }],
      },
      streamSettings,
    }
  }

  if (protocol === 'trojan') {
    const user = toUser(template, settings)
    return {
      tag: `in-${idx + 1}-trojan`,
      listen: '::',
      port: listenPort,
      protocol: 'trojan',
      settings: {
        clients: [{ password: user.password }],
      },
      streamSettings,
    }
  }

  if (protocol === 'vmess') {
    const user = toUser(template, settings)
    return {
      tag: `in-${idx + 1}-vmess`,
      listen: '::',
      port: listenPort,
      protocol: 'vmess',
      settings: {
        clients: [{
          id: user.uuid,
          alterId: user.alter_id,
        }],
      },
      streamSettings,
    }
  }

  if (protocol === 'shadowsocks2022') {
    const user = toUser(template, settings)
    return {
      tag: `in-${idx + 1}-ss2022`,
      listen: '::',
      port: listenPort,
      protocol: 'shadowsocks',
      settings: {
        method: user.method,
        password: user.password,
        network: text(template.transport || 'tcp') || 'tcp',
      },
    }
  }

  if (protocol === 'hysteria2') {
    const user = toUser(template, settings)
    return {
      tag: `in-${idx + 1}-hysteria2`,
      listen: '::',
      port: listenPort,
      protocol: 'hysteria',
      settings: {
        version: 2,
        clients: [{ auth: user.password }],
      },
      streamSettings,
    }
  }

  throw new Error(`unsupported template protocol for xray: ${template.protocol}`)
}

function buildXrayConfig(templates, params, node) {
  const inbounds = templates.map((tpl, idx) => buildXrayInbound(tpl, params, idx, node))
  const outbounds = [
    { tag: 'direct', protocol: 'freedom' },
  ]
  const routing = {
    domainStrategy: 'AsIs',
    rules: [],
  }

  const warp = resolveWarpRoute(templates, node)
  if (warp) {
    const inboundTags = resolveInboundTagsByWarp(templates)
    const warpEndpoint = `${warp.server}:${warp.serverPort}`
    outbounds.push({
      tag: 'x-warp-out',
      protocol: 'wireguard',
      settings: {
        secretKey: warp.privateKey,
        address: warp.localAddress,
        peers: [{
          publicKey: warp.peerPublicKey,
          allowedIPs: ['0.0.0.0/0', '::/0'],
          endpoint: warpEndpoint,
          keepAlive: 30,
        }],
        reserved: warp.reserved,
        mtu: warp.mtu,
        noKernelTun: !warp.systemInterface,
        domainStrategy: resolveXrayWarpDomainStrategy(warp.routeMode),
      },
    })
    routing.domainStrategy = 'IPOnDemand'
    routing.rules = []
    if (inboundTags.warpTags.length > 0) {
      routing.rules.push({
        type: 'field',
        inboundTag: inboundTags.warpTags,
        ip: warp.ipCidrs,
        network: 'tcp,udp',
        outboundTag: 'x-warp-out',
      })
    } else {
      routing.rules.push({ type: 'field', ip: warp.ipCidrs, network: 'tcp,udp', outboundTag: 'x-warp-out' })
    }
    if (inboundTags.directTags.length > 0) {
      routing.rules.push({ type: 'field', inboundTag: inboundTags.directTags, outboundTag: 'direct' })
    }
  }

  return { log: { loglevel: 'warning' }, inbounds, outbounds, routing }
}

function buildSubscriptionOutbounds(templates, params, node) {
  return templates.map((tpl) => {
    const settings = getEffectiveTemplateSettings(tpl, params, node)
    const clientTlsMode = resolveClientTlsMode(tpl, node)
    const subscriptionPort = resolveSubscriptionPort(tpl, settings, node, clientTlsMode)
    const domainFallback = resolveServerDomain(node)
    const nextSettings = { ...settings }
    if (clientTlsMode === 'tls') {
      if (!text(nextSettings.host)) nextSettings.host = domainFallback
      if (!text(nextSettings.sni)) nextSettings.sni = text(nextSettings.server_name || nextSettings.host || domainFallback)
    }

    return {
      template_id: text(tpl.id),
      template_name: text(tpl.name),
      protocol: text(tpl.protocol),
      transport: text(tpl.transport),
      tls_mode: clientTlsMode,
      port: subscriptionPort,
      settings: nextSettings,
    }
  })
}

function buildManifest({
  nodeId,
  rev,
  engine,
  engines,
  actionSingBox,
  actionXray,
  operationId,
  templateNames,
  params,
  summary,
  subscriptionOutbounds,
  createdAt,
}) {
  return {
    schema: 'nodehub-artifact-v1',
    node_id: nodeId,
    rev,
    engine,
    engines,
    action_sing_box: actionSingBox,
    action_xray: actionXray,
    operation_id: operationId,
    template_names: templateNames,
    params,
    summary,
    subscription_outbounds: subscriptionOutbounds,
    created_at: createdAt,
  }
}

function toManifestEnv(manifest) {
  return [
    `SCHEMA=${manifest.schema}`,
    `NODE_ID=${manifest.node_id}`,
    `REV=${manifest.rev}`,
    `ENGINE=${manifest.engine}`,
    `ENGINES=${Array.isArray(manifest.engines) ? manifest.engines.join(',') : ''}`,
    `ACTION_SING_BOX=${manifest.action_sing_box || ''}`,
    `ACTION_XRAY=${manifest.action_xray || ''}`,
    `OPERATION_ID=${manifest.operation_id}`,
    `SUMMARY=${(manifest.summary || '').replace(/\r?\n/g, ' ')}`,
    `CREATED_AT=${manifest.created_at}`,
  ].join('\n') + '\n'
}

function toArtifactFilesMap(files) {
  const rows = {}
  for (const file of files || []) {
    const path = String(file?.path || '')
    if (!path) continue
    if (path.startsWith('/') || path.includes('..')) continue
    rows[path] = String(file?.content || '')
  }
  return rows
}

function buildConfigObject(engine, templates, params, node) {
  if (engine === 'xray') return buildXrayConfig(templates, params, node)
  return buildSingboxConfig(templates, params, node)
}

function buildConfigFile(engine, templates, params, node) {
  const config = buildConfigObject(engine, templates, params, node)
  if (engine === 'xray') {
    return {
      path: 'xray.json',
      content: JSON.stringify(config, null, 2) + '\n',
    }
  }
  return {
    path: 'sing-box.json',
    content: JSON.stringify(config, null, 2) + '\n',
  }
}

export function buildNodeConfigPreview({ templates, params = {}, engine, node }) {
  const selectedEngine = normalizeEngine(engine || templates?.[0]?.engine)
  const decoratedTemplates = (templates || []).map((t) => decorateTemplateWithResolvedSettings(t, params, node))
  const configFile = buildConfigFile(selectedEngine, decoratedTemplates, params || {}, node)
  return {
    engine: selectedEngine,
    config_name: configFile.path,
    config_text: configFile.content,
  }
}

function buildTemplateGroups({ templates, templateGroups, engine }) {
  if (Array.isArray(templateGroups) && templateGroups.length > 0) {
    return templateGroups
      .map((group) => ({
        engine: normalizeEngine(group.engine),
        templates: Array.isArray(group.templates) ? group.templates : [],
      }))
      .filter((group) => group.templates.length > 0)
  }

  return [
    {
      engine: normalizeEngine(engine || templates[0]?.engine),
      templates: Array.isArray(templates) ? templates : [],
    },
  ].filter((group) => group.templates.length > 0)
}

function getGroupAction(groups, engine) {
  return groups.some((group) => group.engine === engine && group.templates.length > 0) ? 'apply' : 'stop'
}

export async function buildNodeArtifactBundle({ node, rev, operationId, templates, templateGroups, params, createdAt, engine }) {
  const baseGroups = buildTemplateGroups({ templates, templateGroups, engine })
  const groups = baseGroups.map((group) => ({
    engine: group.engine,
    templates: group.templates.map((template) => decorateTemplateWithResolvedSettings(template, params, node)),
  }))
  const allTemplates = groups.flatMap((group) => group.templates)
  const templateNames = allTemplates.map((item) => item.name)
  const summary = summarizeConfig(templateNames, params)
  const selectedEngine = groups.length === 1 ? normalizeEngine(groups[0]?.engine || engine) : 'multi'
  const engines = groups.map((group) => group.engine)
  const actionSingBox = getGroupAction(groups, 'sing-box')
  const actionXray = getGroupAction(groups, 'xray')
  const reloadCmd = 'nodehub-protocol-restart'
  const subscriptionOutbounds = buildSubscriptionOutbounds(allTemplates, params, node)
  const manifest = buildManifest({
    nodeId: node.id,
    rev,
    engine: selectedEngine,
    engines,
    actionSingBox,
    actionXray,
    operationId,
    templateNames,
    params,
    summary,
    subscriptionOutbounds,
    createdAt,
  })

  const files = [
    { path: 'manifest.json', content: JSON.stringify(manifest, null, 2) + '\n' },
    { path: 'manifest.env', content: toManifestEnv(manifest) },
  ]

  for (const group of groups) {
    files.push(buildConfigFile(group.engine, group.templates, params, node))
  }

  const filesMap = toArtifactFilesMap(files)
  const packageBytes = buildTarArchive(files)
  const packageBase64 = base64EncodeBytes(packageBytes)
  const sha256 = await sha256HexFromBytes(packageBytes)

  return {
    rev,
    engine: selectedEngine,
    engines,
    action_sing_box: actionSingBox,
    action_xray: actionXray,
    reload_cmd: reloadCmd,
    sha256,
    summary,
    template_names: templateNames,
    params,
    subscription_outbounds: subscriptionOutbounds,
    manifest,
    files: filesMap,
    package_format: 'tar',
    package_base64: packageBase64,
  }
}
