<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import DataGrid from '@/components/ui/DataGrid.vue'
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
const confirmDelete = ref(false)

const form = reactive({
  name: '',
  remark: '',
  visible: new Set<string>(),
})

const baseUrl = computed(() => window.location.origin)
const editing = computed(() => Boolean(editingToken.value))

function subLink(token: string): string {
  return `${baseUrl.value}/sub/${token}`
}

function openCreate(): void {
  editingToken.value = ''
  form.name = ''
  form.remark = ''
  form.visible = new Set()
  editorOpen.value = true
}

function openEdit(sub: SubscriptionRecord): void {
  editingToken.value = sub.token
  form.name = sub.name
  form.remark = sub.remark
  form.visible = new Set(sub.visible_node_ids)
  editorOpen.value = true
}

function toggleNode(id: string): void {
  if (form.visible.has(id)) form.visible.delete(id)
  else form.visible.add(id)
  form.visible = new Set(form.visible)
}

function copy(text: string): void {
  window.navigator.clipboard.writeText(text)
  toastStore.push('链接已复制', 'success')
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
    toastStore.push(sub.enabled ? '订阅已停用' : '订阅已启用', 'success')
    await loadData()
  } catch {
    toastStore.push('订阅状态更新失败', 'danger')
  }
}

async function remove(): Promise<void> {
  if (!editingToken.value) return
  try {
    await deleteSubscription(editingToken.value)
    toastStore.push('订阅已删除', 'success')
    editorOpen.value = false
    await loadData()
  } catch {
    toastStore.push('删除失败', 'danger')
  }
}

onMounted(loadData)
</script>

<template>
  <section class="panel panel-pad" style="display: flex; justify-content: space-between; align-items: center">
    <div>
      <strong>订阅列表</strong>
      <div class="muted">管理可见范围、复制链接与启停状态</div>
    </div>
    <button class="btn btn-primary" @click="openCreate">新建订阅</button>
  </section>

  <DataGrid title="订阅">
    <thead>
      <tr>
        <th>名称</th>
        <th>状态</th>
        <th>节点可见范围</th>
        <th>更新时间</th>
        <th>链接</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="sub in subscriptions" :key="sub.token">
        <td>
          <div style="font-weight: 700">{{ sub.name || '未命名订阅' }}</div>
          <div class="muted" style="font-size: 12px">{{ sub.remark || '-' }}</div>
        </td>
        <td>
          <span class="badge" :class="sub.enabled ? 'success' : 'warning'">
            {{ sub.enabled ? '启用' : '停用' }}
          </span>
        </td>
        <td>
          {{ sub.visible_node_ids.length === 0 ? '全部节点' : sub.visible_node_ids.length + ' 个节点' }}
        </td>
        <td>{{ formatDateTime(sub.updated_at) }}</td>
        <td>
          <button class="btn btn-secondary" @click="copy(subLink(sub.token))">复制</button>
        </td>
        <td>
          <div style="display: flex; gap: 6px">
            <button class="btn btn-secondary" @click="openEdit(sub)">编辑</button>
            <button class="btn btn-secondary" @click="toggleEnabled(sub)">
              {{ sub.enabled ? '停用' : '启用' }}
            </button>
          </div>
        </td>
      </tr>
    </tbody>
  </DataGrid>

  <DetailDrawer v-model="editorOpen" :title="editing ? '编辑订阅' : '新建订阅'">
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
      <button v-if="editing" class="btn btn-danger" @click="confirmDelete = true">删除订阅</button>
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
