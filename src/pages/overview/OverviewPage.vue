<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DataGrid from '@/components/ui/DataGrid.vue'
import { listNodes } from '@/api/services/nodes'
import { listTemplates } from '@/api/services/templates'
import type { NodeRecord } from '@/types/domain'
import { formatDateTime, percent } from '@/utils/format'
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()

const loading = ref(true)
const nodes = ref<NodeRecord[]>([])
const templateCount = ref(0)

const onlineRate = computed(() => {
  if (nodes.value.length === 0) return 0
  return nodes.value.filter((item) => item.online).length / nodes.value.length
})

const failedAlerts = computed(() => nodes.value.filter((item) => item.last_release_status === 'failed').length)
const pendingApply = computed(() => nodes.value.filter((item) => item.last_release_status === 'pending').length)

function releaseVersionText(node: NodeRecord): string {
  const rev = Number(node.target_artifact?.rev || node.target_version || 0)
  if (!Number.isFinite(rev) || rev <= 0) return '-'
  return `r${Math.floor(rev)}`
}

function releaseStatusClass(node: NodeRecord): 'success' | 'warning' | 'danger' {
  if (node.last_release_status === 'ok') return 'success'
  if (node.last_release_status === 'failed') return 'danger'
  return 'warning'
}

function releaseStatusText(node: NodeRecord): string {
  if (node.last_release_status === 'ok') return '已应用'
  if (node.last_release_status === 'failed') return '应用失败'
  if (node.last_release_status === 'pending') return '应用中'
  return '未发布'
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const [nodeRows, templateRows] = await Promise.all([listNodes(), listTemplates()])
    nodes.value = nodeRows
    templateCount.value = templateRows.length
  } catch {
    toastStore.push('总览数据加载失败', 'danger')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="grid-cards">
    <article class="stat-card">
      <div class="muted">健康度</div>
      <div class="stat-value">{{ nodes.length === 0 ? 100 : Math.max(1, Math.round((1 - failedAlerts / nodes.length) * 100)) }}%</div>
    </article>
    <article class="stat-card">
      <div class="muted">在线率</div>
      <div class="stat-value">{{ percent(onlineRate) }}</div>
    </article>
    <article class="stat-card">
      <div class="muted">应用中节点</div>
      <div class="stat-value">{{ pendingApply }}</div>
    </article>
    <article class="stat-card">
      <div class="muted">失败告警</div>
      <div class="stat-value">{{ failedAlerts }}</div>
    </article>
  </section>

  <section style="display: grid; gap: 16px; grid-template-columns: 2fr 1fr">
    <DataGrid title="节点状态">
      <thead>
        <tr>
          <th>节点</th>
          <th>类型</th>
          <th>在线</th>
          <th>发布版本</th>
          <th>应用状态</th>
          <th>最后在线</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="node in nodes" :key="node.id">
          <td>{{ node.name }}</td>
          <td>{{ node.node_type }}</td>
          <td>
            <span class="badge" :class="node.online ? 'success' : 'warning'">
              {{ node.online ? '在线' : '离线' }}
            </span>
          </td>
          <td>{{ releaseVersionText(node) }}</td>
          <td>
            <span class="badge" :class="releaseStatusClass(node)">{{ releaseStatusText(node) }}</span>
          </td>
          <td>{{ formatDateTime(node.last_seen_at) }}</td>
        </tr>
        <tr v-if="!loading && nodes.length === 0">
          <td colspan="6" class="muted">暂无节点</td>
        </tr>
      </tbody>
    </DataGrid>

    <section class="panel panel-pad" style="display: grid; gap: 10px; align-content: start">
      <h3 style="margin: 0">容量概览</h3>
      <div class="muted">配置模板总数：{{ templateCount }}</div>
      <div class="muted">节点总数：{{ nodes.length }}</div>
      <div class="muted">应用中数量：{{ pendingApply }}</div>
      <div class="muted">最后刷新：{{ new Date().toLocaleTimeString('zh-CN', { hour12: false }) }}</div>
    </section>
  </section>
</template>
