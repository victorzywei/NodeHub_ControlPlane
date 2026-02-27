<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DataGrid from '@/components/ui/DataGrid.vue'
import { listNodes } from '@/api/services/nodes'
import { listTemplates } from '@/api/services/templates'
import { listReleases } from '@/api/services/releases'
import type { NodeRecord, ReleaseRecord } from '@/types/domain'
import { formatDateTime, percent } from '@/utils/format'
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()

const loading = ref(true)
const nodes = ref<NodeRecord[]>([])
const releases = ref<ReleaseRecord[]>([])
const templateCount = ref(0)

const onlineRate = computed(() => {
  if (nodes.value.length === 0) return 0
  return nodes.value.filter((n) => n.online).length / nodes.value.length
})

const failedAlerts = computed(() => nodes.value.filter((n) => n.last_release_status === 'failed').length)
const latestRelease = computed(() => releases.value[0] || null)

async function load(): Promise<void> {
  loading.value = true
  try {
    const [nodeRows, templateRows, releaseRows] = await Promise.all([
      listNodes(),
      listTemplates(),
      listReleases(),
    ])
    nodes.value = nodeRows
    templateCount.value = templateRows.length
    releases.value = releaseRows
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
      <div class="muted">最近发布</div>
      <div class="stat-value">{{ latestRelease ? `v${latestRelease.version}` : '-' }}</div>
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
          <th>状态</th>
          <th>目标版本</th>
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
          <td>v{{ node.desired_version }}</td>
          <td>{{ formatDateTime(node.last_seen_at) }}</td>
        </tr>
        <tr v-if="!loading && nodes.length === 0">
          <td colspan="5" class="muted">暂无节点</td>
        </tr>
      </tbody>
    </DataGrid>

    <section class="panel panel-pad" style="display: grid; gap: 10px; align-content: start">
      <h3 style="margin: 0">容量概览</h3>
      <div class="muted">配置模板总数：{{ templateCount }}</div>
      <div class="muted">发布记录总数：{{ releases.length }}</div>
      <div class="muted">节点总数：{{ nodes.length }}</div>
      <div class="muted">最后刷新：{{ new Date().toLocaleTimeString('zh-CN', { hour12: false }) }}</div>
    </section>
  </section>
</template>
