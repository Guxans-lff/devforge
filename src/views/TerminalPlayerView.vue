<script setup lang="ts">
import TerminalPlayer from '@/components/terminal/TerminalPlayer.vue'

defineProps<{
  filePath: string
}>()
</script>

<template>
  <div class="h-full">
    <TerminalPlayer :file-path="filePath" />
  </div>
</template>
