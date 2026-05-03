import type { ProviderConfig } from '@/types/ai'
import { getAllRateLimitStats } from './rateLimiter'
import { getCircuitBreakerStats } from './router'
import { getUsageRecords, type AiGatewayUsageRecord } from './usageTracker'

export interface GatewayDashboardRoute {
  requestId: string
  providerProfileId?: string
  providerId: string
  providerName: string
  model: string
  primaryProviderId?: string
  primaryModel?: string
  retryIndex: number
  fallbackReason?: string
  fallbackChainId?: string
  source: string
  kind: string
  status: AiGatewayUsageRecord['status']
  startedAt: number
  durationMs: number
  firstTokenLatencyMs: number | null
  finishedAt: number
  fallback: boolean
  promptTokens: number
  completionTokens: number
  totalTokens: number
  totalCost: number
  currency: string
  errorType?: string
  errorMessage?: string
}

export interface GatewayDashboardFallback {
  requestId: string
  providerProfileId?: string
  primaryProviderId: string
  primaryModel: string
  providerId: string
  providerName: string
  model: string
  fallbackChainId?: string
  reason: string
  retryIndex: number
  status: AiGatewayUsageRecord['status']
  durationMs: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  totalCost: number
  currency: string
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
  providerProfileId?: string
  providerId: string
  providerName: string
  requestCount: number
  successCount: number
  errorCount: number
  fallbackCount: number
  successRate: number
  avgDurationMs: number | null
  avgFirstTokenLatencyMs: number | null
  totalTokens: number
  totalCost: number
  currency: string
}

export interface GatewayDashboardProfileSummary {
  providerProfileId: string
  requestCount: number
  successCount: number
  errorCount: number
  fallbackCount: number
  successRate: number
  providerCount: number
  modelCount: number
  totalTokens: number
  totalCost: number
  currency: string
}

export interface GatewayDashboardModelSummary {
  key: string
  providerId: string
  providerName: string
  model: string
  requestCount: number
  successCount: number
  errorCount: number
  fallbackCount: number
  successRate: number
  avgDurationMs: number | null
  avgFirstTokenLatencyMs: number | null
  totalTokens: number
  totalCost: number
  currency: string
}

export interface GatewayDashboardSourceSummary {
  source: AiGatewayUsageRecord['source']
  requestCount: number
  errorCount: number
  fallbackCount: number
  totalTokens: number
  totalCost: number
  currency: string
}

export interface GatewayDashboardKindSummary {
  kind: AiGatewayUsageRecord['kind']
  requestCount: number
  successCount: number
  errorCount: number
  fallbackCount: number
  successRate: number
  totalTokens: number
  totalCost: number
  currency: string
}

export interface GatewayDashboardErrorSummary {
  key: string
  errorType: string
  source?: AiGatewayUsageRecord['source']
  providerId?: string
  providerName?: string
  count: number
  retryableCount: number
  latestMessage?: string
  latestFinishedAt: number
}

export interface GatewayDashboardSla {
  status: 'healthy' | 'watch' | 'critical'
  requestCount: number
  successRate: number
  fallbackRate: number
  errorRate: number
  securityBlockCount: number
  throttledProviderCount: number
  openCircuitCount: number
  avgDurationMs: number | null
  avgFirstTokenLatencyMs: number | null
  p95DurationMs: number | null
  p95FirstTokenLatencyMs: number | null
  recommendations: string[]
}

export interface GatewayDashboardCostTrendPoint {
  bucketStart: number
  bucketEnd: number
  requestCount: number
  successCount: number
  errorCount: number
  cancelledCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  totalCost: number
  currency: string
}

export interface GatewayDashboardAppliedFilters {
  sessionId?: string
  providerProfileIds: string[]
  providerIds: string[]
  primaryProviderIds: string[]
  sources: AiGatewayUsageRecord['source'][]
  kinds: AiGatewayUsageRecord['kind'][]
  statuses: AiGatewayUsageRecord['status'][]
  from?: number
  to?: number
}

export interface GatewayDashboardSnapshot {
  generatedAt: number
  appliedFilters: GatewayDashboardAppliedFilters
  currentRoute: GatewayDashboardRoute | null
  summary: GatewayDashboardSummary
  sla: GatewayDashboardSla
  costTrend: GatewayDashboardCostTrendPoint[]
  recentFallbacks: GatewayDashboardFallback[]
  rateLimits: GatewayDashboardRateLimit[]
  circuitBreakers: GatewayDashboardCircuitBreaker[]
  securityBlocks: GatewayDashboardSecurityBlock[]
  profileSummaries: GatewayDashboardProfileSummary[]
  providerSummaries: GatewayDashboardProviderSummary[]
  modelSummaries: GatewayDashboardModelSummary[]
  sourceSummaries: GatewayDashboardSourceSummary[]
  kindSummaries: GatewayDashboardKindSummary[]
  errorSummaries: GatewayDashboardErrorSummary[]
}

export interface BuildGatewayDashboardOptions {
  sessionId?: string | null
  providerProfileIds?: string[]
  providerIds?: string[]
  primaryProviderIds?: string[]
  sources?: AiGatewayUsageRecord['source'][]
  kinds?: AiGatewayUsageRecord['kind'][]
  statuses?: AiGatewayUsageRecord['status'][]
  from?: number
  to?: number
  providers?: ProviderConfig[]
  trendBucketMs?: number
  maxTrendPoints?: number
  maxRecentFallbacks?: number
  maxSecurityBlocks?: number
}

export function buildGatewayDashboardSnapshot(options: BuildGatewayDashboardOptions = {}): GatewayDashboardSnapshot {
  const providerNames = new Map((options.providers ?? []).map(provider => [provider.id, provider.name]))
  const records = filterRecords(getUsageRecords(), options)
  const summary = summarizeRecords(records)
  const rateLimits = getAllRateLimitStats().map(item => ({
    providerId: item.providerId,
    providerName: providerName(providerNames, item.providerId),
    currentCount: item.currentCount,
    maxRequests: item.maxRequests,
    throttledCount: item.throttledCount,
    windowMs: item.windowMs,
  }))
  const circuitBreakers = getCircuitBreakerStats().map(item => ({
    providerId: item.providerId,
    providerName: providerName(providerNames, item.providerId),
    failureCount: item.failureCount,
    openedAt: item.openedAt,
    open: item.open,
  }))
  const securityBlocks = records
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
    }))

  return {
    generatedAt: Date.now(),
    appliedFilters: buildAppliedFilters(options),
    currentRoute: toRoute(records[records.length - 1], providerNames),
    summary,
    sla: buildSla(records, {
      securityBlockCount: securityBlocks.length,
      throttledProviderCount: rateLimits.filter(item => item.throttledCount > 0).length,
      openCircuitCount: circuitBreakers.filter(item => item.open).length,
    }),
    costTrend: buildCostTrend(records, {
      bucketMs: options.trendBucketMs,
      maxPoints: options.maxTrendPoints,
    }),
    recentFallbacks: records
      .filter(isFallbackRecord)
      .slice(-(options.maxRecentFallbacks ?? 5))
      .reverse()
      .map(record => toFallback(record, providerNames)),
    rateLimits,
    circuitBreakers,
    securityBlocks,
    profileSummaries: summarizeProfiles(records),
    providerSummaries: summarizeProviders(records, providerNames),
    modelSummaries: summarizeModels(records, providerNames),
    sourceSummaries: summarizeSources(records),
    kindSummaries: summarizeKinds(records),
    errorSummaries: summarizeErrors(records, providerNames),
  }
}

function filterRecords(records: readonly AiGatewayUsageRecord[], options: BuildGatewayDashboardOptions): AiGatewayUsageRecord[] {
  const providerProfileIds = normalizeStringSet(options.providerProfileIds)
  const providerIds = normalizeStringSet(options.providerIds)
  const primaryProviderIds = normalizeStringSet(options.primaryProviderIds)
  const sources = normalizeStringSet(options.sources)
  const kinds = normalizeStringSet(options.kinds)
  const statuses = normalizeStringSet(options.statuses)

  return records.filter(record => {
    if (options.sessionId && record.sessionId !== options.sessionId) return false
    if (providerProfileIds.size > 0 && !providerProfileIds.has(record.providerProfileId ?? record.providerId)) return false
    if (providerIds.size > 0 && !providerIds.has(record.providerId)) return false
    if (primaryProviderIds.size > 0 && !primaryProviderIds.has(record.primaryProviderId ?? record.providerId)) return false
    if (sources.size > 0 && !sources.has(record.source)) return false
    if (kinds.size > 0 && !kinds.has(record.kind)) return false
    if (statuses.size > 0 && !statuses.has(record.status)) return false
    if (typeof options.from === 'number' && record.finishedAt < options.from) return false
    if (typeof options.to === 'number' && record.finishedAt > options.to) return false
    return true
  })
}

function buildAppliedFilters(options: BuildGatewayDashboardOptions): GatewayDashboardAppliedFilters {
  return {
    sessionId: options.sessionId ?? undefined,
    providerProfileIds: Array.from(normalizeStringSet(options.providerProfileIds)),
    providerIds: Array.from(normalizeStringSet(options.providerIds)),
    primaryProviderIds: Array.from(normalizeStringSet(options.primaryProviderIds)),
    sources: Array.from(normalizeStringSet(options.sources)) as AiGatewayUsageRecord['source'][],
    kinds: Array.from(normalizeStringSet(options.kinds)) as AiGatewayUsageRecord['kind'][],
    statuses: Array.from(normalizeStringSet(options.statuses)) as AiGatewayUsageRecord['status'][],
    from: options.from,
    to: options.to,
  }
}

function normalizeStringSet(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).map(value => value.trim()).filter(Boolean))
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

function buildSla(
  records: AiGatewayUsageRecord[],
  signals: {
    securityBlockCount: number
    throttledProviderCount: number
    openCircuitCount: number
  },
): GatewayDashboardSla {
  const requestCount = records.length
  const successCount = records.filter(record => record.status === 'success').length
  const errorCount = records.filter(record => record.status === 'error').length
  const fallbackCount = records.filter(isFallbackRecord).length
  const durations = records.map(record => Math.max(0, record.finishedAt - record.startedAt))
  const firstTokenLatencies = records
    .map(record => record.firstTokenAt ? Math.max(0, record.firstTokenAt - record.startedAt) : null)
    .filter((value): value is number => value !== null)

  const successRate = requestCount > 0 ? successCount / requestCount : 1
  const errorRate = requestCount > 0 ? errorCount / requestCount : 0
  const fallbackRate = requestCount > 0 ? fallbackCount / requestCount : 0
  const avgDurationMs = average(durations)
  const avgFirstTokenLatencyMs = average(firstTokenLatencies)
  const p95DurationMs = percentile(durations, 0.95)
  const p95FirstTokenLatencyMs = percentile(firstTokenLatencies, 0.95)
  const recommendations: string[] = []

  if (successRate < 0.8) recommendations.push('Gateway 成功率低于 80%，优先检查 Provider 可用性、鉴权和限流配置。')
  if (fallbackRate >= 0.3) recommendations.push('Fallback 比例偏高，建议检查主 Provider 稳定性或调整路由策略。')
  if (signals.securityBlockCount > 0) recommendations.push('存在 SSRF / Endpoint 安全拦截，建议复核 Provider endpoint 与 allowlist。')
  if (signals.throttledProviderCount > 0) recommendations.push('存在 Provider 限流命中，建议调整 Profile 限流或降低并发。')
  if (signals.openCircuitCount > 0) recommendations.push('存在熔断打开的 Provider，建议查看最近错误聚合并切换备用模型。')
  if ((p95FirstTokenLatencyMs ?? 0) > 10_000) recommendations.push('首 token P95 超过 10s，建议检查网络、模型负载或启用更快 fallback。')
  if ((p95DurationMs ?? 0) > 60_000) recommendations.push('请求耗时 P95 超过 60s，建议优化上下文长度或输出 token 上限。')

  let status: GatewayDashboardSla['status'] = 'healthy'
  if (
    successRate < 0.8
    || signals.securityBlockCount > 0
    || signals.openCircuitCount > 0
    || (p95FirstTokenLatencyMs ?? 0) > 15_000
    || (p95DurationMs ?? 0) > 90_000
  ) {
    status = 'critical'
  } else if (
    errorRate > 0
    || fallbackRate >= 0.2
    || signals.throttledProviderCount > 0
    || (p95FirstTokenLatencyMs ?? 0) > 8_000
    || (p95DurationMs ?? 0) > 45_000
  ) {
    status = 'watch'
  }

  return {
    status,
    requestCount,
    successRate,
    fallbackRate,
    errorRate,
    securityBlockCount: signals.securityBlockCount,
    throttledProviderCount: signals.throttledProviderCount,
    openCircuitCount: signals.openCircuitCount,
    avgDurationMs,
    avgFirstTokenLatencyMs,
    p95DurationMs,
    p95FirstTokenLatencyMs,
    recommendations,
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
  return sorted[index] ?? null
}

function summarizeProviders(
  records: AiGatewayUsageRecord[],
  providerNames: Map<string, string>,
): GatewayDashboardProviderSummary[] {
  const summaries = new Map<string, GatewayDashboardProviderSummary & {
    durations: number[]
    firstTokenLatencies: number[]
  }>()

  for (const record of records) {
    const current = summaries.get(record.providerId) ?? {
      providerProfileId: record.providerProfileId,
      providerId: record.providerId,
      providerName: providerName(providerNames, record.providerId),
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      fallbackCount: 0,
      successRate: 1,
      avgDurationMs: null,
      avgFirstTokenLatencyMs: null,
      totalTokens: 0,
      totalCost: 0,
      currency: record.cost?.currency ?? 'USD',
      durations: [],
      firstTokenLatencies: [],
    }
    current.requestCount += 1
    current.successCount += record.status === 'success' ? 1 : 0
    current.errorCount += record.status === 'error' ? 1 : 0
    current.fallbackCount += isFallbackRecord(record) ? 1 : 0
    current.totalTokens += record.usage?.totalTokens ?? 0
    current.totalCost += record.cost?.totalCost ?? 0
    current.durations.push(Math.max(0, record.finishedAt - record.startedAt))
    if (record.firstTokenAt) {
      current.firstTokenLatencies.push(Math.max(0, record.firstTokenAt - record.startedAt))
    }
    if (record.cost?.currency) current.currency = record.cost.currency
    if (record.providerProfileId) current.providerProfileId = record.providerProfileId
    summaries.set(record.providerId, current)
  }

  return Array.from(summaries.values())
    .map(({ durations, firstTokenLatencies, ...summary }) => ({
      ...summary,
      successRate: summary.requestCount > 0 ? summary.successCount / summary.requestCount : 1,
      avgDurationMs: average(durations),
      avgFirstTokenLatencyMs: average(firstTokenLatencies),
    }))
    .sort((a, b) => b.requestCount - a.requestCount)
}

function summarizeProfiles(records: AiGatewayUsageRecord[]): GatewayDashboardProfileSummary[] {
  const summaries = new Map<string, GatewayDashboardProfileSummary & {
    providers: Set<string>
    models: Set<string>
  }>()

  for (const record of records) {
    const providerProfileId = record.providerProfileId ?? record.providerId
    const current = summaries.get(providerProfileId) ?? {
      providerProfileId,
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      fallbackCount: 0,
      successRate: 1,
      providerCount: 0,
      modelCount: 0,
      totalTokens: 0,
      totalCost: 0,
      currency: record.cost?.currency ?? 'USD',
      providers: new Set<string>(),
      models: new Set<string>(),
    }

    current.requestCount += 1
    current.successCount += record.status === 'success' ? 1 : 0
    current.errorCount += record.status === 'error' ? 1 : 0
    current.fallbackCount += isFallbackRecord(record) ? 1 : 0
    current.totalTokens += record.usage?.totalTokens ?? 0
    current.totalCost += record.cost?.totalCost ?? 0
    current.providers.add(record.providerId)
    current.models.add(`${record.providerId}:${record.model}`)
    if (record.cost?.currency) current.currency = record.cost.currency
    summaries.set(providerProfileId, current)
  }

  return Array.from(summaries.values())
    .map(({ providers, models, ...summary }) => ({
      ...summary,
      successRate: summary.requestCount > 0 ? summary.successCount / summary.requestCount : 1,
      providerCount: providers.size,
      modelCount: models.size,
    }))
    .sort((a, b) => {
      if (b.requestCount !== a.requestCount) return b.requestCount - a.requestCount
      return b.totalCost - a.totalCost
    })
}

function summarizeModels(
  records: AiGatewayUsageRecord[],
  providerNames: Map<string, string>,
): GatewayDashboardModelSummary[] {
  const summaries = new Map<string, GatewayDashboardModelSummary & {
    durations: number[]
    firstTokenLatencies: number[]
  }>()

  for (const record of records) {
    const key = `${record.providerId}:${record.model}`
    const current = summaries.get(key) ?? {
      key,
      providerId: record.providerId,
      providerName: providerName(providerNames, record.providerId),
      model: record.model,
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      fallbackCount: 0,
      successRate: 1,
      avgDurationMs: null,
      avgFirstTokenLatencyMs: null,
      totalTokens: 0,
      totalCost: 0,
      currency: record.cost?.currency ?? 'USD',
      durations: [],
      firstTokenLatencies: [],
    }

    current.requestCount += 1
    current.successCount += record.status === 'success' ? 1 : 0
    current.errorCount += record.status === 'error' ? 1 : 0
    current.fallbackCount += isFallbackRecord(record) ? 1 : 0
    current.totalTokens += record.usage?.totalTokens ?? 0
    current.totalCost += record.cost?.totalCost ?? 0
    current.durations.push(Math.max(0, record.finishedAt - record.startedAt))
    if (record.firstTokenAt) {
      current.firstTokenLatencies.push(Math.max(0, record.firstTokenAt - record.startedAt))
    }
    if (record.cost?.currency) current.currency = record.cost.currency
    summaries.set(key, current)
  }

  return Array.from(summaries.values())
    .map(({ durations, firstTokenLatencies, ...summary }) => ({
      ...summary,
      successRate: summary.requestCount > 0 ? summary.successCount / summary.requestCount : 1,
      avgDurationMs: average(durations),
      avgFirstTokenLatencyMs: average(firstTokenLatencies),
    }))
    .sort((a, b) => {
      if (b.requestCount !== a.requestCount) return b.requestCount - a.requestCount
      return b.totalCost - a.totalCost
    })
}

function summarizeSources(records: AiGatewayUsageRecord[]): GatewayDashboardSourceSummary[] {
  const summaries = new Map<string, GatewayDashboardSourceSummary>()

  for (const record of records) {
    const current = summaries.get(record.source) ?? {
      source: record.source,
      requestCount: 0,
      errorCount: 0,
      fallbackCount: 0,
      totalTokens: 0,
      totalCost: 0,
      currency: record.cost?.currency ?? 'USD',
    }
    current.requestCount += 1
    current.errorCount += record.status === 'error' ? 1 : 0
    current.fallbackCount += isFallbackRecord(record) ? 1 : 0
    current.totalTokens += record.usage?.totalTokens ?? 0
    current.totalCost += record.cost?.totalCost ?? 0
    if (record.cost?.currency) current.currency = record.cost.currency
    summaries.set(record.source, current)
  }

  return Array.from(summaries.values()).sort((a, b) => b.requestCount - a.requestCount)
}

function summarizeKinds(records: AiGatewayUsageRecord[]): GatewayDashboardKindSummary[] {
  const summaries = new Map<string, GatewayDashboardKindSummary>()

  for (const record of records) {
    const current = summaries.get(record.kind) ?? {
      kind: record.kind,
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      fallbackCount: 0,
      successRate: 1,
      totalTokens: 0,
      totalCost: 0,
      currency: record.cost?.currency ?? 'USD',
    }
    current.requestCount += 1
    current.successCount += record.status === 'success' ? 1 : 0
    current.errorCount += record.status === 'error' ? 1 : 0
    current.fallbackCount += isFallbackRecord(record) ? 1 : 0
    current.totalTokens += record.usage?.totalTokens ?? 0
    current.totalCost += record.cost?.totalCost ?? 0
    current.successRate = current.requestCount > 0 ? current.successCount / current.requestCount : 1
    if (record.cost?.currency) current.currency = record.cost.currency
    summaries.set(record.kind, current)
  }

  return Array.from(summaries.values()).sort((a, b) => b.requestCount - a.requestCount)
}

function summarizeErrors(
  records: AiGatewayUsageRecord[],
  providerNames: Map<string, string>,
): GatewayDashboardErrorSummary[] {
  const summaries = new Map<string, GatewayDashboardErrorSummary>()

  for (const record of records) {
    if (record.status !== 'error') continue
    const errorType = record.error?.type ?? 'unknown'
    const key = `${errorType}:${record.source}:${record.providerId}`
    const current = summaries.get(key) ?? {
      key,
      errorType,
      source: record.source,
      providerId: record.providerId,
      providerName: providerName(providerNames, record.providerId),
      count: 0,
      retryableCount: 0,
      latestMessage: undefined,
      latestFinishedAt: 0,
    }
    current.count += 1
    current.retryableCount += record.error?.retryable ? 1 : 0
    if (record.finishedAt >= current.latestFinishedAt) {
      current.latestFinishedAt = record.finishedAt
      current.latestMessage = record.error?.message
    }
    summaries.set(key, current)
  }

  return Array.from(summaries.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return b.latestFinishedAt - a.latestFinishedAt
  })
}

function buildCostTrend(
  records: AiGatewayUsageRecord[],
  options: { bucketMs?: number; maxPoints?: number },
): GatewayDashboardCostTrendPoint[] {
  if (records.length === 0) return []

  const bucketMs = normalizePositiveInteger(options.bucketMs, 5 * 60 * 1000)
  const maxPoints = normalizePositiveInteger(options.maxPoints, 12)
  const buckets = new Map<number, GatewayDashboardCostTrendPoint>()

  for (const record of records) {
    const bucketStart = Math.floor(record.finishedAt / bucketMs) * bucketMs
    const current = buckets.get(bucketStart) ?? {
      bucketStart,
      bucketEnd: bucketStart + bucketMs,
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      cancelledCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      currency: record.cost?.currency ?? 'USD',
    }
    current.requestCount += 1
    current.successCount += record.status === 'success' ? 1 : 0
    current.errorCount += record.status === 'error' ? 1 : 0
    current.cancelledCount += record.status === 'cancelled' ? 1 : 0
    current.promptTokens += record.usage?.promptTokens ?? 0
    current.completionTokens += record.usage?.completionTokens ?? 0
    current.totalTokens += record.usage?.totalTokens ?? 0
    current.totalCost += record.cost?.totalCost ?? 0
    if (record.cost?.currency) current.currency = record.cost.currency
    buckets.set(bucketStart, current)
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.bucketStart - b.bucketStart)
    .slice(-maxPoints)
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) return fallback
  return Math.trunc(value)
}

function toRoute(record: AiGatewayUsageRecord | undefined, providerNames: Map<string, string>): GatewayDashboardRoute | null {
  if (!record) return null
  return {
    requestId: record.requestId,
    providerProfileId: record.providerProfileId,
    providerId: record.providerId,
    providerName: providerName(providerNames, record.providerId),
    model: record.model,
    primaryProviderId: record.primaryProviderId,
    primaryModel: record.primaryModel,
    retryIndex: record.retryIndex ?? 0,
    fallbackReason: record.fallbackReason,
    fallbackChainId: record.fallbackChainId,
    source: record.source,
    kind: record.kind,
    status: record.status,
    startedAt: record.startedAt,
    durationMs: Math.max(0, record.finishedAt - record.startedAt),
    firstTokenLatencyMs: record.firstTokenAt ? Math.max(0, record.firstTokenAt - record.startedAt) : null,
    finishedAt: record.finishedAt,
    fallback: isFallbackRecord(record),
    promptTokens: record.usage?.promptTokens ?? 0,
    completionTokens: record.usage?.completionTokens ?? 0,
    totalTokens: record.usage?.totalTokens ?? 0,
    totalCost: record.cost?.totalCost ?? 0,
    currency: record.cost?.currency ?? 'USD',
    errorType: record.error?.type,
    errorMessage: record.error?.message,
  }
}

function toFallback(record: AiGatewayUsageRecord, providerNames: Map<string, string>): GatewayDashboardFallback {
  return {
    requestId: record.requestId,
    providerProfileId: record.providerProfileId,
    primaryProviderId: record.primaryProviderId ?? record.providerId,
    primaryModel: record.primaryModel ?? record.model,
    providerId: record.providerId,
    providerName: providerName(providerNames, record.providerId),
    model: record.model,
    fallbackChainId: record.fallbackChainId,
    reason: record.fallbackReason ?? 'fallback',
    retryIndex: record.retryIndex ?? 0,
    status: record.status,
    durationMs: Math.max(0, record.finishedAt - record.startedAt),
    promptTokens: record.usage?.promptTokens ?? 0,
    completionTokens: record.usage?.completionTokens ?? 0,
    totalTokens: record.usage?.totalTokens ?? 0,
    totalCost: record.cost?.totalCost ?? 0,
    currency: record.cost?.currency ?? 'USD',
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
