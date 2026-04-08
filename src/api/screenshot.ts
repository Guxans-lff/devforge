import { invokeCommand } from '@/api/base'
import type {
  MonitorInfo,
  WindowInfo,
  CaptureResult,
  ScreenshotHistoryItem,
} from '@/types/screenshot'
import type { AiConfig } from '@/types/ai'

// ── 显示器 ─────────────────────────────────────────────────────

/** 枚举所有显示器 */
export function screenshotListMonitors(): Promise<MonitorInfo[]> {
  return invokeCommand<MonitorInfo[]>('screenshot_list_monitors', {}, { source: 'SYSTEM' })
}

// ── 窗口 ──────────────────────────────────────────────────────

/** 获取所有可见窗口信息 */
export function screenshotListWindows(): Promise<WindowInfo[]> {
  return invokeCommand<WindowInfo[]>('screenshot_list_windows', {}, { source: 'SYSTEM' })
}

// ── 截图 ──────────────────────────────────────────────────────

/** 全屏截图 */
export function screenshotCaptureFullscreen(monitorId?: number): Promise<CaptureResult> {
  return invokeCommand<CaptureResult>(
    'screenshot_capture_fullscreen',
    { monitorId: monitorId ?? null },
    { source: 'SYSTEM' },
  )
}

/** 区域截图 */
export function screenshotCaptureRegion(
  monitorId: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<CaptureResult> {
  return invokeCommand<CaptureResult>(
    'screenshot_capture_region',
    { monitorId, x, y, width, height },
    { source: 'SYSTEM' },
  )
}

/** 从已有截图文件裁剪区域（不重新截屏） */
export function screenshotCropRegion(
  sourcePath: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<CaptureResult> {
  return invokeCommand<CaptureResult>(
    'screenshot_crop_region',
    { sourcePath, x, y, width, height },
    { source: 'SYSTEM' },
  )
}

/** 窗口截图 */
export function screenshotCaptureWindow(windowTitle: string): Promise<CaptureResult> {
  return invokeCommand<CaptureResult>(
    'screenshot_capture_window',
    { windowTitle },
    { source: 'SYSTEM' },
  )
}

// ── 保存/剪贴板 ──────────────────────────────────────────────

/** 保存截图到指定路径 */
export function screenshotSaveToFile(sourcePath: string, destPath: string): Promise<void> {
  return invokeCommand('screenshot_save_to_file', { sourcePath, destPath }, { source: 'SYSTEM' })
}

/** 保存标注后的图片到文件 */
export function screenshotSaveAnnotated(pngBase64: string, destPath: string): Promise<void> {
  return invokeCommand('screenshot_save_annotated', { pngBase64, destPath }, { source: 'SYSTEM' })
}

/** 复制截图到剪贴板 */
export function screenshotCopyToClipboard(sourcePath: string): Promise<void> {
  return invokeCommand('screenshot_copy_to_clipboard', { sourcePath }, { source: 'SYSTEM' })
}

/** 复制标注后的图片到剪贴板 */
export function screenshotCopyAnnotatedToClipboard(pngBase64: string): Promise<void> {
  return invokeCommand(
    'screenshot_copy_annotated_to_clipboard',
    { pngBase64 },
    { source: 'SYSTEM' },
  )
}

// ── 历史管理 ──────────────────────────────────────────────────

/** 列出截图历史 */
export function screenshotListHistory(): Promise<ScreenshotHistoryItem[]> {
  return invokeCommand<ScreenshotHistoryItem[]>(
    'screenshot_list_history',
    {},
    { source: 'SYSTEM' },
  )
}

/** 删除截图 */
export function screenshotDelete(id: string): Promise<void> {
  return invokeCommand('screenshot_delete', { id }, { source: 'SYSTEM' })
}

/** 清理旧截图 */
export function screenshotCleanup(days?: number): Promise<number> {
  return invokeCommand<number>(
    'screenshot_cleanup',
    { days: days ?? null },
    { source: 'SYSTEM' },
  )
}

// ── 翻译 ────────────────────────────────────────────────────────

/** 调用 LLM API 翻译文本 */
export function screenshotTranslate(
  text: string,
  sourceLang: string,
  targetLang: string,
  apiConfig: AiConfig,
  apiKey: string,
): Promise<string> {
  return invokeCommand<string>(
    'screenshot_translate',
    { text, sourceLang, targetLang, apiConfig, apiKey },
    { source: 'SYSTEM' },
  )
}
