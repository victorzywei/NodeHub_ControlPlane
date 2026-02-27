<script setup lang="ts">
defineProps<{
  steps: string[]
  activeIndex: number
}>()
</script>

<template>
  <div class="stepper">
    <div
      v-for="(step, index) in steps"
      :key="step"
      class="step-item"
      :class="{
        active: index === activeIndex,
        done: index < activeIndex,
      }"
    >
      {{ index + 1 }}. {{ step }}
    </div>
  </div>
</template>
