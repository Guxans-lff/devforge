<script setup lang="ts">
/**
 * 浮动标注工具栏（Snipaste 风格）
 * 水平排列：9 个标注工具 | 颜色/样式 | 撤销/重做 | 取消/复制/保存/编辑器
 * 定位在选区下方（空间不足时移到上方）
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
  Undo2,
  Redo2,
  X,
  Copy,
  Download,
  Maximize2,
} from 'lucide-vue-next'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import CompactStylePopover from './CompactStylePopover.vue'
import type { AnnotationTool, AnnotationStyle } from '@/types/screenshot'

defineProps<{
  activeTool: AnnotationTool | null
  activeStyle: AnnotationStyle
  canUndo: boolean
  canRedo: boolean
}>()

const emit = defineEmits<{
  'update:tool': [tool: AnnotationTool | null]
  'update:style': [style: Partial<AnnotationStyle>]
  undo: []
  redo: []
  confirm: []
  cancel: []
  save: []
  openEditor: []
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
  emit('update:tool', toolId)
}
</script>

<template>
  <div
    class="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-background/95 backdrop-blur-sm shadow-lg border border-border select-none"
    @mousedown.stop
    @click.stop
  >
    <!-- 标注工具 -->
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

    <!-- 分隔线 -->
    <div class="w-px h-5 bg-border mx-0.5" />

    <!-- 颜色/样式 Popover -->
    <Popover>
      <PopoverTrigger as-child>
        <button
          class="flex items-center justify-center w-7 h-7 rounded hover:bg-accent/50 transition-colors"
          title="样式"
        >
          <div
            class="w-4 h-4 rounded-full border-2 border-muted-foreground/30"
            :style="{ backgroundColor: activeStyle.color }"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" :side-offset="8" align="start" class="p-0 w-auto">
        <CompactStylePopover
          :tool="activeTool"
          :style-options="activeStyle"
          @update:style="emit('update:style', $event)"
        />
      </PopoverContent>
    </Popover>

    <!-- 分隔线 -->
    <div class="w-px h-5 bg-border mx-0.5" />

    <!-- 撤销/重做 -->
    <button
      class="flex items-center justify-center w-7 h-7 rounded transition-colors"
      :class="canUndo ? 'text-muted-foreground hover:text-foreground hover:bg-accent/50' : 'text-muted-foreground/30 cursor-not-allowed'"
      :disabled="!canUndo"
      :title="t('screenshot.action.undo')"
      @click="emit('undo')"
    >
      <Undo2 class="h-3.5 w-3.5" />
    </button>
    <button
      class="flex items-center justify-center w-7 h-7 rounded transition-colors"
      :class="canRedo ? 'text-muted-foreground hover:text-foreground hover:bg-accent/50' : 'text-muted-foreground/30 cursor-not-allowed'"
      :disabled="!canRedo"
      :title="t('screenshot.action.redo')"
      @click="emit('redo')"
    >
      <Redo2 class="h-3.5 w-3.5" />
    </button>

    <!-- 分隔线 -->
    <div class="w-px h-5 bg-border mx-0.5" />

    <!-- 操作按钮 -->
    <button
      class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
      :title="t('screenshot.floatingBar.cancel')"
      @click="emit('cancel')"
    >
      <X class="h-3.5 w-3.5" />
    </button>
    <button
      class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
      :title="t('screenshot.floatingBar.copy')"
      @click="emit('confirm')"
    >
      <Copy class="h-3.5 w-3.5" />
    </button>
    <button
      class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
      :title="t('screenshot.floatingBar.save')"
      @click="emit('save')"
    >
      <Download class="h-3.5 w-3.5" />
    </button>
    <button
      class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
      :title="t('screenshot.floatingBar.openEditor')"
      @click="emit('openEditor')"
    >
      <Maximize2 class="h-3.5 w-3.5" />
    </button>
  </div>
</template>
