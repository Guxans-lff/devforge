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
    onEvent: channel,
  }, { source: 'AI' })
}

export function aiAbortStream(sessionId: string): Promise<boolean> {
  return invokeAiCommand('ai_abort_stream', { sessionId }, { source: 'AI' })
}

