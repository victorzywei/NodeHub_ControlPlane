import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const LoginPage = () => import('@/pages/auth/LoginPage.vue')
const OverviewPage = () => import('@/pages/overview/OverviewPage.vue')
const NodesPage = () => import('@/pages/nodes/NodesPage.vue')
const TemplatesPage = () => import('@/pages/templates/TemplatesPage.vue')
const ReleaseCenterPage = () => import('@/pages/release/ReleaseCenterPage.vue')
const SubscriptionsPage = () => import('@/pages/subscriptions/SubscriptionsPage.vue')
const SystemPage = () => import('@/pages/system/SystemPage.vue')

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/overview' },
    { path: '/login', name: 'login', component: LoginPage, meta: { guest: true, title: '登录' } },
    { path: '/overview', name: 'overview', component: OverviewPage, meta: { title: '总览' } },
    { path: '/nodes', name: 'nodes', component: NodesPage, meta: { title: '节点' } },
    { path: '/templates', name: 'templates', component: TemplatesPage, meta: { title: '配置模板' } },
    { path: '/release', name: 'release', component: ReleaseCenterPage, meta: { title: '发布中心' } },
    { path: '/subscriptions', name: 'subscriptions', component: SubscriptionsPage, meta: { title: '订阅' } },
    { path: '/system', name: 'system', component: SystemPage, meta: { title: '系统' } },
  ],
})

router.beforeEach((to) => {
  const authStore = useAuthStore()
  authStore.hydrateFromStorage()

  if (!to.meta.guest && !authStore.isAuthenticated) {
    return { name: 'login' }
  }

  if (to.name === 'login' && authStore.isAuthenticated) {
    return { name: 'overview' }
  }

  return true
})
