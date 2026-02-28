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

const PRESET_FIELDS: Record<string, TemplateParamField[]> = {
  'vless:tcp:reality': [
    {
      key: 'port',
      label: 'Port',
      type: 'number',
      valueType: 'number',
      defaultValue: 49443,
    },
    {
      key: 'flow',
      label: 'Flow',
      type: 'select',
      valueType: 'string',
      options: [
        { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' },
        { value: 'none', label: 'none' },
      ],
      defaultValue: 'xtls-rprx-vision',
    },
    {
      key: 'server_name',
      label: 'Server Name / SNI',
      type: 'text',
      valueType: 'string',
      placeholder: 'example.com',
      defaultValue: '',
    },
    {
      key: 'reality_private_key',
      label: 'Reality Private Key',
      type: 'password',
      valueType: 'string',
      secret: true,
    },
    {
      key: 'reality_short_id',
      label: 'Reality Short ID',
      type: 'password',
      valueType: 'string',
      secret: true,
    },
  ],
  'hysteria2:udp:tls': [
    {
      key: 'port',
      label: 'Port',
      type: 'number',
      valueType: 'number',
      defaultValue: 49444,
    },
    {
      key: 'password',
      label: 'Password',
      type: 'password',
      valueType: 'string',
      secret: true,
    },
    {
      key: 'obfs',
      label: 'Obfs',
      type: 'select',
      valueType: 'string',
      options: [
        { value: 'none', label: 'none' },
        { value: 'salamander', label: 'salamander' },
      ],
      defaultValue: 'none',
    },
    {
      key: 'sni',
      label: 'SNI',
      type: 'text',
      valueType: 'string',
      placeholder: 'example.com',
      defaultValue: '',
    },
  ],
  'shadowsocks2022:tcp:none': [
    {
      key: 'port',
      label: 'Port',
      type: 'number',
      valueType: 'number',
      defaultValue: 49445,
    },
    {
      key: 'method',
      label: 'Method',
      type: 'select',
      valueType: 'string',
      options: [
        { value: '2022-blake3-aes-128-gcm', label: '2022-blake3-aes-128-gcm' },
        { value: '2022-blake3-aes-256-gcm', label: '2022-blake3-aes-256-gcm' },
        { value: '2022-blake3-chacha20-poly1305', label: '2022-blake3-chacha20-poly1305' },
      ],
      defaultValue: '2022-blake3-aes-128-gcm',
    },
    {
      key: 'password',
      label: 'Password',
      type: 'password',
      valueType: 'string',
      secret: true,
    },
  ],
  'vless:ws:tls': [
    {
      key: 'port',
      label: 'Port',
      type: 'number',
      valueType: 'number',
      defaultValue: 2053,
    },
    {
      key: 'path',
      label: 'WS Path',
      type: 'text',
      valueType: 'string',
      defaultValue: '/ws',
    },
    {
      key: 'host',
      label: 'Host',
      type: 'text',
      valueType: 'string',
      defaultValue: '',
    },
  ],
  'trojan:tcp:tls': [
    {
      key: 'port',
      label: 'Port',
      type: 'number',
      valueType: 'number',
      defaultValue: 2087,
    },
    {
      key: 'password',
      label: 'Password',
      type: 'password',
      valueType: 'string',
      secret: true,
    },
    {
      key: 'sni',
      label: 'SNI',
      type: 'text',
      valueType: 'string',
      placeholder: 'example.com',
      defaultValue: '',
    },
  ],
}

function profileKey(protocol: string, transport: string, tlsMode: string): string {
  return `${protocol}:${transport}:${tlsMode}`
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
  const key = profileKey(protocol, transport, tlsMode)
  const fields = PRESET_FIELDS[key] || []
  return fields.map((item) => ({ ...item, options: item.options ? [...item.options] : undefined }))
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