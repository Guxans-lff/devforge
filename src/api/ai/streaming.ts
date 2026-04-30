import { Channel } from '@tauri-apps/api/core'
import { invokeAiCommand } from './errors'
import type { AiStreamEvent, ChatResult, ContentBlock } from '@/types/ai'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | null
  contentBlocks?: ContentBlock[]
  name?: string
  toolCalls?: Array<{
    id: string
    type: string
    function: { name: string; arguments: string }
  }>
  toolCallId?: string
  reasoningContent?: string
}

export interface ChatStreamParams {
  sessionId: string
  messages: ChatMessage[]
  providerType: string
  model: string
  apiKey: string
  endpoint: string
  maxTokens?: number
  temperature?: number
  systemPrompt?: string
  enableTools?: boolean
  thinkingBudget?: number
  responseFormat?: 'json_object'
  prefixCompletion?: boolean
  prefixContent?: string
}

export function aiChatStream(
  params: ChatStreamParams,
  onEvent: (event: AiStreamEvent) => void,
): Promise<ChatResult> {
  const channel = new Channel<AiStreamEvent>()
  channel.onmessage = onEvent

  return invokeAiCommand('ai_chat_stream', {
    sessionId: params.sessionId,
    messages: params.messages,
    providerType: params.providerType,
    model: params.model,
    apiKey: params.apiKey,
    endpoint: params.endpoint,
    maxTokens: params.maxTokens ?? null,
    temperature: params.temperature ?? null,
    systemPrompt: params.systemPrompt ?? null,
    enableTools: params.enableTools ?? null,
    thinkingBudget: params.thinkingBudget ?? null,
    responseFormat: params.responseFormat ?? null,
    prefixCompletion: params.prefixCompletion ?? null,
    prefixContent: params.prefixContent ?? null,
    onEvent: channel,
  }, { source: 'AI' })
}

export function aiAbortStream(sessionId: string): Promise<boolean> {
  return invokeAiCommand('ai_abort_stream', { sessionId }, { source: 'AI' })
}

export interface CompletionParams {
  providerType: string
  model: string
  apiKey: string
  endpoint: string
  prompt: string
  suffix?: string
  maxTokens?: number
  temperature?: number
  useBeta?: boolean
}

export interface CompletionResult {
  content: string
  model: string
  promptTokens: number
  completionTokens: number
  finishReason: string
}

export function aiCreateCompletion(params: CompletionParams): Promise<CompletionResult> {
  return invokeAiCommand('ai_create_completion', {
    providerType: params.providerType,
    model: params.model,
    apiKey: params.apiKey,
    endpoint: params.endpoint,
    prompt: params.prompt,
    suffix: params.suffix ?? null,
    maxTokens: params.maxTokens ?? null,
    temperature: params.temperature ?? null,
    useBeta: params.useBeta ?? null,
  }, { source: 'AI' })
}

