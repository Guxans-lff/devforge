import { computed, reactive } from 'vue'
import type { ToolCallInfo, ToolResultInfo, ToolExecutionMetadata } from '@/types/ai'

const TREND_SAMPLE_LIMIT = 20
const SESSION_HISTORY_LIMIT = 12

type ErrorKind = NonNullable<ToolExecutionMetadata['errorKind']> | 'unknown'

export type AiRuntimeRoutingReason = 'provider_circuit_open' | 'downgrade_model' | 'switch_provider'

export interface AiToolMetricsSnapshot {
  totalCalls: number
  successCount: number
  errorCount: number
  cancelledCount: number
  timeoutCount: number
  retryCount: number
  totalDurationMs: number
  maxDurationMs: number
  averageDurationMs: number
}

export interface AiChatTrendSnapshot {
  sampleCount: number
  firstTokenAverageMs: number | null
  requestFirstTokenAverageMs: number | null
  responseAverageMs: number | null
  toolRunAverageMs: number | null
  lastFirstTokenDeltaMs: number | null
  lastRequestFirstTokenDeltaMs: number | null
  lastResponseDeltaMs: number | null
  lastToolRunDeltaMs: number | null
}

export interface AiChatSessionSummary {
  startedAt: number | null
  prepareDurationMs: number | null
  firstTokenLatencyMs: number | null
  requestCount: number
  requestFirstTokenLatencyMs: number | null
  recoveryCount: number
  responseDurationMs: number | null
  toolCallCount: number
  toolErrorCount: number
  timeoutCount: number
  success: boolean
}

export interface AiChatErrorBreakdownItem {
  kind: ErrorKind
  count: number
}

export interface AiChatDiagnosticsExport {
  exportedAt: number
  current: {
    sessionStartedAt: number | null
    prepareCompletedAt: number | null
    prepareDurationMs: number | null
    requestStartedAt: number | null
    requestCount: number
    recoveryCount: number
    firstTokenLatencyMs: number | null
    requestFirstTokenLatencyMs: number | null
    responseDurationMs: number | null
    loadHistoryDurationMs: number | null
    historyRestoreCount: number
    compactTriggeredCount: number
    providerRerouteCount: number
    autoDowngradeCount: number
    autoSwitchProviderCount: number
    lastRoutingReason: AiRuntimeRoutingReason | null
    pendingToolQueueLength: number
    lastToolRun: AiToolMetricsSnapshot
  }
  trend: AiChatTrendSnapshot
  sessionHistory: AiChatSessionSummary[]
  errorBreakdown: AiChatErrorBreakdownItem[]
}

export interface AiChatMetricsSnapshot {
  sessionStartedAt: number | null
  prepareCompletedAt: number | null
  prepareDurationMs: number | null
  requestStartedAt: number | null
  requestCount: number
  recoveryCount: number
  firstTokenAt: number | null
  firstTokenLatencyMs: number | null
  requestFirstTokenLatencyMs: number | null
  responseCompletedAt: number | null
  responseDurationMs: number | null
  loadHistoryStartedAt: number | null
  loadHistoryDurationMs: number | null
  historyRestoreCount: number
  compactTriggeredCount: number
  providerRerouteCount: number
  autoDowngradeCount: number
  autoSwitchProviderCount: number
  lastRoutingReason: AiRuntimeRoutingReason | null
  pendingToolQueueLength: number
  lastToolRun: AiToolMetricsSnapshot
  trend: AiChatTrendSnapshot
  sessionHistory: AiChatSessionSummary[]
  errorBreakdown: AiChatErrorBreakdownItem[]
}

function emptyToolSnapshot(): AiToolMetricsSnapshot {
  return {
    totalCalls: 0,
    successCount: 0,
    errorCount: 0,
    cancelledCount: 0,
    timeoutCount: 0,
    retryCount: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    averageDurationMs: 0,
  }
}

function pushSample(samples: number[], value: number): number | null {
  const previous = samples.length > 0 ? samples[samples.length - 1] ?? null : null
  samples.push(value)
  if (samples.length > TREND_SAMPLE_LIMIT) {
    samples.shift()
  }
  return previous === null ? null : value - previous
}

function average(samples: number[]): number | null {
  if (samples.length === 0) return null
  return Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length)
}

function pushSessionSummary(history: AiChatSessionSummary[], summary: AiChatSessionSummary): void {
  history.push(summary)
  if (history.length > SESSION_HISTORY_LIMIT) {
    history.shift()
  }
}

function toErrorKind(value: ToolExecutionMetadata['errorKind'] | undefined): ErrorKind {
  return value ?? 'unknown'
}

export function useAiChatObservability() {
  const state = reactive({
    sessionStartedAt: null as number | null,
    prepareCompletedAt: null as number | null,
    prepareDurationMs: null as number | null,
    requestStartedAt: null as number | null,
    requestCount: 0,
    recoveryCount: 0,
    firstTokenAt: null as number | null,
    firstTokenLatencyMs: null as number | null,
    requestFirstTokenLatencyMs: null as number | null,
    responseCompletedAt: null as number | null,
    responseDurationMs: null as number | null,
    loadHistoryStartedAt: null as number | null,
    loadHistoryDurationMs: null as number | null,
    historyRestoreCount: 0,
    compactTriggeredCount: 0,
    providerRerouteCount: 0,
    autoDowngradeCount: 0,
    autoSwitchProviderCount: 0,
    lastRoutingReason: null as AiRuntimeRoutingReason | null,
    pendingToolQueueLength: 0,
    lastToolRun: emptyToolSnapshot(),
  })

  const trendState = reactive({
    firstTokenSamples: [] as number[],
    requestFirstTokenSamples: [] as number[],
    responseSamples: [] as number[],
    toolRunSamples: [] as number[],
    lastFirstTokenDeltaMs: null as number | null,
    lastRequestFirstTokenDeltaMs: null as number | null,
    lastResponseDeltaMs: null as number | null,
    lastToolRunDeltaMs: null as number | null,
  })

  const sessionState = reactive({
    history: [] as AiChatSessionSummary[],
    errorCountByKind: {} as Partial<Record<ErrorKind, number>>,
  })

  const trend = computed<AiChatTrendSnapshot>(() => ({
    sampleCount: Math.max(
      trendState.firstTokenSamples.length,
      trendState.requestFirstTokenSamples.length,
      trendState.responseSamples.length,
      trendState.toolRunSamples.length,
    ),
    firstTokenAverageMs: average(trendState.firstTokenSamples),
    requestFirstTokenAverageMs: average(trendState.requestFirstTokenSamples),
    responseAverageMs: average(trendState.responseSamples),
    toolRunAverageMs: average(trendState.toolRunSamples),
    lastFirstTokenDeltaMs: trendState.lastFirstTokenDeltaMs,
    lastRequestFirstTokenDeltaMs: trendState.lastRequestFirstTokenDeltaMs,
    lastResponseDeltaMs: trendState.lastResponseDeltaMs,
    lastToolRunDeltaMs: trendState.lastToolRunDeltaMs,
  }))

  const errorBreakdown = computed<AiChatErrorBreakdownItem[]>(() =>
    Object.entries(sessionState.errorCountByKind)
      .map(([kind, count]) => ({ kind: kind as ErrorKind, count }))
      .sort((left, right) => right.count - left.count),
  )

  function finalizeCurrentSession(): void {
    if (!state.sessionStartedAt) return
    if (state.firstTokenLatencyMs === null && state.responseDurationMs === null && state.lastToolRun.totalCalls === 0) return

    pushSessionSummary(sessionState.history, {
      startedAt: state.sessionStartedAt,
      prepareDurationMs: state.prepareDurationMs,
      firstTokenLatencyMs: state.firstTokenLatencyMs,
      requestCount: state.requestCount,
      requestFirstTokenLatencyMs: state.requestFirstTokenLatencyMs,
      recoveryCount: state.recoveryCount,
      responseDurationMs: state.responseDurationMs,
      toolCallCount: state.lastToolRun.totalCalls,
      toolErrorCount: state.lastToolRun.errorCount,
      timeoutCount: state.lastToolRun.timeoutCount,
      success: state.lastToolRun.errorCount === 0 && state.lastToolRun.timeoutCount === 0,
    })
  }

  function markSendStart(now = Date.now()): void {
    finalizeCurrentSession()

    state.sessionStartedAt = now
    state.prepareCompletedAt = null
    state.prepareDurationMs = null
    state.requestStartedAt = null
    state.requestCount = 0
    state.recoveryCount = 0
    state.firstTokenAt = null
    state.firstTokenLatencyMs = null
    state.requestFirstTokenLatencyMs = null
    state.responseCompletedAt = null
    state.responseDurationMs = null
    state.providerRerouteCount = 0
    state.autoDowngradeCount = 0
    state.autoSwitchProviderCount = 0
    state.lastRoutingReason = null
    state.lastToolRun = emptyToolSnapshot()
  }

  function markPrepareComplete(now = Date.now()): void {
    if (!state.sessionStartedAt) return
    state.prepareCompletedAt = now
    state.prepareDurationMs = now - state.sessionStartedAt
  }

  function markRequestStart(now = Date.now()): void {
    if (!state.sessionStartedAt) return
    state.requestStartedAt = now
    state.requestCount += 1
    state.requestFirstTokenLatencyMs = null
  }

  function markRecovery(): void {
    if (!state.sessionStartedAt) return
    state.recoveryCount += 1
  }

  function markFirstToken(now = Date.now()): void {
    if (!state.sessionStartedAt) return
    if (!state.firstTokenAt) {
      state.firstTokenAt = now
      state.firstTokenLatencyMs = now - state.sessionStartedAt
      if (state.firstTokenLatencyMs !== null) {
        trendState.lastFirstTokenDeltaMs = pushSample(trendState.firstTokenSamples, state.firstTokenLatencyMs)
      }
    }
    if (state.requestStartedAt && state.requestFirstTokenLatencyMs === null) {
      state.requestFirstTokenLatencyMs = now - state.requestStartedAt
      trendState.lastRequestFirstTokenDeltaMs = pushSample(
        trendState.requestFirstTokenSamples,
        state.requestFirstTokenLatencyMs,
      )
    }
  }

  function markResponseComplete(now = Date.now()): void {
    if (!state.sessionStartedAt) return
    state.responseCompletedAt = now
    state.responseDurationMs = now - state.sessionStartedAt
    if (state.responseDurationMs !== null) {
      trendState.lastResponseDeltaMs = pushSample(trendState.responseSamples, state.responseDurationMs)
    }
  }

  function markHistoryLoadStart(now = Date.now()): void {
    state.loadHistoryStartedAt = now
    state.loadHistoryDurationMs = null
  }

  function markHistoryLoadComplete(restoredCount: number, now = Date.now()): void {
    state.historyRestoreCount = restoredCount
    if (!state.loadHistoryStartedAt) return
    state.loadHistoryDurationMs = now - state.loadHistoryStartedAt
  }

  function markCompactTriggered(): void {
    state.compactTriggeredCount += 1
  }

  function recordRuntimeRouting(reason: AiRuntimeRoutingReason): void {
    if (!state.sessionStartedAt) return
    state.lastRoutingReason = reason
    if (reason === 'provider_circuit_open') {
      state.providerRerouteCount += 1
      return
    }
    if (reason === 'downgrade_model') {
      state.autoDowngradeCount += 1
      return
    }
    state.autoSwitchProviderCount += 1
  }

  function updatePendingToolQueueLength(length: number): void {
    state.pendingToolQueueLength = length
  }

  function recordToolRun(toolCalls: ToolCallInfo[], toolResults: ToolResultInfo[]): void {
    const byId = new Map(toolCalls.map(call => [call.id, call]))
    const durations = toolResults
      .map(result => result.metadata?.durationMs ?? byId.get(result.toolCallId)?.execution?.durationMs ?? 0)
      .filter(value => value > 0)

    const timeoutCount = toolResults.filter(result =>
      result.metadata?.timedOut || byId.get(result.toolCallId)?.execution?.timedOut,
    ).length
    const cancelledCount = toolResults.filter(result =>
      result.metadata?.cancelled || byId.get(result.toolCallId)?.execution?.cancelled,
    ).length
    const retryCount = toolResults.reduce((sum, result) =>
      sum + (result.metadata?.retryCount ?? byId.get(result.toolCallId)?.execution?.retryCount ?? 0), 0)

    const averageDurationMs = durations.length > 0
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : 0

    state.lastToolRun = {
      totalCalls: toolResults.length,
      successCount: toolResults.filter(result => result.success).length,
      errorCount: toolResults.filter(result => !result.success).length,
      cancelledCount,
      timeoutCount,
      retryCount,
      totalDurationMs: durations.reduce((sum, value) => sum + value, 0),
      maxDurationMs: durations.length > 0 ? Math.max(...durations) : 0,
      averageDurationMs,
    }

    if (averageDurationMs > 0) {
      trendState.lastToolRunDeltaMs = pushSample(trendState.toolRunSamples, averageDurationMs)
    }

    for (const result of toolResults) {
      if (result.success) continue
      const kind = toErrorKind(result.metadata?.errorKind ?? byId.get(result.toolCallId)?.execution?.errorKind)
      sessionState.errorCountByKind[kind] = (sessionState.errorCountByKind[kind] ?? 0) + 1
    }
  }

  function exportSnapshot(now = Date.now()): AiChatDiagnosticsExport {
    return {
      exportedAt: now,
      current: {
        sessionStartedAt: state.sessionStartedAt,
        prepareCompletedAt: state.prepareCompletedAt,
        prepareDurationMs: state.prepareDurationMs,
        requestStartedAt: state.requestStartedAt,
        requestCount: state.requestCount,
        recoveryCount: state.recoveryCount,
        firstTokenLatencyMs: state.firstTokenLatencyMs,
        requestFirstTokenLatencyMs: state.requestFirstTokenLatencyMs,
        responseDurationMs: state.responseDurationMs,
        loadHistoryDurationMs: state.loadHistoryDurationMs,
        historyRestoreCount: state.historyRestoreCount,
        compactTriggeredCount: state.compactTriggeredCount,
        providerRerouteCount: state.providerRerouteCount,
        autoDowngradeCount: state.autoDowngradeCount,
        autoSwitchProviderCount: state.autoSwitchProviderCount,
        lastRoutingReason: state.lastRoutingReason,
        pendingToolQueueLength: state.pendingToolQueueLength,
        lastToolRun: { ...state.lastToolRun },
      },
      trend: { ...trend.value },
      sessionHistory: sessionState.history.map(item => ({ ...item })),
      errorBreakdown: errorBreakdown.value.map(item => ({ ...item })),
    }
  }

  function reset(): void {
    state.sessionStartedAt = null
    state.prepareCompletedAt = null
    state.prepareDurationMs = null
    state.requestStartedAt = null
    state.requestCount = 0
    state.recoveryCount = 0
    state.firstTokenAt = null
    state.firstTokenLatencyMs = null
    state.requestFirstTokenLatencyMs = null
    state.responseCompletedAt = null
    state.responseDurationMs = null
    state.loadHistoryStartedAt = null
    state.loadHistoryDurationMs = null
    state.historyRestoreCount = 0
    state.compactTriggeredCount = 0
    state.providerRerouteCount = 0
    state.autoDowngradeCount = 0
    state.autoSwitchProviderCount = 0
    state.lastRoutingReason = null
    state.pendingToolQueueLength = 0
    state.lastToolRun = emptyToolSnapshot()

    trendState.firstTokenSamples = []
    trendState.requestFirstTokenSamples = []
    trendState.responseSamples = []
    trendState.toolRunSamples = []
    trendState.lastFirstTokenDeltaMs = null
    trendState.lastRequestFirstTokenDeltaMs = null
    trendState.lastResponseDeltaMs = null
    trendState.lastToolRunDeltaMs = null

    sessionState.history = []
    sessionState.errorCountByKind = {}
  }

  return {
    metrics: computed<AiChatMetricsSnapshot>(() => ({
      ...state,
      trend: trend.value,
      sessionHistory: sessionState.history.map(item => ({ ...item })),
      errorBreakdown: errorBreakdown.value,
    })),
    markSendStart,
    markPrepareComplete,
    markRequestStart,
    markRecovery,
    markFirstToken,
    markResponseComplete,
    markHistoryLoadStart,
    markHistoryLoadComplete,
    markCompactTriggered,
    recordRuntimeRouting,
    updatePendingToolQueueLength,
    recordToolRun,
    exportSnapshot,
    reset,
  }
}
