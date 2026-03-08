<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useTheme } from '@/composables/useTheme'
import { useWorkspaceStore } from '@/stores/workspace'
import { useConnectionStore } from '@/stores/connections'
import { useSettingsStore } from '@/stores/settings'
import { startPerformanceMonitoring } from '@/composables/usePerformance'

// 初始化主题
useTheme()

// 全局 UI 字体大小响应：监听设置变化，实时应用到 document 根元素
const settingsStore = useSettingsStore()

function applyUiFontSize(size: number) {
  document.documentElement.style.fontSize = `${size}px`
}

// 立即应用当前值
applyUiFontSize(settingsStore.settings.uiFontSize)

// 监听后续变化
watch(
  () => settingsStore.settings.uiFontSize,
  (size) => applyUiFontSize(size),
)

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
