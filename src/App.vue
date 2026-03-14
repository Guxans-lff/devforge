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
  const settingsStore = useSettingsStore()
  const workspaceStore = useWorkspaceStore()
  const connectionStore = useConnectionStore()

  // 1. 从 SQLite 恢复设置（首次自动迁移 localStorage）
  await settingsStore.restoreState()
  settingsStore.enableAutoSave()
  // 恢复后立即应用字体大小
  applyUiFontSize(settingsStore.settings.uiFontSize)

  // 2. 初始化智能数据路径（如果是随行搬迁模式）
  await settingsStore.initializeDataPath()

  // 3. 加载连接列表
  await connectionStore.loadConnections()

  // 4. 恢复工作区状态（SQLite，首次自动迁移 localStorage）
  await workspaceStore.restoreState()
  workspaceStore.enableAutoSave()

  // 5. 全部就绪后显示窗口，彻底解决白屏闪烁
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    // 给 Vue 渲染渲染最后一帧留一点缓冲时间
    setTimeout(() => {
      invoke('show_main_window')
    }, 100)
  } catch (e) {
    console.error('Failed to show window:', e)
  }
})
</script>

<template>
  <RouterView />
</template>
