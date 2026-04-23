import { aiAbortStream, aiChatStream } from '@/api/ai'
import type { AiStreamEvent, ProviderType } from '@/types/ai'
import { getPromptOptimizerTemplate, renderTemplate, type PromptOptimizerTemplate } from '@/composables/ai/promptOptimizerTemplates'

export interface OptimizePromptInput {
  prompt: string
  templateId?: Exclude<PromptOptimizerTemplate['id'], 'iterate-optimize'>
  providerType: ProviderType
  model: string
  apiKey: string
  endpoint?: string
  sessionId?: string
  signal?: AbortSignal
}

export interface IteratePromptInput {
  originalPrompt: string
  optimizedPrompt: string
  feedback: string
  providerType: ProviderType
  model: string
  apiKey: string
  endpoint?: string
  sessionId?: string
  signal?: AbortSignal
}

export interface PromptOptimizerOptions {
  onDelta?: (delta: string) => void
  onEvent?: (event: AiStreamEvent) => void
}

export interface PromptOptimizerResult {
  text: string
  sessionId: string
}

export async function abortPromptOptimization(sessionId: string): Promise<void> {
  await aiAbortStream(sessionId)
}

export async function optimizePrompt(
  input: OptimizePromptInput,
  options: PromptOptimizerOptions = {},
): Promise<PromptOptimizerResult> {
  const sessionId = input.sessionId ?? `prompt-opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const template = getPromptOptimizerTemplate(input.templateId ?? 'general-optimize')
  const systemPrompt = renderTemplate(template.systemTemplate, { prompt: input.prompt })
  const userMessage = renderTemplate(template.userTemplate, { prompt: input.prompt })

  return runPromptOptimization({
    sessionId,
    providerType: input.providerType,
    model: input.model,
    apiKey: input.apiKey,
    endpoint: input.endpoint,
    systemPrompt,
    userMessage,
    signal: input.signal,
  }, options)
}

export async function iteratePrompt(
  input: IteratePromptInput,
  options: PromptOptimizerOptions = {},
): Promise<PromptOptimizerResult> {
  const sessionId = input.sessionId ?? `prompt-iter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const template = getPromptOptimizerTemplate('iterate-optimize')
  const variables = {
    originalPrompt: input.originalPrompt,
    optimizedPrompt: input.optimizedPrompt,
    feedback: input.feedback,
  }
  const systemPrompt = renderTemplate(template.systemTemplate, variables)
  const userMessage = renderTemplate(template.userTemplate, variables)

  return runPromptOptimization({
    sessionId,
    providerType: input.providerType,
    model: input.model,
    apiKey: input.apiKey,
    endpoint: input.endpoint,
    systemPrompt,
    userMessage,
    signal: input.signal,
  }, options)
}

async function runPromptOptimization(
  input: {
    sessionId: string
    providerType: ProviderType
    model: string
    apiKey: string
    endpoint?: string
    systemPrompt: string
    userMessage: string
    signal?: AbortSignal
  },
  options: PromptOptimizerOptions,
): Promise<PromptOptimizerResult> {
  if (input.signal?.aborted) {
    await abortPromptOptimization(input.sessionId)
    throw createAbortError()
  }

  let text = ''
  let aborted = false
  const handleAbort = async () => {
    aborted = true
    await abortPromptOptimization(input.sessionId)
  }

  input.signal?.addEventListener('abort', handleAbort, { once: true })

  try {
    await aiChatStream(
      {
        sessionId: input.sessionId,
        messages: [{ role: 'user', content: input.userMessage }],
        providerType: input.providerType,
        model: input.model,
        apiKey: input.apiKey,
        endpoint: input.endpoint ?? '',
        systemPrompt: input.systemPrompt,
        enableTools: false,
      },
      (event) => {
        options.onEvent?.(event)
        if (aborted || input.signal?.aborted) return
        if (event.type === 'TextDelta') {
          text += event.delta
          options.onDelta?.(event.delta)
        }
      },
    )
  } finally {
    input.signal?.removeEventListener('abort', handleAbort)
  }

  if (aborted || input.signal?.aborted) {
    throw createAbortError()
  }

  const finalText = text.trim()
  if (!finalText) {
    throw new Error('优化结果为空，请重试')
  }

  return {
    text: finalText,
    sessionId: input.sessionId,
  }
}

function createAbortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError')
}
