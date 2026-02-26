<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue?: number
  max?: number
}>()

const percentage = computed(() => {
  const value = props.modelValue ?? 0
  const max = props.max ?? 100
  return Math.min(100, Math.max(0, (value / max) * 100))
})
</script>

<template>
  <div class="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
    <div
      class="h-full bg-primary transition-all duration-300 ease-in-out"
      :style="{ width: `${percentage}%` }"
    />
  </div>
</template>
