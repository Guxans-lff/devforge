<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useTheme } from '@/composables/useTheme'
import { useWorkspaceStore } from '@/stores/workspace'
import { useConnectionStore } from '@/stores/connections'
import { useSettingsStore } from '@/stores/settings'
import { startPerformanceMonitoring } from '@/composables/usePerformance'
import { useUpdater } from '@/composables/useUpdater'
import { useGlobalScreenshot, cleanupGlobalScreenshot } from '@/composables/useGlobalScreenshot'
import { cleanupGlobalErrorHandler } from '@/composables/useGlobalErrorHandler'
import UpdateNotification from '@/components/layout/UpdateNotification.vue'

/** 当前窗口标签（main / pin-xxx / region-select） */
const currentWindowLabel = getCurrentWindow().label
const isMainWindow = currentWindowLabel === 'main'
if (import.meta.env.DEV) console.log('[App.vue] 窗口标签:', currentWindowLabel, '是否主窗口:', isMainWindow)

// 以下初始化仅在主窗口执行
const { initScheduler } = useTheme()
const { initUpdater, destroyUpdater } = useUpdater()

if (isMainWindow) {
  useGlobalScreenshot()
}

// 全局 UI 字体大小响应：监听设置变化，实时应用到 document 根元素
const settingsStore = useSettingsStore()

function applyUiFontSize(size: number) {
  document.documentElement.style.fontSize = `${size}px`
}

async function showMainWindow() {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    console.info('[Startup] 准备显示主窗口')
    setTimeout(() => {
      void invoke('show_main_window').catch((e) => {
        console.error('[Startup] 显示主窗口失败:', e)
      })
    }, 100)
  } catch (e) {
    console.error('[Startup] 显示主窗口失败:', e)
  }
}

async function restoreStartupState() {
  const settingsStore = useSettingsStore()
  const workspaceStore = useWorkspaceStore()
  const connectionStore = useConnectionStore()

  try {
    console.info('[Startup] 开始恢复设置')
    await settingsStore.restoreState()
    settingsStore.enableAutoSave()
    applyUiFontSize(settingsStore.settings.uiFontSize)
    initScheduler()
    console.info('[Startup] 设置恢复完成')
  } catch (e) {
    console.error('[Startup] 恢复设置失败:', e)
  }

  try {
    console.info('[Startup] 开始初始化数据路径')
    await settingsStore.initializeDataPath()
    console.info('[Startup] 数据路径初始化完成')
  } catch (e) {
    console.error('[Startup] 初始化数据路径失败:', e)
  }

  try {
    console.info('[Startup] 开始加载连接列表')
    await connectionStore.loadConnections()
    console.info('[Startup] 连接列表加载完成')
  } catch (e) {
    console.error('[Startup] 加载连接列表失败:', e)
  }

  try {
    console.info('[Startup] 开始恢复工作区')
    await workspaceStore.restoreState()
    workspaceStore.enableAutoSave()
    console.info('[Startup] 工作区恢复完成')
  } catch (e) {
    console.error('[Startup] 恢复工作区失败:', e)
  }
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

// 仅主窗口执行启动恢复和初始化
onMounted(() => {
  if (isMainWindow) {
    console.info('[Startup] App mounted')
    void showMainWindow()
    void restoreStartupState()
    initUpdater()
  }
})

onUnmounted(() => {
  if (isMainWindow) {
    cleanupGlobalScreenshot()
    cleanupGlobalErrorHandler()
    destroyUpdater()
  }
})
</script>

<template>
  <RouterView />
  <UpdateNotification />
</template>
