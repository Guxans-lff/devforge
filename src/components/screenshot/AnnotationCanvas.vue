<script setup lang="ts">
/**
 * 双层 Canvas 标注编辑组件
 * 底层 Canvas 渲染原始截图（静态）
 * 标注 Canvas 渲染所有标注图形（动态）
 */
import { ref, toRef, computed, onMounted, watch } from 'vue'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useAnnotationCanvas } from '@/composables/useAnnotationCanvas'
import type { CaptureResult, AnnotationTool, AnnotationStyle } from '@/types/screenshot'

const props = withDefaults(defineProps<{
  capture: CaptureResult
  tool: AnnotationTool | null
  styleOptions: AnnotationStyle
  /** 紧凑模式：填满容器，无 padding / max-height 约束（overlay 选区用） */
  compact?: boolean
}>(), { compact: false })

const emit = defineEmits<{
  historyChange: [state: { canUndo: boolean; canRedo: boolean }]
}>()

// ── Canvas 元素引用 ──────────────────────────────────────────────

const baseCanvasRef = ref<HTMLCanvasElement | null>(null)
const annotCanvasRef = ref<HTMLCanvasElement | null>(null)

// ── 图片 URL ────────────────────────────────────────────────────

const imageSrc = computed(() => convertFileSrc(props.capture.filePath))

// ── 初始化标注引擎 ──────────────────────────────────────────────

const engine = useAnnotationCanvas({
  baseCanvas: baseCanvasRef,
  annotCanvas: annotCanvasRef,
  imageSrc: imageSrc,
  imageWidth: toRef(() => props.capture.width),
  imageHeight: toRef(() => props.capture.height),
  tool: toRef(() => props.tool),
  styleOptions: toRef(() => props.styleOptions),
})

// ── 监听操作栈变化 ──────────────────────────────────────────────

watch(
  [() => engine.canUndo.value, () => engine.canRedo.value],
  ([canUndo, canRedo]) => {
    emit('historyChange', { canUndo, canRedo })
  },
)

// ── 生命周期 ────────────────────────────────────────────────────

onMounted(() => {
  engine.loadImage()
})

// ── 暴露方法给父组件 ────────────────────────────────────────────

defineExpose({
  undo: engine.undo,
  redo: engine.redo,
  clear: engine.clear,
  exportBase64: engine.exportBase64,
  exportBlob: engine.exportBlob,
  /** 获取底层 Canvas 元素（OCR 用） */
  getBaseCanvas: () => baseCanvasRef.value,
})

// ── Canvas 显示尺寸（CSS 限制，保持比例） ─────────────────────

const displayStyle = computed(() => {
  return {
    maxWidth: '100%',
    maxHeight: '100%',
  }
})
</script>

<template>
  <div class="relative w-full h-full" :class="compact ? '' : 'flex items-center justify-center p-4'">
    <!-- Canvas 容器 -->
    <div class="relative" :class="compact ? 'w-full h-full' : 'inline-block'" :style="compact ? undefined : displayStyle">
      <!-- 底层 Canvas（截图原图） -->
      <canvas
        ref="baseCanvasRef"
        :class="compact
          ? 'block w-full h-full object-fill'
          : 'block max-w-full max-h-[calc(100vh-160px)] object-contain'"
      />

      <!-- 标注层 Canvas（覆盖在上面，完全对齐） -->
      <canvas
        ref="annotCanvasRef"
        class="absolute inset-0 w-full h-full"
        :class="tool ? 'cursor-crosshair' : 'cursor-default'"
        @mousedown="engine.onMouseDown"
        @mousemove="engine.onMouseMove"
        @mouseup="engine.onMouseUp"
        @mouseleave="engine.onMouseUp"
      />
    </div>
  </div>
</template>
