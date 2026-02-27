<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'confirm'): void
}>()

function close(): void {
  emit('update:modelValue', false)
}

function confirm(): void {
  emit('confirm')
  close()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.modelValue" class="dialog-mask" @click="close">
      <section class="dialog" @click.stop>
        <h3 style="margin: 0">{{ props.title }}</h3>
        <p class="muted" style="margin: 10px 0 14px">{{ props.message }}</p>
        <div style="display: flex; justify-content: flex-end; gap: 8px">
          <button class="btn btn-secondary" @click="close">取消</button>
          <button class="btn" :class="props.danger ? 'btn-danger' : 'btn-primary'" @click="confirm">
            {{ props.confirmLabel || '确认' }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
