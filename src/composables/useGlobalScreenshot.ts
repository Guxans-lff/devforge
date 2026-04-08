/**
 * 全局截图快捷键事件监听
 * 监听 Rust 侧全局快捷键触发的截图事件（Ctrl+Shift+A / Ctrl+Shift+X）
 *
 * Ctrl+Shift+A → 创建独立全屏窗口进行区域截图（Snipaste 风格）
 * Ctrl+Shift+X → 打开截图工作区标签页
 */
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useToast } from '@/composables/useToast'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18n } from 'vue-i18n'
import type { CaptureResult } from '@/types/screenshot'

/** 防重入标志 */
let regionSelectBusy = false

/** 存储所有事件监听的取消函数 */
const unlisteners: Array<() => void> = []

/**
 * 初始化全局截图事件监听
 * 应在 App.vue setup 中调用一次
 */
export function useGlobalScreenshot() {
  const toast = useToast()
  const workspace = useWorkspaceStore()
  const { t } = useI18n()

  // Ctrl+Shift+A → 全屏截图完成，创建独立窗口进行区域选择
  listen<CaptureResult>('global-screenshot-region-start', async (event) => {
    const { filePath, width, height, captureId, capturedAt } = event.payload
    if (regionSelectBusy) return
    regionSelectBusy = true

    const mainWin = getCurrentWindow()

    try {
      const query = new URLSearchParams({
        filePath,
        width: String(width),
        height: String(height),
        captureId,
        capturedAt,
      }).toString()

      const regionWin = new WebviewWindow('region-select', {
        url: `/region-select?${query}`,
        fullscreen: true,
        decorations: false,
        alwaysOnTop: true,
        transparent: false,
        skipTaskbar: true,
        visible: true,
        title: '',
      })

      regionWin.once('tauri://error', (e) => {
        console.error('[GlobalScreenshot] 窗口创建失败:', e)
        regionSelectBusy = false
        mainWin.show()
      })

      regionWin.once('tauri://destroyed', () => {
        regionSelectBusy = false
        mainWin.show()
      })
    } catch (e) {
      console.error('[GlobalScreenshot] 创建窗口异常:', e)
      regionSelectBusy = false
      mainWin.show()
    }
  }).then((fn) => unlisteners.push(fn))

  // 监听区域截图窗口"打开编辑器"跨窗口事件
  listen<CaptureResult>('region-select-open-editor', async (event) => {
    const mainWin = getCurrentWindow()
    await mainWin.show()
    await mainWin.setFocus()

    workspace.addTab({
      id: 'screenshot',
      type: 'screenshot',
      title: t('sidebar.screenshot'),
      closable: true,
      meta: { initialCapture: JSON.stringify(event.payload) },
    })
  }).then((fn) => unlisteners.push(fn))

  // 截图失败
  listen<string>('global-screenshot-error', (event) => {
    toast.error(t('screenshot.message.captureFailed'), event.payload)
  }).then((fn) => unlisteners.push(fn))

  // Ctrl+Shift+X → 打开截图工作区
  listen('global-screenshot-open', async () => {
    const win = getCurrentWindow()
    await win.show()
    await win.setFocus()
    workspace.addTab({
      id: 'screenshot',
      type: 'screenshot',
      title: t('tab.screenshot'),
      closable: true,
    })
  }).then((fn) => unlisteners.push(fn))
}

/**
 * 清理所有全局截图事件监听
 * 应在应用卸载时调用
 */
export function cleanupGlobalScreenshot() {
  unlisteners.forEach((fn) => fn())
  unlisteners.length = 0
}
