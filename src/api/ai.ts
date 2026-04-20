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
  AiSessionDetail,
  DailyUsage,
  ToolDefinition,
  ToolExecResult,
  ContentBlock,
} from '@/types/ai'

/** ChatMessage 结构（对应 Rust ChatMessage） */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | null
  /** 新增：结构化内容块支持（多模态） */
  contentBlocks?: ContentBlock[]
  /** 工具名称（tool 角色消息需要，部分 API 如 OpenAI 要求此字段） */
  name?: string
  /** 工具调用列表（assistant 角色携带） */
  toolCalls?: Array<{
    id: string
    type: string
    function: { name: string; arguments: string }
  }>
  /** 工具调用 ID（tool 角色必须） */
  toolCallId?: string
  /** Reasoning 模型（MiMo / DeepSeek-R 系）工作记忆回传 —— assistant 角色携带 */
  reasoningContent?: string
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
  /** 是否启用工具调用 */
  enableTools?: boolean
  /** Extended Thinking 预算（token），未设置或 <1024 则关闭。仅 Anthropic thinking 能力模型生效 */
  thinkingBudget?: number
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
    enableTools: params.enableTools ?? null,
    thinkingBudget: params.thinkingBudget ?? null,
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
export function aiGetSession(id: string, messageLimit?: number): Promise<AiSessionDetail | null> {
  return invokeCommand('ai_get_session', { id, messageLimit: messageLimit ?? null }, { source: 'AI' })
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

// ─────────────────────────────────── Tool Use ───────────────────────────────────

/**
 * 获取可用工具定义列表
 */
export function aiGetTools(): Promise<ToolDefinition[]> {
  return invokeCommand('ai_get_tools', undefined, { source: 'AI' })
}

/**
 * 执行指定工具
 *
 * @param name 工具名称
 * @param args JSON 字符串参数
 * @param workDir 工作目录（安全边界）
 */
export function aiExecuteTool(
  name: string,
  args: string,
  workDir: string,
  sessionId: string,
  toolCallId: string,
): Promise<ToolExecResult> {
  return invokeCommand(
    'ai_execute_tool',
    { name, arguments: args, workDir, sessionId, toolCallId },
    { source: 'AI' },
  )
}

/** 单轮累计预算检查：超预算时挑最大的若干条落盘替换 */
export interface ToolResultEntry {
  toolCallId: string
  toolName: string
  content: string
}

export function aiEnforceToolResultBudget(
  sessionId: string,
  results: ToolResultEntry[],
): Promise<ToolResultEntry[]> {
  return invokeCommand(
    'ai_enforce_tool_result_budget',
    { sessionId, results },
    { source: 'AI' },
  )
}

/** 读取完整落盘结果（供 UI "查看完整" 使用） */
export function aiReadToolResultFile(
  sessionId: string,
  toolCallId: string,
): Promise<string> {
  return invokeCommand(
    'ai_read_tool_result_file',
    { sessionId, toolCallId },
    { source: 'AI' },
  )
}

/** 回滚 write_file（前端 Reject 调用） */
export function aiRevertWriteFile(
  sessionId: string,
  toolCallId: string,
  targetPath: string,
): Promise<string> {
  return invokeCommand(
    'ai_revert_write_file',
    { sessionId, toolCallId, targetPath },
    { source: 'AI' },
  )
}

// ─────────────────────────────────── Workspace 配置 ───────────────────────────────────

/** 读取工作区 .devforge/config.json（返回 null 表示不存在） */
export function aiReadWorkspaceConfig(root: string): Promise<string | null> {
  return invokeCommand('ai_read_workspace_config', { root }, { source: 'AI' })
}

/** 写入工作区 .devforge/config.json */
export function aiWriteWorkspaceConfig(root: string, content: string): Promise<void> {
  return invokeCommand('ai_write_workspace_config', { root, content }, { source: 'AI' })
}

/** 读取单个上下文文件内容（截断到前 maxLines 行） */
export function aiReadContextFile(root: string, path: string, maxLines?: number): Promise<string> {
  return invokeCommand('ai_read_context_file', { root, path, maxLines }, { source: 'AI' })
}

/** 更新会话日志 .devforge/journal.md 中指定标记区间 */
export function aiUpdateJournalSection(root: string, marker: string, content: string): Promise<void> {
  return invokeCommand('ai_update_journal_section', { root, marker, content }, { source: 'AI' })
}

