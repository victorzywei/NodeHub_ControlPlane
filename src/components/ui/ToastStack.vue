<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()
const { items } = storeToRefs(toastStore)
</script>

<template>
  <Teleport to="body">
    <div class="toast-stack">
      <div
        v-for="item in items"
        :key="item.id"
        class="toast"
        :class="item.tone"
      >
        {{ item.title }}
      </div>
    </div>
  </Teleport>
</template>
