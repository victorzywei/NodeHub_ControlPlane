<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import DataGrid from '@/components/ui/DataGrid.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import DetailDrawer from '@/components/ui/DetailDrawer.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { createNode, deleteNode, getNode, listNodes, nodeInstallCommand, updateNode } from '@/api/services/nodes'
import type { NodeRecord, NodeKind } from '@/types/domain'
import { formatRelative } from '@/utils/format'
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()

const loading = ref(false)
const nodes = ref<NodeRecord[]>([])
const keyword = ref('')
const typeFilter = ref<'all' | NodeKind>('all')
const onlineFilter = ref<'all' | 'online' | 'offline'>('all')

const selected = ref<Set<string>>(new Set())

const detailOpen = ref(false)
const detailNode = ref<NodeRecord | null>(null)
const detailInstallCommand = ref('')

const editorOpen = ref(false)
const editorMode = ref<'create' | 'edit'>('create')
const editingId = ref('')
const form = reactive({
  name: '',
  node_type: 'vps' as NodeKind,
  region: '',
  tags: '',
  entry_cdn: '',
  entry_direct: '',
  entry_ip: '',
  github_mirror: '',
  cf_api_token: '',
})

const confirmBatchDelete = ref(false)

const filteredRows = computed(() => {
  return nodes.value.filter((node) => {
    const matchesKeyword =
      keyword.value.trim().length === 0 ||
      node.name.toLowerCase().includes(keyword.value.toLowerCase()) ||
      node.id.toLowerCase().includes(keyword.value.toLowerCase())

    const matchesType = typeFilter.value === 'all' || node.node_type === typeFilter.value
    const matchesOnline =
      onlineFilter.value === 'all' ||
      (onlineFilter.value === 'online' ? node.online : !node.online)

    return matchesKeyword && matchesType && matchesOnline
  })
})

function toPayload(): Partial<NodeRecord> {
  return {
    name: form.name.trim(),
    node_type: form.node_type,
    region: form.region.trim(),
    tags: form.tags
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    entry_cdn: form.entry_cdn.trim(),
    entry_direct: form.entry_direct.trim(),
    entry_ip: form.entry_ip.trim(),
    github_mirror: form.github_mirror.trim(),
    cf_api_token: form.cf_api_token.trim(),
  }
}

function fillForm(node?: NodeRecord): void {
  form.name = node?.name || ''
  form.node_type = node?.node_type || 'vps'
  form.region = node?.region || ''
  form.tags = (node?.tags || []).join(', ')
  form.entry_cdn = node?.entry_cdn || ''
  form.entry_direct = node?.entry_direct || ''
  form.entry_ip = node?.entry_ip || ''
  form.github_mirror = node?.github_mirror || ''
  form.cf_api_token = node?.cf_api_token || ''
}

async function loadNodesData(): Promise<void> {
  loading.value = true
  try {
    nodes.value = await listNodes()
  } catch {
    toastStore.push('节点列表加载失败', 'danger')
  } finally {
    loading.value = false
  }
}

function toggleSelect(id: string): void {
  if (selected.value.has(id)) selected.value.delete(id)
  else selected.value.add(id)
  selected.value = new Set(selected.value)
}

function startCreate(): void {
  editorMode.value = 'create'
  editingId.value = ''
  fillForm()
  editorOpen.value = true
}

function startEdit(node: NodeRecord): void {
  editorMode.value = 'edit'
  editingId.value = node.id
  fillForm(node)
  editorOpen.value = true
}

async function saveNode(): Promise<void> {
  if (!form.name.trim()) {
    toastStore.push('节点名称不能为空', 'warning')
    return
  }

  try {
    if (editorMode.value === 'create') {
      await createNode(toPayload() as Partial<NodeRecord> & Pick<NodeRecord, 'name' | 'node_type'>)
      toastStore.push('节点已创建', 'success')
    } else {
      await updateNode(editingId.value, toPayload())
      toastStore.push('节点已更新', 'success')
    }
    editorOpen.value = false
    await loadNodesData()
  } catch {
    toastStore.push('节点保存失败', 'danger')
  }
}

async function openDetail(nodeId: string): Promise<void> {
  detailOpen.value = true
  detailInstallCommand.value = ''
  try {
    const node = await getNode(nodeId)
    detailNode.value = node
    if (node.node_type === 'vps') {
      const install = await nodeInstallCommand(node.id)
      detailInstallCommand.value = install.command
    }
  } catch {
    toastStore.push('节点详情加载失败', 'danger')
  }
}

async function runBatchDelete(): Promise<void> {
  const ids = [...selected.value]
  if (ids.length === 0) return

  const results = await Promise.allSettled(ids.map((id) => deleteNode(id)))
  const successCount = results.filter((r) => r.status === 'fulfilled').length
  selected.value = new Set()
  toastStore.push(`批量删除完成，成功 ${successCount}/${ids.length}`, successCount === ids.length ? 'success' : 'warning')
  await loadNodesData()
}

function copyValue(text: string, label: string): void {
  if (!text) return
  window.navigator.clipboard.writeText(text)
  toastStore.push(`${label} 已复制`, 'success')
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-'
  return `${value.toFixed(1)}%`
}

function formatMemorySummary(node: NodeRecord): string {
  if (node.memory_used_mb === null || node.memory_total_mb === null || node.memory_usage_percent === null) {
    return '-'
  }
  return `${node.memory_used_mb.toFixed(0)} / ${node.memory_total_mb.toFixed(0)} MB (${node.memory_usage_percent.toFixed(1)}%)`
}

onMounted(loadNodesData)
</script>

<template>
  <FilterBar>
    <input v-model="keyword" class="input" style="max-width: 240px" placeholder="搜索节点名或 ID" />
    <select v-model="typeFilter" class="select" style="max-width: 160px">
      <option value="all">全部类型</option>
      <option value="vps">VPS</option>
      <option value="edge">Edge</option>
    </select>
    <select v-model="onlineFilter" class="select" style="max-width: 160px">
      <option value="all">全部状态</option>
      <option value="online">在线</option>
      <option value="offline">离线</option>
    </select>
    <button class="btn btn-secondary" @click="selected = new Set(filteredRows.map((item) => item.id))">全选当前</button>
    <button class="btn btn-danger" :disabled="selected.size === 0" @click="confirmBatchDelete = true">
      批量删除 ({{ selected.size }})
    </button>
    <button class="btn btn-primary" style="margin-left: auto" @click="startCreate">新建节点</button>
  </FilterBar>

  <DataGrid title="节点列表">
    <thead>
      <tr>
        <th></th>
        <th>名称</th>
        <th>类型</th>
        <th>区域</th>
        <th>状态</th>
        <th>版本</th>
        <th>最后在线</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="node in filteredRows" :key="node.id">
        <td>
          <input type="checkbox" :checked="selected.has(node.id)" @change="toggleSelect(node.id)" />
        </td>
        <td>
          <div style="font-weight: 700">{{ node.name }}</div>
          <div class="muted" style="font-size: 12px">{{ node.id }}</div>
        </td>
        <td>{{ node.node_type }}</td>
        <td>{{ node.region || '-' }}</td>
        <td>
          <span class="badge" :class="node.online ? 'success' : 'warning'">
            {{ node.online ? '在线' : '离线' }}
          </span>
        </td>
        <td>v{{ node.applied_version }} -> v{{ node.desired_version }}</td>
        <td>{{ formatRelative(node.last_seen_at) }}</td>
        <td>
          <div style="display: flex; gap: 6px">
            <button class="btn btn-secondary" @click="openDetail(node.id)">详情</button>
            <button class="btn btn-secondary" @click="startEdit(node)">编辑</button>
          </div>
        </td>
      </tr>
      <tr v-if="!loading && filteredRows.length === 0">
        <td colspan="8" class="muted">没有匹配节点</td>
      </tr>
    </tbody>
  </DataGrid>

  <DetailDrawer v-model="detailOpen" title="节点详情">
    <template v-if="detailNode">
      <div><strong>{{ detailNode.name }}</strong></div>
      <div class="muted">{{ detailNode.id }}</div>
      <div>类型：{{ detailNode.node_type }}</div>
      <div>入口 CDN：{{ detailNode.entry_cdn || '-' }}</div>
      <div>入口 Direct：{{ detailNode.entry_direct || '-' }}</div>
      <div>入口 IP：{{ detailNode.entry_ip || '-' }}</div>
      <div>节点 Token：{{ detailNode.token || '-' }}</div>
      <div>部署信息：{{ detailNode.deploy_info || '-' }}</div>
      <div>协议应用版本：{{ detailNode.protocol_app_version || '-' }}</div>
      <div>最近错误：{{ detailNode.last_heartbeat_error || '-' }}</div>
      <div>CPU 使用率：{{ formatPercent(detailNode.cpu_usage_percent) }}</div>
      <div>内存占用：{{ formatMemorySummary(detailNode) }}</div>
      <div>资源上报：{{ formatRelative(detailNode.heartbeat_reported_at) }}</div>
      <div>GitHub 镜像：{{ detailNode.github_mirror || '-' }}</div>
      <div>Cloudflare Token：{{ detailNode.cf_api_token ? '已设置' : '-' }}</div>
      <button class="btn btn-secondary" style="margin-top: 8px" @click="copyValue(detailNode.token, '节点 Token')">复制 Token</button>
      <template v-if="detailInstallCommand">
        <div class="muted">VPS 安装命令</div>
        <textarea class="textarea" readonly :value="detailInstallCommand" />
        <button class="btn btn-secondary" @click="copyValue(detailInstallCommand, '安装命令')">复制安装命令</button>
      </template>
    </template>
    <div v-else class="muted">加载中...</div>
  </DetailDrawer>

  <DetailDrawer v-model="editorOpen" :title="editorMode === 'create' ? '新建节点' : '编辑节点'">
    <label>
      名称
      <input v-model="form.name" class="input" />
    </label>
    <label>
      类型
      <select v-model="form.node_type" class="select">
        <option value="vps">VPS</option>
        <option value="edge">Edge</option>
      </select>
    </label>
    <label>
      区域
      <input v-model="form.region" class="input" />
    </label>
    <label>
      标签 (逗号分隔)
      <input v-model="form.tags" class="input" />
    </label>
    <label>
      入口 CDN
      <input v-model="form.entry_cdn" class="input" />
    </label>
    <label>
      入口 Direct
      <input v-model="form.entry_direct" class="input" />
    </label>
    <label>
      入口 IP
      <input v-model="form.entry_ip" class="input" />
    </label>
    <label>
      GitHub 镜像 (可选)
      <input v-model="form.github_mirror" class="input" placeholder="用于vps下载github的文件" />
    </label>
    <label>
      Cloudflare API Token (可选)
      <input v-model="form.cf_api_token" class="input" placeholder="用于申请CF证书" />
    </label>
    <button class="btn btn-primary" @click="saveNode">保存</button>
  </DetailDrawer>

  <ConfirmDialog
    v-model="confirmBatchDelete"
    title="确认批量删除"
    :message="`将删除 ${selected.size} 个节点，该操作不可恢复。`"
    confirm-label="立即删除"
    danger
    @confirm="runBatchDelete"
  />
</template>
