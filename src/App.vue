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
import { createLogger } from '@/utils/logger'
import UpdateNotification from '@/components/layout/UpdateNotification.vue'

/** 当前窗口标签（main / pin-xxx / region-select） */
const currentWindowLabel = getCurrentWindow().label
const isMainWindow = currentWindowLabel === 'main'
const log = createLogger('app.startup')
if (import.meta.env.DEV) {
  log.debug('window_label', { label: currentWindowLabel, isMainWindow })
}

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
    log.info('show_main_window_prepare')
    setTimeout(() => {
      void invoke('show_main_window').catch((e) => {
        log.error('show_main_window_failed', undefined, e)
      })
    }, 100)
  } catch (e) {
    log.error('show_main_window_failed', undefined, e)
  }
}

async function restoreStartupState() {
  const workspaceStore = useWorkspaceStore()
  const connectionStore = useConnectionStore()

  try {
    log.info('restore_settings_start')
    await settingsStore.restoreState()
    settingsStore.enableAutoSave()
    applyUiFontSize(settingsStore.settings.uiFontSize)
    initScheduler()
    log.info('restore_settings_done')
  } catch (e) {
    log.error('restore_settings_failed', undefined, e)
  }

  try {
    log.info('initialize_data_path_start')
    await settingsStore.initializeDataPath()
    log.info('initialize_data_path_done')
  } catch (e) {
    log.error('initialize_data_path_failed', undefined, e)
  }

  try {
    log.info('load_connections_start')
    await connectionStore.loadConnections()
    log.info('load_connections_done')
  } catch (e) {
    log.error('load_connections_failed', undefined, e)
  }

  try {
    log.info('restore_workspace_start')
    await workspaceStore.restoreState()
    workspaceStore.enableAutoSave()
    log.info('restore_workspace_done')
  } catch (e) {
    log.error('restore_workspace_failed', undefined, e)
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
    log.info('app_mounted')
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
