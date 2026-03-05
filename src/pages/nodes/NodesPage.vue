<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import DataGrid from '@/components/ui/DataGrid.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import DetailDrawer from '@/components/ui/DetailDrawer.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { createNode, deleteNode, getNode, listNodes, nodeInstallCommand, previewNodePublish, publishNodeTemplates, updateNode } from '@/api/services/nodes'
import { listTemplates } from '@/api/services/templates'
import type { NodeKind, NodePublishPreview, NodeRecord, TemplateRecord } from '@/types/domain'
import { supportsTemplateCombination } from '@/utils/templateCapability'
import { formatRelative } from '@/utils/format'
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()

const loading = ref(false)
const publishing = ref(false)
const nodes = ref<NodeRecord[]>([])
const templates = ref<TemplateRecord[]>([])
const keyword = ref('')
const typeFilter = ref<'all' | NodeKind>('all')
const onlineFilter = ref<'all' | 'online' | 'offline'>('all')

const selected = ref<Set<string>>(new Set())

const detailOpen = ref(false)
const detailNode = ref<NodeRecord | null>(null)
const detailInstallCommand = ref('')
const detailUninstallCommand = ref('')
const detailTroubleshootCommands = ref<Array<{ title: string, command: string, copyLabel: string }>>([])

const editorOpen = ref(false)
const editorMode = ref<'create' | 'edit'>('create')
const editingId = ref('')
type InstallGroup = 'public_ip' | 'no_public_ip' | 'none'
const installGroup = ref<InstallGroup>('public_ip')
const form = reactive({
  name: '',
  node_type: 'vps' as NodeKind,
  region: '',
  tags: '',
  install_cert: true,
  entry_cdn: '',
  entry_direct: '',
  entry_ip: '',
  github_mirror: '',
  cf_api_token: '',
  install_warp: false,
  warp_license: '',
  install_argo: false,
  argo_token: '',
  argo_domain: '',
})

const publishOpen = ref(false)
const publishNode = ref<NodeRecord | null>(null)
const publishTemplateIds = ref<string[]>([])
const publishPreviewLoading = ref(false)
const publishPreview = ref<NodePublishPreview | null>(null)
const publishPreviewError = ref('')
let publishPreviewSeq = 0

const confirmBatchDelete = ref(false)
const releaseStatusOpen = ref(false)
const releaseStatusNode = ref<NodeRecord | null>(null)

const templateNameMap = computed(() => {
  const map = new Map<string, string>()
  templates.value.forEach((item) => {
    map.set(item.id, item.name)
  })
  return map
})

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

const publishAvailableTemplates = computed(() => {
  const node = publishNode.value
  if (!node) return []
  return templates.value.filter((item) => item.node_types.includes(node.node_type) && isTemplatePublishable(item))
})

function isTemplatePublishable(template: TemplateRecord): boolean {
  return supportsTemplateCombination(template.engine, template.protocol, template.transport, template.tls_mode)
}

function sanitizePublishTemplateIds(ids: string[], nodeType: NodeKind): string[] {
  const allowed = new Set(
    templates.value
      .filter((item) => item.node_types.includes(nodeType) && isTemplatePublishable(item))
      .map((item) => item.id),
  )
  return ids.filter((id) => allowed.has(id))
}

function toPayload(): Partial<NodeRecord> {
  const enableCertInstall = installGroup.value === 'public_ip'
  const enableArgoInstall = installGroup.value === 'no_public_ip'

  return {
    name: form.name.trim(),
    node_type: form.node_type,
    region: form.region.trim(),
    tags: form.tags
      .split(',')
      .map((item: string) => item.trim())
      .filter(Boolean),
    install_cert: enableCertInstall,
    entry_cdn: form.entry_cdn.trim(),
    entry_direct: form.entry_direct.trim(),
    entry_ip: form.entry_ip.trim(),
    github_mirror: form.github_mirror.trim(),
    cf_api_token: form.cf_api_token.trim(),
    install_warp: form.install_warp,
    warp_license: form.warp_license.trim(),
    install_argo: enableArgoInstall,
    argo_token: form.argo_token.trim(),
    argo_domain: form.argo_domain.trim(),
  } as Partial<NodeRecord>
}

function resolveInstallGroup(node?: NodeRecord): InstallGroup {
  if (!node) return 'public_ip'
  if (node.install_argo) return 'no_public_ip'
  if (node.install_cert) return 'public_ip'
  return 'none'
}

function fillForm(node?: NodeRecord): void {
  form.name = node?.name || ''
  form.node_type = node?.node_type || 'vps'
  form.region = node?.region || ''
  form.tags = (node?.tags || []).join(', ')
  form.install_cert = node?.install_cert ?? true
  form.entry_cdn = node?.entry_cdn || ''
  form.entry_direct = node?.entry_direct || ''
  form.entry_ip = node?.entry_ip || ''
  form.github_mirror = node?.github_mirror || ''
  form.cf_api_token = node?.cf_api_token || ''
  form.install_warp = node?.install_warp || false
  form.warp_license = node?.warp_license || ''
  form.install_argo = node?.install_argo || false
  form.argo_token = node?.argo_token || ''
  form.argo_domain = node?.argo_domain || ''
  installGroup.value = resolveInstallGroup(node)
}

async function loadNodesData(): Promise<void> {
  loading.value = true
  try {
    const [nodeResult, templateResult] = await Promise.allSettled([listNodes(), listTemplates()])

    if (nodeResult.status === 'fulfilled') {
      nodes.value = nodeResult.value
    } else {
      toastStore.push('节点列表加载失败', 'danger')
    }

    if (templateResult.status === 'fulfilled') {
      templates.value = templateResult.value
    } else {
      toastStore.push('模板列表加载失败', 'warning')
    }
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

function startPublish(node: NodeRecord): void {
  publishNode.value = node
  const initialIds = Array.isArray(node.applied_template_ids) ? [...node.applied_template_ids] : []
  const sanitizedIds = sanitizePublishTemplateIds(initialIds, node.node_type)
  publishTemplateIds.value = sanitizedIds
  publishPreview.value = null
  publishPreviewError.value = ''
  publishOpen.value = true
  void refreshPublishPreview()
}

async function refreshPublishPreview(): Promise<void> {
  if (!publishNode.value) return

  publishTemplateIds.value = sanitizePublishTemplateIds(publishTemplateIds.value, publishNode.value.node_type)

  const seq = ++publishPreviewSeq
  publishPreviewLoading.value = true
  publishPreviewError.value = ''

  try {
    const preview = await previewNodePublish(publishNode.value.id, publishTemplateIds.value)
    if (seq !== publishPreviewSeq) return
    publishPreview.value = preview
    publishTemplateIds.value = Array.isArray(preview.applied_template_ids) ? [...preview.applied_template_ids] : []
  } catch (error) {
    if (seq !== publishPreviewSeq) return
    publishPreview.value = null
    const message = error instanceof Error ? error.message : ''
    publishPreviewError.value = message ? `预览生成失败：${message}` : '预览生成失败'
  } finally {
    if (seq === publishPreviewSeq) {
      publishPreviewLoading.value = false
    }
  }
}

function togglePublishTemplate(id: string): void {
  if (publishTemplateIds.value.includes(id)) {
    publishTemplateIds.value = publishTemplateIds.value.filter((item) => item !== id)
  } else {
    publishTemplateIds.value = [...publishTemplateIds.value, id]
  }
  void refreshPublishPreview()
}

async function publishTemplatesForNode(): Promise<void> {
  if (!publishNode.value) return
  publishTemplateIds.value = sanitizePublishTemplateIds(publishTemplateIds.value, publishNode.value.node_type)
  if (publishPreview.value && !publishPreview.value.publishable) {
    toastStore.push(publishPreview.value.publish_message || '当前选择无法直接发布', 'warning')
    return
  }
  publishing.value = true
  try {
    const node = await publishNodeTemplates(publishNode.value.id, publishTemplateIds.value)
    publishNode.value = node
    if (detailNode.value && detailNode.value.id === node.id) {
      detailNode.value = node
    }
    if (releaseStatusNode.value && releaseStatusNode.value.id === node.id) {
      releaseStatusNode.value = node
    }
    toastStore.push(`协议已发布，版本 r${node.target_version}`, 'success')
    publishOpen.value = false
    await loadNodesData()
  } catch {
    toastStore.push('协议发布失败', 'danger')
  } finally {
    publishing.value = false
  }
}

async function saveNode(): Promise<void> {
  if (!form.name.trim()) {
    toastStore.push('节点名称不能为空', 'warning')
    return
  }

  try {
    const payload = toPayload()
    if (editorMode.value === 'create') {
      await createNode(payload as Partial<NodeRecord> & Pick<NodeRecord, 'name' | 'node_type'>)
      toastStore.push('节点已创建', 'success')
    } else {
      await updateNode(editingId.value, payload)
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
  detailUninstallCommand.value = ''
  detailTroubleshootCommands.value = []
  try {
    const node = await getNode(nodeId)
    detailNode.value = node
    if (node.node_type === 'vps') {
      const install = await nodeInstallCommand(node.id)
      detailInstallCommand.value = install.command

      const baseUrl = window.location.origin
      detailUninstallCommand.value = `URL='${baseUrl}/agent/uninstall'; if command -v curl >/dev/null 2>&1; then curl -fsSL $URL; else wget -q -O - $URL; fi | bash -s -- --remove-binaries --remove-certs --force`
      detailTroubleshootCommands.value = buildVpsTroubleshootCommands(node, baseUrl)
    }
  } catch {
    toastStore.push('节点详情加载失败', 'danger')
  }
}

function quoteShell(value: string): string {
  return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`
}

function buildVpsTroubleshootCommands(node: NodeRecord, baseUrl: string): Array<{ title: string, command: string, copyLabel: string }> {
  const commands: Array<{ title: string, command: string, copyLabel: string }> = []
  const apiBase = quoteShell(baseUrl)
  const nodeId = quoteShell(node.id)
  const nodeToken = quoteShell(node.token || '')
  const entryCdn = quoteShell(node.entry_cdn || '')
  const entryDirect = quoteShell(node.entry_direct || '')
  const entryIp = quoteShell(node.entry_ip || '')

  commands.push({
    title: '管理端连接检查（异常自动带错误日志）',
    copyLabel: '管理端连接检查命令',
    command: `API_BASE=${apiBase}; NODE_ID=${nodeId}; NODE_TOKEN=${nodeToken}; STATE_DIR=/var/lib/nodehub-agent; [ -d "$STATE_DIR" ] || STATE_DIR="$HOME/.local/share/nodehub-agent"; RESP="$(curl -sS --max-time 12 -w '\\nHTTP_STATUS:%{http_code}' -H "X-Node-Token: $NODE_TOKEN" "$API_BASE/agent/heartbeat?node_id=$NODE_ID" 2>&1)"; RC=$?; if [ "$RC" -ne 0 ]; then echo "FAIL: 管理端连接异常"; echo "reason=$(printf '%s' "$RESP" | tail -n 1)"; echo "last_error=$(cat "$STATE_DIR/last-error.log" 2>/dev/null || echo -)"; tail -n 40 "$STATE_DIR/heartbeat.log" "$STATE_DIR/reconcile.log" 2>/dev/null || true; exit 1; fi; HTTP="$(printf '%s\\n' "$RESP" | sed -n 's/^HTTP_STATUS://p' | tail -n 1)"; BODY="$(printf '%s\\n' "$RESP" | sed '/^HTTP_STATUS:/d')"; if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | grep -q '"success":true'; then echo "OK: 管理端连接正常"; else echo "FAIL: 管理端连接异常 (http=$HTTP)"; echo "body=$(printf '%s' "$BODY" | tr -d '\\n' | cut -c 1-260)"; echo "last_error=$(cat "$STATE_DIR/last-error.log" 2>/dev/null || echo -)"; tail -n 40 "$STATE_DIR/heartbeat.log" "$STATE_DIR/reconcile.log" 2>/dev/null || true; fi`,
  })

  commands.push({
    title: '拉取与应用检查（异常自动给出原因）',
    copyLabel: '拉取应用检查命令',
    command: `API_BASE=${apiBase}; NODE_ID=${nodeId}; NODE_TOKEN=${nodeToken}; STATE_DIR=/var/lib/nodehub-agent; [ -d "$STATE_DIR" ] || STATE_DIR="$HOME/.local/share/nodehub-agent"; LOCAL_CUR="$(cat "$STATE_DIR/current-version" 2>/dev/null || echo 0)"; RESP="$(curl -sS --max-time 12 -w '\\nHTTP_STATUS:%{http_code}' -H "X-Node-Token: $NODE_TOKEN" "$API_BASE/agent/reconcile?node_id=$NODE_ID&current_version=$LOCAL_CUR" 2>&1)"; RC=$?; if [ "$RC" -ne 0 ]; then echo "PULL: FAIL (reconcile 请求失败)"; echo "reason=$(printf '%s' "$RESP" | tail -n 1)"; echo "last_error=$(cat "$STATE_DIR/last-error.log" 2>/dev/null || echo -)"; tail -n 60 "$STATE_DIR/reconcile.log" 2>/dev/null || true; exit 1; fi; HTTP="$(printf '%s\\n' "$RESP" | sed -n 's/^HTTP_STATUS://p' | tail -n 1)"; BODY="$(printf '%s\\n' "$RESP" | sed '/^HTTP_STATUS:/d')"; TARGET="$(printf '%s' "$BODY" | tr -d '\\n' | sed -n 's/.*"target_version":\\([0-9][0-9]*\\).*/\\1/p')"; NEEDS="$(printf '%s' "$BODY" | tr -d '\\n' | sed -n 's/.*"needs_update":\\(true\\|false\\).*/\\1/p')"; if [ "$HTTP" != "200" ] || ! printf '%s' "$BODY" | grep -q '"success":true'; then echo "PULL: FAIL (http=$HTTP)"; echo "body=$(printf '%s' "$BODY" | tr -d '\\n' | cut -c 1-260)"; echo "last_error=$(cat "$STATE_DIR/last-error.log" 2>/dev/null || echo -)"; tail -n 60 "$STATE_DIR/reconcile.log" 2>/dev/null || true; exit 1; fi; if [ -z "$TARGET" ]; then echo "PULL: FAIL (返回缺少 target_version)"; echo "body=$(printf '%s' "$BODY" | tr -d '\\n' | cut -c 1-260)"; exit 1; fi; if [ "$NEEDS" = "true" ]; then echo "PULL: OK (已拉到新版本信息 target=$TARGET local=$LOCAL_CUR)"; else echo "PULL: OK (已是最新 target=$TARGET local=$LOCAL_CUR)"; fi; if [ "$LOCAL_CUR" -ge "$TARGET" ]; then echo "APPLY: OK (current=$LOCAL_CUR target=$TARGET)"; else echo "APPLY: FAIL (current=$LOCAL_CUR < target=$TARGET)"; echo "reason=$(cat "$STATE_DIR/last-error.log" 2>/dev/null || echo -)"; LOG_REASON="$(grep -E 'apply failed|E_[A-Z_]+' "$STATE_DIR/reconcile.log" 2>/dev/null | tail -n 1 || true)"; [ -n "$LOG_REASON" ] && echo "reconcile_log=$LOG_REASON"; fi`,
  })

  commands.push({
    title: '入口域名与回源连通性',
    copyLabel: '入口连通命令',
    command: `ENTRY_CDN=${entryCdn}; ENTRY_DIRECT=${entryDirect}; ENTRY_IP=${entryIp}; for host in "$ENTRY_CDN" "$ENTRY_DIRECT"; do [ -n "$host" ] || continue; echo "== $host =="; (getent ahosts "$host" 2>/dev/null || nslookup "$host" 2>/dev/null || host "$host" 2>/dev/null || true) | head -n 6; done; if [ -n "$ENTRY_CDN" ] && [ -n "$ENTRY_IP" ]; then curl -kI --connect-timeout 8 --resolve "$ENTRY_CDN:443:$ENTRY_IP" "https://$ENTRY_CDN" || true; fi`,
  })

  if (node.install_warp) {
    commands.push({
      title: 'WARP 状态排查',
      copyLabel: 'WARP 排查命令',
      command: "for C in warp-go ip; do command -v \"$C\" >/dev/null 2>&1 && \"$C\" --version 2>/dev/null | head -n 1 || true; done; pgrep -fa 'warp-go|wireguard|wg' || true; ip -6 addr show 2>/dev/null | sed -n '1,80p'",
    })
  }

  if (node.install_argo) {
    commands.push({
      title: 'Argo 隧道排查',
      copyLabel: 'Argo 排查命令',
      command: "command -v cloudflared >/dev/null 2>&1 && cloudflared --version || true; pgrep -fa cloudflared || true; [ -f /var/lib/nodehub-agent/cloudflared.pid ] && cat /var/lib/nodehub-agent/cloudflared.pid || true; [ -f \"$HOME/.local/share/nodehub-agent/cloudflared.pid\" ] && cat \"$HOME/.local/share/nodehub-agent/cloudflared.pid\" || true",
    })
  }

  return commands
}

function formatWarpReserved(value: number[] | null | undefined): string {
  if (!Array.isArray(value) || value.length === 0) return '-'
  const nums = value.map((item) => Number(item)).filter((item) => Number.isFinite(item))
  return nums.length > 0 ? nums.join(',') : '-'
}

async function runBatchDelete(): Promise<void> {
  const ids = [...selected.value]
  if (ids.length === 0) return

  const results = await Promise.allSettled(ids.map((id) => deleteNode(id)))
  const successCount = results.filter((item) => item.status === 'fulfilled').length
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

function formatDiskSummary(node: NodeRecord): string {
  if (node.disk_used_gb === null || node.disk_total_gb === null || node.disk_usage_percent === null) {
    return '-'
  }
  return `${node.disk_used_gb.toFixed(1)} / ${node.disk_total_gb.toFixed(1)} GB (${node.disk_usage_percent.toFixed(1)}%)`
}

function toSafePercent(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

function metricRingStyle(value: number | null): Record<string, string> {
  return { '--metric-progress': `${toSafePercent(value).toFixed(1)}%` }
}

function metricPercentText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '--'
  return `${value.toFixed(2)}%`
}

function detailInstallGroup(node: NodeRecord): InstallGroup {
  return resolveInstallGroup(node)
}

function installGroupLabel(node: NodeRecord): string {
  const mode = detailInstallGroup(node)
  if (mode === 'public_ip') return '有公网 IP'
  if (mode === 'no_public_ip') return '无公网 IP'
  return 'none（不重复安装）'
}

function engineStatusClass(status: string): 'success' | 'warning' | 'danger' {
  if (status === 'running') return 'success'
  if (status === 'stopped') return 'warning'
  return 'danger'
}

function engineStatusText(status: string): string {
  if (status === 'running') return 'running'
  if (status === 'stopped') return 'stoping'
  return '未安装'
}

function engineVersionText(version: string, status: string): string {
  if (status === 'not_installed') return '---'
  return version || '---'
}

function appliedTemplatesText(node: NodeRecord): string {
  if (!Array.isArray(node.applied_template_ids) || node.applied_template_ids.length === 0) return '-'
  const names = node.applied_template_ids
    .map((id) => templateNameMap.value.get(id))
    .filter((item): item is string => Boolean(item))
  return names.length > 0 ? names.join(', ') : '-'
}

function releaseVersion(node: NodeRecord): number {
  const targetRev = Number(node.target_artifact?.rev || 0)
  if (Number.isFinite(targetRev) && targetRev > 0) return Math.floor(targetRev)
  const version = Number(node.target_version || 0)
  return Number.isFinite(version) && version > 0 ? Math.floor(version) : 0
}

function releaseVersionText(node: NodeRecord): string {
  const rev = releaseVersion(node)
  return rev > 0 ? `r${rev}` : '-'
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

function openReleaseStatus(node: NodeRecord): void {
  releaseStatusNode.value = node
  releaseStatusOpen.value = true
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
        <th>协议应用</th>
        <th>在线</th>
        <th>发布版本</th>
        <th>应用状态</th>
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
        <td class="muted" style="max-width: 220px">{{ appliedTemplatesText(node) }}</td>
        <td>
          <span class="badge" :class="node.online ? 'success' : 'warning'">
            {{ node.online ? '在线' : '离线' }}
          </span>
        </td>
        <td>{{ releaseVersionText(node) }}</td>
        <td>
          <button
            class="badge"
            :class="releaseStatusClass(node)"
            style="border: none; cursor: pointer; padding: 4px 10px"
            @click="openReleaseStatus(node)"
          >
            {{ releaseStatusText(node) }}
          </button>
        </td>
        <td>{{ formatRelative(node.last_seen_at) }}</td>
        <td>
          <div style="display: flex; gap: 6px">
            <button class="btn btn-secondary" @click="openDetail(node.id)">详情</button>
            <button class="btn btn-primary" @click="startPublish(node)">协议发布</button>
            <button class="btn btn-secondary" @click="startEdit(node)">编辑</button>
          </div>
        </td>
      </tr>
      <tr v-if="!loading && filteredRows.length === 0">
        <td colspan="10" class="muted">没有匹配节点</td>
      </tr>
    </tbody>
  </DataGrid>

  <DetailDrawer v-model="detailOpen" title="节点详情">
    <template v-if="detailNode">
      <div><strong>{{ detailNode.name }}</strong></div>
      <div class="muted">{{ detailNode.id }}</div>
      <div style="margin-top: 12px; font-weight: 600; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px">心跳上报</div>
      <div class="metric-ring-grid">
        <div class="metric-ring-card">
          <div class="metric-ring cpu" :style="metricRingStyle(detailNode.cpu_usage_percent)">
            <div class="metric-ring-label">CPU</div>
            <div class="metric-ring-percent">{{ metricPercentText(detailNode.cpu_usage_percent) }}</div>
          </div>
          <div class="metric-ring-title">{{ metricPercentText(detailNode.cpu_usage_percent) }}</div>
        </div>
        <div class="metric-ring-card">
          <div class="metric-ring memory" :style="metricRingStyle(detailNode.memory_usage_percent)">
            <div class="metric-ring-label">内存</div>
            <div class="metric-ring-percent">{{ metricPercentText(detailNode.memory_usage_percent) }}</div>
          </div>
          <div class="metric-ring-title">{{ detailNode.memory_used_mb?.toFixed(2) || '--' }} MB / {{ detailNode.memory_total_mb?.toFixed(2) || '--' }} MB</div>
        </div>
        <div class="metric-ring-card">
          <div class="metric-ring disk" :style="metricRingStyle(detailNode.disk_usage_percent)">
            <div class="metric-ring-label">存储</div>
            <div class="metric-ring-percent">{{ metricPercentText(detailNode.disk_usage_percent) }}</div>
          </div>
          <div class="metric-ring-title">{{ detailNode.disk_used_gb?.toFixed(2) || '--' }} GB / {{ detailNode.disk_total_gb?.toFixed(2) || '--' }} GB</div>
        </div>
      </div>
      <div>部署信息：{{ detailNode.deploy_info || '-' }}</div>
      <div>最近错误：{{ detailNode.last_heartbeat_error || '-' }}</div>
      <div>资源上报：{{ formatRelative(detailNode.heartbeat_reported_at) }}</div>
      <div>
        sing-box：{{ engineVersionText(detailNode.sing_box_version, detailNode.sing_box_status) }}
        <span class="badge" :class="engineStatusClass(detailNode.sing_box_status)">
          {{ engineStatusText(detailNode.sing_box_status) }}
        </span>
      </div>
      <div>
        xray：{{ engineVersionText(detailNode.xray_version, detailNode.xray_status) }}
        <span class="badge" :class="engineStatusClass(detailNode.xray_status)">
          {{ engineStatusText(detailNode.xray_status) }}
        </span>
      </div>
      <div>
        WARP 安装：{{ detailNode.install_warp ? '已启用' : '未启用' }}
      </div>
      <div>
        WARP 状态：
        <span class="badge" :class="detailNode.warp_status ? 'success' : 'warning'">{{ detailNode.warp_status || '未注册' }}</span>
      </div>
      <div>WARP IPv6：{{ detailNode.warp_v6 || '-' }}</div>
      <div>WARP Endpoint：{{ detailNode.warp_endpoint || '-' }}</div>
      <div>WARP Reserved：{{ formatWarpReserved(detailNode.warp_reserved) }}</div>
      <div>
        Argo 安装：{{ detailNode.install_argo ? '已启用' : '未启用' }}
      </div>
      <div>
        Argo 状态：
        <span class="badge" :class="detailNode.argo_status === 'running' ? 'success' : (detailNode.argo_status ? 'warning' : 'danger')">
          {{ detailNode.argo_status || '未安装' }}
        </span>
      </div>
      <div>Argo 临时域名：{{ detailNode.argo_temp_domain || '-' }}</div>

      <div style="margin-top: 12px; font-weight: 600; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px">版本应用状态</div>
      <div>
        应用状态：
        <span class="badge" :class="releaseStatusClass(detailNode)">{{ releaseStatusText(detailNode) }}</span>
      </div>
      <div>应用回执：{{ detailNode.last_release_message || '-' }}</div>
      <div>失败代码：{{ detailNode.last_release_error_code || '-' }}</div>

      <div style="margin-top: 12px; font-weight: 600; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px">节点配置</div>
      <div>名称：{{ detailNode.name }}</div>
      <div>Node Token：{{ detailNode.token || '-' }}</div>
      <div>类型：{{ detailNode.node_type }}</div>
      <div>区域：{{ detailNode.region || '-' }}</div>
      <div>标签：{{ (detailNode.tags && detailNode.tags.length > 0) ? detailNode.tags.join(', ') : '-' }}</div>
      <div>安装分组模式：{{ installGroupLabel(detailNode) }}</div>
      <div>GitHub 镜像：{{ detailNode.github_mirror || '-' }}</div>
      <div>WARP License：{{ detailNode.warp_license || '-' }}</div>
      <template v-if="detailInstallGroup(detailNode) === 'public_ip'">
        <div>证书安装：{{ detailNode.install_cert ? '已启用' : '未启用' }}</div>
        <div>入口 CDN：{{ detailNode.entry_cdn || '-' }}</div>
        <div>入口 Direct：{{ detailNode.entry_direct || '-' }}</div>
        <div>入口 IP：{{ detailNode.entry_ip || '-' }}</div>
        <div>Cloudflare Token：{{ detailNode.cf_api_token || '-' }}</div>
      </template>
      <template v-else-if="detailInstallGroup(detailNode) === 'no_public_ip'">
        <div>Argo 隧道类型：{{ detailNode.install_argo ? (detailNode.argo_token ? '固定隧道' : '临时隧道') : '-' }}</div>
        <div>Argo Token：{{ detailNode.argo_token || '-' }}</div>
        <div>Argo 固定域名：{{ detailNode.argo_domain || '-' }}</div>
      </template>
      <template v-else-if="detailInstallGroup(detailNode) === 'none'">
        <div class="muted">none 模式：跳过证书和 Argo 的重复安装。</div>
      </template>
      <template v-if="detailInstallCommand">
        <div class="muted" style="margin-top: 16px; font-weight: 600">VPS 安装命令</div>
        <textarea class="textarea" readonly :value="detailInstallCommand" style="min-height: 80px" />
        <button class="btn btn-secondary" @click="copyValue(detailInstallCommand, '安装命令')">复制安装命令</button>
      </template>
      <template v-if="detailUninstallCommand">
        <div class="muted" style="margin-top: 16px; font-weight: 600">VPS 卸载命令</div>
        <textarea class="textarea" readonly :value="detailUninstallCommand" style="min-height: 60px" />
        <button class="btn btn-danger" @click="copyValue(detailUninstallCommand, '卸载命令')">复制卸载命令</button>
        <div class="muted" style="margin-top: 8px; font-size: 12px">
          此命令会完全卸载 Agent 并删除所有相关文件（包括 xray/sing-box 和证书）
        </div>
      </template>
      <template v-if="detailTroubleshootCommands.length > 0">
        <div class="muted" style="margin-top: 16px; font-weight: 600">Agent 故障排查命令</div>
        <template v-for="item in detailTroubleshootCommands" :key="item.title">
          <div class="muted" style="margin-top: 10px; font-size: 12px">{{ item.title }}</div>
          <textarea class="textarea" readonly :value="item.command" style="min-height: 72px" />
          <button class="btn btn-secondary" @click="copyValue(item.command, item.copyLabel)">复制{{ item.title }}</button>
        </template>
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
      <select v-model="form.node_type" class="select" :disabled="editorMode === 'edit'">
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
      GitHub 镜像 (可选)
      <input v-model="form.github_mirror" class="input" placeholder="用于 vps 下载 github 文件" />
    </label>

    <div style="margin-top: 16px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px">
      <div style="font-weight: 700; margin-bottom: 10px">安装分组</div>
      <label>
        选择安装模式
        <select v-model="installGroup" class="select">
          <option value="public_ip">有公网 IP</option>
          <option value="no_public_ip">无公网 IP</option>
          <option value="none">none（不重复安装）</option>
        </select>
      </label>
      <div class="muted" style="font-size: 12px; margin-top: 6px">
        有公网 IP：入口域名 + 入口 IP + 证书安装；无公网 IP：Argo 隧道；none：跳过重复安装。
      </div>
      <template v-if="installGroup === 'public_ip'">
        <label>
          入口 CDN 域名
          <input v-model="form.entry_cdn" class="input" />
        </label>
        <label>
          入口 Direct 域名
          <input v-model="form.entry_direct" class="input" />
        </label>
        <label>
          入口 IP
          <input v-model="form.entry_ip" class="input" />
        </label>
        <label>
          Cloudflare API Token (可选)
          <input v-model="form.cf_api_token" class="input" placeholder="用于申请 CF 证书" />
        </label>
        <div class="muted" style="font-size: 12px">
          此分组会自动启用证书安装（acme.sh / lego）。
        </div>
      </template>
      <template v-else-if="installGroup === 'no_public_ip'">
        <label>
          Tunnel Token (可选)
          <input v-model="form.argo_token" class="input" placeholder="固定隧道 Token，留空使用临时隧道" />
        </label>
        <label>
          域名 (可选)
          <input v-model="form.argo_domain" class="input" placeholder="固定隧道域名" />
        </label>
        <div class="muted" style="font-size: 12px">
          此分组会自动启用 Argo（cloudflared）隧道安装。
        </div>
      </template>
      <template v-else>
        <div class="muted" style="font-size: 12px">
          当前为 none 分组：将跳过证书和 Argo 的重复安装。
        </div>
      </template>
    </div>

    <div style="margin-top: 16px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px">
      <div style="font-weight: 700; margin-bottom: 10px">WARP 出口</div>
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px">
        <input type="checkbox" v-model="form.install_warp" />
        <span>安装 WARP（warp-go）</span>
      </label>
      <template v-if="form.install_warp">
        <label>
          WARP+ License Key (可选)
          <input v-model="form.warp_license" class="input" placeholder="Agent 安装时自动注册并上报密钥" />
        </label>
      </template>
      <div class="muted" style="font-size: 12px">
        勾选后安装命令包含 --install-warp；可选填写 License 升级 WARP+。在模板编辑器中勾选"WARP 出口"启用路由。
      </div>
    </div>

    <div class="muted" style="margin-bottom: 8px; margin-top: 12px">协议模板请在节点列表的"协议发布"中单独操作。WARP 出口在模板编辑器中启用。</div>

    <button class="btn btn-primary" @click="saveNode">保存</button>
  </DetailDrawer>

  <DetailDrawer v-model="publishOpen" title="协议发布">
    <template v-if="publishNode">
      <div><strong>{{ publishNode.name }}</strong></div>
      <div class="muted">{{ publishNode.id }}</div>
      <div class="muted" style="margin: 8px 0 10px">发布后会生成新版本配置，节点会通过 reconcile 自动拉取。</div>

      <section class="panel panel-pad" style="display: grid; gap: 10px; margin-bottom: 10px">
        <div style="font-weight: 700">选择协议模板</div>
        <div v-if="publishAvailableTemplates.length === 0" class="muted">该节点类型暂无可用模板</div>
        <label
          v-for="template in publishAvailableTemplates"
          :key="template.id"
          style="display: flex; align-items: center; gap: 8px"
        >
          <input
            type="checkbox"
            :checked="publishTemplateIds.includes(template.id)"
            @change="togglePublishTemplate(template.id)"
          />
          <span>{{ template.name }}</span>
          <span class="muted" style="font-size: 12px">({{ template.engine }} / {{ template.protocol }})</span>
        </label>
      </section>

      <div class="muted" style="margin-bottom: 10px">当前已发布：{{ appliedTemplatesText(publishNode) }}</div>
      <button
        class="btn btn-primary"
        :disabled="publishing || publishPreviewLoading || (publishPreview ? !publishPreview.publishable : false)"
        @click="publishTemplatesForNode"
      >
        {{ publishing ? '发布中...' : '发布版本' }}
      </button>

      <section class="panel panel-pad" style="display: grid; gap: 10px; margin-top: 12px">
        <div style="font-weight: 700">发布版本预览</div>

        <div v-if="publishPreviewLoading" class="muted">正在生成预览...</div>
        <div v-else-if="publishPreviewError" class="muted">{{ publishPreviewError }}</div>
        <template v-else-if="publishPreview">
          <div class="muted">目标版本：r{{ publishPreview.next_version }}</div>
          <div
            v-if="!publishPreview.publishable"
            style="padding: 8px 10px; border-radius: 8px; background: rgba(180, 35, 24, 0.08); color: #b42318"
          >
            {{ publishPreview.publish_message || '当前选择无法直接发布' }}
          </div>

          <div v-if="publishPreview.previews.length === 0" class="muted">未选择模板，发布后将清空协议配置。</div>
          <section
            v-for="preview in publishPreview.previews"
            :key="`${preview.engine}-${preview.config_name}`"
            class="panel panel-pad"
            style="display: grid; gap: 8px"
          >
            <div style="display: flex; justify-content: space-between; gap: 8px; align-items: baseline">
              <strong>{{ preview.engine }}</strong>
              <span class="muted">r{{ preview.rev }} / {{ preview.config_name }}</span>
            </div>
            <div class="muted">模板：{{ preview.template_names.join(', ') || '-' }}</div>
            <textarea
              class="textarea"
              readonly
              :value="preview.config_text"
              style="min-height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
            />
          </section>
        </template>
        <div v-else class="muted">请先选择协议模板</div>
      </section>
    </template>
    <div v-else class="muted">请选择节点</div>
  </DetailDrawer>

  <DetailDrawer v-model="releaseStatusOpen" title="协议应用回执">
    <template v-if="releaseStatusNode">
      <div><strong>{{ releaseStatusNode.name }}</strong></div>
      <div class="muted">{{ releaseStatusNode.id }}</div>
      <div>发布版本：{{ releaseVersionText(releaseStatusNode) }}</div>
      <div>
        状态：
        <span class="badge" :class="releaseStatusClass(releaseStatusNode)">{{ releaseStatusText(releaseStatusNode) }}</span>
      </div>
      <div>错误码：{{ releaseStatusNode.last_release_error_code || '-' }}</div>
      <div class="muted" style="font-weight: 600">日志 / 原因</div>
      <textarea class="textarea" readonly :value="releaseStatusNode.last_release_message || '-'" style="min-height: 200px" />
    </template>
    <div v-else class="muted">暂无回执</div>
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
