<script setup lang="ts">
/**
 * 区域框选覆盖层（Snipaste 风格）
 *
 * 状态机：loading → idle(拖选) → selected → annotating(标注) → confirm/cancel
 *
 * 1. 后端先静默全屏截取 → 返回截图路径
 * 2. Canvas 显示截图 + 半透明遮罩
 * 3. 鼠标拖拽绘制选区矩形
 * 4. 放大镜显示鼠标附近像素
 * 5. 选区确认后 → 裁剪区域截图 → 叠加 AnnotationCanvas + 浮动工具栏
 * 6. 标注完成 → 复制/保存/关闭
 */
import { ref, shallowRef, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { convertFileSrc } from '@tauri-apps/api/core'
import { screenshotCaptureFullscreen, screenshotCaptureRegion, screenshotCropRegion, screenshotCopyToClipboard, screenshotCopyAnnotatedToClipboard, screenshotListWindows, screenshotSaveAnnotated } from '@/api/screenshot'
import { useToast } from '@/composables/useToast'
import AnnotationCanvas from './AnnotationCanvas.vue'
import FloatingAnnotationBar from './FloatingAnnotationBar.vue'
import type { CaptureResult, WindowInfo, AnnotationTool, AnnotationStyle } from '@/types/screenshot'
import { createLogger } from '@/utils/logger'

const log = createLogger('screenshot.region')

const props = withDefaults(defineProps<{
  /** 全局快捷键预截图（可选，避免重复截图） */
  preCaptured?: CaptureResult | null
}>(), { preCaptured: null })

const emit = defineEmits<{
  /** 选区确认（兼容旧接口）：monitorId, x, y, w, h */
  confirm: [monitorId: number, x: number, y: number, w: number, h: number]
  /** 取消选区 */
  cancel: []
  /** 全屏截图（用户未拖选，直接确认） */
  fullscreen: [result: CaptureResult]
  /** 标注完成后关闭 */
  close: []
  /** 打开完整编辑器 */
  openEditor: [capture: CaptureResult]
  /** Canvas 渲染就绪（用于独立窗口延迟显示） */
  ready: []
}>()

const { t } = useI18n()
const { success: toastSuccess } = useToast()

// ── 基础状态 ──────────────────────────────────────────────────

const canvasRef = ref<HTMLCanvasElement | null>(null)
const loading = ref(true)
const captureResult = ref<CaptureResult | null>(null)
const backgroundImage = ref<HTMLImageElement | null>(null)
const windows = ref<WindowInfo[]>([])

// 选区状态
const isSelecting = ref(false)
const selectionStart = ref({ x: 0, y: 0 })
const selectionEnd = ref({ x: 0, y: 0 })
const hasSelection = ref(false)

// 鼠标位置（用于放大镜）
const mousePos = ref({ x: 0, y: 0 })

// 悬浮窗口（智能吸附）
const hoveredWindow = ref<WindowInfo | null>(null)

// ── 标注模式状态 ──────────────────────────────────────────────

const annotationMode = ref(false)
const regionCapture = shallowRef<CaptureResult | null>(null)
const activeTool = ref<AnnotationTool | null>(null)
const activeStyle = ref<AnnotationStyle>({
  color: '#ff0000',
  strokeWidth: 2,
  fontSize: 16,
  opacity: 1,
  filled: false,
})
const canUndo = ref(false)
const canRedo = ref(false)
const annotCanvasRef = ref<InstanceType<typeof AnnotationCanvas> | null>(null)

// ── 选区位置样式 ──────────────────────────────────────────────

const selectionStyle = computed(() => {
  const left = Math.min(selectionStart.value.x, selectionEnd.value.x)
  const top = Math.min(selectionStart.value.y, selectionEnd.value.y)
  const width = Math.abs(selectionEnd.value.x - selectionStart.value.x)
  const height = Math.abs(selectionEnd.value.y - selectionStart.value.y)
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  }
})

/** 工具栏定位：选区下方 8px，空间不足时移到上方 */
const toolbarPosition = computed(() => {
  const bottom = Math.max(selectionStart.value.y, selectionEnd.value.y)
  const top = Math.min(selectionStart.value.y, selectionEnd.value.y)
  const left = Math.min(selectionStart.value.x, selectionEnd.value.x)
  const barH = 40
  const gap = 8
  const posTop = bottom + gap + barH > window.innerHeight
    ? top - barH - gap
    : bottom + gap
  return {
    position: 'absolute' as const,
    left: `${left}px`,
    top: `${posTop}px`,
    zIndex: 10001,
  }
})

// ── 初始化 ────────────────────────────────────────────────────

onMounted(async () => {
  if (import.meta.env.DEV) console.log('[RegionSelect] onMounted, preCaptured:', !!props.preCaptured)
  try {
    // 使用预截图或重新截取
    const capturePromise = props.preCaptured
      ? Promise.resolve(props.preCaptured)
      : screenshotCaptureFullscreen()

    const [result, wins] = await Promise.all([
      capturePromise,
      screenshotListWindows(),
    ])
    captureResult.value = result
    windows.value = wins
    if (import.meta.env.DEV) console.log('[RegionSelect] 截图结果:', result.filePath, result.width, 'x', result.height)

    // 加载截图为 Image
    const imgUrl = convertFileSrc(result.filePath)
    if (import.meta.env.DEV) console.log('[RegionSelect] convertFileSrc URL:', imgUrl)

    const img = new Image()
    img.onerror = (e) => {
      if (import.meta.env.DEV) console.error('[RegionSelect] 图片加载失败:', imgUrl, e)
      emit('cancel')
    }
    img.onload = async () => {
      if (import.meta.env.DEV) console.log('[RegionSelect] 图片加载成功:', img.naturalWidth, 'x', img.naturalHeight)
      backgroundImage.value = img
      loading.value = false
      // 等待 DOM 更新（v-show 切换 Canvas 为可见），否则 getBoundingClientRect 返回 0x0
      await nextTick()
      initCanvas()
    }
    img.src = imgUrl
  } catch (e) {
    log.error('onMounted_exception', undefined, e)
    emit('cancel')
  }

  document.addEventListener('keydown', handleKeyDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeyDown)
})

// ── 键盘事件 ────────────────────────────────────────────────────

function handleKeyDown(e: KeyboardEvent) {
  if (annotationMode.value) {
    // 标注模式键盘处理
    if (e.key === 'Escape') {
      handleAnnotationCancel()
    } else if (e.key === 'Enter') {
      handleConfirm()
    } else if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      annotCanvasRef.value?.undo()
    } else if ((e.ctrlKey && e.shiftKey && e.key === 'z') || (e.ctrlKey && e.key === 'y')) {
      e.preventDefault()
      annotCanvasRef.value?.redo()
    } else if (e.ctrlKey && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
    return
  }

  // 框选模式键盘处理
  if (e.key === 'Escape') {
    emit('cancel')
  } else if (e.key === 'Enter') {
    confirmSelection()
  }
}

// ── Canvas 渲染 ────────────────────────────────────────────────

/** Canvas 初始化（仅执行一次，避免每次 renderOverlay 重置 DPI） */
function initCanvas() {
  const canvas = canvasRef.value
  const img = backgroundImage.value
  if (!canvas || !img) {
    log.error('initCanvas_failed', { hasCanvas: !!canvas, hasImg: !!img })
    return
  }

  const rect = canvas.getBoundingClientRect()
  if (import.meta.env.DEV) console.log('[RegionSelect] initCanvas: rect=', rect.width, 'x', rect.height, 'dpr=', window.devicePixelRatio)
  canvas.width = rect.width * window.devicePixelRatio
  canvas.height = rect.height * window.devicePixelRatio

  const ctx = canvas.getContext('2d')!
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

  renderOverlay()
  emit('ready')
}

function renderOverlay() {
  const canvas = canvasRef.value
  const img = backgroundImage.value
  if (!canvas || !img) return

  const rect = canvas.getBoundingClientRect()
  const ctx = canvas.getContext('2d')!

  ctx.clearRect(0, 0, rect.width, rect.height)
  ctx.drawImage(img, 0, 0, rect.width, rect.height)

  // 半透明遮罩
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
  ctx.fillRect(0, 0, rect.width, rect.height)

  // 窗口高亮（悬浮时）
  if (hoveredWindow.value && !isSelecting.value && !hasSelection.value) {
    const win = hoveredWindow.value
    const scaleX = rect.width / img.naturalWidth
    const scaleY = rect.height / img.naturalHeight
    const wx = win.x * scaleX
    const wy = win.y * scaleY
    const ww = win.width * scaleX
    const wh = win.height * scaleY

    ctx.save()
    ctx.beginPath()
    ctx.rect(wx, wy, ww, wh)
    ctx.clip()
    ctx.clearRect(wx, wy, ww, wh)
    ctx.drawImage(img, 0, 0, rect.width, rect.height)
    ctx.restore()

    ctx.strokeStyle = '#0088ff'
    ctx.lineWidth = 2
    ctx.strokeRect(wx, wy, ww, wh)
  }

  // 选区
  if (isSelecting.value || hasSelection.value) {
    const sx = Math.min(selectionStart.value.x, selectionEnd.value.x)
    const sy = Math.min(selectionStart.value.y, selectionEnd.value.y)
    const sw = Math.abs(selectionEnd.value.x - selectionStart.value.x)
    const sh = Math.abs(selectionEnd.value.y - selectionStart.value.y)

    if (sw > 0 && sh > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(sx, sy, sw, sh)
      ctx.clip()
      ctx.clearRect(sx, sy, sw, sh)
      ctx.drawImage(img, 0, 0, rect.width, rect.height)
      ctx.restore()

      ctx.strokeStyle = '#0088ff'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.strokeRect(sx, sy, sw, sh)
      ctx.setLineDash([])

      // 尺寸标签
      const imgScaleX = img.naturalWidth / rect.width
      const imgScaleY = img.naturalHeight / rect.height
      const realW = Math.round(sw * imgScaleX)
      const realH = Math.round(sh * imgScaleY)
      const label = `${realW} × ${realH}`
      ctx.font = '11px monospace'
      const metrics = ctx.measureText(label)
      const labelX = sx
      const labelY = sy > 22 ? sy - 6 : sy + sh + 16

      ctx.fillStyle = 'rgba(0, 136, 255, 0.85)'
      ctx.fillRect(labelX, labelY - 12, metrics.width + 8, 16)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label, labelX + 4, labelY)
    }
  }

  // 放大镜
  renderMagnifier(ctx, rect.width, rect.height)
}

/** 渲染放大镜（鼠标旁 5x 放大 + 像素颜色） */
function renderMagnifier(ctx: CanvasRenderingContext2D, cw: number, ch: number) {
  if (hasSelection.value) return

  const img = backgroundImage.value
  if (!img) return

  const mx = mousePos.value.x
  const my = mousePos.value.y
  const magSize = 100
  const zoom = 5
  const srcSize = magSize / zoom

  let magX = mx + 20
  let magY = my + 20
  if (magX + magSize > cw) magX = mx - magSize - 20
  if (magY + magSize > ch) magY = my - magSize - 20

  const imgScaleX = img.naturalWidth / cw
  const imgScaleY = img.naturalHeight / ch
  const srcX = mx * imgScaleX - srcSize * imgScaleX / 2
  const srcY = my * imgScaleY - srcSize * imgScaleY / 2

  ctx.save()
  ctx.beginPath()
  ctx.arc(magX + magSize / 2, magY + magSize / 2, magSize / 2, 0, Math.PI * 2)
  ctx.clip()

  ctx.drawImage(
    img,
    srcX, srcY, srcSize * imgScaleX, srcSize * imgScaleY,
    magX, magY, magSize, magSize,
  )

  ctx.strokeStyle = 'rgba(255,255,255,0.2)'
  ctx.lineWidth = 0.5
  const cellSize = magSize / (srcSize)
  for (let i = 0; i <= srcSize; i++) {
    ctx.beginPath()
    ctx.moveTo(magX + i * cellSize, magY)
    ctx.lineTo(magX + i * cellSize, magY + magSize)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(magX, magY + i * cellSize)
    ctx.lineTo(magX + magSize, magY + i * cellSize)
    ctx.stroke()
  }

  ctx.strokeStyle = 'rgba(255,0,0,0.6)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(magX + magSize / 2, magY)
  ctx.lineTo(magX + magSize / 2, magY + magSize)
  ctx.moveTo(magX, magY + magSize / 2)
  ctx.lineTo(magX + magSize, magY + magSize / 2)
  ctx.stroke()

  ctx.restore()

  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(magX + magSize / 2, magY + magSize / 2, magSize / 2, 0, Math.PI * 2)
  ctx.stroke()

  const px = Math.round(mx * imgScaleX)
  const py = Math.round(my * imgScaleY)
  const posText = `(${px}, ${py})`
  ctx.font = '10px monospace'
  ctx.fillStyle = 'rgba(0,0,0,0.7)'
  ctx.fillRect(magX, magY + magSize + 4, ctx.measureText(posText).width + 8, 14)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(posText, magX + 4, magY + magSize + 14)
}

// ── 鼠标事件 ────────────────────────────────────────────────────

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0 || annotationMode.value) return

  // 始终记录起点，mouseUp 时再判断是点击窗口还是拖选
  hasSelection.value = false
  isSelecting.value = true
  const { x, y } = getCanvasPos(e)
  selectionStart.value = { x, y }
  selectionEnd.value = { x, y }
}

function onMouseMove(e: MouseEvent) {
  if (annotationMode.value) return
  const { x, y } = getCanvasPos(e)
  mousePos.value = { x, y }

  if (isSelecting.value) {
    selectionEnd.value = { x, y }
  } else if (!hasSelection.value) {
    detectHoveredWindow(x, y)
  }

  renderOverlay()
}

function onMouseUp(_e: MouseEvent) {
  if (!isSelecting.value || annotationMode.value) return
  isSelecting.value = false

  const sx = Math.abs(selectionEnd.value.x - selectionStart.value.x)
  const sy = Math.abs(selectionEnd.value.y - selectionStart.value.y)

  if (sx > 5 && sy > 5) {
    // 拖选距离足够 → 进入标注模式
    hasSelection.value = true
    confirmSelection()
  } else if (hoveredWindow.value) {
    // 点击（未拖动）且悬浮在窗口上 → 截取该窗口
    const win = hoveredWindow.value
    if (canvasRef.value && backgroundImage.value) {
      enterAnnotationMode(0, win.x, win.y, win.width, win.height)
    }
  } else {
    hasSelection.value = false
    renderOverlay()
  }
}

function onDblClick(_e: MouseEvent) {
  if (annotationMode.value) return
  confirmSelection()
}

// ── 辅助函数 ────────────────────────────────────────────────────

function getCanvasPos(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  }
}

/** 检测鼠标悬浮的窗口 */
function detectHoveredWindow(mx: number, my: number) {
  const canvas = canvasRef.value
  const img = backgroundImage.value
  if (!canvas || !img) return

  const rect = canvas.getBoundingClientRect()
  const scaleX = rect.width / img.naturalWidth
  const scaleY = rect.height / img.naturalHeight

  const sorted = [...windows.value]
    .filter(w => !w.isMinimized && w.width > 0 && w.height > 0)
    .sort((a, b) => (a.width * a.height) - (b.width * b.height))

  for (const win of sorted) {
    const wx = win.x * scaleX
    const wy = win.y * scaleY
    const ww = win.width * scaleX
    const wh = win.height * scaleY

    if (mx >= wx && mx <= wx + ww && my >= wy && my <= wy + wh) {
      hoveredWindow.value = win
      return
    }
  }

  hoveredWindow.value = null
}

// ── 进入标注模式 ──────────────────────────────────────────────

/** 裁剪选区并进入标注模式 */
async function enterAnnotationMode(monitorId: number, x: number, y: number, w: number, h: number) {
  try {
    // 优先从已有截图文件裁剪（避免重新截屏截到覆盖层自身）
    const result = captureResult.value
      ? await screenshotCropRegion(captureResult.value.filePath, x, y, w, h)
      : await screenshotCaptureRegion(monitorId, x, y, w, h)
    regionCapture.value = result
    annotationMode.value = true
  } catch (_e) {
    // 裁剪失败回退到普通确认
    emit('confirm', monitorId, x, y, w, h)
  }
}

/** 确认选区 → 进入标注模式 */
function confirmSelection() {
  if (!hasSelection.value) {
    // 无选区 → 直接返回全屏截图
    if (captureResult.value) {
      emit('fullscreen', captureResult.value)
    }
    return
  }

  const canvas = canvasRef.value
  const img = backgroundImage.value
  if (!canvas || !img) return

  const rect = canvas.getBoundingClientRect()
  const imgScaleX = img.naturalWidth / rect.width
  const imgScaleY = img.naturalHeight / rect.height

  const sx = Math.min(selectionStart.value.x, selectionEnd.value.x)
  const sy = Math.min(selectionStart.value.y, selectionEnd.value.y)
  const sw = Math.abs(selectionEnd.value.x - selectionStart.value.x)
  const sh = Math.abs(selectionEnd.value.y - selectionStart.value.y)

  const realX = Math.round(sx * imgScaleX)
  const realY = Math.round(sy * imgScaleY)
  const realW = Math.round(sw * imgScaleX)
  const realH = Math.round(sh * imgScaleY)

  // 进入标注模式
  enterAnnotationMode(0, realX, realY, realW, realH)
}

// ── 标注模式操作 ──────────────────────────────────────────────

function onHistoryChange(state: { canUndo: boolean; canRedo: boolean }) {
  canUndo.value = state.canUndo
  canRedo.value = state.canRedo
}

/** 确认：导出标注图 → 复制到剪贴板 → 关闭 */
async function handleConfirm() {
  try {
    const base64 = annotCanvasRef.value?.exportBase64()
    if (import.meta.env.DEV) console.log('[RegionSelect] handleConfirm: base64 length=', base64?.length ?? 'null', 'regionCapture=', regionCapture.value?.filePath)
    if (base64) {
      await screenshotCopyAnnotatedToClipboard(base64)
    } else if (regionCapture.value) {
      // exportBase64 失败时，复制裁剪后的区域图片（非全屏原图）
      await screenshotCopyToClipboard(regionCapture.value.filePath)
    }
    toastSuccess(t('screenshot.message.copySuccess'))
    emit('close')
  } catch (e) {
    log.error('handleConfirm_exception', undefined, e)
    emit('close')
  }
}

/** 取消标注 → 回到框选模式 */
function handleAnnotationCancel() {
  annotationMode.value = false
  regionCapture.value = null
  activeTool.value = null
  canUndo.value = false
  canRedo.value = false
  hasSelection.value = false
  renderOverlay()
}

/** 保存到文件 */
async function handleSave() {
  try {
    const base64 = annotCanvasRef.value?.exportBase64()
    if (!base64) return

    // 使用 Tauri 文件对话框选择保存路径
    const { save } = await import('@tauri-apps/plugin-dialog')
    const filePath = await save({
      filters: [{ name: 'PNG', extensions: ['png'] }],
      defaultPath: `screenshot_${Date.now()}.png`,
    })
    if (!filePath) return

    await screenshotSaveAnnotated(base64, filePath)
    toastSuccess(t('screenshot.message.saveSuccess'))
    emit('close')
  } catch (_e) {
    // 保存失败静默
  }
}

/** 打开完整编辑器 */
function handleOpenEditor() {
  if (regionCapture.value) {
    emit('openEditor', regionCapture.value)
  }
}
</script>

<template>
  <!-- 全屏覆盖层 -->
  <div class="fixed inset-0 z-[9999] select-none" :class="annotationMode ? '' : 'cursor-crosshair'">
    <!-- 加载状态 -->
    <div v-if="loading" class="flex h-full items-center justify-center bg-black/60">
      <div class="text-white text-sm animate-pulse">{{ t('screenshot.capturing') }}</div>
    </div>

    <!-- Canvas 框选层（标注模式下仍保留作为背景） -->
    <canvas
      v-show="!loading"
      ref="canvasRef"
      class="w-full h-full"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @dblclick="onDblClick"
    />

    <!-- 底部提示（框选模式） -->
    <div
      v-if="!loading && !annotationMode && !hasSelection"
      class="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-black/60 text-white text-xs backdrop-blur-sm"
    >
      {{ t('screenshot.region.hint') }}
    </div>

    <!-- 选区确认后直接进入标注模式，无需确认/取消按钮 -->

    <!-- 标注模式：选区上叠加 AnnotationCanvas + 浮动工具栏 -->
    <template v-if="annotationMode && regionCapture">
      <!-- 标注 Canvas 定位在选区位置 -->
      <div
        class="absolute overflow-hidden"
        :style="selectionStyle"
      >
        <AnnotationCanvas
          ref="annotCanvasRef"
          :capture="regionCapture"
          :tool="activeTool"
          :style-options="activeStyle"
          compact
          @history-change="onHistoryChange"
        />
      </div>

      <!-- 浮动工具栏 -->
      <FloatingAnnotationBar
        :style="toolbarPosition"
        :active-tool="activeTool"
        :active-style="activeStyle"
        :can-undo="canUndo"
        :can-redo="canRedo"
        @update:tool="activeTool = $event"
        @update:style="Object.assign(activeStyle, $event)"
        @undo="annotCanvasRef?.undo()"
        @redo="annotCanvasRef?.redo()"
        @confirm="handleConfirm"
        @cancel="handleAnnotationCancel"
        @save="handleSave"
        @open-editor="handleOpenEditor"
      />
    </template>
  </div>
</template>
