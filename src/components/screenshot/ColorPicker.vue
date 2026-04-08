<script setup lang="ts">
/**
 * 取色器面板
 * 从截图中取色，支持 HEX / RGB / HSL 格式
 * 点击截图区域取色 → 显示颜色值 → 一键复制
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { Button } from '@/components/ui/button'
import { Copy, Pipette } from 'lucide-vue-next'

const props = defineProps<{
  /** 当前取色的颜色（从 Canvas 鼠标位置读取） */
  color: string | null
}>()

const emit = defineEmits<{
  /** 请求进入取色模式 */
  activate: []
  /** 选择颜色并应用 */
  select: [color: string]
}>()

const { t } = useI18n()
const toast = useToast()

const activeFormat = ref<'hex' | 'rgb' | 'hsl'>('hex')

// ── 颜色格式转换 ────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (!m) return null
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

const formattedColor = computed(() => {
  if (!props.color) return ''
  const rgb = hexToRgb(props.color)
  if (!rgb) return props.color

  switch (activeFormat.value) {
    case 'hex':
      return props.color.toUpperCase()
    case 'rgb':
      return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
    case 'hsl': {
      const [h, s, l] = rgbToHsl(...rgb)
      return `hsl(${h}, ${s}%, ${l}%)`
    }
    default:
      return props.color
  }
})

// ── 操作 ──────────────────────────────────────────────────────

async function copyColor() {
  if (!formattedColor.value) return
  try {
    await navigator.clipboard.writeText(formattedColor.value)
    toast.success(t('screenshot.message.copySuccess'))
  } catch {
    toast.error(t('screenshot.message.copyFailed'))
  }
}
</script>

<template>
  <div class="flex flex-col gap-2 p-3 border-t border-border bg-muted/10">
    <!-- 标题 + 激活按钮 -->
    <div class="flex items-center justify-between">
      <span class="text-xs font-medium text-muted-foreground">
        <Pipette class="inline h-3 w-3 mr-1" />
        取色器
      </span>
      <Button variant="ghost" size="sm" class="h-6 text-xs" @click="emit('activate')">
        取色
      </Button>
    </div>

    <!-- 颜色预览 -->
    <div v-if="color" class="flex items-center gap-2">
      <!-- 色块 -->
      <div
        class="w-8 h-8 rounded border border-border shadow-inner"
        :style="{ backgroundColor: color }"
      />

      <!-- 颜色值 + 格式切换 -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1 mb-1">
          <button
            v-for="fmt in ['hex', 'rgb', 'hsl'] as const"
            :key="fmt"
            class="px-1.5 py-0.5 text-[10px] uppercase rounded transition-colors"
            :class="activeFormat === fmt
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent'"
            @click="activeFormat = fmt"
          >
            {{ fmt }}
          </button>
        </div>
        <div class="flex items-center gap-1">
          <code class="text-xs font-mono truncate">{{ formattedColor }}</code>
          <button
            class="p-0.5 rounded hover:bg-accent text-muted-foreground"
            @click="copyColor"
          >
            <Copy class="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="text-[10px] text-muted-foreground/60">
      点击"取色"后在截图上选取颜色
    </div>
  </div>
</template>
