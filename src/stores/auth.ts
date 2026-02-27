import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

const STORAGE_KEY = 'nodehub_admin_key'
const SKIP_AUTH =
  import.meta.env.MODE === 'development' &&
  (import.meta.env.VITE_SKIP_AUTH === '1' || import.meta.env.VITE_SKIP_AUTH === 'true')
const PREVIEW_ADMIN_KEY = 'preview-admin-key'

export const useAuthStore = defineStore('auth', () => {
  const adminKey = ref('')

  const isAuthenticated = computed(() => SKIP_AUTH || adminKey.value.trim().length > 0)

  function hydrateFromStorage(): void {
    if (SKIP_AUTH) {
      adminKey.value = PREVIEW_ADMIN_KEY
      window.sessionStorage.setItem(STORAGE_KEY, PREVIEW_ADMIN_KEY)
      return
    }

    if (adminKey.value) return
    const stored = window.sessionStorage.getItem(STORAGE_KEY) || ''
    adminKey.value = stored
  }

  function setAdminKey(key: string): void {
    adminKey.value = key.trim()
    if (adminKey.value) {
      window.sessionStorage.setItem(STORAGE_KEY, adminKey.value)
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY)
    }
  }

  function clearAdminKey(): void {
    adminKey.value = ''
    window.sessionStorage.removeItem(STORAGE_KEY)
  }

  return {
    adminKey,
    isAuthenticated,
    hydrateFromStorage,
    setAdminKey,
    clearAdminKey,
  }
})
