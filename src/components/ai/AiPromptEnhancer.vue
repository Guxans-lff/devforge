<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProviderConfig, ModelConfig } from '@/types/ai'
import { getCredential } from '@/api/connection'
import { iteratePrompt, optimizePrompt } from '@/composables/ai/promptOptimizer'
import type { PromptOptimizerTemplate } from '@/composables/ai/promptOptimizerTemplates'
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

const { t } = useI18n()
const templateOptions = computed<Array<{ value: Exclude<PromptOptimizerTemplate['id'], 'iterate-optimize'>; label: string }>>(() => [
  { value: 'general-optimize', label: t('ai.promptEnhancer.templateGeneral') },
  { value: 'code-optimize', label: t('ai.promptEnhancer.templateCode') },
  { value: 'structured-optimize', label: t('ai.promptEnhancer.templateStructured') },
  { value: 'polish-optimize', label: t('ai.promptEnhancer.templatePolish') },
])
const selectedTemplateId = ref<Exclude<PromptOptimizerTemplate['id'], 'iterate-optimize'>>('general-optimize')
const enhancedText = ref('')
const feedback = ref('')
const isLoading = ref(false)
const error = ref('')
let activeRequestId = 0
let activeController: AbortController | null = null

const canIterate = computed(() => !!enhancedText.value && !isLoading.value)

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

async function runEnhance() {
  if (!props.provider || !props.model) {
    error.value = t('ai.promptEnhancer.selectModelFirst')
    return
  }
  if (!props.originalText.trim()) {
    error.value = t('ai.promptEnhancer.emptyInput')
    return
  }

  cancelActiveRequest()
  const controller = new AbortController()
  activeController = controller
  const requestId = ++activeRequestId
  isLoading.value = true
  error.value = ''
  enhancedText.value = ''

  try {
    const apiKey = await getCredential(`ai-provider-${props.provider.id}`) ?? ''
    if (requestId !== activeRequestId) return
    if (!apiKey) {
      error.value = t('ai.promptEnhancer.apiKeyMissing')
      return
    }

    const result = await optimizePrompt(
      {
        prompt: props.originalText,
        providerType: props.provider.providerType,
        model: props.model.id,
        apiKey,
        endpoint: props.provider.endpoint ?? '',
        templateId: selectedTemplateId.value,
        sessionId: `prompt-enhance-${Date.now()}-${requestId}`,
        signal: controller.signal,
      },
      {
        onDelta(delta) {
          if (requestId !== activeRequestId || controller.signal.aborted) return
          enhancedText.value += delta
        },
      },
    )

    if (requestId !== activeRequestId || controller.signal.aborted) return
    enhancedText.value = result.text
  } catch (e: unknown) {
    if (requestId !== activeRequestId || controller.signal.aborted || isAbortError(e)) return
    error.value = getErrorMessage(e)
  } finally {
    if (requestId === activeRequestId && activeController === controller) {
      isLoading.value = false
      activeController = null
    }
  }
}

async function runIterate() {
  if (!props.provider || !props.model || !enhancedText.value) return

  cancelActiveRequest()
  const controller = new AbortController()
  activeController = controller
  const requestId = ++activeRequestId
  const currentOptimizedText = enhancedText.value
  let nextEnhancedText = ''
  isLoading.value = true
  error.value = ''
  enhancedText.value = ''

  try {
    const apiKey = await getCredential(`ai-provider-${props.provider.id}`) ?? ''
    if (requestId !== activeRequestId) return
    if (!apiKey) {
      error.value = t('ai.promptEnhancer.apiKeyMissing')
      return
    }

    const result = await iteratePrompt(
      {
        originalPrompt: props.originalText,
        optimizedPrompt: currentOptimizedText,
        feedback: feedback.value.trim(),
        providerType: props.provider.providerType,
        model: props.model.id,
        apiKey,
        endpoint: props.provider.endpoint ?? '',
        sessionId: `prompt-iterate-${Date.now()}-${requestId}`,
        signal: controller.signal,
      },
      {
        onDelta(delta) {
          if (requestId !== activeRequestId || controller.signal.aborted) return
          nextEnhancedText += delta
          enhancedText.value = nextEnhancedText
        },
      },
    )

    if (requestId !== activeRequestId || controller.signal.aborted) return
    enhancedText.value = result.text
  } catch (e: unknown) {
    if (requestId !== activeRequestId || controller.signal.aborted || isAbortError(e)) return
    enhancedText.value = currentOptimizedText
    error.value = getErrorMessage(e)
  } finally {
    if (requestId === activeRequestId && activeController === controller) {
      isLoading.value = false
      activeController = null
    }
  }
}

function cancelActiveRequest() {
  activeController?.abort()
  activeController = null
}

function getErrorMessage(errorLike: unknown): string {
  if (errorLike instanceof Error) {
    return errorLike.message
  }
  if (typeof errorLike === 'object' && errorLike !== null && 'message' in errorLike) {
    return String((errorLike as { message: unknown }).message)
  }
  return JSON.stringify(errorLike)
}

function isAbortError(errorLike: unknown): boolean {
  return errorLike instanceof DOMException
    ? errorLike.name === 'AbortError'
    : errorLike instanceof Error && errorLike.name === 'AbortError'
}

watch(() => props.open, (v) => {
  if (v) runEnhance()
  else {
    cancelActiveRequest()
    activeRequestId++
    isLoading.value = false
    enhancedText.value = ''
    feedback.value = ''
    selectedTemplateId.value = 'general-optimize'
    error.value = ''
  }
})

function handleAccept() {
  if (!enhancedText.value) return
  emit('accept', enhancedText.value)
  emit('update:open', false)
}

function handleClose() {
  cancelActiveRequest()
  activeRequestId++
  emit('update:open', false)
}

onBeforeUnmount(() => {
  cancelActiveRequest()
  activeRequestId++
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="w-[780px] max-w-[90vw] p-0 gap-0 overflow-hidden">
      <DialogHeader class="flex-row items-center gap-2 px-5 py-4 border-b border-border/40 space-y-0">
        <Sparkles class="h-4 w-4 text-violet-500 shrink-0" />
        <DialogTitle class="text-sm font-semibold leading-none">{{ t('ai.promptEnhancer.title') }}</DialogTitle>
        <span class="text-xs text-muted-foreground/50">{{ t('ai.promptEnhancer.subtitle') }}</span>
      </DialogHeader>

      <div class="grid grid-cols-2 divide-x divide-border/40 min-h-[240px]">
        <div class="flex flex-col">
          <div class="px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 border-b border-border/30 bg-muted/10">
            {{ t('ai.promptEnhancer.original') }}
          </div>
          <div class="flex-1 p-4 text-xs leading-relaxed whitespace-pre-wrap break-words text-muted-foreground overflow-y-auto max-h-[320px]">
            {{ originalText }}
          </div>
        </div>

        <div class="flex flex-col">
          <div class="flex items-center justify-between px-4 py-2 border-b border-border/30 bg-muted/10">
            <div class="text-[10px] font-medium uppercase tracking-wider text-violet-500/70">{{ t('ai.promptEnhancer.enhanced') }}</div>
            <button
              v-if="!isLoading && (enhancedText || error)"
              class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              @click="runEnhance"
            >
              <RefreshCw class="h-3 w-3" />
              {{ t('ai.promptEnhancer.regenerate') }}
            </button>
          </div>
          <div class="flex-1 p-4 text-xs leading-relaxed break-words overflow-y-auto max-h-[320px]">
            <div v-if="error" class="space-y-3">
              <div v-if="enhancedText" class="whitespace-pre-wrap" v-html="renderDiff(originalText, enhancedText)" />
              <div class="flex items-start gap-1.5 text-destructive/80">
                <span class="shrink-0">⚠</span>
                <span>{{ error }}</span>
              </div>
            </div>
            <div v-else-if="isLoading" class="whitespace-pre-wrap text-foreground/80">
              <span v-if="!enhancedText" class="flex items-center gap-2 text-muted-foreground/50">
                <Loader2 class="h-3.5 w-3.5 animate-spin" />{{ t('ai.promptEnhancer.loading') }}
              </span>
              <template v-else>{{ enhancedText }}</template>
            </div>
            <div
              v-else-if="enhancedText"
              class="whitespace-pre-wrap"
              v-html="renderDiff(originalText, enhancedText)"
            />
          </div>
        </div>
      </div>

      <div class="border-t border-border/40 bg-muted/5 px-5 py-3 space-y-2">
        <div class="space-y-2">
          <div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            {{ t('ai.promptEnhancer.templateMode') }}
          </div>
          <select
            v-model="selectedTemplateId"
            :disabled="isLoading"
            class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            @change="runEnhance"
          >
            <option v-for="option in templateOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>
        <div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          {{ t('ai.promptEnhancer.iterateLabel') }}
        </div>
        <textarea
          v-model="feedback"
          :disabled="isLoading"
          class="min-h-20 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          :placeholder="t('ai.promptEnhancer.iteratePlaceholder')"
        />
      </div>

      <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/40 bg-muted/10">
        <Button variant="ghost" size="sm" @click="handleClose">
          <X class="mr-1 h-3.5 w-3.5" />
          {{ t('common.cancel') }}
        </Button>
        <Button size="sm" variant="outline" :disabled="!canIterate" @click="runIterate">
          <RefreshCw class="mr-1 h-3.5 w-3.5" />
          {{ t('ai.promptEnhancer.iterate') }}
        </Button>
        <Button
          size="sm"
          :disabled="!enhancedText || isLoading"
          @click="handleAccept"
        >
          <Check class="mr-1 h-3.5 w-3.5" />
          {{ t('ai.promptEnhancer.useEnhanced') }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
