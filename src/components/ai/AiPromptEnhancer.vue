<script setup lang="ts">
/**
 * AI 提示词优化器
 *
 * 接收原始提示词，调用 AI 生成优化版本，左右对比展示，支持接受/拒绝。
 */
import { ref, watch } from 'vue'
import type { ProviderConfig, ModelConfig } from '@/types/ai'
import { aiChatStream } from '@/api/ai'
import { getCredential } from '@/api/connection'
import { diffWords } from 'diff'
import { Sparkles, Loader2, Check, X, RefreshCw } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  open: boolean
  originalText: string
  provider: ProviderConfig | null
  model: ModelConfig | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  accept: [text: string]
}>()

const enhancedText = ref('')
const isLoading = ref(false)
const error = ref('')

/** 词级 diff 渲染：新增词绿色高亮，删除词红色删除线 */
function renderDiff(original: string, enhanced: string): string {
  const parts = diffWords(original, enhanced)
  return parts.map(part => {
    const escaped = part.value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
    if (part.added) return `<span class="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">${escaped}</span>`
    if (part.removed) return `<span class="bg-rose-500/15 text-rose-600 dark:text-rose-400 line-through opacity-60">${escaped}</span>`
    return `<span>${escaped}</span>`
  }).join('')
}

const ENHANCE_PROMPT = `你是提示词优化引擎。将用户输入的提示词改写为更清晰、具体、有效的版本。

规则（必须严格遵守）：
1. 只输出改写后的提示词本身，禁止输出任何其他内容
2. 禁止以"以下是"、"优化后"、"作为"、"我将"等任何前缀开头
3. 禁止在末尾加任何总结、说明或注释
4. 保留原始核心意图，补充必要上下文和约束
5. 语言与原文保持一致（中文输入→中文输出）`

async function runEnhance() {
  if (!props.provider || !props.model) {
    error.value = '请先选择模型'
    return
  }
  if (!props.originalText.trim()) {
    error.value = '输入内容为空'
    return
  }
  isLoading.value = true
  error.value = ''
  enhancedText.value = ''

  try {
    const apiKey = await getCredential(`ai-provider-${props.provider.id}`) ?? ''
    if (!apiKey) {
      error.value = '未配置 API Key，请在设置中配置'
      return
    }
    await aiChatStream(
      {
        sessionId: `enhance-${Date.now()}`,
        messages: [{ role: 'user', content: props.originalText }],
        providerType: props.provider.providerType,
        model: props.model.id,
        apiKey,
        endpoint: props.provider.endpoint ?? '',
        systemPrompt: ENHANCE_PROMPT,
        enableTools: false,
      },
      (event) => {
        if (event.type === 'TextDelta') {
          enhancedText.value += event.delta
        }
      },
    )
  } catch (e: unknown) {
    if (e instanceof Error) {
      error.value = e.message
    } else if (typeof e === 'object' && e !== null && 'message' in e) {
      error.value = String((e as { message: unknown }).message)
    } else {
      error.value = JSON.stringify(e)
    }
  } finally {
    isLoading.value = false
  }
}

watch(() => props.open, (v) => {
  if (v) runEnhance()
  else {
    enhancedText.value = ''
    error.value = ''
  }
})

function handleAccept() {
  if (!enhancedText.value) return
  emit('accept', enhancedText.value)
  emit('update:open', false)
}

function handleClose() {
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="w-[780px] max-w-[90vw] p-0 gap-0 overflow-hidden">
      <!-- 头部 -->
      <DialogHeader class="flex-row items-center gap-2 px-5 py-4 border-b border-border/40 space-y-0">
        <Sparkles class="h-4 w-4 text-violet-500 shrink-0" />
        <DialogTitle class="text-sm font-semibold leading-none">提示词优化</DialogTitle>
        <span class="text-xs text-muted-foreground/50">AI 将重写你的提示词，使其更清晰有效</span>
      </DialogHeader>

      <!-- 对比区 -->
      <div class="grid grid-cols-2 divide-x divide-border/40 min-h-[240px]">
        <!-- 原始 -->
        <div class="flex flex-col">
          <div class="px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 border-b border-border/30 bg-muted/10">
            原始
          </div>
          <div class="flex-1 p-4 text-xs leading-relaxed whitespace-pre-wrap break-words text-muted-foreground overflow-y-auto max-h-[320px]">
            {{ originalText }}
          </div>
        </div>

        <!-- 优化后 -->
        <div class="flex flex-col">
          <div class="flex items-center justify-between px-4 py-2 border-b border-border/30 bg-muted/10">
            <div class="text-[10px] font-medium uppercase tracking-wider text-violet-500/70">优化后</div>
            <button
              v-if="!isLoading && (enhancedText || error)"
              class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              @click="runEnhance"
            >
              <RefreshCw class="h-3 w-3" />
              重新生成
            </button>
          </div>
          <div class="flex-1 p-4 text-xs leading-relaxed break-words overflow-y-auto max-h-[320px]">
            <!-- 错误 -->
            <div v-if="error" class="flex items-start gap-1.5 text-destructive/80">
              <span class="shrink-0">⚠</span>
              <span>{{ error }}</span>
            </div>
            <!-- 流式输出中（纯文本，不 diff） -->
            <div v-else-if="isLoading" class="whitespace-pre-wrap text-foreground/80">
              <span v-if="!enhancedText" class="flex items-center gap-2 text-muted-foreground/50">
                <Loader2 class="h-3.5 w-3.5 animate-spin" />优化中…
              </span>
              <template v-else>{{ enhancedText }}</template>
            </div>
            <!-- 完成后：词级 diff -->
            <div
              v-else-if="enhancedText"
              class="whitespace-pre-wrap"
              v-html="renderDiff(originalText, enhancedText)"
            />
          </div>
        </div>
      </div>

      <!-- 底部操作 -->
      <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/40 bg-muted/10">
        <Button variant="ghost" size="sm" @click="handleClose">
          <X class="mr-1 h-3.5 w-3.5" />
          取消
        </Button>
        <Button
          size="sm"
          :disabled="!enhancedText || isLoading"
          @click="handleAccept"
        >
          <Check class="mr-1 h-3.5 w-3.5" />
          使用优化版本
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
