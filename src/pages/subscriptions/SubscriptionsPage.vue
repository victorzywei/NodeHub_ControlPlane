<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import DetailDrawer from '@/components/ui/DetailDrawer.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { listNodes } from '@/api/services/nodes'
import { createSubscription, deleteSubscription, listSubscriptions, updateSubscription } from '@/api/services/subscriptions'
import type { NodeRecord, SubscriptionRecord } from '@/types/domain'
import { formatDateTime } from '@/utils/format'
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()

const subscriptions = ref<SubscriptionRecord[]>([])
const nodes = ref<NodeRecord[]>([])
const editorOpen = ref(false)
const editingToken = ref('')
const deletingToken = ref('')
const confirmDelete = ref(false)

const form = reactive({
  name: '',
  remark: '',
  visible: new Set<string>(),
})

const baseUrl = computed(() => window.location.origin)
const editing = computed(() => Boolean(editingToken.value))
const nodeNameMap = computed(() => new Map(nodes.value.map((node) => [node.id, node.name])))

const linkFormats = [
  { key: 'v2ray', label: 'v2ray' },
  { key: 'clash', label: 'clash' },
  { key: 'singbox', label: 'singbox' },
] as const

function subLink(token: string, format?: string): string {
  const root = `${baseUrl.value}/sub/${token}`
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
  try {
    const [subRows, nodeRows] = await Promise.all([listSubscriptions(), listNodes()])
    subscriptions.value = subRows
    nodes.value = nodeRows
  } catch {
    toastStore.push('订阅数据加载失败', 'danger')
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
  <section class="panel panel-pad sub-header">
    <h2 class="sub-title">订阅管理</h2>
    <button class="btn btn-primary" @click="openCreate">+ 创建订阅</button>
  </section>

  <section class="sub-stack">
    <article v-for="sub in subscriptions" :key="sub.token" class="sub-card">
      <header class="sub-card-head">
        <div class="sub-card-meta">
          <div class="sub-name-row">
            <strong class="sub-name">{{ sub.name || '未命名订阅' }}</strong>
            <span class="sub-dot" :class="sub.enabled ? 'online' : 'offline'" />
            <span class="sub-status" :class="sub.enabled ? 'enabled' : 'disabled'">
              {{ sub.enabled ? '启用' : '禁用' }}
            </span>
          </div>
          <div class="sub-meta-line">
            可见节点: {{ visibleNodesText(sub) }} · 创建: {{ formatDateTime(sub.created_at) }}
          </div>
          <div class="sub-meta-line">更新时间: {{ formatDateTime(sub.updated_at) }}</div>
          <div v-if="sub.remark" class="sub-meta-line">备注: {{ sub.remark }}</div>
        </div>

        <div class="sub-actions">
          <button class="btn btn-secondary" @click="openEdit(sub)">编辑</button>
          <button class="btn btn-secondary" @click="toggleEnabled(sub)">{{ sub.enabled ? '禁用' : '启用' }}</button>
          <button class="btn btn-danger" @click="requestDelete(sub.token)">删除</button>
        </div>
      </header>

      <section class="sub-links">
        <div v-for="item in linkFormats" :key="item.key" class="sub-link-row">
          <span class="sub-link-label">{{ item.label }}:</span>
          <code class="sub-link-text">{{ subLink(sub.token, item.key) }}</code>
          <button class="btn btn-secondary sub-copy-btn" @click="copy(subLink(sub.token, item.key))">复制</button>
        </div>
      </section>
    </article>

    <section v-if="subscriptions.length === 0" class="panel panel-pad muted">暂无订阅，点击右上角创建订阅。</section>
  </section>

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

.sub-title {
  margin: 0;
  font-size: 28px;
  letter-spacing: 0.02em;
}

.sub-stack {
  display: grid;
  gap: 14px;
}

.sub-card {
  border: 1px solid #1f3252;
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(18, 31, 54, 0.94), rgba(14, 24, 43, 0.98)),
    radial-gradient(circle at 90% 0%, rgba(36, 123, 255, 0.2), transparent 50%);
  color: #cce1ff;
  padding: 16px;
  box-shadow: 0 16px 30px rgba(5, 12, 24, 0.36);
}

.sub-card-head {
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.sub-card-meta {
  display: grid;
  gap: 6px;
}

.sub-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sub-name {
  font-size: 24px;
  font-weight: 800;
  line-height: 1.2;
}

.sub-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.sub-dot.online {
  background: #1fdb9f;
}

.sub-dot.offline {
  background: #f59e0b;
}

.sub-status {
  font-size: 13px;
  font-weight: 700;
}

.sub-status.enabled {
  color: #1fdb9f;
}

.sub-status.disabled {
  color: #f59e0b;
}

.sub-meta-line {
  color: rgba(191, 211, 242, 0.72);
  font-size: 14px;
}

.sub-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: flex-end;
}

.sub-card .btn-secondary {
  border-color: rgba(106, 165, 242, 0.4);
  background: rgba(16, 41, 77, 0.78);
  color: #87c8ff;
}

.sub-card .btn-secondary:hover {
  background: rgba(16, 53, 98, 0.92);
}

.sub-card .btn-danger {
  background: rgba(139, 39, 58, 0.72);
  border: 1px solid rgba(240, 111, 130, 0.45);
}

.sub-links {
  margin-top: 14px;
  display: grid;
  gap: 8px;
}

.sub-link-row {
  display: grid;
  grid-template-columns: 64px 1fr auto;
  gap: 10px;
  align-items: center;
  border: 1px solid rgba(92, 125, 176, 0.34);
  border-radius: 10px;
  padding: 8px 10px;
  background: rgba(4, 16, 35, 0.72);
}

.sub-link-label {
  color: rgba(160, 185, 224, 0.74);
  font-size: 14px;
  text-transform: lowercase;
}

.sub-link-text {
  overflow: auto;
  white-space: nowrap;
  color: #17d1ff;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 14px;
}

.sub-copy-btn {
  padding: 6px 12px;
  font-size: 13px;
}

@media (max-width: 860px) {
  .sub-title {
    font-size: 22px;
  }

  .sub-card-head {
    flex-direction: column;
  }

  .sub-actions {
    justify-content: flex-start;
  }

  .sub-link-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
</style>
