<script setup lang="ts">
/**
 * OCR 文字识别结果面板
 * 显示识别结果，支持逐行选择、全部复制
 * 集成翻译面板
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { Button } from '@/components/ui/button'
import {
  Copy,
  ScanText,
  Loader2,
  ChevronDown,
  ChevronUp,
  Languages,
} from 'lucide-vue-next'
import TranslatePanel from '@/components/screenshot/TranslatePanel.vue'
import type { OcrResult } from '@/composables/useOcr'

const props = defineProps<{
  /** OCR 识别结果 */
  result: OcrResult | null
  /** 是否正在识别 */
  recognizing: boolean
  /** 识别进度 0-1 */
  progress: number
  /** 错误信息 */
  error: string | null
  /** 是否正在初始化 worker */
  initializing: boolean
}>()

const emit = defineEmits<{
  /** 请求执行全图 OCR */
  recognize: []
  /** 请求框选区域 OCR */
  recognizeRegion: []
}>()

const { t } = useI18n()
const toast = useToast()

/** 是否展开翻译面板 */
const showTranslate = ref(false)

/** 选中的行索引（用于部分复制） */
const selectedLines = ref<Set<number>>(new Set())

/** 选中的文本 */
const selectedText = computed(() => {
  if (!props.result) return ''
  if (selectedLines.value.size === 0) return props.result.text
  return props.result.lines
    .filter((_, i) => selectedLines.value.has(i))
    .map((l) => l.text)
    .join('\n')
})

/** 进度百分比 */
const progressPercent = computed(() => Math.round(props.progress * 100))

/** 切换行选中状态 */
function toggleLine(index: number) {
  const s = new Set(selectedLines.value)
  if (s.has(index)) {
    s.delete(index)
  } else {
    s.add(index)
  }
  selectedLines.value = s
}

/** 全选/取消全选 */
function toggleAll() {
  if (!props.result) return
  if (selectedLines.value.size === props.result.lines.length) {
    selectedLines.value = new Set()
  } else {
    selectedLines.value = new Set(props.result.lines.map((_, i) => i))
  }
}

/** 复制文字到剪贴板 */
async function copyText() {
  const text = selectedText.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('screenshot.message.copySuccess'))
  } catch {
    toast.error(t('screenshot.message.copyFailed'))
  }
}
</script>

<template>
  <div class="flex flex-col h-full border-l border-border bg-background">
    <!-- 标题栏 -->
    <div class="flex items-center gap-2 px-3 py-2 border-b border-border">
      <ScanText class="h-4 w-4 text-muted-foreground" />
      <span class="text-xs font-medium">{{ t('screenshot.ocr.title') }}</span>
      <div class="flex-1" />
      <!-- 全图识别 -->
      <Button
        variant="outline"
        size="sm"
        class="h-6 text-xs"
        :disabled="recognizing || initializing"
        @click="emit('recognize')"
      >
        <Loader2 v-if="recognizing || initializing" class="mr-1 h-3 w-3 animate-spin" />
        {{ initializing ? t('screenshot.ocr.initializing') : t('screenshot.ocr.recognizeFull') }}
      </Button>
      <!-- 区域识别 -->
      <Button
        variant="ghost"
        size="sm"
        class="h-6 text-xs"
        :disabled="recognizing || initializing"
        @click="emit('recognizeRegion')"
      >
        {{ t('screenshot.ocr.recognizeRegion') }}
      </Button>
    </div>

    <!-- 进度条 -->
    <div v-if="recognizing" class="px-3 py-2">
      <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <Loader2 class="h-3 w-3 animate-spin" />
        {{ t('screenshot.ocr.recognizing') }} {{ progressPercent }}%
      </div>
      <div class="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          class="h-full bg-primary rounded-full transition-all duration-300"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="px-3 py-2 text-xs text-destructive">
      {{ error }}
    </div>

    <!-- 识别结果 -->
    <div v-if="result" class="flex-1 min-h-0 flex flex-col">
      <!-- 操作栏 -->
      <div class="flex items-center gap-1 px-3 py-1.5 border-b border-border">
        <span class="text-[10px] text-muted-foreground">
          {{ t('screenshot.ocr.confidence') }}: {{ Math.round(result.confidence) }}%
          · {{ result.lines.length }} {{ t('screenshot.ocr.lines') }}
        </span>
        <div class="flex-1" />
        <button
          class="text-[10px] text-primary hover:underline"
          @click="toggleAll"
        >
          {{ selectedLines.size === result.lines.length
            ? t('screenshot.ocr.deselectAll')
            : t('screenshot.ocr.selectAll') }}
        </button>
        <Button variant="ghost" size="sm" class="h-5 px-1.5" @click="copyText">
          <Copy class="h-3 w-3" />
        </Button>
      </div>

      <!-- 文字行列表 -->
      <div class="flex-1 min-h-0 overflow-auto px-1 py-1">
        <div
          v-for="(line, index) in result.lines"
          :key="index"
          class="flex items-start gap-1 px-2 py-0.5 rounded text-xs cursor-pointer transition-colors"
          :class="selectedLines.has(index) ? 'bg-primary/10' : 'hover:bg-accent'"
          @click="toggleLine(index)"
        >
          <span class="text-[10px] text-muted-foreground/50 w-4 text-right flex-shrink-0 mt-0.5">
            {{ index + 1 }}
          </span>
          <span class="flex-1 select-text break-all leading-relaxed">
            {{ line.text }}
          </span>
        </div>
      </div>

      <!-- 翻译区域 -->
      <div class="border-t border-border">
        <button
          class="w-full flex items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
          @click="showTranslate = !showTranslate"
        >
          <Languages class="h-3 w-3" />
          {{ t('screenshot.action.translate') }}
          <component :is="showTranslate ? ChevronUp : ChevronDown" class="h-3 w-3 ml-auto" />
        </button>
        <TranslatePanel
          v-if="showTranslate"
          :text="selectedText"
        />
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="!recognizing && !error" class="flex-1 flex items-center justify-center">
      <div class="text-center text-xs text-muted-foreground/60 px-4">
        <ScanText class="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p>{{ t('screenshot.ocr.empty') }}</p>
        <p class="mt-1">{{ t('screenshot.ocr.emptyHint') }}</p>
      </div>
    </div>
  </div>
</template>
