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
}

function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array, (value) => value.toString(16).padStart(2, '0')).join('')
}

export function generateSecretValue(key: string): string {
  if (key === 'reality_private_key') return randomHex(32)
  if (key === 'reality_short_id') return randomHex(8)
  if (key === 'password') return randomHex(16)
  return randomHex(16)
}

export function getPresetTemplateParamFields(protocol: string, transport: string, tlsMode: string): TemplateParamField[] {
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
    fields.push({ key: 'host', label: 'Host', type: 'text', valueType: 'string', defaultValue: '' })
  } else if (transport === 'grpc') {
    fields.push({ key: 'service_name', label: 'gRPC Service Name', type: 'text', valueType: 'string', defaultValue: 'grpc-service' })
  }

  if (protocol === 'vless' && transport === 'tcp' && (tlsMode === 'reality' || tlsMode === 'tls')) {
    fields.push({ key: 'flow', label: 'Flow', type: 'select', valueType: 'string', options: [{ value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' }, { value: 'none', label: 'none' }], defaultValue: 'xtls-rprx-vision' })
  }

  if (tlsMode === 'reality') {
    fields.push({ key: 'server_name', label: 'Server Name / SNI', type: 'text', valueType: 'string', placeholder: 'example.com', defaultValue: '' })
    fields.push({ key: 'reality_private_key', label: 'Reality Private Key', type: 'password', valueType: 'string', secret: true })
    fields.push({ key: 'reality_short_id', label: 'Reality Short ID', type: 'password', valueType: 'string', secret: true })
  } else if (tlsMode === 'tls') {
    fields.push({ key: 'sni', label: 'SNI', type: 'text', valueType: 'string', placeholder: 'example.com', defaultValue: '' })
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