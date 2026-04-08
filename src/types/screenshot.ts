/** 显示器信息 */
export interface MonitorInfo {
  id: number
  name: string
  x: number
  y: number
  width: number
  height: number
  isPrimary: boolean
  scaleFactor: number
}

/** 窗口信息（用于智能吸附） */
export interface WindowInfo {
  title: string
  appName: string
  x: number
  y: number
  width: number
  height: number
  isMinimized: boolean
}

/** 截图结果 */
export interface CaptureResult {
  filePath: string
  width: number
  height: number
  captureId: string
  capturedAt: string
}

/** 截图历史记录项 */
export interface ScreenshotHistoryItem {
  id: string
  filePath: string
  width: number
  height: number
  fileSize: number
  capturedAt: string
}

// ── 标注相关类型 ──────────────────────────────────────────────

/** 标注工具类型 */
export type AnnotationTool =
  | 'arrow'
  | 'rectangle'
  | 'ellipse'
  | 'text'
  | 'mosaic'
  | 'blur'
  | 'freehand'
  | 'highlight'
  | 'counter'

/** 标注样式 */
export interface AnnotationStyle {
  color: string
  strokeWidth: number
  fontSize?: number
  opacity?: number
  filled?: boolean
}

/** 点坐标 */
export interface Point {
  x: number
  y: number
}

/** 标注数据 */
export interface Annotation {
  id: string
  tool: AnnotationTool
  style: AnnotationStyle
  /** 关键点集合（箭头/画笔/高亮用） */
  points: Point[]
  /** 文字内容（文字工具用） */
  text?: string
  /** 矩形区域（矩形/椭圆/马赛克/模糊用） */
  rect?: { x: number; y: number; w: number; h: number }
  /** 序号值（序号标注用） */
  counterValue?: number
}

/** 截图模式 */
export type CaptureMode = 'fullscreen' | 'region' | 'window'

/** 编辑器模式 */
export type EditorMode = 'dashboard' | 'editor'
