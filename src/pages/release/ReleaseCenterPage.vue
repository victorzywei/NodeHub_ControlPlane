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
const expandedLogNodeIds = ref<Set<string>>(new Set())

const nodes = ref<NodeRecord[]>([])
const templates = ref<TemplateRecord[]>([])
const operations = ref<ReleaseRecord[]>([])

const keyword = ref('')
const selectedNodes = ref<Set<string>>(new Set())
const selectedTemplates = ref<Set<string>>(new Set())
const paramsJson = ref('{}')
const LOG_PREVIEW_LIMIT = 48

function hasReleaseVersion(node: NodeRecord): boolean {
  return Number(node.desired_version || 0) > 0 || Number(node.applied_version || 0) > 0
}

function summarizeParams(params: Record<string, unknown>): string {
  const entries = Object.entries(params || {})
  if (entries.length === 0) return ''
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ')
}

function configSummary(templateNames: string[], params: Record<string, unknown>, fallback = ''): string {
  const names = templateNames.map((item) => String(item || '').trim()).filter(Boolean)
  const templateText = names.length > 0 ? names.join(' / ') : ''
  const paramsText = summarizeParams(params)
  if (templateText && paramsText) return `${templateText} | ${paramsText}`
  if (templateText) return templateText
  return fallback || '-'
}

function nodeConfigSummary(node: NodeRecord): string {
  const desired = node.desired_artifact
  const applied = node.applied_artifact
  const templateNames = Array.isArray(desired?.template_names) ? desired.template_names : []
  const params =
    desired?.params && typeof desired.params === 'object' && !Array.isArray(desired.params)
      ? desired.params
      : {}
  return configSummary(templateNames, params, String(desired?.summary || applied?.summary || ''))
}

function nodeLogSummary(node: NodeRecord): string {
  const releaseMessage = String(node.last_release_message || '').trim()
  const heartbeatError = String(node.last_heartbeat_error || '').trim()

  if (node.last_release_status === 'failed') return releaseMessage || heartbeatError || 'deploy failed'
  if (heartbeatError) return `heartbeat error: ${heartbeatError}`
  if (releaseMessage) return releaseMessage
  if (node.last_release_status === 'ok') return 'deploy success'
  if (node.last_release_status === 'pending') return 'deploy pending'
  return '-'
}

function canExpandNodeLog(node: NodeRecord): boolean {
  const text = nodeLogSummary(node)
  return text !== '-' && text.length > LOG_PREVIEW_LIMIT
}

function isNodeLogExpanded(nodeId: string): boolean {
  return expandedLogNodeIds.value.has(nodeId)
}

function toggleNodeLog(nodeId: string): void {
  if (expandedLogNodeIds.value.has(nodeId)) expandedLogNodeIds.value.delete(nodeId)
  else expandedLogNodeIds.value.add(nodeId)
  expandedLogNodeIds.value = new Set(expandedLogNodeIds.value)
}

function nodeLogDisplay(node: NodeRecord): string {
  const text = nodeLogSummary(node)
  if (text === '-' || isNodeLogExpanded(node.id) || !canExpandNodeLog(node)) return text
  return `${text.slice(0, LOG_PREVIEW_LIMIT)}...`
}

function operationConfigSummary(operation: ReleaseRecord): string {
  return configSummary(operation.template_names || [], operation.params || {}, String(operation.summary || ''))
}

function operationResultSummary(operation: ReleaseRecord): string {
  const success = operation.results.filter((item) => item.status === 'queued').length
  const failed = operation.results.filter((item) => item.status === 'failed').length
  return `success ${success} / failed ${failed}`
}

const releaseNodes = computed(() => nodes.value.filter(hasReleaseVersion))

const filteredNodes = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return releaseNodes.value

  return releaseNodes.value.filter((node) => {
    const configText = nodeConfigSummary(node).toLowerCase()
    const logText = nodeLogSummary(node).toLowerCase()

    return (
      node.name.toLowerCase().includes(text) ||
      node.id.toLowerCase().includes(text) ||
      node.node_type.toLowerCase().includes(text) ||
      configText.includes(text) ||
      logText.includes(text)
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
      warning: unsupported.length > 0 ? `unsupported: ${unsupported.join(', ')}` : '',
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
    const validNodeIds = new Set(nodeRows.map((item) => item.id))
    expandedLogNodeIds.value = new Set([...expandedLogNodeIds.value].filter((id) => validNodeIds.has(id)))
  } catch {
    toastStore.push('Failed to load release center data', 'danger')
  } finally {
    loading.value = false
  }
}

async function applyToNodes(): Promise<void> {
  if (pending.value) return

  if (selectedNodes.value.size === 0) {
    toastStore.push('Select at least one node', 'warning')
    return
  }

  if (selectedTemplates.value.size === 0) {
    toastStore.push('Select at least one template', 'warning')
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

    const success = operation.results.filter((item) => item.status === 'queued').length
    const total = operation.results.length
    toastStore.push(`Release queued: ${success}/${total}`, success === total ? 'success' : 'warning')

    drawerOpen.value = false
    await loadData()
  } catch {
    toastStore.push('Release creation failed, please check parameters', 'danger')
  } finally {
    pending.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <FilterBar>
    <input v-model="keyword" class="input" style="max-width: 280px" placeholder="Search nodes or config" />
    <button class="btn btn-primary" style="margin-left: auto" @click="openDrawer">New Apply</button>
  </FilterBar>

  <DataGrid title="Node Deployment Status">
    <thead>
      <tr>
        <th>Node</th>
        <th>Type</th>
        <th>Version</th>
        <th>Config</th>
        <th>Status</th>
        <th>Last Report</th>
        <th>Log</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="node in filteredNodes" :key="node.id">
        <td>
          <div style="font-weight: 700">{{ node.name }}</div>
          <div class="muted" style="font-size: 12px">{{ node.id }}</div>
        </td>
        <td>{{ node.node_type }}</td>
        <td>r{{ node.applied_version }} -> r{{ node.desired_version }}</td>
        <td>{{ nodeConfigSummary(node) }}</td>
        <td>
          <span
            class="badge"
            :class="
              node.last_release_status === 'failed'
                ? 'danger'
                : node.last_release_status === 'ok'
                  ? 'success'
                  : 'warning'
            "
          >
            {{ node.last_release_status }}
          </span>
        </td>
        <td>{{ formatRelative(node.heartbeat_reported_at || node.last_seen_at) }}</td>
        <td>
          <div class="muted" style="max-width: 360px; word-break: break-word">
            {{ nodeLogDisplay(node) }}
          </div>
          <button
            v-if="canExpandNodeLog(node)"
            type="button"
            class="btn btn-secondary"
            style="margin-top: 6px; padding: 2px 10px; font-size: 12px"
            @click="toggleNodeLog(node.id)"
          >
            {{ isNodeLogExpanded(node.id) ? 'Collapse' : 'Expand' }}
          </button>
        </td>
      </tr>
      <tr v-if="!loading && filteredNodes.length === 0">
        <td colspan="7" class="muted">No nodes with release history</td>
      </tr>
    </tbody>
  </DataGrid>

  <DataGrid title="Recent 10 Operations">
    <thead>
      <tr>
        <th>Time</th>
        <th>Nodes</th>
        <th>Config Summary</th>
        <th>Result</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="operation in operations" :key="operation.id">
        <td>{{ formatDateTime(operation.created_at) }}</td>
        <td>{{ operation.node_ids.length }}</td>
        <td>{{ operationConfigSummary(operation) }}</td>
        <td>{{ operationResultSummary(operation) }}</td>
      </tr>
      <tr v-if="!loading && operations.length === 0">
        <td colspan="4" class="muted">No operation history</td>
      </tr>
    </tbody>
  </DataGrid>

  <DetailDrawer v-model="drawerOpen" title="Create Release Apply">
    <article class="panel panel-pad" style="display: grid; gap: 10px">
      <strong>1) Select Nodes</strong>
      <div style="max-height: 220px; overflow: auto; border: 1px solid var(--line); border-radius: 10px; padding: 8px">
        <label v-for="node in nodes" :key="node.id" style="display: flex; gap: 8px; align-items: center; padding: 6px 0">
          <input type="checkbox" :checked="selectedNodes.has(node.id)" @change="toggleNode(node.id)" />
          <span>{{ node.name }}</span>
          <span class="muted" style="margin-left: auto; font-size: 12px">{{ node.node_type }}</span>
        </label>
      </div>
    </article>

    <article class="panel panel-pad" style="display: grid; gap: 10px">
      <strong>2) Select Templates</strong>
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

    <ParamEditor v-model="paramsJson" label="3) Params" hint="Optional JSON object" />

    <div style="display: flex; justify-content: flex-end">
      <button class="btn btn-primary" :disabled="pending" @click="applyToNodes">
        {{ pending ? 'Applying...' : 'Apply Now' }}
      </button>
    </div>
  </DetailDrawer>
</template>
