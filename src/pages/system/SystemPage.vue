<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { getSystemStatus } from '@/api/services/system'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import type { SystemStatus } from '@/types/domain'

const authStore = useAuthStore()
const toastStore = useToastStore()
const router = useRouter()

const status = ref<SystemStatus | null>(null)
const confirmClearKey = ref(false)

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
