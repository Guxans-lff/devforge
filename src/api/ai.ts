import { Channel } from '@tauri-apps/api/core'
import { invokeCommand } from '@/api/base'
import { invokeAiCommand, AiBridgeError } from '@/api/ai/errors'
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
  McpStatusResult,
  ContentBlock,
} from '@/types/ai'

export { AiBridgeError }

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
    responseFormat: params.responseFormat ?? null,
    prefixCompletion: params.prefixCompletion ?? null,
    prefixContent: params.prefixContent ?? null,
    onEvent: channel,
  }, { source: 'AI' })
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
  return invokeCommand('ai_create_completion', {
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

export interface AnalyzeDatabaseSqlErrorParams {
  providerType: string
  model: string
  apiKey: string
  endpoint: string
  sql: string
  error: string
  database?: string
  driver?: string
  executionMode?: 'single' | 'multi' | 'batch'
}

export function buildDatabaseSqlErrorAnalysisPrompt(params: AnalyzeDatabaseSqlErrorParams): ChatMessage[] {
  const context = [
    `数据库驱动: ${params.driver || 'unknown'}`,
    `当前数据库: ${params.database || '未选择'}`,
    `执行模式: ${params.executionMode || 'single'}`,
    '',
    '[SQL]',
    params.sql,
    '',
    '[ERROR]',
    params.error,
  ].join('\n')

  return [
    {
      role: 'system',
      content: [
        '你是资深数据库故障分析助手。',
        '你只根据给定 SQL、错误信息和最小上下文分析，不要编造不存在的表结构。',
        '请输出严格 JSON，对象字段固定为 summary、fixSql、explanation。',
        'summary 用一句中文概括根因；fixSql 填修复后的 SQL，若信息不足则返回空字符串；explanation 用中文说明修改原因与注意点。',
        '不要输出 markdown 代码块，不要输出 JSON 之外的任何文字。',
      ].join(' '),
    },
    {
      role: 'user',
      content: context,
    },
  ]
}

export function analyzeDatabaseSqlError(
  params: AnalyzeDatabaseSqlErrorParams,
  onEvent: (event: AiStreamEvent) => void,
): Promise<ChatResult> {
  return aiChatStream({
    sessionId: crypto.randomUUID(),
    messages: buildDatabaseSqlErrorAnalysisPrompt(params),
    providerType: params.providerType,
    model: params.model,
    apiKey: params.apiKey,
    endpoint: params.endpoint,
    temperature: 0.2,
    maxTokens: 1200,
  }, onEvent)
}

export function aiAbortStream(sessionId: string): Promise<boolean> {
  return invokeCommand('ai_abort_stream', { sessionId }, { source: 'AI' })
}

export function aiListProviders(): Promise<ProviderConfig[]> {
  return invokeCommand('ai_list_providers', undefined, { source: 'AI' })
}

export function aiSaveProvider(config: ProviderConfig): Promise<void> {
  return invokeCommand('ai_save_provider', { config }, { source: 'AI' })
}

export function aiDeleteProvider(id: string): Promise<void> {
  return invokeCommand('ai_delete_provider', { id }, { source: 'AI' })
}

export interface ProviderRemoteModel {
  id: string
  object?: string
  ownedBy?: string
}

export interface ProviderModelsResponse {
  models: ProviderRemoteModel[]
}

export function aiListProviderModels(endpoint: string, apiKey: string): Promise<ProviderModelsResponse> {
  return invokeCommand('ai_list_provider_models', { endpoint, apiKey }, { source: 'AI' })
}

export function aiSaveSession(session: AiSession): Promise<void> {
  return invokeCommand('ai_save_session', { session }, { source: 'AI' })
}

export function aiListSessions(): Promise<AiSession[]> {
  return invokeCommand('ai_list_sessions', undefined, { source: 'AI' })
}

export function aiGetSession(id: string, messageLimit?: number): Promise<AiSessionDetail | null> {
  return invokeCommand('ai_get_session', { id, messageLimit: messageLimit ?? null }, { source: 'AI' })
}

export function aiDeleteSession(id: string): Promise<void> {
  return invokeCommand('ai_delete_session', { id }, { source: 'AI' })
}

export function aiSaveMessage(message: AiMessageRecord): Promise<void> {
  return invokeCommand('ai_save_message', { message }, { source: 'AI' })
}

export interface AiTranscriptEventRecord {
  id: string
  sessionId: string
  turnId?: string | null
  eventType: string
  timestamp: number
  payloadJson: string
}

export function aiAppendTranscriptEvent(event: AiTranscriptEventRecord): Promise<void> {
  return invokeCommand('ai_append_transcript_event', { event }, { source: 'AI', silent: true })
}

export function aiListTranscriptEvents(sessionId: string, limit?: number): Promise<AiTranscriptEventRecord[]> {
  return invokeCommand('ai_list_transcript_events', { sessionId, limit: limit ?? null }, { source: 'AI', silent: true })
}

export function aiCountTranscriptEvents(sessionId: string): Promise<number> {
  return invokeCommand('ai_count_transcript_events', { sessionId }, { source: 'AI', silent: true })
}

export function aiGetUsageStats(startDate: string, endDate: string): Promise<DailyUsage[]> {
  return invokeCommand('ai_get_usage_stats', { startDate, endDate }, { source: 'AI' })
}

export function aiGetTools(): Promise<ToolDefinition[]> {
  return invokeCommand('ai_get_tools', undefined, { source: 'AI' })
}

export function aiGetMcpStatus(workDir: string): Promise<McpStatusResult> {
  return invokeAiCommand('ai_get_mcp_status', { workDir }, { source: 'AI' })
}

export function aiExecuteTool(
  name: string,
  args: string,
  workDir: string,
  sessionId: string,
  toolCallId: string,
  timeoutMs?: number,
): Promise<ToolExecResult> {
  return invokeCommand(
    'ai_execute_tool',
    { name, arguments: args, workDir, sessionId, toolCallId, timeoutMs: timeoutMs ?? null },
    { source: 'AI' },
  )
}

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

export function aiReadWorkspaceConfig(root: string): Promise<string | null> {
  return invokeCommand('ai_read_workspace_config', { root }, { source: 'AI' })
}

export function aiWriteWorkspaceConfig(root: string, content: string): Promise<void> {
  return invokeCommand('ai_write_workspace_config', { root, content }, { source: 'AI' })
}

export function aiReadContextFile(root: string, path: string, maxLines?: number): Promise<string> {
  return invokeCommand('ai_read_context_file', { root, path, maxLines: maxLines ?? null }, { source: 'AI' })
}

export function aiUpdateJournalSection(root: string, marker: string, content: string): Promise<void> {
  return invokeCommand('ai_update_journal_section', { root, marker, content }, { source: 'AI' })
}
