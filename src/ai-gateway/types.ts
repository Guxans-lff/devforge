/**
 * AI Provider Gateway 核心类型定义
 *
 * 统一所有 AI 请求的入口类型，支持请求追踪、路由、成本统计。
 */

import type { ChatMessage } from '@/api/ai'
import type { AiStreamEvent, ProviderConfig, ModelConfig, AiProviderHealth as ProviderHealth } from '@/types/ai'
import type { FallbackCandidate } from './router'
import type { RateLimitConfig } from './rateLimiter'
import type { TokenEstimateResult } from './tokenEstimator'

/** 请求来源 */
export type AiGatewaySource =
  | 'chat'
  | 'compact'
  | 'tool'
  | 'prompt_optimize'
  | 'erp'
  | 'schema_compare'
  | 'workflow'
  | 'background_job'

/** 请求类型 */
export type AiGatewayRequestKind =
  | 'chat_completions'
  | 'responses'
  | 'compact'
  | 'prompt_optimize'
  | 'embedding'
  | 'rerank'
  | 'image'
  | 'audio'

/** Gateway 请求上下文 */
export interface AiGatewayContext {
  /** 全局唯一请求 ID（用于追踪） */
  requestId: string
  /** 所属会话 ID */
  sessionId: string
  /** 当前 turn ID */
  turnId?: string
  /** 请求来源 */
  source: AiGatewaySource
  /** 请求类型 */
  kind: AiGatewayRequestKind

  /** 选用的 Provider Profile ID */
  providerProfileId: string
  /** Provider 类型 */
  providerType: string
  /** 使用的模型 ID */
  model: string
  /** 上游模型名（如果有映射） */
  upstreamModel?: string

  /** 是否流式 */
  stream: boolean
  /** 当前重试次数 */
  retryIndex: number
  /** fallback 链 ID */
  fallbackChainId?: string
  primaryProviderId?: string
  primaryModel?: string
  fallbackReason?: string
  /** 上次错误（重试时携带） */
  lastError?: AiGatewayError

  /** 请求开始时间 */
  startedAt: number
  /** 首 token 到达时间 */
  firstTokenAt?: number
  /** 请求结束时间 */
  finishedAt?: number

  /** 请求前 token 预算估算 */
  tokenEstimate?: TokenEstimateResult
  /** 实际用量 */
  usage?: AiGatewayUsage
  /** 成本 */
  cost?: AiGatewayCost
}

/** Gateway 请求参数 */
export interface AiGatewayRequest {
  requestId?: string
  /** 会话 ID */
  sessionId: string
  /** 消息列表 */
  messages: ChatMessage[]
  /** 选用的 Provider */
  provider: ProviderConfig
  /** 选用的模型 */
  model: ModelConfig
  /** API Key */
  apiKey: string
  /** 按 Provider ID 覆盖 API Key，用于跨 Provider fallback */
  apiKeysByProvider?: Record<string, string | undefined>
  /** 系统提示词 */
  systemPrompt?: string
  /** 是否启用工具 */
  enableTools?: boolean
  /** 思考预算 */
  thinkingBudget?: number
  /** 最大 token 数 */
  maxTokens?: number
  /** 温度 */
  temperature?: number
  /** 请求来源 */
  source: AiGatewaySource
  /** 请求类型 */
  kind: AiGatewayRequestKind
  /** 是否流式 */
  stream?: boolean
  signal?: AbortSignal
  /** Fallback chain：当前路由失败时的备用候选 */
  fallbackChain?: FallbackCandidate[]
  /** 限流配置（默认使用 DEFAULT_RATE_LIMIT） */
  rateLimit?: RateLimitConfig
  /** 附加数据（供特定 source 使用） */
  metadata?: Record<string, unknown>
}

/** Gateway 执行结果 */
export interface AiGatewayResult {
  /** 状态 */
  status: 'success' | 'error' | 'cancelled'
  /** 生成的内容 */
  content: string
  /** 使用的模型 */
  model: string
  /** 完成原因 */
  finishReason: string
  /** 用量 */
  usage: AiGatewayUsage
  /** 成本 */
  cost?: AiGatewayCost
  /** 请求上下文 */
  context: AiGatewayContext
}

/** Gateway 错误 */
export class AiGatewayError extends Error {
  /** 错误类型 */
  type: 'timeout' | 'network' | 'rate_limit' | 'auth' | 'context_too_long'
    | 'provider_error' | 'cancelled' | 'user_rejected' | 'unknown'
  /** 是否可重试 */
  retryable: boolean
  /** HTTP 状态码（如有） */
  statusCode?: number
  /** 原始错误 */
  original?: unknown

  constructor(
    type: AiGatewayError['type'],
    message: string,
    retryable: boolean,
    original?: unknown,
  ) {
    super(message)
    this.name = 'AiGatewayError'
    this.type = type
    this.retryable = retryable
    this.original = original
  }
}

/** Token 用量 */
export interface AiGatewayUsage {
  /** 输入 token 数 */
  promptTokens: number
  /** 输出 token 数 */
  completionTokens: number
  /** 缓存读取 token 数 */
  cacheReadTokens?: number
  /** 总 token 数 */
  totalTokens: number
}

/** 成本记录 */
export interface AiGatewayCost {
  /** 输入成本 */
  inputCost: number
  /** 输出成本 */
  outputCost: number
  /** 缓存读取成本 */
  cacheReadCost?: number
  /** 总成本 */
  totalCost: number
  /** 币种 */
  currency: string
}

/** Provider Health 状态 */
export interface AiProviderHealth extends ProviderHealth {
  /** 状态 */
  status: 'unknown' | 'healthy' | 'degraded' | 'unhealthy'
  /** 最后检查时间 */
  checkedAt: number | null
  /** 延迟（ms） */
  latencyMs: number | null
  /** 是否支持流式 */
  supportsStream: boolean | null
  /** 是否支持工具 */
  supportsTools: boolean | null
  /** 是否返回 usage */
  supportsUsage: boolean | null
  /** 最后错误信息 */
  lastError: string | null
}

/** 带 Health 的 Provider Profile */
export interface ProviderProfileWithHealth extends ProviderConfig {
  health?: AiProviderHealth
}

/** Gateway 事件处理器 */
export type AiGatewayEventHandler = (event: AiStreamEvent) => void

/** 单次请求记录（用于追踪和诊断） */
export interface AiGatewayRequestRecord {
  /** 请求 ID */
  requestId: string
  /** 会话 ID */
  sessionId: string
  /** 来源 */
  source: AiGatewaySource
  /** 类型 */
  kind: AiGatewayRequestKind
  /** Provider ID */
  providerId: string
  /** 模型 */
  model: string
  /** 开始时间 */
  startedAt: number
  /** 首 token 时间 */
  firstTokenAt?: number
  /** 结束时间 */
  finishedAt?: number
  /** 状态 */
  status: 'running' | 'success' | 'error' | 'cancelled'
  /** 用量 */
  usage?: AiGatewayUsage
  /** 成本 */
  cost?: AiGatewayCost
  /** 错误 */
  error?: AiGatewayError
}
