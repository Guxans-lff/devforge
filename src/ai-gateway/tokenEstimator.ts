/**
 * Token Estimator —— 请求前 token 预算估算
 *
 * 提供轻量级、无需外部依赖的 token 估算，用于：
 * - 预算控制：防止超过模型 maxContext
 * - 路由决策：选择能容纳请求的模型
 * - 成本预估：发送前展示大致费用
 */

import type { ChatMessage } from '@/api/ai'
import type { ModelConfig } from '@/types/ai'

/** 每条消息固定开销（role + 格式包装） */
const MESSAGE_OVERHEAD_TOKENS = 4

/** 系统提示词固定开销 */
const SYSTEM_PROMPT_OVERHEAD = 4

/** 工具定义平均开销（简化估算） */
const TOOLS_OVERHEAD_TOKENS = 800

/** 中文文本字符→token 比例 */
const CJK_CHAR_RATIO = 1 / 1.5

/** 英文/代码字符→token 比例 */
const ASCII_CHAR_RATIO = 1 / 4

export interface TokenEstimateInput {
  /** 消息列表 */
  messages: ChatMessage[]
  /** 系统提示词 */
  systemPrompt?: string
  /** 是否启用工具（会增加固定开销） */
  enableTools?: boolean
  /** 目标模型（用于获取 maxContext） */
  model: ModelConfig
  /** 期望最大输出 token（默认使用模型 maxOutput 的 50%） */
  targetMaxTokens?: number
}

export interface TokenEstimateResult {
  /** 预估输入 token */
  inputTokens: number
  /** 预估输出 token */
  estimatedOutputTokens: number
  /** 预估总 token */
  estimatedTotalTokens: number
  /** 估算方法 */
  method: 'char_ratio' | 'historical'
  /** 是否在预算内 */
  withinBudget: boolean
  /** 预算剩余 */
  budgetRemaining: number
  /** 预算使用率 */
  budgetUsageRatio: number
}

/**
 * 检测文本中 CJK（中日韩）字符比例
 */
function detectCjkRatio(text: string): number {
  if (text.length === 0) return 0
  let cjkCount = 0
  for (const char of text) {
    const code = char.charCodeAt(0)
    // CJK Unified Ideographs + CJK Extensions + Hangul + Hiragana + Katakana
    if (
      (code >= 0x4e00 && code <= 0x9fff)
      || (code >= 0x3400 && code <= 0x4dbf)
      || (code >= 0x3000 && code <= 0x303f)
      || (code >= 0x3040 && code <= 0x309f)
      || (code >= 0x30a0 && code <= 0x30ff)
      || (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjkCount++
    }
  }
  return cjkCount / text.length
}

/**
 * 根据文本语言混合比例选择字符→token 比例
 */
function chooseCharRatio(text: string): number {
  const cjkRatio = detectCjkRatio(text)
  // 线性插值：CJK 越多比例越高
  return cjkRatio * CJK_CHAR_RATIO + (1 - cjkRatio) * ASCII_CHAR_RATIO
}

/**
 * 估算单段文本的 token 数
 */
export function estimateTextTokens(text: string): number {
  if (!text || text.length === 0) return 0
  const ratio = chooseCharRatio(text)
  return Math.ceil(text.length * ratio)
}

/**
 * 估算消息列表的输入 token
 */
export function estimateInputTokens(
  messages: ChatMessage[],
  systemPrompt?: string,
  enableTools?: boolean,
): number {
  let tokens = 0

  // 系统提示词
  if (systemPrompt && systemPrompt.length > 0) {
    tokens += SYSTEM_PROMPT_OVERHEAD + estimateTextTokens(systemPrompt)
  }

  // 消息列表
  for (const msg of messages) {
    tokens += MESSAGE_OVERHEAD_TOKENS
    const content = typeof msg.content === 'string' ? msg.content : ''
    tokens += estimateTextTokens(content)
    // 工具调用名称和参数也计入（简化估算）
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        tokens += estimateTextTokens(tc.function.name)
        tokens += estimateTextTokens(tc.function.arguments)
        tokens += 4 // 工具调用开销
      }
    }
  }

  // 工具定义开销
  if (enableTools) {
    tokens += TOOLS_OVERHEAD_TOKENS
  }

  return tokens
}

/**
 * 估算输出 token
 *
 * 策略：优先使用调用方提供的 targetMaxTokens，否则取模型 maxOutput 的 50%
 */
function estimateOutputTokens(model: ModelConfig, targetMaxTokens?: number): number {
  if (targetMaxTokens && targetMaxTokens > 0) {
    return targetMaxTokens
  }
  const maxOutput = model.capabilities.maxOutput
  if (maxOutput && maxOutput > 0) {
    return Math.floor(maxOutput * 0.5)
  }
  return 1024 // 兜底
}

/**
 * 对一次 Gateway 请求做完整 token 预算估算
 */
export function estimateRequestTokens(input: TokenEstimateInput): TokenEstimateResult {
  const inputTokens = estimateInputTokens(input.messages, input.systemPrompt, input.enableTools)
  const estimatedOutputTokens = estimateOutputTokens(input.model, input.targetMaxTokens)
  const estimatedTotalTokens = inputTokens + estimatedOutputTokens

  const maxContext = input.model.capabilities.maxContext
  const withinBudget = maxContext > 0 ? estimatedTotalTokens <= maxContext : true
  const budgetRemaining = maxContext > 0 ? Math.max(0, maxContext - estimatedTotalTokens) : Infinity
  const budgetUsageRatio = maxContext > 0 ? estimatedTotalTokens / maxContext : 0

  return {
    inputTokens,
    estimatedOutputTokens,
    estimatedTotalTokens,
    method: 'char_ratio',
    withinBudget,
    budgetRemaining,
    budgetUsageRatio,
  }
}

export interface CostEstimateInput {
  inputTokens: number
  estimatedOutputTokens: number
  model: ModelConfig
}

export interface CostEstimateResult {
  /** 预估输入成本 */
  estimatedInputCost: number
  /** 预估输出成本 */
  estimatedOutputCost: number
  /** 预估总成本 */
  estimatedTotalCost: number
  /** 币种 */
  currency: string
  /** 是否有定价信息 */
  hasPricing: boolean
}

/**
 * 根据 token 估算和模型定价计算预估成本
 */
export function estimateCost(input: CostEstimateInput): CostEstimateResult {
  const pricing = input.model.capabilities.pricing
  if (!pricing) {
    return {
      estimatedInputCost: 0,
      estimatedOutputCost: 0,
      estimatedTotalCost: 0,
      currency: 'USD',
      hasPricing: false,
    }
  }

  const inputCost = (input.inputTokens / 1_000_000) * pricing.inputPer1m
  const outputCost = (input.estimatedOutputTokens / 1_000_000) * pricing.outputPer1m

  return {
    estimatedInputCost: inputCost,
    estimatedOutputCost: outputCost,
    estimatedTotalCost: inputCost + outputCost,
    currency: pricing.currency,
    hasPricing: true,
  }
}
