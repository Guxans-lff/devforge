/**
 * AI 上下文预算分析器
 *
 * 将会话上下文拆分为不同类别，统计各类别 token 占用，
 * 帮助用户理解"为什么上下文快满了"并提供清理建议。
 */

import { estimateTokens } from '@/utils/file-markers'
import type { AiMessage, FileAttachment, AiMemory } from '@/types/ai'

/** 预算分类键 */
export type BudgetCategoryKey =
  | 'systemPrompt'
  | 'memory'
  | 'messages'
  | 'toolResults'
  | 'attachments'
  | 'compactSummary'
  | 'safetyContext'

/** 单条明细项 */
export interface BudgetItem {
  label: string
  tokens: number
  detail?: string
}

/** 单个分类统计 */
export interface BudgetCategory {
  key: BudgetCategoryKey
  label: string
  tokens: number
  itemCount: number
  description: string
  items?: BudgetItem[]
}

/** 预算分析报告 */
export interface ContextBudgetReport {
  categories: BudgetCategory[]
  totalTokens: number
  maxContextTokens: number
  usagePercent: number
  largestCategoryKey: BudgetCategoryKey | null
  recommendations: string[]
  timestamp: number
}

/** 分析选项 */
export interface AnalyzeContextBudgetOptions {
  /** 系统提示文本 */
  systemPrompt?: string
  /** 已加载的项目记忆列表 */
  memories?: AiMemory[]
  /** 当前会话消息列表 */
  messages: AiMessage[]
  /** 待发送的文件附件 */
  attachments?: FileAttachment[]
  /** 模型最大上下文 token 数 */
  maxContextTokens: number
  /** 当前压缩摘要文本 */
  compactSummary?: string
  /** 安全/权限上下文文本 */
  safetyContext?: string
}

const CATEGORY_LABELS: Record<BudgetCategoryKey, string> = {
  systemPrompt: 'System Prompt',
  memory: '项目记忆',
  messages: '会话消息',
  toolResults: '工具结果',
  attachments: '文件附件',
  compactSummary: '压缩摘要',
  safetyContext: '安全上下文',
}

const CATEGORY_DESCRIPTIONS: Record<BudgetCategoryKey, string> = {
  systemPrompt: '系统提示、模式后缀、工具指南、输出风格',
  memory: '从项目记忆中召回的相关上下文',
  messages: '当前会话中的用户和 AI 消息',
  toolResults: '工具调用返回的原始结果',
  attachments: '用户附加的文件内容',
  compactSummary: '历史压缩后保留的摘要',
  safetyContext: '权限模式、审批状态等安全信息',
}

const MESSAGE_ANALYSIS_LIMIT = 80
const TEXT_ESTIMATE_LIMIT = 8_000

function estimateBoundedTokens(text?: string | null): number {
  const value = text ?? ''
  if (value.length <= TEXT_ESTIMATE_LIMIT) return estimateTokens(value)

  const sampled = `${value.slice(0, TEXT_ESTIMATE_LIMIT / 2)}${value.slice(-TEXT_ESTIMATE_LIMIT / 2)}`
  return estimateTokens(sampled) + Math.ceil((value.length - sampled.length) / 3.5)
}

/**
 * 估算单条消息的 token 数
 *
 * 优先使用消息自带的 tokens/totalTokens，否则按字符估算。
 */
function estimateMessageTokens(message: AiMessage): number {
  if (message.totalTokens && message.totalTokens > 0) {
    return message.totalTokens
  }
  if (message.tokens && message.tokens > 0) {
    return message.tokens
  }
  let text = message.content ?? ''
  if (message.thinking) {
    text += message.thinking
  }
  return estimateBoundedTokens(text)
}

/**
 * 分析会话上下文预算
 */
export function analyzeContextBudget(
  options: AnalyzeContextBudgetOptions,
): ContextBudgetReport {
  const {
    systemPrompt,
    memories,
    messages,
    attachments,
    maxContextTokens,
    compactSummary,
    safetyContext,
  } = options

  const now = Date.now()
  const categories: BudgetCategory[] = []

  // 1. System Prompt
  const systemPromptTokens = estimateBoundedTokens(systemPrompt)
  categories.push({
    key: 'systemPrompt',
    label: CATEGORY_LABELS.systemPrompt,
    tokens: systemPromptTokens,
    itemCount: systemPrompt ? 1 : 0,
    description: CATEGORY_DESCRIPTIONS.systemPrompt,
  })

  // 2. Memory
  const memoryItems: BudgetItem[] = []
  let memoryTokens = 0
  if (memories && memories.length > 0) {
    for (const memory of memories) {
      const tokens = estimateBoundedTokens(memory.content)
      memoryTokens += tokens
      memoryItems.push({
        label: memory.title || memory.type,
        tokens,
        detail: memory.type,
      })
    }
  }
  categories.push({
    key: 'memory',
    label: CATEGORY_LABELS.memory,
    tokens: memoryTokens,
    itemCount: memoryItems.length,
    description: CATEGORY_DESCRIPTIONS.memory,
    items: memoryItems.length > 0 ? memoryItems : undefined,
  })

  // 3. Messages + 4. Tool Results（同一轮遍历）
  let messageTokens = 0
  let toolResultTokens = 0
  const messageItems: BudgetItem[] = []
  const toolResultItems: BudgetItem[] = []

  const analyzedMessages = messages.length > MESSAGE_ANALYSIS_LIMIT
    ? messages.slice(-MESSAGE_ANALYSIS_LIMIT)
    : messages

  for (const message of analyzedMessages) {
    // 跳过分割线和边界标记
    if (message.type === 'divider' || message.type === 'compact-boundary' || message.type === 'rewind-boundary') {
      continue
    }

    const msgTokens = estimateMessageTokens(message)
    messageTokens += msgTokens
    messageItems.push({
      label: message.role === 'user' ? 'User' : 'Assistant',
      tokens: msgTokens,
      detail: message.content?.slice(0, 40).replace(/\n/g, ' ') + (message.content && message.content.length > 40 ? '...' : ''),
    })

    // 工具结果单独统计
    if (message.toolResults && message.toolResults.length > 0) {
      for (const result of message.toolResults) {
        const trTokens = estimateBoundedTokens(result.content)
        toolResultTokens += trTokens
        toolResultItems.push({
          label: result.toolName,
          tokens: trTokens,
          detail: result.success ? 'success' : 'error',
        })
      }
    }
  }

  categories.push({
    key: 'messages',
    label: CATEGORY_LABELS.messages,
    tokens: messageTokens,
    itemCount: messageItems.length,
    description: CATEGORY_DESCRIPTIONS.messages,
    items: messageItems.length > 0 ? messageItems.slice(-10) : undefined, // 只保留最近 10 条避免过大
  })

  categories.push({
    key: 'toolResults',
    label: CATEGORY_LABELS.toolResults,
    tokens: toolResultTokens,
    itemCount: toolResultItems.length,
    description: CATEGORY_DESCRIPTIONS.toolResults,
    items: toolResultItems.length > 0 ? toolResultItems.slice(-10) : undefined,
  })

  // 5. Attachments
  const attachmentItems: BudgetItem[] = []
  let attachmentTokens = 0
  if (attachments && attachments.length > 0) {
    for (const attachment of attachments) {
      const tokens = estimateBoundedTokens(attachment.content)
      attachmentTokens += tokens
      attachmentItems.push({
        label: attachment.name,
        tokens,
        detail: `${attachment.lines ?? 0} lines`,
      })
    }
  }
  categories.push({
    key: 'attachments',
    label: CATEGORY_LABELS.attachments,
    tokens: attachmentTokens,
    itemCount: attachmentItems.length,
    description: CATEGORY_DESCRIPTIONS.attachments,
    items: attachmentItems.length > 0 ? attachmentItems : undefined,
  })

  // 6. Compact Summary
  const compactTokens = estimateBoundedTokens(compactSummary)
  categories.push({
    key: 'compactSummary',
    label: CATEGORY_LABELS.compactSummary,
    tokens: compactTokens,
    itemCount: compactSummary ? 1 : 0,
    description: CATEGORY_DESCRIPTIONS.compactSummary,
  })

  // 7. Safety Context
  const safetyTokens = estimateBoundedTokens(safetyContext)
  categories.push({
    key: 'safetyContext',
    label: CATEGORY_LABELS.safetyContext,
    tokens: safetyTokens,
    itemCount: safetyContext ? 1 : 0,
    description: CATEGORY_DESCRIPTIONS.safetyContext,
  })

  const totalTokens = categories.reduce((sum, c) => sum + c.tokens, 0)
  const usagePercent = maxContextTokens > 0
    ? Math.min(100, Math.round((totalTokens / maxContextTokens) * 100))
    : 0

  // 找出最大分类
  let largestCategoryKey: BudgetCategoryKey | null = null
  let largestTokens = 0
  for (const category of categories) {
    if (category.tokens > largestTokens) {
      largestTokens = category.tokens
      largestCategoryKey = category.key
    }
  }

  // 生成建议
  const recommendations: string[] = []
  if (usagePercent >= 90) {
    recommendations.push('上下文使用率已超过 90%，建议立即压缩历史消息')
  } else if (usagePercent >= 75) {
    recommendations.push('上下文使用率较高，建议适时压缩')
  }

  if (toolResultTokens > 0 && totalTokens > 0 && toolResultTokens / totalTokens > 0.4) {
    recommendations.push('工具结果占用比例过高，可考虑清理部分工具输出')
  }

  if (attachmentTokens > 0 && totalTokens > 0 && attachmentTokens / totalTokens > 0.3) {
    recommendations.push('文件附件占用较多上下文，建议移除不必要的大文件')
  }

  if (messageTokens > 0 && totalTokens > 0 && messageTokens / totalTokens > 0.5) {
    recommendations.push('会话消息占比较大，压缩历史可释放大量空间')
  }

  if (memoryTokens > 0 && totalTokens > 0 && memoryTokens / totalTokens > 0.25) {
    recommendations.push('项目记忆占用较多，可检查是否有冗余记忆条目')
  }

  return {
    categories,
    totalTokens,
    maxContextTokens,
    usagePercent,
    largestCategoryKey,
    recommendations,
    timestamp: now,
  }
}

/**
 * 获取单个分类的占比（百分比）
 */
export function getCategoryPercent(
  report: ContextBudgetReport,
  key: BudgetCategoryKey,
): number {
  const category = report.categories.find(c => c.key === key)
  if (!category || report.totalTokens === 0) return 0
  return Math.round((category.tokens / report.totalTokens) * 100)
}
