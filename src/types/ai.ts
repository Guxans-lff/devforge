// AI 模块类型定义

// ─────────────────────────────────── Provider 配置 ───────────────────────────────────

/** Provider 类型 */
export type ProviderType = 'openai_compat' | 'anthropic'

/** 模型定价信息 */
export interface ModelPricing {
  /** 每百万输入 token 价格 */
  inputPer1m: number
  /** 每百万输出 token 价格 */
  outputPer1m: number
  /** 币种（如 "USD"、"CNY"） */
  currency: string
}

/** 模型能力描述 */
export interface ModelCapabilities {
  /** 是否支持流式输出 */
  streaming: boolean
  /** 是否支持图片输入（Vision） */
  vision: boolean
  /** 是否支持思考过程（Thinking/Reasoning） */
  thinking: boolean
  /** 是否支持工具调用 */
  toolUse: boolean
  /** 最大上下文 token 数 */
  maxContext: number
  /** 最大输出 token 数 */
  maxOutput: number
  /** 定价信息 */
  pricing?: ModelPricing
}

/** 单个模型配置 */
export interface ModelConfig {
  /** 模型 ID（API 调用使用） */
  id: string
  /** 模型显示名称 */
  name: string
  /** 模型能力 */
  capabilities: ModelCapabilities
}

/** Provider 配置 */
export interface ProviderConfig {
  id: string
  name: string
  providerType: ProviderType
  endpoint: string
  models: ModelConfig[]
  isDefault: boolean
  createdAt: number
}

// ─────────────────────────────────── 流式事件 ───────────────────────────────────

/** AI 流式事件（tagged union，与 Rust 端 AiStreamEvent 对应） */
export type AiStreamEvent =
  | { type: 'TextDelta'; delta: string }
  | { type: 'ThinkingDelta'; delta: string }
  | { type: 'ToolCall'; id: string; name: string; arguments: string }
  | { type: 'Usage'; prompt_tokens: number; completion_tokens: number; cache_read_tokens?: number }
  | { type: 'Done'; finish_reason: string }
  | { type: 'Error'; message: string; retryable: boolean }

// ─────────────────────────────────── 对话结果 ───────────────────────────────────

/** 单次对话调用结果 */
export interface ChatResult {
  content: string
  model: string
  promptTokens: number
  completionTokens: number
  finishReason: string
}

// ─────────────────────────────────── 会话 ───────────────────────────────────

/** AI 会话 */
export interface AiSession {
  id: string
  title: string
  providerId: string
  model: string
  systemPrompt?: string
  messageCount: number
  totalTokens: number
  estimatedCost: number
  tags?: string[]
  createdAt: number
  updatedAt: number
  workDir?: string
}

/** AI 消息（持久化记录） */
export interface AiMessageRecord {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  contentType: string
  tokens: number
  cost: number
  parentId?: string
  createdAt: number
}

/** AI 对话消息（运行时 UI 使用） */
export interface AiMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'error'
  content: string
  thinking?: string
  timestamp: number
  tokens?: number
  isStreaming?: boolean
  /** 工具调用列表（assistant 消息携带） */
  toolCalls?: ToolCallInfo[]
  /** 工具执行结果（内嵌到 assistant 消息中展示） */
  toolResults?: ToolResultInfo[]
}

// ─────────────────────────────────── Tool Use ───────────────────────────────────

/** 工具调用信息（前端运行时） */
export interface ToolCallInfo {
  id: string
  name: string
  arguments: string
  /** 解析后的参数对象 */
  parsedArgs?: Record<string, unknown>
  /** 执行状态 */
  status: 'pending' | 'running' | 'success' | 'error'
  /** 执行结果 */
  result?: string
  /** 错误信息 */
  error?: string
}

/** AI 文件操作信息 */
export interface FileOperation {
  /** 操作类型 */
  op: 'create' | 'modify' | 'delete'
  /** 文件路径 */
  path: string
  /** 文件名 */
  fileName: string
  /** 旧内容（modify 时存在） */
  oldContent?: string
  /** 新内容（create/modify 时存在） */
  newContent?: string
  /** 操作状态 */
  status: 'pending' | 'applied' | 'rejected' | 'error'
  /** 错误信息 */
  errorMessage?: string
  /** 关联的 toolCall ID */
  toolCallId: string
}

/** 工具执行结果（用于展示） */
export interface ToolResultInfo {
  toolCallId: string
  toolName: string
  success: boolean
  content: string
}

/** 工具定义（后端返回） */
export interface ToolDefinition {
  type: string
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** 工具执行结果（后端返回） */
export interface ToolExecResult {
  success: boolean
  content: string
}

// ─────────────────────────────────── 用量统计 ───────────────────────────────────

/** 每日用量统计 */
export interface DailyUsage {
  date: string
  providerId: string
  model: string
  requestCount: number
  promptTokens: number
  completionTokens: number
  estimatedCost: number
}

// ─────────────────────────────────── 文件附件 ───────────────────────────────────

/** 文件附件（用户选文件 → 读取 → 附带发送） */
export interface FileAttachment {
  /** 唯一 ID */
  id: string
  /** 文件名 */
  name: string
  /** 本地绝对路径 */
  path: string
  /** 文件大小（字节） */
  size: number
  /** 文件文本内容（读取后填充） */
  content?: string
  /** 行数 */
  lines?: number
  /** 读取状态 */
  status: 'pending' | 'reading' | 'ready' | 'error'
  /** 错误信息 */
  error?: string
}

// ─────────────────────────────────── 旧版兼容（截图翻译使用） ───────────────────────────────────

/** 旧版 AI 配置（保留兼容） */
export interface AiConfig {
  provider: string
  model: string
  endpoint: string
  maxTokens: number
}

/** 旧版 AI 结果 */
export interface AiResult {
  content: string
  model: string
  promptTokens: number
  completionTokens: number
}

// ─────────────────────────────────── 记忆系统 ───────────────────────────────────

/** 记忆类型 */
export type MemoryType = 'summary' | 'knowledge' | 'preference'

/** 记忆条目 */
export interface AiMemory {
  id: string
  workspaceId: string
  type: MemoryType
  title: string
  content: string
  tags: string
  sourceSessionId?: string
  weight: number
  lastUsedAt?: number
  createdAt: number
  updatedAt: number
}

/** 压缩记录 */
export interface AiCompaction {
  id: string
  sessionId: string
  summary: string
  originalCount: number
  originalTokens: number
  createdAt: number
}

/** 压缩规则配置 */
export interface CompactRule {
  /** P0-必须保留的内容描述 */
  p0: string
  /** P1-尽量保留的内容描述 */
  p1: string
  /** P2-立即丢弃的内容描述 */
  p2: string
  /** 压缩比目标（如 0.2 表示压缩到 20%） */
  ratio: number
}
