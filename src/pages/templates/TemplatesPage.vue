<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import DataGrid from '@/components/ui/DataGrid.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import DetailDrawer from '@/components/ui/DetailDrawer.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { createTemplate, deleteTemplate, getTemplateRegistry, listTemplates, updateTemplate } from '@/api/services/templates'
import type { NodeKind, TemplateRecord, TemplateRegistry } from '@/types/domain'
import type { TemplateParamField } from '@/utils/templateParams'
import { supportsProtocolTls, supportsTemplateCombination } from '@/utils/templateCapability'
import { generateSecretValue, getPresetTemplateParamFields, valueToInput } from '@/utils/templateParams'
import { useToastStore } from '@/stores/toast'

interface EditorParamField extends TemplateParamField {
  custom?: boolean
}

const toastStore = useToastStore()

const loading = ref(false)
const keyword = ref('')
const templates = ref<TemplateRecord[]>([])
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
})

const confirmDelete = ref(false)

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

const presetParamFields = computed<EditorParamField[]>(() => {
  return getPresetTemplateParamFields(form.protocol, form.transport, form.tls_mode, form.engine)
})

const allParamFields = computed<EditorParamField[]>(() => {
  return presetParamFields.value
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

  presetParamFields.value.forEach((field) => {
    const raw = source[field.key]
    let value = valueToInput(raw)

    if (!value) {
      if (field.secret) {
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

function buildDefaultsPayload(): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const fieldMap = new Map(presetParamFields.value.map((field) => [field.key, field]))

  presetParamFields.value.forEach((field) => {
    const key = field.key
    const rawValue = defaultsForm[key]
    const value = String(rawValue ?? '')
    const currentField = fieldMap.get(key)

    if (value.trim() === '') {
      if (currentField?.optional) result[key] = ''
      return
    }

    if (currentField?.valueType === 'number') {
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
    const [templateRows, registryData] = await Promise.all([listTemplates(), getTemplateRegistry()])
    templates.value = templateRows
    registry.value = registryData
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
  ensureValidSelection()
  syncDefaultsForm({})
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
  ensureValidSelection()
  syncDefaultsForm(template.defaults || {})
  editorOpen.value = true
}

function regenSecret(key: string): void {
  defaultsForm[key] = generateSecretValue(key, { ...defaultsForm, protocol: form.protocol } as Record<string, string>)
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

    for (const field of presetParamFields.value) {
      const val = defaults[field.key]
      if (val === undefined || val === '') {
        if (!field.optional) {
          toastStore.push(`参数 ${field.label || field.key} 未配置`, 'warning')
          return
        }
      }

      if (field.key === 'port') {
        const portNum = Number(val)
        if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
          toastStore.push('端口必须是 1 - 65535 的整数', 'warning')
          return
        }
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
    if (editorMode.value !== 'create') return
    const nextSource: Record<string, unknown> = { ...defaultsForm }
    syncDefaultsForm(nextSource)
  },
)

watch(
  () => [form.protocol, form.tls_mode, form.engine],
  () => {
    if (!editorOpen.value) return
    ensureValidSelection()
  },
)

watch(
  () => defaultsForm.method,
  (newMethod, oldMethod) => {
    if (editorOpen.value && form.protocol === 'shadowsocks2022' && newMethod && oldMethod && newMethod !== oldMethod) {
      if (defaultsForm.password) {
        regenSecret('password')
      }
    }
  }
)

watch(
  () => defaultsForm.server_name,
  (newServerName) => {
    if (editorOpen.value && form.tls_mode === 'reality' && newServerName !== undefined) {
      if (form.engine === 'xray') {
        if (!newServerName) {
          defaultsForm.dest = ''
        } else if (!defaultsForm.dest || defaultsForm.dest.includes(newServerName) || defaultsForm.dest === ':443') {
          defaultsForm.dest = `${newServerName}:443`
        }
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
        <td>{{ item.tls_mode }}</td>
        <td>{{ item.node_types.join(', ') || '-' }}</td>
        <td class="muted">{{ item.description || '-' }}</td>
        <td><button class="btn btn-secondary" @click="openEdit(item)">编辑参数</button></td>
      </tr>
      <tr v-if="!loading && builtinRows.length === 0">
        <td colspan="8" class="muted">暂无内置模板</td>
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
        <td>{{ item.tls_mode }}</td>
        <td>{{ item.node_types.join(', ') || '-' }}</td>
        <td><button class="btn btn-secondary" @click="openEdit(item)">编辑</button></td>
      </tr>
      <tr v-if="!loading && customRows.length === 0">
        <td colspan="7" class="muted">暂无自定义模板</td>
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

      <label v-for="field in allParamFields" :key="field.key" style="display: grid; gap: 6px">
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

          <button v-if="field.secret" class="btn btn-secondary" type="button" @click="regenSecret(field.key)">生成</button>
        </div>
      </label>

      <div class="muted" style="font-size: 12px">仅显示当前“协议 + 安全 + 传输”组合支持的参数，避免无效配置。</div>
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
