<script setup lang="ts">
/**
 * 截图工具主视图
 * Dashboard 模式：截图操作按钮 + 历史网格
 * Editor 模式：标注编辑器
 * RegionSelect 模式：全屏覆盖框选
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useScreenshot } from '@/composables/useScreenshot'
import ScreenshotToolbar from '@/components/screenshot/ScreenshotToolbar.vue'
import ScreenshotHistory from '@/components/screenshot/ScreenshotHistory.vue'
import ScreenshotEditor from '@/components/screenshot/ScreenshotEditor.vue'
import RegionSelectOverlay from '@/components/screenshot/RegionSelectOverlay.vue'
import DelayCountdown from '@/components/screenshot/DelayCountdown.vue'
import type { CaptureResult } from '@/types/screenshot'

const screenshot = useScreenshot()

/** 是否显示区域框选覆盖层 */
const showRegionSelect = ref(false)

/** 监听全局快捷键截图事件，自动刷新历史 */
let unlistenCapture: UnlistenFn | null = null

onMounted(async () => {
  screenshot.init()
  unlistenCapture = await listen('global-screenshot-captured', () => {
    screenshot.refreshHistory()
  })
})

onUnmounted(() => {
  unlistenCapture?.()
})

/** 打开区域框选 */
function openRegionSelect() {
  showRegionSelect.value = true
}

/** 区域选区确认（兼容旧接口） */
function onRegionConfirm(monitorId: number, x: number, y: number, w: number, h: number) {
  showRegionSelect.value = false
  screenshot.captureRegion(monitorId, x, y, w, h)
}

/** 全屏截图（从 RegionSelectOverlay 直接确认） */
function onRegionFullscreen(result: CaptureResult) {
  showRegionSelect.value = false
  screenshot.currentCapture.value = result
  screenshot.mode.value = 'editor'
  screenshot.refreshHistory()
}

/** 取消区域框选 */
function onRegionCancel() {
  showRegionSelect.value = false
}

/** 标注完成后关闭覆盖层 */
function onRegionClose() {
  showRegionSelect.value = false
  screenshot.refreshHistory()
}

/** 从浮动工具栏打开编辑器 */
function onOpenEditor(capture: CaptureResult) {
  showRegionSelect.value = false
  screenshot.currentCapture.value = capture
  screenshot.mode.value = 'editor'
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Dashboard 模式 -->
    <template v-if="screenshot.mode.value === 'dashboard'">
      <!-- 截图操作栏 -->
      <ScreenshotToolbar
        :monitors="screenshot.monitors.value"
        :capturing="screenshot.capturing.value"
        @capture-fullscreen="screenshot.captureFullscreen"
        @capture-region="screenshot.captureRegion"
        @capture-window="screenshot.captureWindow"
        @open-region-select="openRegionSelect"
        @delay-capture="screenshot.startDelayedCapture"
      />

      <!-- 历史网格 -->
      <ScreenshotHistory
        :items="screenshot.historyList.value"
        :loading="screenshot.loading.value"
        class="flex-1 min-h-0"
        @open="screenshot.openInEditor"
        @delete="screenshot.deleteScreenshot"
        @cleanup="screenshot.cleanupOld"
        @copy="(item) => {
          screenshot.currentCapture.value = {
            filePath: item.filePath,
            width: item.width,
            height: item.height,
            captureId: item.id,
            capturedAt: item.capturedAt,
          }
          screenshot.copyToClipboard()
        }"
      />
    </template>

    <!-- Editor 模式 -->
    <ScreenshotEditor
      v-else-if="screenshot.currentCapture.value"
      :capture="screenshot.currentCapture.value"
      @back="screenshot.backToDashboard"
      @save="screenshot.saveAnnotated"
      @copy="screenshot.copyAnnotatedToClipboard"
      @save-original="screenshot.saveToFile"
      @copy-original="screenshot.copyToClipboard"
      @pin="screenshot.pinToScreen"
    />

    <!-- 区域框选覆盖层（Teleport 到 body，覆盖整个屏幕） -->
    <Teleport to="body">
      <RegionSelectOverlay
        v-if="showRegionSelect"
        @confirm="onRegionConfirm"
        @cancel="onRegionCancel"
        @fullscreen="onRegionFullscreen"
        @close="onRegionClose"
        @open-editor="onOpenEditor"
      />
    </Teleport>

    <!-- 延迟截图倒计时 -->
    <DelayCountdown
      v-if="screenshot.isDelaying.value"
      :seconds="screenshot.delaySeconds.value"
      @done="screenshot.onDelayDone"
      @cancel="screenshot.cancelDelay"
    />
  </div>
</template>
