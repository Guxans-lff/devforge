/**
 * Token Estimator 鈥?璇锋眰鍓?token 棰勭畻浼扮畻
 *
 * 鎻愪緵杞婚噺绾с€佹棤闇€澶栭儴渚濊禆鐨?token 浼扮畻锛岀敤浜庯細
 * - 棰勭畻鎺у埗锛堥槻姝㈣秴鍑烘ā鍨?maxContext锛? * - 璺敱鍐崇瓥锛堥€夋嫨鑳藉绾宠姹傜殑妯″瀷锛? * - 鎴愭湰棰勪及锛堝彂閫佸墠灞曠ず澶ц嚧璐圭敤锛? */

import type { ChatMessage } from '@/api/ai'
import type { ModelConfig } from '@/types/ai'

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 甯搁噺 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/** 姣忔秷鎭浐瀹氬紑閿€锛坮ole + 鏍煎紡鍖呰锛?*/
const MESSAGE_OVERHEAD_TOKENS = 4

/** 绯荤粺鎻愮ず璇嶅浐瀹氬紑閿€ */
const SYSTEM_PROMPT_OVERHEAD = 4

/** 宸ュ叿瀹氫箟骞冲潎寮€閿€锛堢畝鍖栦及绠楋級 */
const TOOLS_OVERHEAD_TOKENS = 800

/** 涓枃鏂囨湰瀛楃鈫抰oken 姣斾緥 */
const CJK_CHAR_RATIO = 1 / 1.5

/** 鑻辨枃/浠ｇ爜瀛楃鈫抰oken 姣斾緥 */
const ASCII_CHAR_RATIO = 1 / 4

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 绫诲瀷 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface TokenEstimateInput {
  /** 娑堟伅鍒楄〃 */
  messages: ChatMessage[]
  /** 绯荤粺鎻愮ず璇?*/
  systemPrompt?: string
  /** 鏄惁鍚敤宸ュ叿锛堜細澧炲姞鍥哄畾寮€閿€锛?*/
  enableTools?: boolean
  /** 鐩爣妯″瀷锛堢敤浜庤幏鍙?maxContext锛?*/
  model: ModelConfig
  /** 鏈熸湜鏈€澶ц緭鍑?token锛堥粯璁ょ敤妯″瀷 maxOutput 鐨?50%锛?*/
  targetMaxTokens?: number
}

export interface TokenEstimateResult {
  /** 棰勪及杈撳叆 token */
  inputTokens: number
  /** 棰勪及杈撳嚭 token */
  estimatedOutputTokens: number
  /** 棰勪及鎬?token */
  estimatedTotalTokens: number
  /** 浼扮畻鏂规硶 */
  method: 'char_ratio' | 'historical'
  /** 鏄惁鍦ㄩ绠楀唴 */
  withinBudget: boolean
  /** 棰勭畻鍓╀綑 */
  budgetRemaining: number
  /** 棰勭畻浣跨敤鐜?*/
  budgetUsageRatio: number
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 鏍稿績浼扮畻 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * 妫€娴嬫枃鏈腑 CJK锛堜腑鏃ラ煩锛夊瓧绗︽瘮渚? */
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
 * 鏍规嵁鏂囨湰璇█娣峰悎姣斾緥閫夋嫨瀛楃鈫抰oken 姣斾緥
 */
function chooseCharRatio(text: string): number {
  const cjkRatio = detectCjkRatio(text)
  // 绾挎€ф彃鍊硷細CJK 瓒婂姣斾緥瓒婇珮
  return cjkRatio * CJK_CHAR_RATIO + (1 - cjkRatio) * ASCII_CHAR_RATIO
}

/**
 * 浼扮畻鍗曟鏂囨湰鐨?token 鏁? */
export function estimateTextTokens(text: string): number {
  if (!text || text.length === 0) return 0
  const ratio = chooseCharRatio(text)
  return Math.ceil(text.length * ratio)
}

/**
 * 浼扮畻娑堟伅鍒楄〃鐨勮緭鍏?token
 */
export function estimateInputTokens(
  messages: ChatMessage[],
  systemPrompt?: string,
  enableTools?: boolean,
): number {
  let tokens = 0

  // 绯荤粺鎻愮ず璇?
  if (systemPrompt && systemPrompt.length > 0) {
    tokens += SYSTEM_PROMPT_OVERHEAD + estimateTextTokens(systemPrompt)
  }

  // 娑堟伅鍒楄〃
  for (const msg of messages) {
    tokens += MESSAGE_OVERHEAD_TOKENS
    const content = typeof msg.content === 'string' ? msg.content : ''
    tokens += estimateTextTokens(content)
    // 宸ュ叿璋冪敤鍚嶇О+鍙傛暟涔熺畻鍏ワ紙绠€鍖栦及绠楋級
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        tokens += estimateTextTokens(tc.function.name)
        tokens += estimateTextTokens(tc.function.arguments)
        tokens += 4 // 宸ュ叿璋冪敤寮€閿€
      }
    }
  }

  // 宸ュ叿瀹氫箟寮€閿€
  if (enableTools) {
    tokens += TOOLS_OVERHEAD_TOKENS
  }

  return tokens
}

/**
 * 浼扮畻杈撳嚭 token
 *
 * 绛栫暐锛氫紭鍏堢敤璋冪敤鏂规彁渚涚殑 targetMaxTokens锛屽惁鍒欏彇妯″瀷 maxOutput 鐨?50%
 */
function estimateOutputTokens(model: ModelConfig, targetMaxTokens?: number): number {
  if (targetMaxTokens && targetMaxTokens > 0) {
    return targetMaxTokens
  }
  const maxOutput = model.capabilities.maxOutput
  if (maxOutput && maxOutput > 0) {
    return Math.floor(maxOutput * 0.5)
  }
  return 1024 // 鍏滃簳
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 瀹屾暣浼扮畻 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * 瀵逛竴娆?Gateway 璇锋眰鍋氬畬鏁?token 棰勭畻浼扮畻
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

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 鎴愭湰棰勪及 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface CostEstimateInput {
  inputTokens: number
  estimatedOutputTokens: number
  model: ModelConfig
}

export interface CostEstimateResult {
  /** 棰勪及杈撳叆鎴愭湰 */
  estimatedInputCost: number
  /** 棰勪及杈撳嚭鎴愭湰 */
  estimatedOutputCost: number
  /** 棰勪及鎬绘垚鏈?*/
  estimatedTotalCost: number
  /** 甯佺 */
  currency: string
  /** 鏄惁鏈夊畾浠蜂俊鎭?*/
  hasPricing: boolean
}

/**
 * 鏍规嵁 token 浼扮畻鍜屾ā鍨嬪畾浠疯绠楅浼版垚鏈? */
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
