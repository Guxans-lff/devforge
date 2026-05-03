/**
 * AI Gateway 使用记录追踪器
 *
 * 记录每次请求的用量和成本，支持按 session/provider/model/source 聚合。
 * 数据暂存内存，后续可接入持久化。
 */

import type { AiGatewayUsage, AiGatewayCost, AiGatewayError, AiGatewaySource, AiGatewayRequestKind } from './types'

export interface AiGatewayUsageRecord {
  requestId: string
  sessionId: string
  source: AiGatewaySource
  kind: AiGatewayRequestKind
  providerProfileId?: string
  providerId: string
  model: string
  primaryProviderId?: string
  primaryModel?: string
  fallbackReason?: string
  fallbackChainId?: string
  retryIndex?: number
  startedAt: number
  firstTokenAt?: number
  finishedAt: number
  status: 'success' | 'error' | 'cancelled'
  usage?: AiGatewayUsage
  cost?: AiGatewayCost
  error?: AiGatewayError
}

/** 内存中的使用记录 */
const usageRecords: AiGatewayUsageRecord[] = []

/** 最大保留记录数 */
const MAX_RECORDS = 1000

/**
 * 记录一次请求的使用情况
 */
export function recordUsage(record: AiGatewayUsageRecord): void {
  usageRecords.push(record)
  // 限制内存大小
  if (usageRecords.length > MAX_RECORDS) {
    usageRecords.splice(0, usageRecords.length - MAX_RECORDS)
  }
}

/**
 * 获取所有记录
 */
export function getUsageRecords(): readonly AiGatewayUsageRecord[] {
  return usageRecords
}

/** 获取最近发生过 fallback 的请求记录 */
export function getRecentFallbackRecords(limit = 5): AiGatewayUsageRecord[] {
  return usageRecords
    .filter(record => (record.retryIndex ?? 0) > 0 || !!record.primaryProviderId)
    .slice(-limit)
    .reverse()
}

/**
 * 按会话 ID 获取记录
 */
export function getUsageRecordsBySession(sessionId: string): AiGatewayUsageRecord[] {
  return usageRecords.filter(r => r.sessionId === sessionId)
}

/**
 * 获取本会话的用量汇总
 */
export function getSessionUsageSummary(sessionId: string): {
  requestCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  totalCost: number
  currency: string
  errorCount: number
} {
  const records = getUsageRecordsBySession(sessionId)
  const currency = records.find(r => r.cost)?.cost?.currency || 'USD'

  return records.reduce(
    (sum, r) => {
      sum.requestCount += 1
      sum.promptTokens += r.usage?.promptTokens ?? 0
      sum.completionTokens += r.usage?.completionTokens ?? 0
      sum.totalTokens += r.usage?.totalTokens ?? 0
      sum.totalCost += r.cost?.totalCost ?? 0
      sum.errorCount += r.status === 'error' ? 1 : 0
      return sum
    },
    {
      requestCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      currency,
      errorCount: 0,
    },
  )
}

/**
 * 清空记录（用于测试或重置）
 */
export function clearUsageRecords(): void {
  usageRecords.length = 0
}

/**
 * 按 Provider 汇总
 */
export function getProviderUsageSummary(providerId: string): {
  requestCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  totalCost: number
  currency: string
} {
  const records = usageRecords.filter(r => r.providerId === providerId)
  const currency = records.find(r => r.cost)?.cost?.currency || 'USD'

  return records.reduce(
    (sum, r) => {
      sum.requestCount += 1
      sum.promptTokens += r.usage?.promptTokens ?? 0
      sum.completionTokens += r.usage?.completionTokens ?? 0
      sum.totalTokens += r.usage?.totalTokens ?? 0
      sum.totalCost += r.cost?.totalCost ?? 0
      return sum
    },
    { requestCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, totalCost: 0, currency },
  )
}

/**
 * 按 Model 汇总
 */
export function getModelUsageSummary(model: string): {
  requestCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  totalCost: number
  currency: string
} {
  const records = usageRecords.filter(r => r.model === model)
  const currency = records.find(r => r.cost)?.cost?.currency || 'USD'

  return records.reduce(
    (sum, r) => {
      sum.requestCount += 1
      sum.promptTokens += r.usage?.promptTokens ?? 0
      sum.completionTokens += r.usage?.completionTokens ?? 0
      sum.totalTokens += r.usage?.totalTokens ?? 0
      sum.totalCost += r.cost?.totalCost ?? 0
      return sum
    },
    { requestCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, totalCost: 0, currency },
  )
}

/**
 * 按 Source 汇总
 */
export function getSourceUsageSummary(source: string): {
  requestCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  totalCost: number
  currency: string
  errorCount: number
} {
  const records = usageRecords.filter(r => r.source === source)
  const currency = records.find(r => r.cost)?.cost?.currency || 'USD'

  return records.reduce(
    (sum, r) => {
      sum.requestCount += 1
      sum.promptTokens += r.usage?.promptTokens ?? 0
      sum.completionTokens += r.usage?.completionTokens ?? 0
      sum.totalTokens += r.usage?.totalTokens ?? 0
      sum.totalCost += r.cost?.totalCost ?? 0
      sum.errorCount += r.status === 'error' ? 1 : 0
      return sum
    },
    { requestCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, totalCost: 0, currency, errorCount: 0 },
  )
}

/**
 * 获取全局用量汇总
 */
export function getGlobalUsageSummary(): {
  totalRequests: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  totalCost: number
  currency: string
  errorCount: number
  successRate: number
} {
  const currency = usageRecords.find(r => r.cost)?.cost?.currency || 'USD'
  const totalRequests = usageRecords.length
  const errorCount = usageRecords.filter(r => r.status === 'error').length

  const sums = usageRecords.reduce(
    (sum, r) => {
      sum.promptTokens += r.usage?.promptTokens ?? 0
      sum.completionTokens += r.usage?.completionTokens ?? 0
      sum.totalTokens += r.usage?.totalTokens ?? 0
      sum.totalCost += r.cost?.totalCost ?? 0
      return sum
    },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, totalCost: 0 },
  )

  return {
    totalRequests,
    totalPromptTokens: sums.promptTokens,
    totalCompletionTokens: sums.completionTokens,
    totalTokens: sums.totalTokens,
    totalCost: sums.totalCost,
    currency,
    errorCount,
    successRate: totalRequests > 0 ? (totalRequests - errorCount) / totalRequests : 1,
  }
}
