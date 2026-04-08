<script setup lang="ts">
/**
 * 区域截图独立窗口
 *
 * 独立的全屏无边框窗口，用于 Snipaste 风格截图体验。
 * 通过 URL query 接收截图参数（和 PinWindow 一样，简单可靠无竞态）。
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { emit as tauriEmit } from '@tauri-apps/api/event'
import RegionSelectOverlay from '@/components/screenshot/RegionSelectOverlay.vue'
import type { CaptureResult } from '@/types/screenshot'

const route = useRoute()

/** 从 URL query 直接读取截图参数 */
const preCaptured = computed<CaptureResult | null>(() => {
  const filePath = String(route.query.filePath || '')
  if (!filePath) return null
  return {
    filePath,
    width: Number(route.query.width) || 0,
    height: Number(route.query.height) || 0,
    captureId: String(route.query.captureId || ''),
    capturedAt: String(route.query.capturedAt || ''),
  }
})
const overlayVisible = ref(false)
const debugStatus = ref('初始化中...')

onMounted(() => {
  if (import.meta.env.DEV) console.log('[RegionSelect] onMounted, query:', route.query)
  if (preCaptured.value) {
    debugStatus.value = `截图数据就绪: ${preCaptured.value.filePath}`
    overlayVisible.value = true
  } else {
    debugStatus.value = '未收到截图参数，3秒后关闭'
    setTimeout(async () => {
      const win = getCurrentWindow()
      try { await win.destroy() } catch { await win.close() }
    }, 3000)
  }
})

/** 关闭窗口 */
async function destroyWindow() {
  overlayVisible.value = false
  const win = getCurrentWindow()
  try {
    await win.destroy()
  } catch {
    await win.close()
  }
}

/** Canvas 渲染就绪 */
async function onReady() {
  debugStatus.value = 'Canvas 渲染完成'
}

/** 取消/ESC → 关闭窗口 */
function onCancel() {
  destroyWindow()
}

/** 标注完成（复制到剪贴板后） → 关闭窗口 */
function onClose() {
  destroyWindow()
}

/** 打开编辑器 → 通知主窗口 → 延迟关闭自身 */
async function onOpenEditor(capture: CaptureResult) {
  await tauriEmit('region-select-open-editor', capture)
  setTimeout(() => destroyWindow(), 100)
}
</script>

<template>
  <div class="w-screen h-screen overflow-hidden bg-black">
    <RegionSelectOverlay
      v-if="overlayVisible && preCaptured"
      :pre-captured="preCaptured"
      @ready="onReady"
      @cancel="onCancel"
      @close="onClose"
      @open-editor="onOpenEditor"
    />
    <!-- 等待数据时显示状态（调试用，可直接看到窗口加载到哪一步了） -->
    <div v-else class="flex h-full items-center justify-center flex-col gap-4">
      <div class="text-white/50 text-sm animate-pulse">{{ debugStatus }}</div>
    </div>
  </div>
</template>
