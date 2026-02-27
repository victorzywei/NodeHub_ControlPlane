<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean
  title: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.modelValue" class="drawer-mask" @click="close" />
    <aside v-if="props.modelValue" class="drawer" role="dialog" aria-modal="true">
      <header class="drawer-header">
        <strong>{{ props.title }}</strong>
        <button class="btn btn-secondary" @click="close">关闭</button>
      </header>
      <div class="drawer-body">
        <slot />
      </div>
    </aside>
  </Teleport>
</template>
