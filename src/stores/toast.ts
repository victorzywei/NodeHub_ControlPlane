import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface ToastItem {
  id: number
  title: string
  tone: ToastTone
}

let seed = 1

export const useToastStore = defineStore('toast', () => {
  const items = ref<ToastItem[]>([])

  function push(title: string, tone: ToastTone = 'info'): void {
    const item: ToastItem = {
      id: seed++,
      title,
      tone,
    }
    items.value.unshift(item)
    window.setTimeout(() => remove(item.id), 2600)
  }

  function remove(id: number): void {
    items.value = items.value.filter((item) => item.id !== id)
  }

  return { items, push, remove }
})
