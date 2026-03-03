<script setup lang="ts">
import { onMounted } from 'vue'
import { useTheme } from '@/composables/useTheme'
import { useWorkspaceStore } from '@/stores/workspace'
import { useConnectionStore } from '@/stores/connections'
import { startPerformanceMonitoring } from '@/composables/usePerformance'

// Initialize dark theme
useTheme()

// 启动性能监控
if (import.meta.env.DEV) {
  startPerformanceMonitoring()
}

// 应用启动时恢复工作区状态
onMounted(async () => {
  const workspaceStore = useWorkspaceStore()
  const connectionStore = useConnectionStore()

  // 先加载连接列表
  await connectionStore.loadConnections()

  // 然后尝试恢复工作区状态
  const snapshot = workspaceStore.loadSnapshot()
  if (snapshot) {
    workspaceStore.restoreSnapshot(snapshot)
  }
})
</script>

<template>
  <RouterView />
</template>
