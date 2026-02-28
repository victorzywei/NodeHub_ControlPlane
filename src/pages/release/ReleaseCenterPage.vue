<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DataGrid from '@/components/ui/DataGrid.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import DetailDrawer from '@/components/ui/DetailDrawer.vue'
import ParamEditor from '@/components/ui/ParamEditor.vue'
import { listNodes } from '@/api/services/nodes'
import { listTemplates } from '@/api/services/templates'
import { createRelease, listReleases } from '@/api/services/releases'
import type { NodeRecord, ReleaseRecord, TemplateRecord } from '@/types/domain'
import { formatDateTime, formatRelative, parseJsonObject } from '@/utils/format'
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()

const loading = ref(false)
const pending = ref(false)
const drawerOpen = ref(false)

const nodes = ref<NodeRecord[]>([])
const templates = ref<TemplateRecord[]>([])
const operations = ref<ReleaseRecord[]>([])

const keyword = ref('')
const selectedNodes = ref<Set<string>>(new Set())
const selectedTemplates = ref<Set<string>>(new Set())
const paramsJson = ref('{}')

const filteredNodes = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return nodes.value

  return nodes.value.filter((node) => {
    return (
      node.name.toLowerCase().includes(text) ||
      node.id.toLowerCase().includes(text) ||
      node.desired_config_summary.toLowerCase().includes(text) ||
      node.applied_config_summary.toLowerCase().includes(text)
    )
  })
})

const selectedNodeRows = computed(() => nodes.value.filter((node) => selectedNodes.value.has(node.id)))
const selectedNodeTypes = computed(() => new Set(selectedNodeRows.value.map((node) => node.node_type)))

const templatesWithStatus = computed(() => {
  return templates.value.map((template) => {
    if (selectedNodeTypes.value.size === 0) {
      return { ...template, compatible: true, warning: '' }
    }

    const unsupported = [...selectedNodeTypes.value].filter((type) => !template.node_types.includes(type))
    return {
      ...template,
      compatible: unsupported.length === 0,
      warning: unsupported.length > 0 ? `不支持: ${unsupported.join(', ')}` : '',
    }
  })
})

function resetDrawerForm(): void {
  selectedNodes.value = new Set()
  selectedTemplates.value = new Set()
  paramsJson.value = '{}'
}

function openDrawer(): void {
  resetDrawerForm()
  drawerOpen.value = true
}

function toggleNode(id: string): void {
  if (selectedNodes.value.has(id)) selectedNodes.value.delete(id)
  else selectedNodes.value.add(id)
  selectedNodes.value = new Set(selectedNodes.value)
}

function toggleTemplate(id: string, compatible: boolean): void {
  if (!compatible) return
  if (selectedTemplates.value.has(id)) selectedTemplates.value.delete(id)
  else selectedTemplates.value.add(id)
  selectedTemplates.value = new Set(selectedTemplates.value)
}

async function loadData(): Promise<void> {
  loading.value = true
  try {
    const [nodeRows, templateRows, operationRows] = await Promise.all([listNodes(), listTemplates(), listReleases()])
    nodes.value = nodeRows
    templates.value = templateRows
    operations.value = operationRows
  } catch {
    toastStore.push('发布中心数据加载失败', 'danger')
  } finally {
    loading.value = false
  }
}

async function applyToNodes(): Promise<void> {
  if (pending.value) return

  if (selectedNodes.value.size === 0) {
    toastStore.push('至少选择一个节点', 'warning')
    return
  }

  if (selectedTemplates.value.size === 0) {
    toastStore.push('至少选择一个模板', 'warning')
    return
  }

  pending.value = true
  try {
    const params = parseJsonObject(paramsJson.value)
    const operation = await createRelease({
      node_ids: [...selectedNodes.value],
      template_ids: [...selectedTemplates.value],
      params,
    })

    const queued = operation.results.filter((item) => item.status === 'queued').length
    const total = operation.results.length
    const tone = queued === total ? 'success' : 'warning'

    toastStore.push(`已下发配置 ${queued}/${total}`, tone)
    drawerOpen.value = false
    await loadData()
  } catch {
    toastStore.push('配置下发失败，请检查参数', 'danger')
  } finally {
    pending.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <FilterBar>
    <input v-model="keyword" class="input" style="max-width: 280px" placeholder="搜索节点或配置" />
    <button class="btn btn-primary" style="margin-left: auto" @click="openDrawer">新增应用</button>
  </FilterBar>

  <DataGrid title="节点配置状态">
    <thead>
      <tr>
        <th>节点名称</th>
        <th>版本</th>
        <th>配置</th>
        <th>状态</th>
        <th>最后上报</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="node in filteredNodes" :key="node.id">
        <td>
          <div style="font-weight: 700">{{ node.name }}</div>
          <div class="muted" style="font-size: 12px">{{ node.id }}</div>
        </td>
        <td>r{{ node.applied_version }} -> r{{ node.desired_version }}</td>
        <td>{{ node.desired_config_summary || node.applied_config_summary || '-' }}</td>
        <td>
          <span class="badge" :class="node.last_release_status === 'failed' ? 'danger' : node.last_release_status === 'ok' ? 'success' : 'warning'">
            {{ node.last_release_status }}
          </span>
        </td>
        <td>{{ formatRelative(node.heartbeat_reported_at || node.last_seen_at) }}</td>
      </tr>
      <tr v-if="!loading && filteredNodes.length === 0">
        <td colspan="5" class="muted">暂无节点</td>
      </tr>
    </tbody>
  </DataGrid>

  <DataGrid title="最近10次操作">
    <thead>
      <tr>
        <th>时间</th>
        <th>配置摘要</th>
        <th>节点结果</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="operation in operations" :key="operation.id">
        <td>{{ formatDateTime(operation.created_at) }}</td>
        <td>{{ operation.summary || operation.template_names.join(' + ') || '-' }}</td>
        <td>
          成功 {{ operation.results.filter((item) => item.status === 'queued').length }} /
          失败 {{ operation.results.filter((item) => item.status === 'failed').length }}
        </td>
      </tr>
      <tr v-if="!loading && operations.length === 0">
        <td colspan="3" class="muted">暂无操作记录</td>
      </tr>
    </tbody>
  </DataGrid>

  <DetailDrawer v-model="drawerOpen" title="新增节点应用">
    <article class="panel panel-pad" style="display: grid; gap: 10px">
      <strong>1) 选择节点</strong>
      <div style="max-height: 220px; overflow: auto; border: 1px solid var(--line); border-radius: 10px; padding: 8px">
        <label v-for="node in nodes" :key="node.id" style="display: flex; gap: 8px; align-items: center; padding: 6px 0">
          <input type="checkbox" :checked="selectedNodes.has(node.id)" @change="toggleNode(node.id)" />
          <span>{{ node.name }}</span>
          <span class="muted" style="margin-left: auto; font-size: 12px">{{ node.node_type }}</span>
        </label>
      </div>
    </article>

    <article class="panel panel-pad" style="display: grid; gap: 10px">
      <strong>2) 选择配置模板</strong>
      <div style="max-height: 220px; overflow: auto; border: 1px solid var(--line); border-radius: 10px; padding: 8px">
        <label v-for="template in templatesWithStatus" :key="template.id" style="display: grid; gap: 4px; padding: 6px 0">
          <span style="display: flex; gap: 8px; align-items: center">
            <input
              type="checkbox"
              :checked="selectedTemplates.has(template.id)"
              :disabled="!template.compatible"
              @change="toggleTemplate(template.id, template.compatible)"
            />
            <span>{{ template.name }}</span>
            <span v-if="!template.compatible" class="badge warning" style="margin-left: auto">{{ template.warning }}</span>
          </span>
          <span class="muted" style="font-size: 12px; margin-left: 22px">{{ template.protocol }} / {{ template.transport }} / {{ template.tls_mode }}</span>
        </label>
      </div>
    </article>

    <ParamEditor v-model="paramsJson" label="3) 自定义参数" hint="JSON 对象，可选。" />

    <div style="display: flex; justify-content: flex-end">
      <button class="btn btn-primary" :disabled="pending" @click="applyToNodes">
        {{ pending ? '应用中...' : '立即应用' }}
      </button>
    </div>
  </DetailDrawer>
</template>