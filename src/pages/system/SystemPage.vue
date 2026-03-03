<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { cleanupTemplateRefs, getSystemStatus } from '@/api/services/system'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import type { SystemStatus, TemplateRefCleanupResult } from '@/types/domain'

const authStore = useAuthStore()
const toastStore = useToastStore()
const router = useRouter()

const status = ref<SystemStatus | null>(null)
const confirmClearKey = ref(false)
const cleanupRunning = ref(false)
const cleanupResult = ref<TemplateRefCleanupResult | null>(null)
const cleanupError = ref('')

async function load(): Promise<void> {
  try {
    status.value = await getSystemStatus()
  } catch {
    toastStore.push('系统状态加载失败', 'danger')
  }
}

function maskedKey(): string {
  const raw = authStore.adminKey
  if (!raw) return '-'
  if (raw.length <= 6) return `${raw[0] || ''}***`
  return `${raw.slice(0, 3)}***${raw.slice(-3)}`
}

function clearKeyAndLogout(): void {
  authStore.clearAdminKey()
  toastStore.push('Admin Key 已清除', 'success')
  router.push('/login')
}

async function runCleanup(dryRun: boolean): Promise<void> {
  cleanupRunning.value = true
  cleanupError.value = ''
  try {
    const result = await cleanupTemplateRefs(dryRun)
    cleanupResult.value = result
    if (dryRun) {
      toastStore.push(`预检完成：受影响节点 ${result.changed_nodes}，待移除引用 ${result.removed_template_refs}`, 'success')
    } else {
      toastStore.push(`清理完成：已更新节点 ${result.updated_nodes}，移除引用 ${result.removed_template_refs}`, 'success')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '模板引用清理失败'
    cleanupError.value = message
    toastStore.push(message, 'danger')
  } finally {
    cleanupRunning.value = false
  }
}

onMounted(load)
</script>

<template>
  <section style="display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))">
    <article class="panel panel-pad" style="display: grid; gap: 8px">
      <h3 style="margin: 0">Admin Key</h3>
      <div>当前会话：{{ maskedKey() }}</div>
      <div class="muted">Key 仅保存在浏览器 Session Storage。</div>
    </article>

    <article class="panel panel-pad" style="display: grid; gap: 8px">
      <h3 style="margin: 0">KV 状态</h3>
      <div>可用性：{{ status?.kv_available ? '可用' : '不可用' }}</div>
      <div>命名空间：{{ status?.kv_namespace || '-' }}</div>
      <div>时间：{{ status?.now || '-' }}</div>
    </article>

    <article class="panel panel-pad" style="display: grid; gap: 8px">
      <h3 style="margin: 0">版本信息</h3>
      <div>控制台版本：{{ status?.app_version || '-' }}</div>
      <div>运行提示：{{ status?.uptime_hint || '-' }}</div>
    </article>
  </section>

  <section class="panel panel-pad" style="display: grid; gap: 10px">
    <h3 style="margin: 0">模板引用清理</h3>
    <p class="muted" style="margin: 0">清理节点中已删除/不适用/不支持组合的历史模板引用，避免影响发布预览与发布流程。</p>
    <div style="display: flex; gap: 8px; flex-wrap: wrap">
      <button class="btn btn-secondary" :disabled="cleanupRunning" @click="runCleanup(true)">
        {{ cleanupRunning ? '处理中...' : '预检（不落库）' }}
      </button>
      <button class="btn btn-primary" :disabled="cleanupRunning" @click="runCleanup(false)">
        {{ cleanupRunning ? '处理中...' : '执行清理（落库）' }}
      </button>
    </div>
    <div v-if="cleanupError" class="muted" style="color: #b42318">{{ cleanupError }}</div>
    <template v-if="cleanupResult">
      <div>处理节点：{{ cleanupResult.processed_nodes }}</div>
      <div>受影响节点：{{ cleanupResult.changed_nodes }}</div>
      <div>移除引用：{{ cleanupResult.removed_template_refs }}</div>
      <div>实际更新：{{ cleanupResult.updated_nodes }}</div>
      <details v-if="cleanupResult.details.length > 0">
        <summary>查看受影响节点详情（{{ cleanupResult.details.length }}）</summary>
        <div style="display: grid; gap: 8px; margin-top: 8px">
          <article v-for="row in cleanupResult.details" :key="row.node_id" class="panel panel-pad" style="display: grid; gap: 6px">
            <div><strong>{{ row.node_name || row.node_id }}</strong></div>
            <div class="muted">{{ row.node_id }}</div>
            <div>模板引用：{{ row.before_count }} -> {{ row.after_count }}</div>
            <div class="muted">
              移除项：{{ row.removed.map((item) => `${item.template_id}(${item.reason})`).join(', ') || '-' }}
            </div>
          </article>
        </div>
      </details>
    </template>
  </section>

  <section class="panel panel-pad" style="display: grid; gap: 10px">
    <h3 style="margin: 0">危险操作</h3>
    <p class="muted" style="margin: 0">这些操作会影响当前管理会话，请谨慎执行。</p>
    <div style="display: flex; gap: 8px">
      <button class="btn btn-danger" @click="confirmClearKey = true">清除 Admin Key 并退出</button>
    </div>
  </section>

  <ConfirmDialog
    v-model="confirmClearKey"
    title="确认清除 Admin Key"
    message="执行后将立即退出系统，需要重新登录。"
    confirm-label="确认清除"
    danger
    @confirm="clearKeyAndLogout"
  />
</template>
