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
  | { type: 'Usage'; prompt_tokens: number; completion_tokens: number }
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
}

/** AI 消息（持久化记录） */
export interface AiMessageRecord {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
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
