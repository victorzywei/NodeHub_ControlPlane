<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import DetailDrawer from '@/components/ui/DetailDrawer.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import { listNodes } from '@/api/services/nodes'
import { createSubscription, deleteSubscription, listSubscriptions, updateSubscription } from '@/api/services/subscriptions'
import { getSystemStatus } from '@/api/services/system'
import type { NodeRecord, SubscriptionRecord, SystemStatus } from '@/types/domain'
import { formatDateTime } from '@/utils/format'
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()

const subscriptions = ref<SubscriptionRecord[]>([])
const nodes = ref<NodeRecord[]>([])
const configuredBaseUrl = ref('')
const editorOpen = ref(false)
const editingToken = ref('')
const deletingToken = ref('')
const confirmDelete = ref(false)

const form = reactive({
  name: '',
  remark: '',
  visible: new Set<string>(),
})

const editing = computed(() => Boolean(editingToken.value))
const nodeNameMap = computed(() => new Map(nodes.value.map((node) => [node.id, node.name])))

const linkFormats = [
  { key: 'v2ray', label: 'v2ray' },
  { key: 'clash', label: 'clash' },
  { key: 'singbox', label: 'singbox' },
] as const

function normalizeBaseUrl(raw: string): string {
  const text = String(raw || '').trim()
  if (!text) return ''

  try {
    const parsed = new URL(text)
    return parsed.origin
  } catch {
    return ''
  }
}

const effectiveBaseUrl = computed(() => normalizeBaseUrl(configuredBaseUrl.value) || window.location.origin)

function subLink(token: string, format?: string): string {
  const root = `${effectiveBaseUrl.value}/sub/${token}`
  return format ? `${root}?format=${format}` : root
}

function visibleNodesText(sub: SubscriptionRecord): string {
  if (!Array.isArray(sub.visible_node_ids) || sub.visible_node_ids.length === 0) return '全部节点'
  return sub.visible_node_ids.map((id) => nodeNameMap.value.get(id) || id).join('、')
}

function openCreate(): void {
  editingToken.value = ''
  deletingToken.value = ''
  form.name = ''
  form.remark = ''
  form.visible = new Set()
  editorOpen.value = true
}

function openEdit(sub: SubscriptionRecord): void {
  editingToken.value = sub.token
  deletingToken.value = ''
  form.name = sub.name
  form.remark = sub.remark
  form.visible = new Set(sub.visible_node_ids)
  editorOpen.value = true
}

function requestDelete(token: string): void {
  deletingToken.value = token
  confirmDelete.value = true
}

function toggleNode(id: string): void {
  if (form.visible.has(id)) form.visible.delete(id)
  else form.visible.add(id)
  form.visible = new Set(form.visible)
}

async function copy(text: string): Promise<void> {
  try {
    await window.navigator.clipboard.writeText(text)
    toastStore.push('链接已复制', 'success')
  } catch {
    toastStore.push('复制失败，请手动复制', 'warning')
  }
}

async function loadData(): Promise<void> {
  const [subRows, nodeRows, status] = await Promise.allSettled([
    listSubscriptions(),
    listNodes(),
    getSystemStatus(),
  ])

  if (subRows.status === 'fulfilled') subscriptions.value = subRows.value
  else toastStore.push('订阅数据加载失败', 'danger')

  if (nodeRows.status === 'fulfilled') nodes.value = nodeRows.value
  else toastStore.push('节点数据加载失败', 'danger')

  if (status.status === 'fulfilled') {
    const system = status.value as SystemStatus
    configuredBaseUrl.value = system.subscription_base_url || ''
  } else {
    configuredBaseUrl.value = ''
  }
}

async function save(): Promise<void> {
  try {
    const payload = {
      name: form.name.trim(),
      remark: form.remark.trim(),
      visible_node_ids: [...form.visible],
    }

    if (editing.value) {
      await updateSubscription(editingToken.value, payload)
      toastStore.push('订阅已更新', 'success')
    } else {
      await createSubscription(payload)
      toastStore.push('订阅已创建', 'success')
    }

    editorOpen.value = false
    await loadData()
  } catch {
    toastStore.push('订阅保存失败', 'danger')
  }
}

async function toggleEnabled(sub: SubscriptionRecord): Promise<void> {
  try {
    await updateSubscription(sub.token, { enabled: !sub.enabled })
    toastStore.push(sub.enabled ? '订阅已禁用' : '订阅已启用', 'success')
    await loadData()
  } catch {
    toastStore.push('订阅状态更新失败', 'danger')
  }
}

async function remove(): Promise<void> {
  const token = deletingToken.value || editingToken.value
  if (!token) return

  try {
    await deleteSubscription(token)
    toastStore.push('订阅已删除', 'success')
    if (editingToken.value === token) editorOpen.value = false
    deletingToken.value = ''
    await loadData()
  } catch {
    toastStore.push('删除失败', 'danger')
  }
}

onMounted(loadData)
</script>

<template>
  <FilterBar>
    <div style="flex: 1"></div>
    <button class="btn btn-primary" @click="openCreate">新建订阅</button>
  </FilterBar>

  <div class="sub-stack" style="margin-top: 16px;">
    <div v-for="sub in subscriptions" :key="sub.token" class="panel panel-pad">
      <div class="sub-head">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="font-weight: 700; font-size: 16px;">{{ sub.name || '未命名订阅' }}</div>
          <span class="badge" :class="sub.enabled ? 'success' : 'warning'">
            {{ sub.enabled ? '启用' : '禁用' }}
          </span>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary" @click="openEdit(sub)">编辑</button>
          <button class="btn btn-secondary" @click="toggleEnabled(sub)">{{ sub.enabled ? '禁用' : '启用' }}</button>
          <button class="btn btn-danger" @click="requestDelete(sub.token)">删除</button>
        </div>
      </div>
      
      <div class="muted" style="font-size: 13px; margin-top: 8px; margin-bottom: 16px;">
        可见节点: {{ visibleNodesText(sub) }} · 更新: {{ formatDateTime(sub.updated_at) }}<template v-if="sub.remark"> · 备注: {{ sub.remark }}</template>
      </div>

      <div style="display: grid; gap: 8px;">
        <div v-for="item in linkFormats" :key="item.key" class="sub-link-row">
          <div class="sub-link-label">{{ item.label }}:</div>
          <div class="sub-link-text">{{ subLink(sub.token, item.key) }}</div>
          <button class="btn btn-secondary sub-copy-btn" @click="copy(subLink(sub.token, item.key))">复制</button>
        </div>
      </div>
    </div>
    
    <div v-if="subscriptions.length === 0" class="panel panel-pad muted" style="text-align: center; padding: 40px;">
      暂无订阅，点击右上角创建订阅。
    </div>
  </div>

  <DetailDrawer v-model="editorOpen" :title="editing ? '编辑订阅' : '创建订阅'">
    <label>
      订阅名称
      <input v-model="form.name" class="input" />
    </label>

    <label>
      备注
      <input v-model="form.remark" class="input" />
    </label>

    <section>
      <div style="font-weight: 700; margin-bottom: 8px">节点可见范围</div>
      <div style="display: grid; gap: 6px">
        <label v-for="node in nodes" :key="node.id" style="display: flex; gap: 8px; align-items: center">
          <input type="checkbox" :checked="form.visible.has(node.id)" @change="toggleNode(node.id)" />
          <span>{{ node.name }}</span>
          <span class="muted">({{ node.node_type }})</span>
        </label>
      </div>
      <div class="muted" style="font-size: 12px; margin-top: 8px">不勾选代表默认可见全部节点</div>
    </section>

    <div style="display: flex; gap: 8px">
      <button class="btn btn-primary" @click="save">保存</button>
      <button v-if="editing" class="btn btn-danger" @click="requestDelete(editingToken)">删除订阅</button>
    </div>
  </DetailDrawer>

  <ConfirmDialog
    v-model="confirmDelete"
    title="删除订阅"
    message="删除后订阅链接将立即失效。"
    confirm-label="删除"
    danger
    @confirm="remove"
  />
</template>

<style scoped>
.sub-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sub-stack {
  display: grid;
  gap: 14px;
}

.sub-card {
  border-radius: 16px;
}

.sub-head {
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.sub-link-row {
  display: grid;
  grid-template-columns: 64px 1fr auto;
  gap: 10px;
  align-items: center;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  padding: 8px 10px;
  background: var(--bg-panel-alt);
}

.sub-link-label {
  color: var(--text-secondary);
  font-size: 14px;
  text-transform: lowercase;
}

.sub-link-text {
  overflow: auto;
  white-space: nowrap;
  color: var(--brand-strong);
  font-family: 'IBM Plex Mono', monospace;
  font-size: 14px;
}

.sub-copy-btn {
  padding: 6px 12px;
  font-size: 13px;
}

@media (max-width: 860px) {
  .sub-head {
    flex-direction: column;
  }

  .sub-link-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
</style>
