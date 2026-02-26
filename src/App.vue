<script setup lang="ts">
import { useTheme } from '@/composables/useTheme'

// Initialize dark theme
useTheme()
</script>

<template>
  <RouterView />
</template>
