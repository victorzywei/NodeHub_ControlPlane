<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

interface NavItem {
  name: string
  label: string
  to: string
}

const navItems: NavItem[] = [
  { name: 'overview', label: '总览', to: '/overview' },
  { name: 'nodes', label: '节点', to: '/nodes' },
  { name: 'templates', label: '配置模板', to: '/templates' },
  { name: 'release', label: '发布中心', to: '/release' },
  { name: 'subscriptions', label: '订阅', to: '/subscriptions' },
  { name: 'system', label: '系统', to: '/system' },
]

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const mobileOpen = ref(false)
const pageTitle = computed(() => String(route.meta.title || 'NodeHub'))

function isActive(name: string): boolean {
  return route.name === name
}

function navigate(path: string): void {
  mobileOpen.value = false
  router.push(path)
}

function logout(): void {
  authStore.clearAdminKey()
  mobileOpen.value = false
  router.push('/login')
}
</script>

<template>
  <div class="app-shell">
    <aside class="shell-sidebar">
      <div class="shell-brand">
        <div class="shell-brand-badge">N</div>
        <div>
          <div style="font-weight: 800">NodeHub</div>
          <div class="muted" style="font-size: 12px">Modern Control Plane</div>
        </div>
      </div>

      <div class="shell-nav-title">导航</div>
      <nav>
        <a
          v-for="item in navItems"
          :key="item.name"
          class="shell-nav-link"
          :class="{ active: isActive(item.name) }"
          href="#"
          @click.prevent="navigate(item.to)"
        >
          {{ item.label }}
        </a>
      </nav>

      <div style="margin-top: auto; padding-top: 12px">
        <button class="btn btn-secondary" style="width: 100%" @click="logout">退出登录</button>
      </div>
    </aside>

    <div class="shell-main">
      <header class="shell-topbar">
        <div style="display: flex; gap: 10px; align-items: center">
          <button class="btn btn-secondary mobile-only" @click="mobileOpen = true">菜单</button>
          <h1>{{ pageTitle }}</h1>
        </div>
        <div class="muted" style="font-size: 13px">{{ new Date().toLocaleDateString('zh-CN') }}</div>
      </header>

      <main class="shell-content">
        <slot />
      </main>
    </div>

    <Teleport to="body">
      <div v-if="mobileOpen" class="drawer-mask" @click="mobileOpen = false" />
      <aside v-if="mobileOpen" class="drawer" style="width: min(320px, 92vw); height: 100vh; top: 0; bottom: auto; border-radius: 0">
        <div class="drawer-header">
          <strong>导航</strong>
          <button class="btn btn-secondary" @click="mobileOpen = false">关闭</button>
        </div>
        <div class="drawer-body" style="display: block">
          <a
            v-for="item in navItems"
            :key="item.name"
            href="#"
            class="shell-nav-link"
            :class="{ active: isActive(item.name) }"
            @click.prevent="navigate(item.to)"
          >
            {{ item.label }}
          </a>
          <button class="btn btn-danger" style="width: 100%; margin-top: 14px" @click="logout">退出登录</button>
        </div>
      </aside>
    </Teleport>
  </div>
</template>
