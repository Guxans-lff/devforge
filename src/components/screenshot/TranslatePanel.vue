<script setup lang="ts">
/**
 * 翻译结果面板
 * 调用后端 LLM API 翻译 OCR 识别的文字
 * 支持语言对切换、API 配置
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { Button } from '@/components/ui/button'
import { Copy, Loader2, Settings, RefreshCw } from 'lucide-vue-next'
import { screenshotTranslate } from '@/api/screenshot'
import type { AiConfig } from '@/types/ai'

const props = defineProps<{
  /** 待翻译文本 */
  text: string
}>()

const { t } = useI18n()
const toast = useToast()

// ── 翻译状态 ──────────────────────────────────────────────────

const translating = ref(false)
const translatedText = ref('')
const translateError = ref<string | null>(null)

// ── 语言选项 ──────────────────────────────────────────────────

const sourceLang = ref('auto')
const targetLang = ref('zh')

const langOptions = [
  { value: 'auto', label: '自动检测' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
]

// ── API 配置 ──────────────────────────────────────────────────

const showConfig = ref(false)
const apiConfig = ref<AiConfig>({
  provider: 'openai',
  model: 'gpt-4o-mini',
  endpoint: 'https://api.openai.com/v1',
  maxTokens: 2048,
})
const apiKey = ref('')

// 尝试从 localStorage 恢复配置
try {
  const saved = localStorage.getItem('devforge-translate-config')
  if (saved) {
    const parsed = JSON.parse(saved)
    apiConfig.value = { ...apiConfig.value, ...parsed.apiConfig }
    apiKey.value = parsed.apiKey || ''
  }
} catch { /* 忽略 */ }

/** 保存配置到 localStorage */
function saveConfig() {
  try {
    localStorage.setItem('devforge-translate-config', JSON.stringify({
      apiConfig: apiConfig.value,
      apiKey: apiKey.value,
    }))
    toast.success(t('screenshot.translate.configSaved'))
    showConfig.value = false
  } catch { /* 忽略 */ }
}

// ── 翻译操作 ──────────────────────────────────────────────────

async function doTranslate() {
  if (!props.text.trim()) return
  if (!apiKey.value) {
    showConfig.value = true
    translateError.value = t('screenshot.translate.noApiKey')
    return
  }

  translating.value = true
  translateError.value = null
  translatedText.value = ''

  try {
    translatedText.value = await screenshotTranslate(
      props.text,
      sourceLang.value,
      targetLang.value,
      apiConfig.value,
      apiKey.value,
    )
  } catch (e) {
    translateError.value = String(e)
  } finally {
    translating.value = false
  }
}

/** 复制翻译结果 */
async function copyResult() {
  if (!translatedText.value) return
  try {
    await navigator.clipboard.writeText(translatedText.value)
    toast.success(t('screenshot.message.copySuccess'))
  } catch {
    toast.error(t('screenshot.message.copyFailed'))
  }
}

/** 交换源/目标语言 */
function swapLangs() {
  if (sourceLang.value === 'auto') return
  const tmp = sourceLang.value
  sourceLang.value = targetLang.value
  targetLang.value = tmp
}
</script>

<template>
  <div class="flex flex-col gap-2 px-3 py-2 bg-muted/10">
    <!-- 语言对选择 + 翻译按钮 -->
    <div class="flex items-center gap-1.5">
      <select
        v-model="sourceLang"
        class="h-6 text-[10px] bg-background border border-border rounded px-1"
      >
        <option v-for="opt in langOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>

      <button
        class="text-xs text-muted-foreground hover:text-foreground px-1"
        :disabled="sourceLang === 'auto'"
        @click="swapLangs"
      >
        ⇄
      </button>

      <select
        v-model="targetLang"
        class="h-6 text-[10px] bg-background border border-border rounded px-1"
      >
        <option
          v-for="opt in langOptions.filter(o => o.value !== 'auto')"
          :key="opt.value"
          :value="opt.value"
        >
          {{ opt.label }}
        </option>
      </select>

      <div class="flex-1" />

      <!-- 配置按钮 -->
      <button
        class="p-0.5 rounded hover:bg-accent text-muted-foreground"
        :title="t('screenshot.translate.config')"
        @click="showConfig = !showConfig"
      >
        <Settings class="h-3 w-3" />
      </button>

      <!-- 翻译按钮 -->
      <Button
        variant="default"
        size="sm"
        class="h-6 text-xs"
        :disabled="translating || !text.trim()"
        @click="doTranslate"
      >
        <Loader2 v-if="translating" class="mr-1 h-3 w-3 animate-spin" />
        <RefreshCw v-else class="mr-1 h-3 w-3" />
        {{ t('screenshot.translate.run') }}
      </Button>
    </div>

    <!-- API 配置区（可折叠） -->
    <div v-if="showConfig" class="flex flex-col gap-1.5 p-2 rounded border border-border bg-background text-[10px]">
      <div class="flex items-center gap-1">
        <label class="w-14 text-muted-foreground">Endpoint</label>
        <input
          v-model="apiConfig.endpoint"
          class="flex-1 h-5 px-1.5 border border-border rounded bg-background text-[10px]"
          placeholder="https://api.openai.com/v1"
        />
      </div>
      <div class="flex items-center gap-1">
        <label class="w-14 text-muted-foreground">Model</label>
        <input
          v-model="apiConfig.model"
          class="flex-1 h-5 px-1.5 border border-border rounded bg-background text-[10px]"
          placeholder="gpt-4o-mini"
        />
      </div>
      <div class="flex items-center gap-1">
        <label class="w-14 text-muted-foreground">API Key</label>
        <input
          v-model="apiKey"
          type="password"
          class="flex-1 h-5 px-1.5 border border-border rounded bg-background text-[10px]"
          placeholder="sk-..."
        />
      </div>
      <Button variant="outline" size="sm" class="h-5 text-[10px] self-end" @click="saveConfig">
        {{ t('screenshot.translate.saveConfig') }}
      </Button>
    </div>

    <!-- 错误提示 -->
    <div v-if="translateError" class="text-[10px] text-destructive">
      {{ translateError }}
    </div>

    <!-- 翻译结果 -->
    <div v-if="translatedText" class="relative">
      <div class="p-2 rounded border border-border bg-background text-xs leading-relaxed select-text whitespace-pre-wrap max-h-[200px] overflow-auto">
        {{ translatedText }}
      </div>
      <button
        class="absolute top-1 right-1 p-0.5 rounded hover:bg-accent text-muted-foreground"
        @click="copyResult"
      >
        <Copy class="h-3 w-3" />
      </button>
    </div>
  </div>
</template>
