<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import DataGrid from '@/components/ui/DataGrid.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import DetailDrawer from '@/components/ui/DetailDrawer.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { createTemplate, deleteTemplate, getTemplateRegistry, listTemplates, updateTemplate } from '@/api/services/templates'
import { getNode, listNodes } from '@/api/services/nodes'
import type { NodeKind, NodeRecord, TemplateRecord, TemplateRegistry } from '@/types/domain'
import type { TemplateParamField } from '@/utils/templateParams'
import { supportsProtocolTls, supportsTemplateCombination } from '@/utils/templateCapability'
import { generateRealityKeyPair, generateSecretValue, getPresetTemplateParamFields, valueToInput } from '@/utils/templateParams'
import { useToastStore } from '@/stores/toast'

interface EditorParamField extends TemplateParamField {
  custom?: boolean
}

const toastStore = useToastStore()
const DEFAULT_WARP_SERVER = 'engage.cloudflareclient.com'
const DEFAULT_WARP_SERVER_PORT = 2408
const DEFAULT_WARP_LOCAL_ADDRESS_IPV4 = '172.16.0.2/32'
const DEFAULT_WARP_PEER_PUBLIC_KEY = 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo='
const DEFAULT_WARP_SYSTEM_INTERFACE = 'false'
const DEFAULT_WARP_MTU = 1280
const DEFAULT_WARP_RESERVED = '0,0,0'

const loading = ref(false)
const keyword = ref('')
const templates = ref<TemplateRecord[]>([])
const nodes = ref<NodeRecord[]>([])
const registry = ref<TemplateRegistry>({
  engines: [],
  protocols: [],
  transports: [],
  tls_modes: [],
  node_types: [],
})

const editorOpen = ref(false)
const editorMode = ref<'create' | 'edit'>('create')
const editingTemplate = ref<TemplateRecord | null>(null)
const defaultsForm = reactive<Record<string, string>>({})

const form = reactive({
  name: '',
  engine: 'sing-box',
  protocol: '',
  transport: '',
  tls_mode: '',
  node_type: 'vps' as NodeKind,
  description: '',
  warp_exit: false,
  warp_route_mode: 'all' as string,
})

const confirmDelete = ref(false)
const generatingRealityPair = ref(false)
const selectedWarpNodeId = ref('')

const availableProtocols = computed(() => registry.value.protocols)

const availableTlsModes = computed(() => {
  return registry.value.tls_modes.filter((item) => supportsProtocolTls(form.protocol, item.key))
})

const availableTransports = computed(() => {
  return registry.value.transports.filter((item) =>
    supportsTemplateCombination(form.engine, form.protocol, item.key, form.tls_mode),
  )
})

function ensureValidSelection(): void {
  const protocolSet = new Set(availableProtocols.value.map((item) => item.key))
  if (!protocolSet.has(form.protocol)) {
    form.protocol = availableProtocols.value[0]?.key || ''
  }

  const tlsSet = new Set(availableTlsModes.value.map((item) => item.key))
  if (!tlsSet.has(form.tls_mode)) {
    form.tls_mode = availableTlsModes.value[0]?.key || ''
  }

  const transportSet = new Set(availableTransports.value.map((item) => item.key))
  if (!transportSet.has(form.transport)) {
    form.transport = availableTransports.value[0]?.key || ''
  }
}

const filteredTemplates = computed(() => {
  if (!keyword.value.trim()) return templates.value
  const text = keyword.value.toLowerCase()
  return templates.value.filter((item) => {
    return (
      item.name.toLowerCase().includes(text) ||
      item.protocol.toLowerCase().includes(text) ||
      item.engine.toLowerCase().includes(text)
    )
  })
})

const builtinRows = computed(() => filteredTemplates.value.filter((item) => item.kind === 'builtin'))
const customRows = computed(() => filteredTemplates.value.filter((item) => item.kind === 'custom'))

function formatTemplatePort(template: TemplateRecord): string {
  const raw = template.defaults?.port
  const port = typeof raw === 'number' ? raw : Number(raw)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? String(port) : '-'
}

const presetParamFields = computed<EditorParamField[]>(() => {
  return getPresetTemplateParamFields(form.protocol, form.transport, form.tls_mode, form.engine)
})

const warpParamFields = computed<EditorParamField[]>(() => {
  return [
    {
      key: 'warp_server',
      label: 'Server',
      type: 'text',
      valueType: 'string',
      defaultValue: DEFAULT_WARP_SERVER,
    },
    {
      key: 'warp_server_port',
      label: 'Server Port',
      type: 'number',
      valueType: 'number',
      defaultValue: DEFAULT_WARP_SERVER_PORT,
    },
    {
      key: 'warp_local_address_ipv4',
      label: 'Local Address IPv4',
      type: 'text',
      valueType: 'string',
      defaultValue: DEFAULT_WARP_LOCAL_ADDRESS_IPV4,
    },
    {
      key: 'warp_local_address_ipv6',
      label: 'Local Address IPv6',
      type: 'text',
      valueType: 'string',
      defaultValue: '',
      optional: true,
      placeholder: '留空自动使用节点上报 IPv6/128',
    },
    {
      key: 'warp_private_key',
      label: 'Private Key',
      type: 'password',
      valueType: 'string',
      defaultValue: '',
      optional: true,
      placeholder: '留空时使用节点自动上报密钥',
    },
    {
      key: 'warp_peer_public_key',
      label: 'Peer Public Key',
      type: 'text',
      valueType: 'string',
      defaultValue: DEFAULT_WARP_PEER_PUBLIC_KEY,
    },
    {
      key: 'warp_system_interface',
      label: 'System Interface',
      type: 'select',
      valueType: 'string',
      options: [
        { value: 'false', label: 'false' },
        { value: 'true', label: 'true' },
      ],
      defaultValue: DEFAULT_WARP_SYSTEM_INTERFACE,
    },
    {
      key: 'warp_mtu',
      label: 'MTU',
      type: 'number',
      valueType: 'number',
      defaultValue: DEFAULT_WARP_MTU,
    },
    {
      key: 'warp_reserved',
      label: 'Reserved',
      type: 'text',
      valueType: 'string',
      defaultValue: DEFAULT_WARP_RESERVED,
      optional: true,
      placeholder: '示例: 0,0,0',
    },
  ]
})

const defaultsParamFields = computed<EditorParamField[]>(() => {
  return [...presetParamFields.value, ...warpParamFields.value]
})

const warpCandidateNodes = computed<NodeRecord[]>(() => {
  return nodes.value.filter((node) => node.node_type === 'vps')
})

function replaceDefaultsForm(next: Record<string, string>): void {
  Object.keys(defaultsForm).forEach((key) => {
    delete defaultsForm[key]
  })
  Object.entries(next).forEach(([key, value]) => {
    defaultsForm[key] = value
  })
}

function syncDefaultsForm(source: Record<string, unknown>): void {
  const next: Record<string, string> = {}

  defaultsParamFields.value.forEach((field) => {
    const raw = source[field.key]
    let value = valueToInput(raw)

    if (!value) {
      if (field.secret) {
        if (field.key === 'reality_private_key' || field.key === 'reality_public_key') {
          value = ''
        } else {
          value = generateSecretValue(field.key, { ...next, ...source, protocol: form.protocol } as Record<string, string>)
        }
      } else if (field.key === 'uuid') {
        value = generateSecretValue(field.key, { ...next, ...source, protocol: form.protocol } as Record<string, string>)
      } else if (field.defaultValue !== undefined) {
        value = String(field.defaultValue)
      } else if (field.type === 'select' && field.options && field.options.length > 0) {
        value = field.options[0].value
      }
    }

    next[field.key] = value
  })

  replaceDefaultsForm(next)
}

function hasField(key: string): boolean {
  return presetParamFields.value.some((field) => field.key === key)
}

function canGenerateSingleField(field: EditorParamField): boolean {
  if (field.key === 'uuid') return true
  if (!field.secret) return false
  return field.key !== 'reality_private_key' && field.key !== 'reality_public_key'
}

function canGenerateRealityPairAtField(key: string): boolean {
  if (key !== 'reality_private_key') return false
  return hasField('reality_private_key') && hasField('reality_public_key')
}

async function regenRealityKeyPair(force = true, notify = true): Promise<void> {
  if (!hasField('reality_private_key') || !hasField('reality_public_key')) return
  if (generatingRealityPair.value) return

  const privateKey = String(defaultsForm.reality_private_key || '')
  const publicKey = String(defaultsForm.reality_public_key || '')
  if (!force && privateKey && publicKey) return

  generatingRealityPair.value = true
  try {
    const pair = await generateRealityKeyPair()
    defaultsForm.reality_private_key = pair.privateKey
    defaultsForm.reality_public_key = pair.publicKey
    if (notify) toastStore.push('Reality 密钥对已生成', 'success')
  } catch {
    if (notify) toastStore.push('当前浏览器不支持 X25519 自动生成，请手动填入密钥对', 'warning')
  } finally {
    generatingRealityPair.value = false
  }
}

function buildDefaultsPayload(): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const payloadFields = form.warp_exit ? defaultsParamFields.value : presetParamFields.value

  payloadFields.forEach((field) => {
    const key = field.key
    const rawValue = defaultsForm[key]
    const value = String(rawValue ?? '')

    if (value.trim() === '') {
      if (field.optional) result[key] = ''
      return
    }

    if (field.valueType === 'number') {
      const num = Number(value)
      result[key] = Number.isFinite(num) ? num : value
      return
    }

    result[key] = value
  })

  return result
}

async function loadData(): Promise<void> {
  loading.value = true
  try {
    const [templateRows, registryData, nodeRows] = await Promise.all([listTemplates(), getTemplateRegistry(), listNodes()])
    templates.value = templateRows
    registry.value = registryData
    nodes.value = nodeRows
  } catch {
    toastStore.push('模板数据加载失败', 'danger')
  } finally {
    loading.value = false
  }
}

function resetCreateForm(): void {
  form.name = ''
  form.engine = registry.value.engines[0]?.key || 'sing-box'
  form.protocol = registry.value.protocols[0]?.key || ''
  form.tls_mode = registry.value.tls_modes[0]?.key || ''
  form.transport = registry.value.transports[0]?.key || ''
  form.node_type = (registry.value.node_types[0]?.key as NodeKind) || 'vps'
  form.description = ''
  form.warp_exit = false
  form.warp_route_mode = 'all'
  selectedWarpNodeId.value = ''
  ensureValidSelection()
  syncDefaultsForm({})
  void regenRealityKeyPair(false, false)
}

function openCreate(): void {
  editorMode.value = 'create'
  editingTemplate.value = null
  resetCreateForm()
  editorOpen.value = true
}

function openEdit(template: TemplateRecord): void {
  editorMode.value = 'edit'
  editingTemplate.value = template
  form.name = template.name
  form.engine = template.engine
  form.protocol = template.protocol
  form.transport = template.transport
  form.tls_mode = template.tls_mode
  form.node_type = (template.node_types[0] as NodeKind) || 'vps'
  form.description = template.description
  form.warp_exit = template.warp_exit || false
  form.warp_route_mode = template.warp_route_mode || 'all'
  selectedWarpNodeId.value = ''
  ensureValidSelection()
  syncDefaultsForm(template.defaults || {})
  void regenRealityKeyPair(false, false)
  editorOpen.value = true
}

function parseWarpEndpoint(rawEndpoint: string): { host: string; port: string } {
  const raw = String(rawEndpoint || '').trim()
  if (!raw) return { host: '', port: '' }

  const bracketMatch = raw.match(/^\[(.+)\]:(\d+)$/)
  if (bracketMatch) {
    return { host: bracketMatch[1], port: bracketMatch[2] }
  }

  const sep = raw.lastIndexOf(':')
  if (sep <= 0 || sep >= raw.length - 1) return { host: raw, port: '' }
  const host = raw.slice(0, sep)
  const port = raw.slice(sep + 1)
  if (!/^\d+$/.test(port)) return { host: raw, port: '' }
  return { host, port }
}

async function fillWarpParamsFromNode(): Promise<void> {
  if (!selectedWarpNodeId.value) {
    toastStore.push('请先选择节点', 'warning')
    return
  }

  try {
    const node = await getNode(selectedWarpNodeId.value)
    if (!node.warp_private_key) {
      toastStore.push('该节点未上报 WARP 私钥，请先在节点侧完成 WARP 注册', 'warning')
      return
    }

    const endpoint = parseWarpEndpoint(node.warp_endpoint || '')
    if (endpoint.host) defaultsForm.warp_server = endpoint.host
    if (endpoint.port) defaultsForm.warp_server_port = endpoint.port
    defaultsForm.warp_private_key = String(node.warp_private_key || '')
    defaultsForm.warp_local_address_ipv4 = String(defaultsForm.warp_local_address_ipv4 || DEFAULT_WARP_LOCAL_ADDRESS_IPV4)
    defaultsForm.warp_local_address_ipv6 = node.warp_v6 ? `${node.warp_v6}/128` : String(defaultsForm.warp_local_address_ipv6 || '')
    defaultsForm.warp_peer_public_key = String(defaultsForm.warp_peer_public_key || DEFAULT_WARP_PEER_PUBLIC_KEY)
    defaultsForm.warp_system_interface = String(defaultsForm.warp_system_interface || DEFAULT_WARP_SYSTEM_INTERFACE)
    defaultsForm.warp_mtu = String(defaultsForm.warp_mtu || DEFAULT_WARP_MTU)
    if (Array.isArray(node.warp_reserved) && node.warp_reserved.length === 3) {
      defaultsForm.warp_reserved = node.warp_reserved.join(',')
    }

    toastStore.push(`已读取节点 ${node.name} 的 WARP 参数`, 'success')
  } catch {
    toastStore.push('读取节点 WARP 参数失败', 'danger')
  }
}

function regenFieldValue(key: string): void {
  if (key === 'reality_private_key' || key === 'reality_public_key') {
    void regenRealityKeyPair(true, true)
    return
  }
  defaultsForm[key] = generateSecretValue(key, { ...defaultsForm, protocol: form.protocol } as Record<string, string>)
}

function validatePresetDefaults(defaults: Record<string, unknown>): string | null {
  for (const field of presetParamFields.value) {
    const val = defaults[field.key]
    if ((val === undefined || val === '') && !field.optional) {
      return `参数 ${field.label || field.key} 未配置`
    }

    if (field.key === 'port') {
      const portNum = Number(val)
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        return '端口必须是 1 - 65535 的整数'
      }
    }
  }
  return null
}

function validateWarpDefaults(defaults: Record<string, unknown>): string | null {
  const warpServer = String(defaults.warp_server || '').trim()
  const warpLocalAddressV4 = String(defaults.warp_local_address_ipv4 || '').trim()
  const warpPeerPublicKey = String(defaults.warp_peer_public_key || '').trim()
  const warpSystemInterface = String(defaults.warp_system_interface || '').trim().toLowerCase()
  const warpServerPort = Number(defaults.warp_server_port)
  const warpMtu = Number(defaults.warp_mtu)
  const warpReserved = String(defaults.warp_reserved || '').trim()

  if (!warpServer) return 'WARP Server 未配置'
  if (!warpLocalAddressV4) return 'WARP Local Address IPv4 未配置'
  if (!warpPeerPublicKey) return 'WARP Peer Public Key 未配置'
  if (warpSystemInterface !== 'true' && warpSystemInterface !== 'false') return 'WARP System Interface 必须是 true 或 false'
  if (!Number.isInteger(warpServerPort) || warpServerPort < 1 || warpServerPort > 65535) {
    return 'WARP Server Port 必须是 1 - 65535 的整数'
  }
  if (!Number.isInteger(warpMtu) || warpMtu < 576 || warpMtu > 65535) {
    return 'WARP MTU 必须是 576 - 65535 的整数'
  }
  if (warpReserved) {
    const parts = warpReserved.split(',').map((item) => Number(item.trim()))
    if (parts.length !== 3 || parts.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
      return 'WARP Reserved 格式应为 a,b,c（3 个 0-255 整数）'
    }
  }
  return null
}

async function saveTemplate(): Promise<void> {
  try {
    const defaults = buildDefaultsPayload()

    if (!form.name.trim()) {
      toastStore.push('模板名称不能为空', 'warning')
      return
    }

    if (!supportsProtocolTls(form.protocol, form.tls_mode)) {
      toastStore.push('当前 TLS 模式不支持该协议', 'warning')
      return
    }
    if (!supportsTemplateCombination(form.engine, form.protocol, form.transport, form.tls_mode)) {
      toastStore.push('当前传输类型不支持该协议/TLS 组合', 'warning')
      return
    }

    const presetError = validatePresetDefaults(defaults)
    if (presetError) {
      toastStore.push(presetError, 'warning')
      return
    }

    if (form.warp_exit) {
      const warpError = validateWarpDefaults(defaults)
      if (warpError) {
        toastStore.push(warpError, 'warning')
        return
      }
    }

    const payload = {
      name: form.name.trim(),
      engine: form.node_type === 'edge' ? 'sing-box' : form.engine,
      protocol: form.protocol,
      transport: form.transport,
      tls_mode: form.tls_mode,
      node_types: [form.node_type],
      description: form.description.trim(),
      warp_exit: form.warp_exit,
      warp_route_mode: form.warp_route_mode,
      defaults,
    }

    if (editorMode.value === 'create') {
      await createTemplate(payload)
      toastStore.push('模板已创建', 'success')
    } else if (editingTemplate.value) {
      await updateTemplate(editingTemplate.value.id, payload)
      toastStore.push('模板已更新', 'success')
    }

    editorOpen.value = false
    await loadData()
  } catch {
    toastStore.push('模板保存失败', 'danger')
  }
}

async function removeTemplate(): Promise<void> {
  if (!editingTemplate.value) return
  try {
    await deleteTemplate(editingTemplate.value.id)
    toastStore.push(editingTemplate.value.kind === 'builtin' ? '内置模板已重置' : '模板已删除', 'success')
    editorOpen.value = false
    await loadData()
  } catch {
    toastStore.push('模板删除失败', 'danger')
  }
}

watch(
  () => [form.protocol, form.transport, form.tls_mode, form.engine],
  () => {
    if (!editorOpen.value) return

    ensureValidSelection()
    if (editorMode.value === 'create') {
      const nextSource: Record<string, unknown> = { ...defaultsForm }
      syncDefaultsForm(nextSource)
    }
    void regenRealityKeyPair(false, false)
  },
)

watch(
  () => defaultsForm.method,
  (newMethod, oldMethod) => {
    if (editorOpen.value && form.protocol === 'shadowsocks2022' && newMethod && oldMethod && newMethod !== oldMethod) {
      if (defaultsForm.password) {
        regenFieldValue('password')
      }
    }
  }
)

onMounted(loadData)
</script>

<template>
  <FilterBar>
    <input v-model="keyword" class="input" style="max-width: 260px" placeholder="搜索模板" />
    <button class="btn btn-primary" style="margin-left: auto" @click="openCreate">新建模板</button>
  </FilterBar>

  <DataGrid title="内置模板">
    <thead>
      <tr>
        <th>名称</th>
        <th>引擎</th>
        <th>协议</th>
        <th>传输</th>
        <th>端口</th>
        <th>TLS</th>
        <th>可用节点</th>
        <th>说明</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="item in builtinRows" :key="item.id">
        <td>{{ item.name }}</td>
        <td>{{ item.engine }}</td>
        <td>{{ item.protocol }}</td>
        <td>{{ item.transport }}</td>
        <td>{{ formatTemplatePort(item) }}</td>
        <td>{{ item.tls_mode }}</td>
        <td>{{ item.node_types.join(', ') || '-' }}</td>
        <td class="muted">{{ item.description || '-' }}</td>
        <td><button class="btn btn-secondary" @click="openEdit(item)">编辑参数</button></td>
      </tr>
      <tr v-if="!loading && builtinRows.length === 0">
        <td colspan="9" class="muted">暂无内置模板</td>
      </tr>
    </tbody>
  </DataGrid>

  <DataGrid title="自定义模板">
    <thead>
      <tr>
        <th>名称</th>
        <th>引擎</th>
        <th>协议</th>
        <th>传输</th>
        <th>端口</th>
        <th>TLS</th>
        <th>可用节点</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="item in customRows" :key="item.id">
        <td>{{ item.name }}</td>
        <td>{{ item.engine }}</td>
        <td>{{ item.protocol }}</td>
        <td>{{ item.transport }}</td>
        <td>{{ formatTemplatePort(item) }}</td>
        <td>{{ item.tls_mode }}</td>
        <td>{{ item.node_types.join(', ') || '-' }}</td>
        <td><button class="btn btn-secondary" @click="openEdit(item)">编辑</button></td>
      </tr>
      <tr v-if="!loading && customRows.length === 0">
        <td colspan="8" class="muted">暂无自定义模板</td>
      </tr>
    </tbody>
  </DataGrid>

  <DetailDrawer v-model="editorOpen" :title="editorMode === 'create' ? '新建模板' : '模板编辑'">
    <label>
      模板名称
      <input v-model="form.name" class="input" />
    </label>

    <label v-if="form.node_type !== 'edge'">
      配置引擎
      <select v-model="form.engine" class="select">
        <option v-for="item in registry.engines" :key="item.key" :value="item.key">{{ item.label }}</option>
      </select>
    </label>

    <label>
      协议
      <select v-model="form.protocol" class="select" :disabled="editorMode === 'edit'">
        <option v-for="item in availableProtocols" :key="item.key" :value="item.key">{{ item.label }}</option>
      </select>
    </label>

    <label>
      安全
      <select v-model="form.tls_mode" class="select" :disabled="editorMode === 'edit'">
        <option v-for="item in availableTlsModes" :key="item.key" :value="item.key">{{ item.label }}</option>
      </select>
    </label>

    <label>
      传输
      <select v-model="form.transport" class="select" :disabled="editorMode === 'edit'">
        <option v-for="item in availableTransports" :key="item.key" :value="item.key">{{ item.label }}</option>
      </select>
    </label>

    <label>
      节点类型
      <select v-model="form.node_type" class="select">
        <option v-for="nodeType in registry.node_types" :key="nodeType.key" :value="nodeType.key">
          {{ nodeType.label }}
        </option>
      </select>
    </label>

    <label>
      描述
      <input v-model="form.description" class="input" />
    </label>

    <article class="panel panel-pad" style="display: grid; gap: 10px">
      <strong>细节参数</strong>

      <label v-for="field in presetParamFields" :key="field.key" style="display: grid; gap: 6px">
        <span style="font-weight: 700">{{ field.label }}</span>
        <div style="display: flex; gap: 8px; align-items: center">
          <select v-if="field.type === 'select'" v-model="defaultsForm[field.key]" class="select" style="flex: 1">
            <option v-for="option in field.options || []" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>

          <input
            v-else
            v-model="defaultsForm[field.key]"
            class="input"
            style="flex: 1"
            :type="field.type === 'number' ? 'number' : 'text'"
            :min="field.key === 'port' ? 1 : undefined"
            :max="field.key === 'port' ? 65535 : undefined"
            :step="field.key === 'port' ? 1 : undefined"
            :placeholder="field.placeholder || ''"
          />

          <button
            v-if="canGenerateSingleField(field)"
            class="btn btn-secondary"
            type="button"
            @click="regenFieldValue(field.key)"
          >
            生成
          </button>
          <button
            v-else-if="canGenerateRealityPairAtField(field.key)"
            class="btn btn-secondary"
            type="button"
            :disabled="generatingRealityPair"
            @click="regenRealityKeyPair(true, true)"
          >
            {{ generatingRealityPair ? '生成中...' : '生成 Reality 密钥对' }}
          </button>
        </div>
      </label>

      <div class="muted" style="font-size: 12px">仅显示当前“协议 + 安全 + 传输”组合支持的参数，避免无效配置。</div>
    </article>

    <article class="panel panel-pad" style="display: grid; gap: 10px">
      <strong>WARP 出口</strong>
      <label style="display: flex; align-items: center; gap: 8px">
        <input type="checkbox" v-model="form.warp_exit" />
        <span>使用 WARP 作为出口</span>
      </label>
      <template v-if="form.warp_exit">
        <label>
          读取节点 WARP 参数
          <div style="display: flex; gap: 8px">
            <select v-model="selectedWarpNodeId" class="select" style="flex: 1">
              <option value="">请选择节点</option>
              <option v-for="node in warpCandidateNodes" :key="node.id" :value="node.id">
                {{ node.name }} ({{ node.warp_status || '未注册' }})
              </option>
            </select>
            <button class="btn btn-secondary" type="button" @click="fillWarpParamsFromNode">获取</button>
          </div>
        </label>
        <label>
          路由模式
          <select v-model="form.warp_route_mode" class="select">
            <option value="all">全部流量 (IPv4+IPv6)</option>
            <option value="ipv4">仅 IPv4</option>
            <option value="ipv6">仅 IPv6</option>
          </select>
        </label>
        <label>
          Server
          <input v-model="defaultsForm.warp_server" class="input" placeholder="engage.cloudflareclient.com" />
        </label>
        <label>
          Server Port
          <input v-model="defaultsForm.warp_server_port" class="input" type="number" min="1" max="65535" step="1" />
        </label>
        <label>
          Local Address IPv4
          <input v-model="defaultsForm.warp_local_address_ipv4" class="input" placeholder="172.16.0.2/32" />
        </label>
        <label>
          Local Address IPv6
          <input v-model="defaultsForm.warp_local_address_ipv6" class="input" placeholder="留空自动使用节点上报 IPv6/128" />
        </label>
        <label>
          Private Key
          <input v-model="defaultsForm.warp_private_key" class="input" type="password" placeholder="留空时使用节点自动上报密钥" />
        </label>
        <label>
          Peer Public Key
          <input v-model="defaultsForm.warp_peer_public_key" class="input" />
        </label>
        <label>
          System Interface
          <select v-model="defaultsForm.warp_system_interface" class="select">
            <option value="false">false</option>
            <option value="true">true</option>
          </select>
        </label>
        <label>
          MTU
          <input v-model="defaultsForm.warp_mtu" class="input" type="number" min="576" max="65535" step="1" />
        </label>
        <label>
          Reserved
          <input v-model="defaultsForm.warp_reserved" class="input" placeholder="0,0,0" />
        </label>
      </template>
      <div class="muted" style="font-size: 12px">
        同一套 WARP 参数会同时用于 xray / sing-box 出口配置；可手动填写，也可从节点一键读取后再调整。
      </div>
    </article>

    <div style="display: flex; gap: 8px">
      <button class="btn btn-primary" @click="saveTemplate">保存</button>
      <button v-if="editorMode === 'edit'" class="btn btn-danger" @click="confirmDelete = true">
        {{ editingTemplate?.kind === 'builtin' ? '重置为默认' : '删除模板' }}
      </button>
    </div>
  </DetailDrawer>

  <ConfirmDialog
    v-model="confirmDelete"
    :title="editingTemplate?.kind === 'builtin' ? '确认重置模板' : '确认删除模板'"
    :message="editingTemplate?.kind === 'builtin' ? '将撤销所有覆盖参数，恢复内置默认值。' : '删除后不可恢复。'"
    confirm-label="确认"
    danger
    @confirm="removeTemplate"
  />
</template>
