<script setup lang="ts">
/**
 * 截图编辑器容器
 * 顶部工具栏 + Canvas 编辑区 + 底部样式面板 + OCR 面板
 */
import { ref, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft,
  Undo2,
  Redo2,
  Eraser,
  Download,
  ClipboardCopy,
  Pin,
  ScanText,
} from 'lucide-vue-next'
import AnnotationCanvas from '@/components/screenshot/AnnotationCanvas.vue'
import AnnotationToolbar from '@/components/screenshot/AnnotationToolbar.vue'
import AnnotationStylePanel from '@/components/screenshot/AnnotationStylePanel.vue'
import ColorPicker from '@/components/screenshot/ColorPicker.vue'
import OcrPanel from '@/components/screenshot/OcrPanel.vue'
import { useOcr } from '@/composables/useOcr'
import type { CaptureResult, AnnotationTool, AnnotationStyle } from '@/types/screenshot'

const props = defineProps<{
  capture: CaptureResult
}>()

const emit = defineEmits<{
  back: []
  save: [pngBase64: string, destPath: string]
  copy: [pngBase64: string]
  saveOriginal: [destPath: string]
  copyOriginal: []
  pin: [filePath: string, width: number, height: number]
}>()

const { t } = useI18n()

// ── 标注状态 ─────────────────────────────────────────────────────

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

/** Canvas 组件引用 */
const canvasRef = ref<InstanceType<typeof AnnotationCanvas> | null>(null)

/** 取色器状态 */
const showColorPicker = ref(false)
const pickedColor = ref<string | null>(null)
const isColorPicking = ref(false)

/** OCR 状态 */
const showOcrPanel = ref(false)
const ocr = useOcr()

/** 组件卸载时释放 OCR worker */
onBeforeUnmount(() => {
  ocr.terminate()
})

// ── 操作 ─────────────────────────────────────────────────────────

function handleToolChange(tool: AnnotationTool | null) {
  activeTool.value = tool
}

function handleStyleChange(style: Partial<AnnotationStyle>) {
  activeStyle.value = { ...activeStyle.value, ...style }
}

function handleUndo() {
  canvasRef.value?.undo()
}

function handleRedo() {
  canvasRef.value?.redo()
}

function handleClear() {
  canvasRef.value?.clear()
}

function handleHistoryChange(state: { canUndo: boolean; canRedo: boolean }) {
  canUndo.value = state.canUndo
  canRedo.value = state.canRedo
}

/** 导出标注后的图片并复制到剪贴板 */
async function handleCopyAnnotated() {
  const base64 = canvasRef.value?.exportBase64()
  if (base64) {
    emit('copy', base64)
  } else {
    emit('copyOriginal')
  }
}

/** 导出标注后的图片并保存（需要 save dialog） */
async function handleSaveAnnotated() {
  // TODO: 接入 Tauri save dialog 选择路径
  const base64 = canvasRef.value?.exportBase64()
  if (base64) {
    // 暂用默认路径，后续替换为 save dialog
    const { save } = await import('@tauri-apps/plugin-dialog')
    const destPath = await save({
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
      defaultPath: `screenshot_${Date.now()}.png`,
    })
    if (destPath) {
      emit('save', base64, destPath)
    }
  }
}

/** 贴图到屏幕 */
function handlePin() {
  emit('pin', props.capture.filePath, props.capture.width, props.capture.height)
}

/** 激活取色器模式 */
function activateColorPicker() {
  isColorPicking.value = true
  showColorPicker.value = true
  // 临时切换到取色模式，Canvas 点击时读取像素颜色
  activeTool.value = null
}

/** 从取色器选择颜色并应用到当前样式 */
function applyPickedColor(color: string) {
  activeStyle.value = { ...activeStyle.value, color }
  isColorPicking.value = false
}

// ── OCR ──────────────────────────────────────────────────────

/** 切换 OCR 面板显示 */
function toggleOcrPanel() {
  showOcrPanel.value = !showOcrPanel.value
}

/** 全图 OCR 识别 */
async function handleOcrFull() {
  const canvas = canvasRef.value?.getBaseCanvas?.()
  if (canvas) {
    await ocr.recognizeFromCanvas(canvas)
  }
}

/** 区域 OCR — 暂时使用全图（后续可集成框选） */
async function handleOcrRegion() {
  // TODO: 集成框选区域后传入 rect 参数
  await handleOcrFull()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶部操作栏 -->
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <!-- 返回按钮 -->
      <Button variant="ghost" size="sm" @click="emit('back')">
        <ArrowLeft class="mr-1.5 h-4 w-4" />
        {{ t('screenshot.action.close') }}
      </Button>

      <div class="h-4 w-px bg-border mx-1" />

      <!-- 撤销/重做 -->
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7"
        :disabled="!canUndo"
        :title="t('screenshot.action.undo')"
        @click="handleUndo"
      >
        <Undo2 class="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7"
        :disabled="!canRedo"
        :title="t('screenshot.action.redo')"
        @click="handleRedo"
      >
        <Redo2 class="h-3.5 w-3.5" />
      </Button>

      <!-- 清除标注 -->
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7"
        :title="t('screenshot.action.clear')"
        @click="handleClear"
      >
        <Eraser class="h-3.5 w-3.5" />
      </Button>

      <div class="flex-1" />

      <!-- 尺寸信息 -->
      <span class="text-xs text-muted-foreground">
        {{ capture.width }} × {{ capture.height }}
      </span>

      <div class="h-4 w-px bg-border mx-1" />

      <!-- 贴图 -->
      <Button variant="outline" size="sm" @click="handlePin">
        <Pin class="mr-1.5 h-3.5 w-3.5" />
        {{ t('screenshot.action.pin') }}
      </Button>

      <!-- OCR -->
      <Button
        variant="outline"
        size="sm"
        :class="showOcrPanel ? 'bg-accent' : ''"
        @click="toggleOcrPanel"
      >
        <ScanText class="mr-1.5 h-3.5 w-3.5" />
        {{ t('screenshot.action.ocr') }}
      </Button>

      <!-- 复制/保存 -->
      <Button variant="outline" size="sm" @click="handleCopyAnnotated">
        <ClipboardCopy class="mr-1.5 h-3.5 w-3.5" />
        {{ t('screenshot.action.copy') }}
      </Button>
      <Button variant="default" size="sm" @click="handleSaveAnnotated">
        <Download class="mr-1.5 h-3.5 w-3.5" />
        {{ t('screenshot.action.save') }}
      </Button>
    </div>

    <!-- 中间区域：工具栏 + Canvas -->
    <div class="flex flex-1 min-h-0">
      <!-- 左侧工具栏 -->
      <AnnotationToolbar
        :active-tool="activeTool"
        @update:active-tool="handleToolChange"
      />

      <!-- Canvas 编辑区 -->
      <div class="flex-1 min-w-0 overflow-auto bg-muted/30">
        <AnnotationCanvas
          ref="canvasRef"
          :capture="capture"
          :tool="activeTool"
          :style-options="activeStyle"
          @history-change="handleHistoryChange"
        />
      </div>

      <!-- 右侧样式面板 + 取色器 -->
      <div v-if="activeTool || showColorPicker" class="flex flex-col">
        <AnnotationStylePanel
          v-if="activeTool"
          :tool="activeTool"
          :style-options="activeStyle"
          @update:style="handleStyleChange"
        />
        <ColorPicker
          :color="pickedColor"
          @activate="activateColorPicker"
          @select="applyPickedColor"
        />
      </div>

      <!-- OCR 面板 -->
      <OcrPanel
        v-if="showOcrPanel"
        class="w-[280px] flex-shrink-0"
        :result="ocr.result.value"
        :recognizing="ocr.recognizing.value"
        :progress="ocr.progress.value"
        :error="ocr.error.value"
        :initializing="ocr.initializing.value"
        @recognize="handleOcrFull"
        @recognize-region="handleOcrRegion"
      />
    </div>
  </div>
</template>
