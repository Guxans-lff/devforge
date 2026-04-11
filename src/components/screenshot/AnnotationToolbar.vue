<script setup lang="ts">
/**
 * 标注工具选择栏（左侧垂直排列）
 * 9 个标注工具：箭头、矩形、椭圆、文字、马赛克、模糊、画笔、高亮、序号
 */
import { useI18n } from 'vue-i18n'
import type { Component } from 'vue'
import {
  ArrowUpRight,
  Square,
  Circle,
  Type,
  Grid3x3,
  Droplets,
  Pencil,
  Highlighter,
  Hash,
} from 'lucide-vue-next'
import type { AnnotationTool } from '@/types/screenshot'

const props = defineProps<{
  activeTool: AnnotationTool | null
}>()

const emit = defineEmits<{
  'update:activeTool': [tool: AnnotationTool | null]
}>()

const { t } = useI18n()

const tools: { id: AnnotationTool; icon: Component; labelKey: string }[] = [
  { id: 'arrow', icon: ArrowUpRight, labelKey: 'screenshot.toolbar.arrow' },
  { id: 'rectangle', icon: Square, labelKey: 'screenshot.toolbar.rectangle' },
  { id: 'ellipse', icon: Circle, labelKey: 'screenshot.toolbar.ellipse' },
  { id: 'text', icon: Type, labelKey: 'screenshot.toolbar.text' },
  { id: 'mosaic', icon: Grid3x3, labelKey: 'screenshot.toolbar.mosaic' },
  { id: 'blur', icon: Droplets, labelKey: 'screenshot.toolbar.blur' },
  { id: 'freehand', icon: Pencil, labelKey: 'screenshot.toolbar.freehand' },
  { id: 'highlight', icon: Highlighter, labelKey: 'screenshot.toolbar.highlight' },
  { id: 'counter', icon: Hash, labelKey: 'screenshot.toolbar.counter' },
]

function toggleTool(toolId: AnnotationTool) {
  // 再次点击同一工具 → 取消选择
  emit('update:activeTool', props.activeTool === toolId ? null : toolId)
}
</script>

<template>
  <div class="flex flex-col gap-0.5 border-r border-border bg-muted/10 p-1 w-9">
    <button
      v-for="tool in tools"
      :key="tool.id"
      class="flex items-center justify-center w-7 h-7 rounded transition-colors"
      :class="activeTool === tool.id
        ? 'bg-primary text-primary-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'"
      :title="t(tool.labelKey)"
      @click="toggleTool(tool.id)"
    >
      <component :is="tool.icon" class="h-3.5 w-3.5" />
    </button>
  </div>
</template>
