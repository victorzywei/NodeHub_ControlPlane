<script setup lang="ts">
defineProps<{
  title?: string
}>()
</script>

<template>
  <section class="panel panel-pad">
    <div v-if="title" style="margin-bottom: 12px; font-weight: 700">{{ title }}</div>
    <div class="table-wrap">
      <table class="table">
        <slot />
      </table>
    </div>
  </section>
</template>
