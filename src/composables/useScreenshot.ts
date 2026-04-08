/**
 * 截图工作流 composable
 * 管理截图模式切换、截图/保存/复制/历史 CRUD
 */
import { ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import type {
  MonitorInfo,
  CaptureResult,
  ScreenshotHistoryItem,
  EditorMode,
} from '@/types/screenshot'
import {
  screenshotListMonitors,
  screenshotCaptureFullscreen,
  screenshotCaptureRegion,
  screenshotCaptureWindow,
  screenshotSaveToFile,
  screenshotSaveAnnotated,
  screenshotCopyToClipboard,
  screenshotCopyAnnotatedToClipboard,
  screenshotListHistory,
  screenshotDelete,
  screenshotCleanup,
} from '@/api/screenshot'

export function useScreenshot() {
  const { t } = useI18n()
  const toast = useToast()

  // ── 状态 ──────────────────────────────────────────────────────

  /** 当前视图模式 */
  const mode = ref<EditorMode>('dashboard')

  /** 当前截图结果（进入编辑器时设置） */
  const currentCapture = shallowRef<CaptureResult | null>(null)

  /** 截图历史列表 */
  const historyList = shallowRef<ScreenshotHistoryItem[]>([])

  /** 显示器列表 */
  const monitors = shallowRef<MonitorInfo[]>([])

  /** 加载状态 */
  const loading = ref(false)

  /** 正在截图中 */
  const capturing = ref(false)

  // ── 初始化 ─────────────────────────────────────────────────────

  /** 加载显示器列表和截图历史 */
  async function init() {
    loading.value = true
    try {
      const [m, h] = await Promise.all([
        screenshotListMonitors(),
        screenshotListHistory(),
      ])
      monitors.value = m
      historyList.value = h
    } catch (e) {
      toast.error(t('screenshot.message.captureFailed'), String(e))
    } finally {
      loading.value = false
    }
  }

  /** 刷新历史列表 */
  async function refreshHistory() {
    try {
      historyList.value = await screenshotListHistory()
    } catch (e) {
      toast.error(t('screenshot.message.captureFailed'), String(e))
    }
  }

  // ── 截图操作 ──────────────────────────────────────────────────

  /** 全屏截图 */
  async function captureFullscreen(monitorId?: number) {
    capturing.value = true
    try {
      const result = await screenshotCaptureFullscreen(monitorId)
      currentCapture.value = result
      mode.value = 'editor'
      toast.success(t('screenshot.message.captureSuccess'))
      await refreshHistory()
    } catch (e) {
      toast.error(t('screenshot.message.captureFailed'), String(e))
    } finally {
      capturing.value = false
    }
  }

  /** 区域截图 — 通过 RegionSelectOverlay 窗口完成选区后调用 */
  async function captureRegion(
    monitorId: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    capturing.value = true
    try {
      const result = await screenshotCaptureRegion(monitorId, x, y, width, height)
      currentCapture.value = result
      mode.value = 'editor'
      toast.success(t('screenshot.message.captureSuccess'))
      await refreshHistory()
    } catch (e) {
      toast.error(t('screenshot.message.captureFailed'), String(e))
    } finally {
      capturing.value = false
    }
  }

  /** 窗口截图 */
  async function captureWindow(windowTitle: string) {
    capturing.value = true
    try {
      const result = await screenshotCaptureWindow(windowTitle)
      currentCapture.value = result
      mode.value = 'editor'
      toast.success(t('screenshot.message.captureSuccess'))
      await refreshHistory()
    } catch (e) {
      toast.error(t('screenshot.message.captureFailed'), String(e))
    } finally {
      capturing.value = false
    }
  }

  // ── 保存/复制 ─────────────────────────────────────────────────

  /** 保存原始截图到指定路径 */
  async function saveToFile(destPath: string) {
    if (!currentCapture.value) return
    try {
      await screenshotSaveToFile(currentCapture.value.filePath, destPath)
      toast.success(t('screenshot.message.saveSuccess'))
    } catch (e) {
      toast.error(t('screenshot.message.saveFailed'), String(e))
    }
  }

  /** 保存标注后的图片 */
  async function saveAnnotated(pngBase64: string, destPath: string) {
    try {
      await screenshotSaveAnnotated(pngBase64, destPath)
      toast.success(t('screenshot.message.saveSuccess'))
    } catch (e) {
      toast.error(t('screenshot.message.saveFailed'), String(e))
    }
  }

  /** 复制原始截图到剪贴板 */
  async function copyToClipboard() {
    if (!currentCapture.value) return
    try {
      await screenshotCopyToClipboard(currentCapture.value.filePath)
      toast.success(t('screenshot.message.copySuccess'))
    } catch (e) {
      toast.error(t('screenshot.message.copyFailed'), String(e))
    }
  }

  /** 复制标注后的图片到剪贴板 */
  async function copyAnnotatedToClipboard(pngBase64: string) {
    try {
      await screenshotCopyAnnotatedToClipboard(pngBase64)
      toast.success(t('screenshot.message.copySuccess'))
    } catch (e) {
      toast.error(t('screenshot.message.copyFailed'), String(e))
    }
  }

  // ── 历史管理 ──────────────────────────────────────────────────

  /** 删除一条截图记录 */
  async function deleteScreenshot(id: string) {
    try {
      await screenshotDelete(id)
      toast.success(t('screenshot.message.deleteSuccess'))
      await refreshHistory()
    } catch (e) {
      toast.error(t('screenshot.message.captureFailed'), String(e))
    }
  }

  /** 清理旧截图 */
  async function cleanupOld(days?: number) {
    try {
      const count = await screenshotCleanup(days)
      toast.success(t('screenshot.history.cleanupDone', { count }))
      await refreshHistory()
    } catch (e) {
      toast.error(t('screenshot.message.captureFailed'), String(e))
    }
  }

  /** 打开历史截图到编辑器 */
  function openInEditor(item: ScreenshotHistoryItem) {
    currentCapture.value = {
      filePath: item.filePath,
      width: item.width,
      height: item.height,
      captureId: item.id,
      capturedAt: item.capturedAt,
    }
    mode.value = 'editor'
  }

  /** 返回面板模式 */
  function backToDashboard() {
    mode.value = 'dashboard'
    currentCapture.value = null
    void refreshHistory()
  }

  // ── 贴图 (Pin to Screen) ───────────────────────────────────────

  /** 将当前截图/标注结果贴到屏幕上 */
  async function pinToScreen(filePath: string, width: number, height: number) {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      const pinId = `pin-${Date.now()}`

      // 限制贴图窗口最大尺寸
      const maxW = Math.min(width, 800)
      const maxH = Math.min(height, 600)
      const scale = Math.min(maxW / width, maxH / height, 1)
      const winW = Math.round(width * scale)
      const winH = Math.round(height * scale)

      const pinWindow = new WebviewWindow(pinId, {
        url: `/pin?filePath=${encodeURIComponent(filePath)}&width=${width}&height=${height}`,
        width: winW,
        height: winH,
        decorations: false,
        alwaysOnTop: true,
        transparent: false,
        resizable: true,
        skipTaskbar: true,
        title: '贴图',
      })

      pinWindow.once('tauri://error', (e) => {
        toast.error('贴图窗口创建失败', typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload))
      })
    } catch (e) {
      toast.error('贴图窗口创建失败', e instanceof Error ? e.message : JSON.stringify(e))
    }
  }

  // ── 延迟截图 ──────────────────────────────────────────────────

  /** 延迟截图状态 */
  const delaySeconds = ref(0)
  const isDelaying = ref(false)

  /** 设置延迟截图 */
  function startDelayedCapture(seconds: number) {
    delaySeconds.value = seconds
    isDelaying.value = true
  }

  /** 延迟结束，执行截图 */
  async function onDelayDone() {
    isDelaying.value = false
    delaySeconds.value = 0
    await captureFullscreen()
  }

  /** 取消延迟截图 */
  function cancelDelay() {
    isDelaying.value = false
    delaySeconds.value = 0
  }

  return {
    // 状态
    mode,
    currentCapture,
    historyList,
    monitors,
    loading,
    capturing,
    // 延迟截图状态
    delaySeconds,
    isDelaying,
    // 初始化
    init,
    refreshHistory,
    // 截图
    captureFullscreen,
    captureRegion,
    captureWindow,
    // 保存/复制
    saveToFile,
    saveAnnotated,
    copyToClipboard,
    copyAnnotatedToClipboard,
    // 历史
    deleteScreenshot,
    cleanupOld,
    openInEditor,
    backToDashboard,
    // 贴图
    pinToScreen,
    // 延迟截图
    startDelayedCapture,
    onDelayDone,
    cancelDelay,
  }
}
