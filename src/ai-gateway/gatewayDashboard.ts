import type { ProviderConfig } from '@/types/ai'
import { getAllRateLimitStats } from './rateLimiter'
import { getCircuitBreakerStats } from './router'
import { getUsageRecords, type AiGatewayUsageRecord } from './usageTracker'

export interface GatewayDashboardRoute {
  requestId: string
  providerId: string
  providerName: string
  model: string
  source: string
  kind: string
  status: AiGatewayUsageRecord['status']
  startedAt: number
  durationMs: number
  firstTokenLatencyMs: number | null
  finishedAt: number
  fallback: boolean
  errorType?: string
  errorMessage?: string
}

export interface GatewayDashboardFallback {
  requestId: string
  primaryProviderId: string
  primaryModel: string
  providerId: string
  providerName: string
  model: string
  reason: string
  retryIndex: number
  status: AiGatewayUsageRecord['status']
  durationMs: number
  errorType?: string
  errorMessage?: string
  finishedAt: number
}

export interface GatewayDashboardSummary {
  requestCount: number
  successCount: number
  errorCount: number
  cancelledCount: number
  successRate: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  totalCost: number
  currency: string
}

export interface GatewayDashboardRateLimit {
  providerId: string
  providerName: string
  currentCount: number
  maxRequests: number
  throttledCount: number
  windowMs: number
}

export interface GatewayDashboardCircuitBreaker {
  providerId: string
  providerName: string
  failureCount: number
  openedAt: number | null
  open: boolean
}

export interface GatewayDashboardSecurityBlock {
  requestId: string
  providerId: string
  providerName: string
  model: string
  reason: string
  errorType?: string
  finishedAt: number
}

export interface GatewayDashboardProviderSummary {
  providerId: string
  providerName: string
  requestCount: number
  errorCount: number
  totalTokens: number
  totalCost: number
  currency: string
}

export interface GatewayDashboardSnapshot {
  generatedAt: number
  currentRoute: GatewayDashboardRoute | null
  summary: GatewayDashboardSummary
  recentFallbacks: GatewayDashboardFallback[]
  rateLimits: GatewayDashboardRateLimit[]
  circuitBreakers: GatewayDashboardCircuitBreaker[]
  securityBlocks: GatewayDashboardSecurityBlock[]
  providerSummaries: GatewayDashboardProviderSummary[]
}

export interface BuildGatewayDashboardOptions {
  sessionId?: string | null
  providers?: ProviderConfig[]
  maxRecentFallbacks?: number
  maxSecurityBlocks?: number
}

export function buildGatewayDashboardSnapshot(options: BuildGatewayDashboardOptions = {}): GatewayDashboardSnapshot {
  const providerNames = new Map((options.providers ?? []).map(provider => [provider.id, provider.name]))
  const records = filterRecords(getUsageRecords(), options.sessionId)
  const summary = summarizeRecords(records)

  return {
    generatedAt: Date.now(),
    currentRoute: toRoute(records[records.length - 1], providerNames),
    summary,
    recentFallbacks: records
      .filter(isFallbackRecord)
      .slice(-(options.maxRecentFallbacks ?? 5))
      .reverse()
      .map(record => toFallback(record, providerNames)),
    rateLimits: getAllRateLimitStats().map(item => ({
      providerId: item.providerId,
      providerName: providerName(providerNames, item.providerId),
      currentCount: item.currentCount,
      maxRequests: item.maxRequests,
      throttledCount: item.throttledCount,
      windowMs: item.windowMs,
    })),
    circuitBreakers: getCircuitBreakerStats().map(item => ({
      providerId: item.providerId,
      providerName: providerName(providerNames, item.providerId),
      failureCount: item.failureCount,
      openedAt: item.openedAt,
      open: item.open,
    })),
    securityBlocks: records
      .filter(isSecurityBlockRecord)
      .slice(-(options.maxSecurityBlocks ?? 5))
      .reverse()
      .map(record => ({
        requestId: record.requestId,
        providerId: record.providerId,
        providerName: providerName(providerNames, record.providerId),
        model: record.model,
        reason: extractSecurityReason(record),
        errorType: record.error?.type,
        finishedAt: record.finishedAt,
      })),
    providerSummaries: summarizeProviders(records, providerNames),
  }
}

function filterRecords(records: readonly AiGatewayUsageRecord[], sessionId?: string | null): AiGatewayUsageRecord[] {
  if (!sessionId) return records.slice()
  return records.filter(record => record.sessionId === sessionId)
}

function summarizeRecords(records: AiGatewayUsageRecord[]): GatewayDashboardSummary {
  const currency = records.find(record => record.cost)?.cost?.currency ?? 'USD'
  const summary = records.reduce(
    (acc, record) => {
      acc.requestCount += 1
      acc.successCount += record.status === 'success' ? 1 : 0
      acc.errorCount += record.status === 'error' ? 1 : 0
      acc.cancelledCount += record.status === 'cancelled' ? 1 : 0
      acc.promptTokens += record.usage?.promptTokens ?? 0
      acc.completionTokens += record.usage?.completionTokens ?? 0
      acc.totalTokens += record.usage?.totalTokens ?? 0
      acc.totalCost += record.cost?.totalCost ?? 0
      return acc
    },
    {
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      cancelledCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    },
  )

  return {
    ...summary,
    currency,
    successRate: summary.requestCount > 0 ? summary.successCount / summary.requestCount : 1,
  }
}

function summarizeProviders(
  records: AiGatewayUsageRecord[],
  providerNames: Map<string, string>,
): GatewayDashboardProviderSummary[] {
  const summaries = new Map<string, GatewayDashboardProviderSummary>()

  for (const record of records) {
    const current = summaries.get(record.providerId) ?? {
      providerId: record.providerId,
      providerName: providerName(providerNames, record.providerId),
      requestCount: 0,
      errorCount: 0,
      totalTokens: 0,
      totalCost: 0,
      currency: record.cost?.currency ?? 'USD',
    }
    current.requestCount += 1
    current.errorCount += record.status === 'error' ? 1 : 0
    current.totalTokens += record.usage?.totalTokens ?? 0
    current.totalCost += record.cost?.totalCost ?? 0
    if (record.cost?.currency) current.currency = record.cost.currency
    summaries.set(record.providerId, current)
  }

  return Array.from(summaries.values()).sort((a, b) => b.requestCount - a.requestCount)
}

function toRoute(record: AiGatewayUsageRecord | undefined, providerNames: Map<string, string>): GatewayDashboardRoute | null {
  if (!record) return null
  return {
    requestId: record.requestId,
    providerId: record.providerId,
    providerName: providerName(providerNames, record.providerId),
    model: record.model,
    source: record.source,
    kind: record.kind,
    status: record.status,
    startedAt: record.startedAt,
    durationMs: Math.max(0, record.finishedAt - record.startedAt),
    firstTokenLatencyMs: record.firstTokenAt ? Math.max(0, record.firstTokenAt - record.startedAt) : null,
    finishedAt: record.finishedAt,
    fallback: isFallbackRecord(record),
    errorType: record.error?.type,
    errorMessage: record.error?.message,
  }
}

function toFallback(record: AiGatewayUsageRecord, providerNames: Map<string, string>): GatewayDashboardFallback {
  return {
    requestId: record.requestId,
    primaryProviderId: record.primaryProviderId ?? record.providerId,
    primaryModel: record.primaryModel ?? record.model,
    providerId: record.providerId,
    providerName: providerName(providerNames, record.providerId),
    model: record.model,
    reason: record.fallbackReason ?? 'fallback',
    retryIndex: record.retryIndex ?? 0,
    status: record.status,
    durationMs: Math.max(0, record.finishedAt - record.startedAt),
    errorType: record.error?.type,
    errorMessage: record.error?.message,
    finishedAt: record.finishedAt,
  }
}

function isFallbackRecord(record: AiGatewayUsageRecord): boolean {
  return (record.retryIndex ?? 0) > 0 || !!record.primaryProviderId
}

function isSecurityBlockRecord(record: AiGatewayUsageRecord): boolean {
  if (record.status !== 'error') return false
  const message = record.error?.message ?? ''
  return /Endpoint security check failed|Localhost is not allowed|Private IP is not allowed|Unsupported protocol|Invalid URL/i.test(message)
}

function extractSecurityReason(record: AiGatewayUsageRecord): string {
  const message = record.error?.message ?? ''
  const [, reason] = message.match(/Endpoint security check failed:\s*(.+)$/i) ?? []
  return reason?.trim() || message || 'unknown'
}

function providerName(providerNames: Map<string, string>, providerId: string): string {
  return providerNames.get(providerId) ?? providerId
}
