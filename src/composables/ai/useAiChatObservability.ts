import { computed, reactive } from 'vue'
import type { ToolCallInfo, ToolResultInfo, ToolExecutionMetadata } from '@/types/ai'

const TREND_SAMPLE_LIMIT = 20
const SESSION_HISTORY_LIMIT = 12

type ErrorKind = NonNullable<ToolExecutionMetadata['errorKind']> | 'unknown'

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
  responseAverageMs: number | null
  toolRunAverageMs: number | null
  lastFirstTokenDeltaMs: number | null
  lastResponseDeltaMs: number | null
  lastToolRunDeltaMs: number | null
}

export interface AiChatSessionSummary {
  startedAt: number | null
  firstTokenLatencyMs: number | null
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
    firstTokenLatencyMs: number | null
    responseDurationMs: number | null
    loadHistoryDurationMs: number | null
    historyRestoreCount: number
    compactTriggeredCount: number
    pendingToolQueueLength: number
    lastToolRun: AiToolMetricsSnapshot
  }
  trend: AiChatTrendSnapshot
  sessionHistory: AiChatSessionSummary[]
  errorBreakdown: AiChatErrorBreakdownItem[]
}

export interface AiChatMetricsSnapshot {
  sessionStartedAt: number | null
  firstTokenAt: number | null
  firstTokenLatencyMs: number | null
  responseCompletedAt: number | null
  responseDurationMs: number | null
  loadHistoryStartedAt: number | null
  loadHistoryDurationMs: number | null
  historyRestoreCount: number
  compactTriggeredCount: number
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
    firstTokenAt: null as number | null,
    firstTokenLatencyMs: null as number | null,
    responseCompletedAt: null as number | null,
    responseDurationMs: null as number | null,
    loadHistoryStartedAt: null as number | null,
    loadHistoryDurationMs: null as number | null,
    historyRestoreCount: 0,
    compactTriggeredCount: 0,
    pendingToolQueueLength: 0,
    lastToolRun: emptyToolSnapshot(),
  })

  const trendState = reactive({
    firstTokenSamples: [] as number[],
    responseSamples: [] as number[],
    toolRunSamples: [] as number[],
    lastFirstTokenDeltaMs: null as number | null,
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
      trendState.responseSamples.length,
      trendState.toolRunSamples.length,
    ),
    firstTokenAverageMs: average(trendState.firstTokenSamples),
    responseAverageMs: average(trendState.responseSamples),
    toolRunAverageMs: average(trendState.toolRunSamples),
    lastFirstTokenDeltaMs: trendState.lastFirstTokenDeltaMs,
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
      firstTokenLatencyMs: state.firstTokenLatencyMs,
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
    state.firstTokenAt = null
    state.firstTokenLatencyMs = null
    state.responseCompletedAt = null
    state.responseDurationMs = null
    state.lastToolRun = emptyToolSnapshot()
  }

  function markFirstToken(now = Date.now()): void {
    if (!state.sessionStartedAt || state.firstTokenAt) return
    state.firstTokenAt = now
    state.firstTokenLatencyMs = now - state.sessionStartedAt
    if (state.firstTokenLatencyMs !== null) {
      trendState.lastFirstTokenDeltaMs = pushSample(trendState.firstTokenSamples, state.firstTokenLatencyMs)
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
        firstTokenLatencyMs: state.firstTokenLatencyMs,
        responseDurationMs: state.responseDurationMs,
        loadHistoryDurationMs: state.loadHistoryDurationMs,
        historyRestoreCount: state.historyRestoreCount,
        compactTriggeredCount: state.compactTriggeredCount,
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
    state.firstTokenAt = null
    state.firstTokenLatencyMs = null
    state.responseCompletedAt = null
    state.responseDurationMs = null
    state.loadHistoryStartedAt = null
    state.loadHistoryDurationMs = null
    state.historyRestoreCount = 0
    state.compactTriggeredCount = 0
    state.pendingToolQueueLength = 0
    state.lastToolRun = emptyToolSnapshot()

    trendState.firstTokenSamples = []
    trendState.responseSamples = []
    trendState.toolRunSamples = []
    trendState.lastFirstTokenDeltaMs = null
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
    markFirstToken,
    markResponseComplete,
    markHistoryLoadStart,
    markHistoryLoadComplete,
    markCompactTriggered,
    updatePendingToolQueueLength,
    recordToolRun,
    exportSnapshot,
    reset,
  }
}
