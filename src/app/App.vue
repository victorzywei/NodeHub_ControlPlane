<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import ToastStack from '@/components/ui/ToastStack.vue'

const route = useRoute()
const isGuestRoute = computed(() => route.meta.guest === true)
</script>

<template>
  <RouterView v-slot="{ Component }">
    <component :is="Component" v-if="isGuestRoute" />
    <AppShell v-else>
      <component :is="Component" />
    </AppShell>
  </RouterView>
  <ToastStack />
</template>
