<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: string
  label?: string
  hint?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const normalizedLabel = computed(() => props.label || '参数 JSON')
</script>

<template>
  <label style="display: grid; gap: 6px">
    <span style="font-weight: 700">{{ normalizedLabel }}</span>
    <textarea
      class="textarea"
      :value="props.modelValue"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />
    <span v-if="props.hint" class="muted" style="font-size: 12px">{{ props.hint }}</span>
  </label>
</template>
