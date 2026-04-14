/**
 * AI 模块 API 层
 *
 * 封装所有 AI 相关的 Tauri 命令调用，包括：
 * - 流式对话（Channel 推送）
 * - 中断生成
 * - Provider 管理
 * - 会话管理
 * - 用量统计
 */

import { Channel } from '@tauri-apps/api/core'
import { invokeCommand } from '@/api/base'
import type {
  AiStreamEvent,
  ChatResult,
  ProviderConfig,
  AiSession,
  AiMessageRecord,
  DailyUsage,
} from '@/types/ai'

/** ChatMessage 结构（对应 Rust ChatMessage） */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/** 流式对话参数 */
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
}

// ─────────────────────────────────── 流式对话 ───────────────────────────────────

/**
 * 流式对话
 *
 * 通过 Tauri Channel 实时接收 AI 回复增量事件。
 *
 * @param params 对话参数
 * @param onEvent 流式事件回调
 * @returns 最终对话结果（含 token 统计）
 */
export function aiChatStream(
  params: ChatStreamParams,
  onEvent: (event: AiStreamEvent) => void,
): Promise<ChatResult> {
  const channel = new Channel<AiStreamEvent>()
  channel.onmessage = onEvent

  return invokeCommand('ai_chat_stream', {
    sessionId: params.sessionId,
    messages: params.messages,
    providerType: params.providerType,
    model: params.model,
    apiKey: params.apiKey,
    endpoint: params.endpoint,
    maxTokens: params.maxTokens ?? null,
    temperature: params.temperature ?? null,
    systemPrompt: params.systemPrompt ?? null,
    onEvent: channel,
  }, { source: 'AI' })
}

/**
 * 中断流式生成
 *
 * @param sessionId 会话 ID
 * @returns 是否成功中断
 */
export function aiAbortStream(sessionId: string): Promise<boolean> {
  return invokeCommand('ai_abort_stream', { sessionId }, { source: 'AI' })
}

// ─────────────────────────────────── Provider 管理 ───────────────────────────────────

/**
 * 获取已配置的 Provider 列表
 */
export function aiListProviders(): Promise<ProviderConfig[]> {
  return invokeCommand('ai_list_providers', undefined, { source: 'AI' })
}

/**
 * 保存 Provider 配置（新增或更新）
 */
export function aiSaveProvider(config: ProviderConfig): Promise<void> {
  return invokeCommand('ai_save_provider', { config }, { source: 'AI' })
}

/**
 * 删除 Provider
 */
export function aiDeleteProvider(id: string): Promise<void> {
  return invokeCommand('ai_delete_provider', { id }, { source: 'AI' })
}

// ─────────────────────────────────── 会话管理 ───────────────────────────────────

/**
 * 保存会话（新增或更新）
 */
export function aiSaveSession(session: AiSession): Promise<void> {
  return invokeCommand('ai_save_session', { session }, { source: 'AI' })
}

/**
 * 获取会话列表
 */
export function aiListSessions(): Promise<AiSession[]> {
  return invokeCommand('ai_list_sessions', undefined, { source: 'AI' })
}

/**
 * 获取单个会话（含历史消息）
 *
 * @returns [session, messages] 元组，会话不存在时返回 null
 */
export function aiGetSession(id: string): Promise<[AiSession, AiMessageRecord[]] | null> {
  return invokeCommand('ai_get_session', { id }, { source: 'AI' })
}

/**
 * 删除会话（级联删除消息）
 */
export function aiDeleteSession(id: string): Promise<void> {
  return invokeCommand('ai_delete_session', { id }, { source: 'AI' })
}

/**
 * 保存消息记录
 */
export function aiSaveMessage(message: AiMessageRecord): Promise<void> {
  return invokeCommand('ai_save_message', { message }, { source: 'AI' })
}

// ─────────────────────────────────── 用量统计 ───────────────────────────────────

/**
 * 获取用量统计
 *
 * @param startDate 开始日期（YYYY-MM-DD）
 * @param endDate 结束日期（YYYY-MM-DD）
 * @returns 按天/Provider/Model 聚合的用量列表
 */
export function aiGetUsageStats(startDate: string, endDate: string): Promise<DailyUsage[]> {
  return invokeCommand('ai_get_usage_stats', { startDate, endDate }, { source: 'AI' })
}
