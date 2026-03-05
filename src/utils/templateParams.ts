export type ParamValueType = 'string' | 'number'
export type TemplateParamInput = 'text' | 'number' | 'select' | 'password'

export interface TemplateParamOption {
  value: string
  label: string
}

export interface TemplateParamField {
  key: string
  label: string
  type: TemplateParamInput
  valueType: ParamValueType
  options?: TemplateParamOption[]
  placeholder?: string
  defaultValue?: string | number
  secret?: boolean
  custom?: boolean
  optional?: boolean
}

const LARGE_PUBLIC_DOMAIN_OPTIONS: TemplateParamOption[] = [
  { value: 'www.microsoft.com', label: 'www.microsoft.com' },
  { value: 'www.apple.com', label: 'www.apple.com' },
  { value: 'www.nvidia.com', label: 'www.nvidia.com' },
  { value: 'aws.amazon.com', label: 'aws.amazon.com' },
  { value: 'gateway.icloud.com', label: 'gateway.icloud.com' },
  { value: 'itunes.apple.com', label: 'itunes.apple.com' },
  { value: 'www.dbs.com.sg', label: 'www.dbs.com.sg' },
  { value: 'www.hsbc.com.hk', label: 'www.hsbc.com.hk' },
]

function hostHintByProtocol(protocol: string): string {
  if (protocol === 'hysteria2') return '服务器 IP 或域名'
  return '服务器域名'
}

function sniHintByProtocol(protocol: string): string {
  if (protocol === 'hysteria2') return '服务器 IP 或域名'
  return '服务器域名'
}

function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array, (value) => value.toString(16).padStart(2, '0')).join('')
}

function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const hex = randomHex(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function randomBase64Url(bytes: number): string {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  let binary = ''
  for (const value of array) binary += String.fromCharCode(value)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function isBase64Url43(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value || ''))
}

export interface RealityKeyPair {
  privateKey: string
  publicKey: string
}

export async function generateRealityKeyPair(): Promise<RealityKeyPair> {
  if (!crypto?.subtle) {
    throw new Error('WebCrypto unavailable')
  }

  let keyPair: CryptoKeyPair
  try {
    keyPair = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair
  } catch {
    throw new Error('X25519 not supported by current browser')
  }

  const [privateJwk, publicJwk] = await Promise.all([
    crypto.subtle.exportKey('jwk', keyPair.privateKey),
    crypto.subtle.exportKey('jwk', keyPair.publicKey),
  ])
  const privateKey = String((privateJwk as JsonWebKey).d || '')
  const publicKey = String((publicJwk as JsonWebKey).x || '')

  if (!isBase64Url43(privateKey) || !isBase64Url43(publicKey)) {
    throw new Error('Invalid X25519 keypair result')
  }

  return { privateKey, publicKey }
}

export function generateSecretValue(key: string, ctx?: Record<string, string>): string {
  if (key === 'uuid' || key === 'user_id' || key === 'id') return randomUuid()
  if (key === 'reality_private_key' || key === 'reality_public_key') return ''
  if (key === 'reality_short_id') return randomHex(8)
  if (key === 'password') {
    if (ctx?.['protocol'] === 'shadowsocks2022') {
      const method = ctx?.['method'] || '2022-blake3-aes-128-gcm'
      const bytes = method.includes('128') ? 16 : 32
      const array = new Uint8Array(bytes)
      crypto.getRandomValues(array)
      return btoa(String.fromCharCode(...array))
    }
    return randomHex(16)
  }
  return randomHex(16)
}

export function getPresetTemplateParamFields(protocol: string, transport: string, tlsMode: string, engine: string): TemplateParamField[] {
  const fields: TemplateParamField[] = []

  let defaultPort = 443
  if (protocol === 'hysteria2') defaultPort = 49444
  else if (protocol === 'shadowsocks2022') defaultPort = 49445
  else if (protocol === 'vless' && tlsMode === 'reality') defaultPort = 49443
  else if (transport === 'ws') defaultPort = 2053
  else if (protocol === 'trojan') defaultPort = 2087

  fields.push({
    key: 'port',
    label: 'Port',
    type: 'number',
    valueType: 'number',
    defaultValue: defaultPort,
  })

  if (protocol === 'vless' || protocol === 'vmess') {
    fields.push({ key: 'uuid', label: 'UUID', type: 'text', valueType: 'string' })
  }

  if (protocol === 'hysteria2') {
    fields.push({ key: 'password', label: 'Password', type: 'password', valueType: 'string', secret: true })
    fields.push({ key: 'obfs', label: 'Obfs', type: 'select', valueType: 'string', options: [{ value: 'none', label: 'none' }, { value: 'salamander', label: 'salamander' }], defaultValue: 'none' })
  } else if (protocol === 'shadowsocks2022') {
    fields.push({ key: 'method', label: 'Method', type: 'select', valueType: 'string', options: [{ value: '2022-blake3-aes-128-gcm', label: '2022-blake3-aes-128-gcm' }, { value: '2022-blake3-aes-256-gcm', label: '2022-blake3-aes-256-gcm' }, { value: '2022-blake3-chacha20-poly1305', label: '2022-blake3-chacha20-poly1305' }], defaultValue: '2022-blake3-aes-128-gcm' })
    fields.push({ key: 'password', label: 'Password', type: 'password', valueType: 'string', secret: true })
  } else if (protocol === 'trojan') {
    fields.push({ key: 'password', label: 'Password', type: 'password', valueType: 'string', secret: true })
  }

  if (transport === 'ws') {
    fields.push({ key: 'path', label: 'WS Path', type: 'text', valueType: 'string', defaultValue: '/ws' })
    const hostHint = hostHintByProtocol(protocol)
    fields.push({
      key: 'host',
      label: `Host（${hostHint}）`,
      type: 'text',
      valueType: 'string',
      placeholder: hostHint === '服务器域名' ? 'example.com' : 'example.com 或 1.2.3.4',
      defaultValue: '',
      optional: true,
    })
  } else if (transport === 'httpupgrade' || transport === 'xhttp') {
    fields.push({ key: 'path', label: 'Path', type: 'text', valueType: 'string', defaultValue: '/' })
    const hostHint = hostHintByProtocol(protocol)
    fields.push({
      key: 'host',
      label: `Host（${hostHint}）`,
      type: 'text',
      valueType: 'string',
      placeholder: hostHint === '服务器域名' ? 'example.com' : 'example.com 或 1.2.3.4',
      defaultValue: '',
      optional: true,
    })
  } else if (transport === 'grpc') {
    fields.push({ key: 'service_name', label: 'gRPC Service Name', type: 'text', valueType: 'string', defaultValue: 'grpc-service' })
  } else if (transport === 'mkcp') {
    fields.push({ key: 'seed', label: 'mKCP Seed', type: 'text', valueType: 'string', defaultValue: '', optional: true })
  }

  if (protocol === 'vless' && transport === 'tcp' && (tlsMode === 'reality' || tlsMode === 'tls')) {
    fields.push({ key: 'flow', label: 'Flow', type: 'select', valueType: 'string', options: [{ value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' }, { value: 'none', label: 'none' }], defaultValue: 'xtls-rprx-vision' })
  }

  if (tlsMode === 'reality') {
    const REALITY_SNI_OPTIONS = [
      ...LARGE_PUBLIC_DOMAIN_OPTIONS,
      { value: '', label: '自动跟随节点主域名' }
    ]
    const randomSni = REALITY_SNI_OPTIONS[Math.floor(Math.random() * (REALITY_SNI_OPTIONS.length - 1))].value

    fields.push({ key: 'server_name', label: 'Server Name / SNI（大型公共域名）', type: 'select', valueType: 'string', options: REALITY_SNI_OPTIONS, defaultValue: randomSni, optional: true })
    fields.push({ key: 'reality_private_key', label: 'Reality Private Key', type: 'password', valueType: 'string', secret: true })
    fields.push({ key: 'reality_public_key', label: 'Reality Public Key', type: 'password', valueType: 'string', secret: true })
    fields.push({ key: 'reality_short_id', label: 'Reality Short ID', type: 'password', valueType: 'string', secret: true })

  } else if (tlsMode === 'tls') {
    const sniHint = sniHintByProtocol(protocol)
    fields.push({
      key: 'sni',
      label: `SNI（${sniHint}）`,
      type: 'text',
      valueType: 'string',
      placeholder: sniHint === '服务器域名' ? 'example.com' : 'example.com 或 1.2.3.4',
      defaultValue: '',
      optional: true,
    })
  }

  return fields
}

export function valueToInput(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}
