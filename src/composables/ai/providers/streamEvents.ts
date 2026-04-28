/**
 * 标准流式事件定义与工具函数
 *
 * 所有 Provider 最终都转成这套事件，UI 和 Agent Runtime 不感知底层模型差异。
 * 事件类型与 Rust 后端 `models.rs` 中的 `AiStreamEvent` 一一对应。
 */

import type { AiStreamEvent } from '@/types/ai'

// ─────────────────────────── 事件类型守卫 ───────────────────────────

export function isTextDelta(event: AiStreamEvent): event is { type: 'TextDelta'; delta: string } {
  return event.type === 'TextDelta'
}

export function isThinkingDelta(event: AiStreamEvent): event is { type: 'ThinkingDelta'; delta: string } {
  return event.type === 'ThinkingDelta'
}

export function isToolCall(event: AiStreamEvent): event is { type: 'ToolCall'; id: string; name: string; arguments: string } {
  return event.type === 'ToolCall'
}

export function isToolCallDelta(event: AiStreamEvent): event is { type: 'ToolCallDelta'; index: number; id?: string; name?: string; arguments_delta: string } {
  return event.type === 'ToolCallDelta'
}

export function isUsage(event: AiStreamEvent): event is { type: 'Usage'; prompt_tokens: number; completion_tokens: number; cache_read_tokens?: number } {
  return event.type === 'Usage'
}

export function isDone(event: AiStreamEvent): event is { type: 'Done'; finish_reason: string } {
  return event.type === 'Done'
}

export function isError(event: AiStreamEvent): event is { type: 'Error'; message: string; retryable: boolean } {
  return event.type === 'Error'
}

// ─────────────────────────── 事件分类 ───────────────────────────

/** 是否为内容事件（文本/思考） */
export function isContentEvent(event: AiStreamEvent): boolean {
  return event.type === 'TextDelta' || event.type === 'ThinkingDelta'
}

/** 是否为工具相关事件 */
export function isToolEvent(event: AiStreamEvent): boolean {
  return event.type === 'ToolCall' || event.type === 'ToolCallDelta'
}

/** 是否为终止事件（Done/Error） */
export function isTerminalEvent(event: AiStreamEvent): boolean {
  return event.type === 'Done' || event.type === 'Error'
}

// ─────────────────────────── 事件提取 ───────────────────────────

/** 从事件列表中提取完整文本 */
export function extractText(events: AiStreamEvent[]): string {
  return events
    .filter(isTextDelta)
    .map(e => e.delta)
    .join('')
}

/** 从事件列表中提取完整思考过程 */
export function extractThinking(events: AiStreamEvent[]): string {
  return events
    .filter(isThinkingDelta)
    .map(e => e.delta)
    .join('')
}

/** 从事件列表中提取 Usage 信息 */
export function extractUsage(events: AiStreamEvent[]): { prompt_tokens: number; completion_tokens: number; cache_read_tokens: number } | null {
  const usageEvent = events.find(isUsage)
  if (!usageEvent) return null
  return {
    prompt_tokens: usageEvent.prompt_tokens,
    completion_tokens: usageEvent.completion_tokens,
    cache_read_tokens: usageEvent.cache_read_tokens ?? 0,
  }
}

/** 从事件列表中提取 Done 事件的 finish_reason */
export function extractFinishReason(events: AiStreamEvent[]): string | null {
  const doneEvent = events.find(isDone)
  return doneEvent?.finish_reason ?? null
}

// ─────────────────────────── 事件统计 ───────────────────────────

/** 统计事件分布 */
export function summarizeEvents(events: AiStreamEvent[]): {
  textDeltas: number
  thinkingDeltas: number
  toolCalls: number
  toolCallDeltas: number
  usage: boolean
  done: boolean
  error: boolean
} {
  let textDeltas = 0
  let thinkingDeltas = 0
  let toolCalls = 0
  let toolCallDeltas = 0
  let usage = false
  let done = false
  let error = false

  for (const event of events) {
    switch (event.type) {
      case 'TextDelta': textDeltas++; break
      case 'ThinkingDelta': thinkingDeltas++; break
      case 'ToolCall': toolCalls++; break
      case 'ToolCallDelta': toolCallDeltas++; break
      case 'Usage': usage = true; break
      case 'Done': done = true; break
      case 'Error': error = true; break
    }
  }

  return { textDeltas, thinkingDeltas, toolCalls, toolCallDeltas, usage, done, error }
}
