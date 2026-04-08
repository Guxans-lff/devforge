/**
 * Canvas 标注引擎 composable
 * 双层 Canvas：底层渲染原始截图，标注层渲染所有标注图形
 * 支持 9 个工具 + 撤销/重做操作栈
 */
import { ref, shallowRef, watch, type Ref, nextTick } from 'vue'
import type {
  Annotation,
  AnnotationTool,
  AnnotationStyle,
  Point,
} from '@/types/screenshot'

/** StackBlur 简化版（用于模糊工具，半径受限避免性能问题） */
// 数组索引访问全部在循环边界内，不会越界
/* eslint-disable @typescript-eslint/no-explicit-any */
function stackBlur(imageData: ImageData, radius: number) {
  const { width, height } = imageData
  // 使用 any 绕过 noUncheckedIndexedAccess — 所有索引均在算法边界内
  const data = imageData.data as any
  if (radius < 1) return
  radius = Math.min(radius, 20) // 限制最大半径

  const wm = width - 1
  const hm = height - 1
  const div = radius + radius + 1
  const r: any[] = new Array(width * height)
  const g: any[] = new Array(width * height)
  const b: any[] = new Array(width * height)

  let rSum: number, gSum: number, bSum: number
  let p: number, p1: number, p2: number
  let yi: number, yw: number

  for (yi = 0, yw = 0; yi < height; yi++, yw += width) {
    rSum = gSum = bSum = 0
    for (let i = -radius; i <= radius; i++) {
      p = (yw + Math.min(wm, Math.max(0, i))) * 4
      rSum += data[p]
      gSum += data[p + 1]
      bSum += data[p + 2]
    }
    for (let x = 0; x < width; x++) {
      r[yw + x] = (rSum / div) | 0
      g[yw + x] = (gSum / div) | 0
      b[yw + x] = (bSum / div) | 0

      p1 = (yw + Math.min(wm, x + radius + 1)) * 4
      p2 = (yw + Math.max(0, x - radius)) * 4
      rSum += data[p1] - data[p2]
      gSum += data[p1 + 1] - data[p2 + 1]
      bSum += data[p1 + 2] - data[p2 + 2]
    }
  }

  for (let x = 0; x < width; x++) {
    rSum = gSum = bSum = 0
    for (let i = -radius; i <= radius; i++) {
      yi = Math.max(0, Math.min(hm, i)) * width + x
      rSum += r[yi]
      gSum += g[yi]
      bSum += b[yi]
    }
    for (let y = 0; y < height; y++) {
      p = (y * width + x) * 4
      data[p] = (rSum / div) | 0
      data[p + 1] = (gSum / div) | 0
      data[p + 2] = (bSum / div) | 0

      p1 = (Math.min(hm, y + radius + 1) * width + x)
      p2 = (Math.max(0, y - radius) * width + x)
      rSum += r[p1] - r[p2]
      gSum += g[p1] - g[p2]
      bSum += b[p1] - b[p2]
    }
  }
}

export interface UseAnnotationCanvasOptions {
  /** 底层 Canvas 元素 */
  baseCanvas: Ref<HTMLCanvasElement | null>
  /** 标注层 Canvas 元素 */
  annotCanvas: Ref<HTMLCanvasElement | null>
  /** 图片源路径 */
  imageSrc: Ref<string>
  /** 图片原始宽高 */
  imageWidth: Ref<number>
  imageHeight: Ref<number>
  /** 当前工具 */
  tool: Ref<AnnotationTool | null>
  /** 当前样式 */
  styleOptions: Ref<AnnotationStyle>
}

export function useAnnotationCanvas(options: UseAnnotationCanvasOptions) {
  const {
    baseCanvas,
    annotCanvas,
    imageSrc,
    imageWidth: _imageWidth,
    imageHeight: _imageHeight,
    tool,
    styleOptions,
  } = options

  // ── 状态 ──────────────────────────────────────────────────────

  /** 所有已确认标注 */
  const annotations = ref<Annotation[]>([])

  /** 操作栈 */
  const undoStack = ref<Annotation[][]>([])
  const redoStack = ref<Annotation[][]>([])

  /** 是否可撤销/重做 */
  const canUndo = ref(false)
  const canRedo = ref(false)

  /** 序号计数器 */
  const counterValue = ref(1)

  /** 加载的图片对象 */
  const baseImage = shallowRef<HTMLImageElement | null>(null)

  // ── 绘制中的临时状态 ──────────────────────────────────────────

  let isDrawing = false
  let drawStart: Point = { x: 0, y: 0 }
  let drawCurrent: Point = { x: 0, y: 0 }
  let freehandPoints: Point[] = []

  /** 文字编辑中的 DOM 元素 */
  let textInput: HTMLDivElement | null = null

  // ── 图片加载 ──────────────────────────────────────────────────

  function loadImage() {
    if (!imageSrc.value) return
    if (import.meta.env.DEV) console.log('[AnnotCanvas] loadImage:', imageSrc.value)
    const img = new Image()
    img.onerror = (e) => console.error('[AnnotCanvas] 图片加载失败:', imageSrc.value, e)
    img.onload = () => {
      if (import.meta.env.DEV) console.log('[AnnotCanvas] 图片加载成功:', img.naturalWidth, 'x', img.naturalHeight)
      baseImage.value = img
      renderBase()
      renderAnnotations()
    }
    img.src = imageSrc.value
  }

  watch(imageSrc, loadImage)

  // ── Canvas 渲染 ───────────────────────────────────────────────

  /** 渲染底层截图 */
  function renderBase() {
    const canvas = baseCanvas.value
    const img = baseImage.value
    if (!canvas || !img) return

    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
  }

  /** 渲染所有标注 + 当前绘制中的图形 */
  function renderAnnotations() {
    const canvas = annotCanvas.value
    if (!canvas) return
    const base = baseCanvas.value
    if (!base) return

    canvas.width = base.width
    canvas.height = base.height
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // 渲染已确认的标注
    for (const ann of annotations.value) {
      drawAnnotation(ctx, ann)
    }

    // 渲染当前正在绘制的临时图形
    if (isDrawing && tool.value) {
      const tempAnnotation = buildTempAnnotation()
      if (tempAnnotation) {
        drawAnnotation(ctx, tempAnnotation)
      }
    }
  }

  /** 构建绘制中的临时标注 */
  function buildTempAnnotation(): Annotation | null {
    const t = tool.value
    if (!t) return null

    const base: Omit<Annotation, 'id'> = {
      tool: t,
      style: { ...styleOptions.value },
      points: [],
    }

    switch (t) {
      case 'arrow':
        return { ...base, id: '__temp__', points: [drawStart, drawCurrent] }
      case 'rectangle':
      case 'ellipse':
      case 'mosaic':
      case 'blur': {
        const rect = pointsToRect(drawStart, drawCurrent)
        return { ...base, id: '__temp__', points: [], rect }
      }
      case 'freehand':
      case 'highlight':
        return { ...base, id: '__temp__', points: [...freehandPoints] }
      default:
        return null
    }
  }

  // ── 标注绘制函数 ─────────────────────────────────────────────

  function drawAnnotation(ctx: CanvasRenderingContext2D, ann: Annotation) {
    ctx.save()
    ctx.strokeStyle = ann.style.color
    ctx.fillStyle = ann.style.color
    ctx.lineWidth = ann.style.strokeWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (ann.style.opacity !== undefined && ann.style.opacity < 1) {
      ctx.globalAlpha = ann.style.opacity
    }

    switch (ann.tool) {
      case 'arrow':
        drawArrow(ctx, ann)
        break
      case 'rectangle':
        drawRect(ctx, ann)
        break
      case 'ellipse':
        drawEllipse(ctx, ann)
        break
      case 'text':
        drawText(ctx, ann)
        break
      case 'mosaic':
        drawMosaic(ctx, ann)
        break
      case 'blur':
        drawBlurArea(ctx, ann)
        break
      case 'freehand':
        drawFreehand(ctx, ann)
        break
      case 'highlight':
        drawHighlight(ctx, ann)
        break
      case 'counter':
        drawCounter(ctx, ann)
        break
    }

    ctx.restore()
  }

  function drawArrow(ctx: CanvasRenderingContext2D, ann: Annotation) {
    if (ann.points.length < 2) return
    const [start, end] = ann.points as [Point, Point]
    const dx = end.x - start.x
    const dy = end.y - start.y
    const angle = Math.atan2(dy, dx)
    const headLen = Math.max(15, ann.style.strokeWidth * 4)

    // 线段
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()

    // 箭头
    ctx.beginPath()
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(
      end.x - headLen * Math.cos(angle - Math.PI / 6),
      end.y - headLen * Math.sin(angle - Math.PI / 6),
    )
    ctx.lineTo(
      end.x - headLen * Math.cos(angle + Math.PI / 6),
      end.y - headLen * Math.sin(angle + Math.PI / 6),
    )
    ctx.closePath()
    ctx.fill()
  }

  function drawRect(ctx: CanvasRenderingContext2D, ann: Annotation) {
    if (!ann.rect) return
    const { x, y, w, h } = ann.rect
    if (ann.style.filled) {
      ctx.fillRect(x, y, w, h)
    } else {
      ctx.strokeRect(x, y, w, h)
    }
  }

  function drawEllipse(ctx: CanvasRenderingContext2D, ann: Annotation) {
    if (!ann.rect) return
    const { x, y, w, h } = ann.rect
    const cx = x + w / 2
    const cy = y + h / 2

    ctx.beginPath()
    ctx.ellipse(cx, cy, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2)
    if (ann.style.filled) {
      ctx.fill()
    } else {
      ctx.stroke()
    }
  }

  function drawText(ctx: CanvasRenderingContext2D, ann: Annotation) {
    if (!ann.text || ann.points.length === 0) return
    const fontSize = ann.style.fontSize ?? 16
    ctx.font = `${fontSize}px sans-serif`
    ctx.textBaseline = 'top'

    const lines = ann.text.split('\n')
    const { x, y } = ann.points[0]!
    lines.forEach((line, i) => {
      ctx.fillText(line, x, y + i * (fontSize * 1.3))
    })
  }

  function drawMosaic(ctx: CanvasRenderingContext2D, ann: Annotation) {
    if (!ann.rect || !baseCanvas.value) return
    const { x, y, w, h } = ann.rect
    if (w === 0 || h === 0) return

    const baseCtx = baseCanvas.value.getContext('2d')!
    const blockSize = Math.max(8, ann.style.strokeWidth * 3)

    // 从底层 Canvas 取像素，像素化处理
    const sx = Math.max(0, Math.round(x))
    const sy = Math.max(0, Math.round(y))
    const sw = Math.min(Math.round(w), baseCanvas.value.width - sx)
    const sh = Math.min(Math.round(h), baseCanvas.value.height - sy)
    if (sw <= 0 || sh <= 0) return

    const imgData = baseCtx.getImageData(sx, sy, sw, sh)

    for (let by = 0; by < sh; by += blockSize) {
      for (let bx = 0; bx < sw; bx += blockSize) {
        // 取块中心像素颜色
        const cx = Math.min(bx + Math.floor(blockSize / 2), sw - 1)
        const cy = Math.min(by + Math.floor(blockSize / 2), sh - 1)
        const idx = (cy * sw + cx) * 4
        const r = imgData.data[idx]
        const g = imgData.data[idx + 1]
        const b = imgData.data[idx + 2]

        ctx.fillStyle = `rgb(${r},${g},${b})`
        ctx.fillRect(
          sx + bx,
          sy + by,
          Math.min(blockSize, sw - bx),
          Math.min(blockSize, sh - by),
        )
      }
    }
  }

  function drawBlurArea(ctx: CanvasRenderingContext2D, ann: Annotation) {
    if (!ann.rect || !baseCanvas.value) return
    const { x, y, w, h } = ann.rect
    if (w === 0 || h === 0) return

    const baseCtx = baseCanvas.value.getContext('2d')!
    const sx = Math.max(0, Math.round(x))
    const sy = Math.max(0, Math.round(y))
    const sw = Math.min(Math.round(w), baseCanvas.value.width - sx)
    const sh = Math.min(Math.round(h), baseCanvas.value.height - sy)
    if (sw <= 0 || sh <= 0) return

    const imgData = baseCtx.getImageData(sx, sy, sw, sh)
    const blurRadius = Math.max(5, ann.style.strokeWidth * 2)
    stackBlur(imgData, blurRadius)
    ctx.putImageData(imgData, sx, sy)
  }

  function drawFreehand(ctx: CanvasRenderingContext2D, ann: Annotation) {
    if (ann.points.length < 2) return
    ctx.beginPath()
    ctx.moveTo(ann.points[0]!.x, ann.points[0]!.y)

    for (let i = 1; i < ann.points.length - 1; i++) {
      const xc = (ann.points[i]!.x + ann.points[i + 1]!.x) / 2
      const yc = (ann.points[i]!.y + ann.points[i + 1]!.y) / 2
      ctx.quadraticCurveTo(ann.points[i]!.x, ann.points[i]!.y, xc, yc)
    }

    const last = ann.points[ann.points.length - 1]!
    ctx.lineTo(last.x, last.y)
    ctx.stroke()
  }

  function drawHighlight(ctx: CanvasRenderingContext2D, ann: Annotation) {
    if (ann.points.length < 2) return
    ctx.save()
    ctx.globalAlpha = 0.3
    ctx.lineWidth = Math.max(20, ann.style.strokeWidth * 6)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    ctx.beginPath()
    ctx.moveTo(ann.points[0]!.x, ann.points[0]!.y)
    for (let i = 1; i < ann.points.length; i++) {
      ctx.lineTo(ann.points[i]!.x, ann.points[i]!.y)
    }
    ctx.stroke()
    ctx.restore()
  }

  function drawCounter(ctx: CanvasRenderingContext2D, ann: Annotation) {
    if (ann.points.length === 0) return
    const { x, y } = ann.points[0]!
    const fontSize = ann.style.fontSize ?? 16
    const radius = fontSize * 0.9

    // 圆形背景
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()

    // 数字（白色）
    ctx.save()
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(ann.counterValue ?? 1), x, y)
    ctx.restore()
  }

  // ── 辅助函数 ──────────────────────────────────────────────────

  function pointsToRect(p1: Point, p2: Point) {
    return {
      x: Math.min(p1.x, p2.x),
      y: Math.min(p1.y, p2.y),
      w: Math.abs(p2.x - p1.x),
      h: Math.abs(p2.y - p1.y),
    }
  }

  function genId(): string {
    return `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  /** 获取 Canvas 内的鼠标坐标（处理缩放） */
  function getCanvasPoint(e: MouseEvent): Point {
    const canvas = annotCanvas.value
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  // ── 鼠标事件处理 ─────────────────────────────────────────────

  function onMouseDown(e: MouseEvent) {
    if (!tool.value) return
    const point = getCanvasPoint(e)
    if (import.meta.env.DEV) console.log('[AnnotCanvas] onMouseDown, tool:', tool.value, 'point:', point)

    // 文字工具：点击创建输入框
    if (tool.value === 'text') {
      createTextInput(point)
      return
    }

    // 序号工具：点击直接放置
    if (tool.value === 'counter') {
      pushAnnotation({
        id: genId(),
        tool: 'counter',
        style: { ...styleOptions.value },
        points: [point],
        counterValue: counterValue.value++,
      })
      return
    }

    isDrawing = true
    drawStart = point
    drawCurrent = point
    freehandPoints = [point]
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDrawing) return
    drawCurrent = getCanvasPoint(e)

    if (tool.value === 'freehand' || tool.value === 'highlight') {
      freehandPoints.push(drawCurrent)
    }

    renderAnnotations()
  }

  function onMouseUp(_e: MouseEvent) {
    if (!isDrawing || !tool.value) return
    isDrawing = false

    const t = tool.value
    const ann: Annotation = {
      id: genId(),
      tool: t,
      style: { ...styleOptions.value },
      points: [],
    }

    switch (t) {
      case 'arrow':
        ann.points = [drawStart, drawCurrent]
        break
      case 'rectangle':
      case 'ellipse':
      case 'mosaic':
      case 'blur':
        ann.rect = pointsToRect(drawStart, drawCurrent)
        // 忽略太小的区域
        if (ann.rect.w < 3 && ann.rect.h < 3) {
          renderAnnotations()
          return
        }
        break
      case 'freehand':
      case 'highlight':
        ann.points = [...freehandPoints]
        if (ann.points.length < 2) {
          renderAnnotations()
          return
        }
        break
      default:
        renderAnnotations()
        return
    }

    pushAnnotation(ann)
  }

  // ── 文字输入 ──────────────────────────────────────────────────

  function createTextInput(point: Point) {
    // 移除旧的输入框
    removeTextInput()

    const canvas = annotCanvas.value
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    const rect = canvas.getBoundingClientRect()
    const scaleX = rect.width / canvas.width
    const scaleY = rect.height / canvas.height

    const div = document.createElement('div')
    div.contentEditable = 'true'
    div.style.cssText = `
      position: absolute;
      left: ${point.x * scaleX}px;
      top: ${point.y * scaleY}px;
      min-width: 50px;
      min-height: 20px;
      padding: 2px 4px;
      font-size: ${(styleOptions.value.fontSize ?? 16) * scaleY}px;
      color: ${styleOptions.value.color};
      background: rgba(255,255,255,0.8);
      border: 1px solid ${styleOptions.value.color};
      outline: none;
      white-space: pre-wrap;
      z-index: 10;
    `

    div.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        removeTextInput()
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        commitTextInput(point)
      }
    })

    div.addEventListener('blur', () => {
      commitTextInput(point)
    })

    parent.style.position = 'relative'
    parent.appendChild(div)
    textInput = div

    nextTick(() => div.focus())
  }

  function commitTextInput(point: Point) {
    if (!textInput) return
    const text = textInput.innerText.trim()
    removeTextInput()

    if (text) {
      pushAnnotation({
        id: genId(),
        tool: 'text',
        style: { ...styleOptions.value },
        points: [point],
        text,
      })
    }
  }

  function removeTextInput() {
    if (textInput && textInput.parentElement) {
      textInput.parentElement.removeChild(textInput)
    }
    textInput = null
  }

  // ── 操作栈 ────────────────────────────────────────────────────

  function pushAnnotation(ann: Annotation) {
    undoStack.value.push([...annotations.value])
    redoStack.value = []
    annotations.value = [...annotations.value, ann]
    updateHistoryState()
    renderAnnotations()
  }

  function undo() {
    if (undoStack.value.length === 0) return
    redoStack.value.push([...annotations.value])
    annotations.value = undoStack.value.pop()!
    updateHistoryState()
    renderAnnotations()
  }

  function redo() {
    if (redoStack.value.length === 0) return
    undoStack.value.push([...annotations.value])
    annotations.value = redoStack.value.pop()!
    updateHistoryState()
    renderAnnotations()
  }

  function clear() {
    if (annotations.value.length === 0) return
    undoStack.value.push([...annotations.value])
    redoStack.value = []
    annotations.value = []
    counterValue.value = 1
    updateHistoryState()
    renderAnnotations()
  }

  function updateHistoryState() {
    canUndo.value = undoStack.value.length > 0
    canRedo.value = redoStack.value.length > 0
  }

  // ── 导出 ──────────────────────────────────────────────────────

  /** 合并底层 + 标注层，导出 base64 PNG */
  function exportBase64(): string | null {
    const base = baseCanvas.value
    const annot = annotCanvas.value
    if (import.meta.env.DEV) console.log('[AnnotCanvas] exportBase64: base=', base?.width, 'x', base?.height, 'annot=', annot?.width, 'x', annot?.height)
    if (!base || !annot) return null

    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = base.width
    exportCanvas.height = base.height
    const ctx = exportCanvas.getContext('2d')!
    ctx.drawImage(base, 0, 0)
    ctx.drawImage(annot, 0, 0)

    // 取 base64（去掉 data:image/png;base64, 前缀）
    const dataUrl = exportCanvas.toDataURL('image/png')
    return dataUrl.replace(/^data:image\/png;base64,/, '')
  }

  /** 导出 Blob */
  function exportBlob(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const base = baseCanvas.value
      const annot = annotCanvas.value
      if (!base || !annot) {
        resolve(null)
        return
      }

      const exportCanvas = document.createElement('canvas')
      exportCanvas.width = base.width
      exportCanvas.height = base.height
      const ctx = exportCanvas.getContext('2d')!
      ctx.drawImage(base, 0, 0)
      ctx.drawImage(annot, 0, 0)

      exportCanvas.toBlob((blob) => resolve(blob), 'image/png')
    })
  }

  return {
    // 状态
    annotations,
    canUndo,
    canRedo,
    counterValue,
    // 操作
    undo,
    redo,
    clear,
    exportBase64,
    exportBlob,
    // Canvas 操作
    loadImage,
    renderBase,
    renderAnnotations,
    // 鼠标事件
    onMouseDown,
    onMouseMove,
    onMouseUp,
  }
}
