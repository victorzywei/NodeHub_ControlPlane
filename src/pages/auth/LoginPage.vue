<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { login } from '@/api/services/auth'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { ApiRequestError } from '@/api/request'

const router = useRouter()
const authStore = useAuthStore()
const toastStore = useToastStore()

const adminKey = ref('')
const pending = ref(false)

async function submit(): Promise<void> {
  if (!adminKey.value.trim() || pending.value) return
  pending.value = true
  try {
    await login(adminKey.value)
    authStore.setAdminKey(adminKey.value)
    toastStore.push('登录成功', 'success')
    router.push('/overview')
  } catch (error) {
    const message = error instanceof ApiRequestError ? error.message : '登录失败'
    toastStore.push(message, 'danger')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <main style="min-height: 100vh; display: grid; place-items: center; padding: 18px">
    <section class="panel panel-pad" style="width: min(420px, 100%)">
      <div style="text-align: center; margin-bottom: 20px">
        <div class="shell-brand-badge" style="margin: 0 auto 12px">N</div>
        <h1 style="margin: 0; font-size: 24px">NodeHub Modern</h1>
        <p class="muted" style="margin-top: 6px">输入 Admin Key 进入控制台</p>
      </div>

      <form @submit.prevent="submit" style="display: grid; gap: 10px">
        <label for="adminKey" style="font-weight: 700">Admin Key</label>
        <input id="adminKey" v-model="adminKey" type="password" class="input" autocomplete="off" />
        <button class="btn btn-primary" type="submit" :disabled="pending || !adminKey.trim()">
          {{ pending ? '验证中...' : '登录' }}
        </button>
      </form>
    </section>
  </main>
</template>
