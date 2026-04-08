<script setup lang="ts">
/**
 * 标注样式面板（右侧）
 * 颜色预设 + 线宽滑块 + 字号（文字工具时显示）+ 填充开关
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AnnotationTool, AnnotationStyle } from '@/types/screenshot'

const props = defineProps<{
  tool: AnnotationTool
  styleOptions: AnnotationStyle
}>()

const emit = defineEmits<{
  'update:style': [style: Partial<AnnotationStyle>]
}>()

const { t } = useI18n()

const colorPresets = [
  '#ff0000', // 红
  '#00cc44', // 绿
  '#0088ff', // 蓝
  '#ffcc00', // 黄
  '#ffffff', // 白
  '#000000', // 黑
  '#ff6600', // 橙
  '#cc00ff', // 紫
]

const strokeWidths = [1, 2, 3, 4, 6, 8]
const fontSizes = [12, 14, 16, 20, 24, 32]

/** 是否显示字号选项 */
const showFontSize = computed(() => ['text', 'counter'].includes(props.tool))

/** 是否显示填充选项 */
const showFilled = computed(() => ['rectangle', 'ellipse'].includes(props.tool))
</script>

<template>
  <div class="flex flex-col gap-3 border-l border-border bg-muted/10 p-2 w-[140px]">
    <!-- 颜色 -->
    <div>
      <div class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
        {{ t('screenshot.style.color') }}
      </div>
      <div class="grid grid-cols-4 gap-1">
        <button
          v-for="color in colorPresets"
          :key="color"
          class="w-6 h-6 rounded border-2 transition-all"
          :class="styleOptions.color === color
            ? 'border-primary scale-110 shadow-sm'
            : 'border-transparent hover:border-border'"
          :style="{ backgroundColor: color }"
          @click="emit('update:style', { color })"
        />
      </div>
      <!-- 自定义颜色 -->
      <input
        type="color"
        :value="styleOptions.color"
        class="w-full h-6 mt-1.5 rounded cursor-pointer border border-border"
        @input="emit('update:style', { color: ($event.target as HTMLInputElement).value })"
      />
    </div>

    <!-- 线宽 -->
    <div>
      <div class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
        {{ t('screenshot.style.strokeWidth') }}
      </div>
      <div class="flex gap-1 flex-wrap">
        <button
          v-for="w in strokeWidths"
          :key="w"
          class="flex items-center justify-center w-7 h-6 rounded text-[10px] transition-colors"
          :class="styleOptions.strokeWidth === w
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted/50 text-muted-foreground hover:bg-accent'"
          @click="emit('update:style', { strokeWidth: w })"
        >
          {{ w }}
        </button>
      </div>
    </div>

    <!-- 字号（仅文字/序号工具） -->
    <div v-if="showFontSize">
      <div class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
        {{ t('screenshot.style.fontSize') }}
      </div>
      <div class="flex gap-1 flex-wrap">
        <button
          v-for="s in fontSizes"
          :key="s"
          class="flex items-center justify-center w-7 h-6 rounded text-[10px] transition-colors"
          :class="styleOptions.fontSize === s
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted/50 text-muted-foreground hover:bg-accent'"
          @click="emit('update:style', { fontSize: s })"
        >
          {{ s }}
        </button>
      </div>
    </div>

    <!-- 填充（仅矩形/椭圆） -->
    <div v-if="showFilled">
      <label class="flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          :checked="styleOptions.filled"
          class="rounded border-border"
          @change="emit('update:style', { filled: ($event.target as HTMLInputElement).checked })"
        />
        <span class="text-xs text-muted-foreground">{{ t('screenshot.style.filled') }}</span>
      </label>
    </div>
  </div>
</template>
