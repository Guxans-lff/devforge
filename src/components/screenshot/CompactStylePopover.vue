<script setup lang="ts">
/**
 * 紧凑版样式面板（用于浮动工具栏的 Popover 中）
 * 颜色预设 + 线宽 + 字号 + 填充开关
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AnnotationTool, AnnotationStyle } from '@/types/screenshot'

const props = defineProps<{
  tool: AnnotationTool | null
  styleOptions: AnnotationStyle
}>()

const emit = defineEmits<{
  'update:style': [style: Partial<AnnotationStyle>]
}>()

const { t } = useI18n()

const colorPresets = [
  '#ff0000', '#00cc44', '#0088ff', '#ffcc00',
  '#ffffff', '#000000', '#ff6600', '#cc00ff',
]

const strokeWidths: [string, number][] = [['S', 1], ['M', 3], ['L', 6]]
const fontSizes: [string, number][] = [['小', 14], ['中', 20], ['大', 28]]

const showFontSize = computed(() => props.tool && ['text', 'counter'].includes(props.tool))
const showFilled = computed(() => props.tool && ['rectangle', 'ellipse'].includes(props.tool))
</script>

<template>
  <div class="p-2 w-[200px] select-none" @mousedown.stop>
    <!-- 颜色预设 -->
    <div class="text-[10px] text-muted-foreground mb-1">{{ t('screenshot.style.color') }}</div>
    <div class="flex gap-1 mb-2">
      <button
        v-for="color in colorPresets"
        :key="color"
        class="w-5 h-5 rounded-full border-2 transition-all"
        :class="styleOptions.color === color
          ? 'border-primary scale-110 shadow-sm'
          : 'border-transparent hover:border-border'"
        :style="{ backgroundColor: color }"
        @click="emit('update:style', { color })"
      />
    </div>
    <input
      type="color"
      :value="styleOptions.color"
      class="w-full h-5 rounded cursor-pointer border border-border mb-2"
      @input="emit('update:style', { color: ($event.target as HTMLInputElement).value })"
    />

    <!-- 线宽 -->
    <div class="text-[10px] text-muted-foreground mb-1">{{ t('screenshot.style.strokeWidth') }}</div>
    <div class="flex gap-1 mb-2">
      <button
        v-for="[label, value] in strokeWidths"
        :key="value"
        class="flex-1 h-6 rounded text-[10px] transition-colors"
        :class="styleOptions.strokeWidth === value
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted/50 text-muted-foreground hover:bg-accent'"
        @click="emit('update:style', { strokeWidth: value })"
      >
        {{ label }}
      </button>
    </div>

    <!-- 字号 -->
    <template v-if="showFontSize">
      <div class="text-[10px] text-muted-foreground mb-1">{{ t('screenshot.style.fontSize') }}</div>
      <div class="flex gap-1 mb-2">
        <button
          v-for="[label, value] in fontSizes"
          :key="value"
          class="flex-1 h-6 rounded text-[10px] transition-colors"
          :class="styleOptions.fontSize === value
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted/50 text-muted-foreground hover:bg-accent'"
          @click="emit('update:style', { fontSize: value })"
        >
          {{ label }}
        </button>
      </div>
    </template>

    <!-- 填充 -->
    <label v-if="showFilled" class="flex items-center gap-1.5 cursor-pointer">
      <input
        type="checkbox"
        :checked="styleOptions.filled"
        class="rounded border-border"
        @change="emit('update:style', { filled: ($event.target as HTMLInputElement).checked })"
      />
      <span class="text-xs text-muted-foreground">{{ t('screenshot.style.filled') }}</span>
    </label>
  </div>
</template>
