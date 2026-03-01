<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DataGrid from '@/components/ui/DataGrid.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import DetailDrawer from '@/components/ui/DetailDrawer.vue'
import ParamEditor from '@/components/ui/ParamEditor.vue'
import { getNodeConfig, listNodes } from '@/api/services/nodes'
import { listTemplates } from '@/api/services/templates'
import { createRelease, listReleases } from '@/api/services/releases'
import type { NodeArtifactConfigView, NodeConfigDetail, NodeRecord, ReleaseRecord, TemplateRecord } from '@/types/domain'
import { formatDateTime, formatRelative, parseJsonObject } from '@/utils/format'
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()

const loading = ref(false)
const pending = ref(false)
const drawerOpen = ref(false)
const expandedLogNodeIds = ref<Set<string>>(new Set())

const configDrawerOpen = ref(false)
const configLoading = ref(false)
const configNodeName = ref('')
const configDetail = ref<NodeConfigDetail | null>(null)
const configHintMessage = ref('')

const nodes = ref<NodeRecord[]>([])
const templates = ref<TemplateRecord[]>([])
const operations = ref<ReleaseRecord[]>([])

const keyword = ref('')
const selectedNodes = ref<Set<string>>(new Set())
const selectedTemplates = ref<Set<string>>(new Set())
const paramsJson = ref('{}')
const LOG_PREVIEW_LIMIT = 48

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
  const target = node.target_artifact
  const current = node.current_artifact
  const templateNames = Array.isArray(target?.template_names) ? target.template_names : []
  const params =
    target?.params && typeof target.params === 'object' && !Array.isArray(target.params)
      ? target.params
      : {}
  return configSummary(templateNames, params, String(target?.summary || current?.summary || ''))
}

function nodeVersionText(node: NodeRecord): string {
  const current = Number(node.current_version || 0)
  const target = Number(node.target_version || 0)
  if (current <= 0 && target <= 0) return '-'
  return `r${current} -> r${target}`
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

function operationFailureSummary(operation: ReleaseRecord): string {
  const reasons = operation.results
    .filter((item) => item.status === 'failed' && item.reason)
    .map((item) => String(item.reason || '').trim())
    .filter(Boolean)
  return reasons[0] || ''
}

function configUpdatedAt(view: NodeArtifactConfigView | null): string {
  if (!view?.created_at) return '-'
  return formatDateTime(view.created_at)
}

function configRevText(view: NodeArtifactConfigView | null): string {
  const rev = Number(view?.rev || 0)
  return rev > 0 ? `r${rev}` : '-'
}

function protocolConfigText(view: NodeArtifactConfigView | null): string {
  return String(view?.config_text || '').trim()
}

function hasConfigView(view: NodeArtifactConfigView | null): boolean {
  return Boolean(view && (Number(view.rev || 0) > 0 || view.sha256 || view.engine || view.config_text))
}

function copyText(text: string, label: string): void {
  if (!text) return
  window.navigator.clipboard.writeText(text)
  toastStore.push(`${label} copied`, 'success')
}

const filteredNodes = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return nodes.value

  return nodes.value.filter((node) => {
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
    const [nodesResult, templatesResult, releasesResult] = await Promise.allSettled([
      listNodes(),
      listTemplates(),
      listReleases(),
    ])

    if (nodesResult.status === 'fulfilled') nodes.value = nodesResult.value
    if (templatesResult.status === 'fulfilled') templates.value = templatesResult.value
    if (releasesResult.status === 'fulfilled') operations.value = releasesResult.value

    if (nodesResult.status === 'rejected') toastStore.push('Failed to load nodes', 'danger')
    if (templatesResult.status === 'rejected') toastStore.push('Failed to load templates', 'danger')
    if (releasesResult.status === 'rejected') toastStore.push('Failed to load release history', 'warning')

    const validNodeIds = new Set(nodes.value.map((item) => item.id))
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

async function openNodeConfig(node: NodeRecord): Promise<void> {
  configDrawerOpen.value = true
  configLoading.value = true
  configNodeName.value = node.name
  configDetail.value = null
  configHintMessage.value = node.last_release_message || ''

  try {
    configDetail.value = await getNodeConfig(node.id)
  } catch {
    toastStore.push('Failed to load node config', 'danger')
  } finally {
    configLoading.value = false
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
          <button
            type="button"
            style="font-weight: 700; background: transparent; border: 0; padding: 0; color: inherit; cursor: pointer; text-align: left"
            @click="openNodeConfig(node)"
          >
            {{ node.name }}
          </button>
          <div class="muted" style="font-size: 12px">{{ node.id }}</div>
        </td>
        <td>{{ node.node_type }}</td>
        <td>{{ nodeVersionText(node) }}</td>
        <td>
          <div>{{ nodeConfigSummary(node) }}</div>
          <button class="btn btn-secondary" style="margin-top: 6px; padding: 2px 10px; font-size: 12px" @click="openNodeConfig(node)">
            View Config
          </button>
        </td>
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
        <td colspan="7" class="muted">No nodes</td>
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
        <td>
          <div>{{ operationResultSummary(operation) }}</div>
          <div v-if="operationFailureSummary(operation)" class="muted" style="font-size: 12px; margin-top: 4px">
            {{ operationFailureSummary(operation) }}
          </div>
        </td>
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

  <DetailDrawer v-model="configDrawerOpen" :title="`Node Config - ${configNodeName || ''}`">
    <div v-if="configLoading" class="muted">Loading...</div>
    <template v-else-if="configDetail">
      <article class="panel panel-pad" style="display: grid; gap: 8px; margin-bottom: 12px">
        <strong>Target (generated)</strong>
        <div class="muted">rev: {{ configRevText(configDetail.target) }} | engine: {{ configDetail.target?.engine || '-' }}</div>
        <div class="muted">sha256: {{ configDetail.target?.sha256 || '-' }}</div>
        <div class="muted">created: {{ configUpdatedAt(configDetail.target) }}</div>
        <div v-if="configDetail.target?.missing" class="badge warning">artifact missing in KV</div>

        <div v-if="!hasConfigView(configDetail.target)" class="muted">
          No generated artifact yet. {{ configHintMessage || '' }}
        </div>
        <div v-else-if="!protocolConfigText(configDetail.target)" class="muted">
          No generated protocol config yet. {{ configHintMessage || '' }}
        </div>
        <template v-else>
          <label class="muted">{{ configDetail.target?.config_name || 'protocol config' }}</label>
          <textarea class="textarea" readonly :value="protocolConfigText(configDetail.target)" style="min-height: 280px" />
          <div style="display: flex; justify-content: flex-end">
            <button class="btn btn-secondary" @click="copyText(protocolConfigText(configDetail.target), 'target config')">
              Copy
            </button>
          </div>
        </template>
      </article>

      <article class="panel panel-pad" style="display: grid; gap: 8px">
        <strong>Current (running)</strong>
        <div class="muted">rev: {{ configRevText(configDetail.current) }} | engine: {{ configDetail.current?.engine || '-' }}</div>
        <div class="muted">sha256: {{ configDetail.current?.sha256 || '-' }}</div>
        <div class="muted">created: {{ configUpdatedAt(configDetail.current) }}</div>
        <div v-if="configDetail.current?.missing" class="badge warning">artifact missing in KV</div>

        <div v-if="!hasConfigView(configDetail.current)" class="muted">
          No applied artifact yet.
        </div>
        <div v-else-if="!protocolConfigText(configDetail.current)" class="muted">
          No applied protocol config yet.
        </div>
        <template v-else>
          <label class="muted">{{ configDetail.current?.config_name || 'protocol config' }}</label>
          <textarea class="textarea" readonly :value="protocolConfigText(configDetail.current)" style="min-height: 280px" />
          <div style="display: flex; justify-content: flex-end">
            <button class="btn btn-secondary" @click="copyText(protocolConfigText(configDetail.current), 'current config')">
              Copy
            </button>
          </div>
        </template>
      </article>
    </template>
    <div v-else class="muted">No config data</div>
  </DetailDrawer>
</template>
