<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import DataGrid from '@/components/ui/DataGrid.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import DetailDrawer from '@/components/ui/DetailDrawer.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import ParamEditor from '@/components/ui/ParamEditor.vue'
import { createTemplate, deleteTemplate, getTemplateRegistry, listTemplates, updateTemplate } from '@/api/services/templates'
import type { TemplateRecord, TemplateRegistry } from '@/types/domain'
import { parseJsonObject } from '@/utils/format'
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()

const loading = ref(false)
const keyword = ref('')
const templates = ref<TemplateRecord[]>([])
const registry = ref<TemplateRegistry>({
  protocols: [],
  transports: [],
  tls_modes: [],
})

const editorOpen = ref(false)
const editorMode = ref<'create' | 'edit'>('create')
const editingTemplate = ref<TemplateRecord | null>(null)
const defaultsJson = ref('{}')

const form = reactive({
  name: '',
  protocol: '',
  transport: '',
  tls_mode: '',
  description: '',
})

const confirmDelete = ref(false)

const filteredTemplates = computed(() => {
  if (!keyword.value.trim()) return templates.value
  const text = keyword.value.toLowerCase()
  return templates.value.filter((item) => {
    return item.name.toLowerCase().includes(text) || item.protocol.toLowerCase().includes(text)
  })
})

const builtinRows = computed(() => filteredTemplates.value.filter((item) => item.kind === 'builtin'))
const customRows = computed(() => filteredTemplates.value.filter((item) => item.kind === 'custom'))

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

function openCreate(): void {
  editorMode.value = 'create'
  editingTemplate.value = null
  form.name = ''
  form.protocol = registry.value.protocols[0]?.key || ''
  form.transport = registry.value.transports[0]?.key || ''
  form.tls_mode = registry.value.tls_modes[0]?.key || ''
  form.description = ''
  defaultsJson.value = '{}'
  editorOpen.value = true
}

function openEdit(template: TemplateRecord): void {
  editorMode.value = 'edit'
  editingTemplate.value = template
  form.name = template.name
  form.protocol = template.protocol
  form.transport = template.transport
  form.tls_mode = template.tls_mode
  form.description = template.description
  defaultsJson.value = JSON.stringify(template.defaults || {}, null, 2)
  editorOpen.value = true
}

async function saveTemplate(): Promise<void> {
  try {
    const defaults = parseJsonObject(defaultsJson.value)

    if (!form.name.trim()) {
      toastStore.push('模板名称不能为空', 'warning')
      return
    }

    if (editorMode.value === 'create') {
      await createTemplate({
        name: form.name.trim(),
        protocol: form.protocol,
        transport: form.transport,
        tls_mode: form.tls_mode,
        description: form.description.trim(),
        defaults,
      })
      toastStore.push('模板已创建', 'success')
    } else if (editingTemplate.value) {
      await updateTemplate(editingTemplate.value.id, {
        name: form.name.trim(),
        description: form.description.trim(),
        defaults,
      })
      toastStore.push('模板已更新', 'success')
    }

    editorOpen.value = false
    await loadData()
  } catch {
    toastStore.push('模板保存失败，请检查参数 JSON', 'danger')
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

onMounted(loadData)
</script>

<template>
  <FilterBar>
    <input v-model="keyword" class="input" style="max-width: 260px" placeholder="搜索模板" />
    <button class="btn btn-primary" style="margin-left: auto" @click="openCreate">新建自定义模板</button>
  </FilterBar>

  <DataGrid title="内置模板">
    <thead>
      <tr>
        <th>名称</th>
        <th>协议</th>
        <th>传输</th>
        <th>TLS</th>
        <th>说明</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="item in builtinRows" :key="item.id">
        <td>{{ item.name }}</td>
        <td>{{ item.protocol }}</td>
        <td>{{ item.transport }}</td>
        <td>{{ item.tls_mode }}</td>
        <td class="muted">{{ item.description || '-' }}</td>
        <td><button class="btn btn-secondary" @click="openEdit(item)">编辑参数</button></td>
      </tr>
      <tr v-if="!loading && builtinRows.length === 0">
        <td colspan="6" class="muted">暂无内置模板</td>
      </tr>
    </tbody>
  </DataGrid>

  <DataGrid title="自定义模板">
    <thead>
      <tr>
        <th>名称</th>
        <th>协议</th>
        <th>传输</th>
        <th>TLS</th>
        <th>兼容节点</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="item in customRows" :key="item.id">
        <td>{{ item.name }}</td>
        <td>{{ item.protocol }}</td>
        <td>{{ item.transport }}</td>
        <td>{{ item.tls_mode }}</td>
        <td>{{ item.node_types.join(', ') || '-' }}</td>
        <td><button class="btn btn-secondary" @click="openEdit(item)">编辑</button></td>
      </tr>
      <tr v-if="!loading && customRows.length === 0">
        <td colspan="6" class="muted">暂无自定义模板</td>
      </tr>
    </tbody>
  </DataGrid>

  <DetailDrawer v-model="editorOpen" :title="editorMode === 'create' ? '新建模板' : '模板编辑'">
    <label>
      模板名称
      <input v-model="form.name" class="input" />
    </label>

    <label>
      协议
      <select v-model="form.protocol" class="select" :disabled="editorMode === 'edit'">
        <option v-for="item in registry.protocols" :key="item.key" :value="item.key">{{ item.label }}</option>
      </select>
    </label>

    <label>
      传输
      <select v-model="form.transport" class="select" :disabled="editorMode === 'edit'">
        <option v-for="item in registry.transports" :key="item.key" :value="item.key">{{ item.label }}</option>
      </select>
    </label>

    <label>
      TLS 模式
      <select v-model="form.tls_mode" class="select" :disabled="editorMode === 'edit'">
        <option v-for="item in registry.tls_modes" :key="item.key" :value="item.key">{{ item.label }}</option>
      </select>
    </label>

    <label>
      描述
      <input v-model="form.description" class="input" />
    </label>

    <ParamEditor v-model="defaultsJson" label="参数编辑器" hint="统一 JSON 参数编辑器" />

    <div style="display: flex; gap: 8px">
      <button class="btn btn-primary" @click="saveTemplate">保存</button>
      <button
        v-if="editorMode === 'edit'"
        class="btn btn-danger"
        @click="confirmDelete = true"
      >
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
