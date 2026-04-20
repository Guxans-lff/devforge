import { describe, expect, it } from 'vitest'
import { useAiChatObservability } from '@/composables/ai/useAiChatObservability'
import type { ToolCallInfo, ToolResultInfo } from '@/types/ai'

function makeToolCall(id: string, durationMs: number, retryCount = 0): ToolCallInfo {
  return {
    id,
    name: 'read_file',
    arguments: '{}',
    status: 'success',
    execution: {
      class: 'read',
      queue: 'read-other',
      lockKey: `tool:${id}`,
      queuedAt: 1000,
      startedAt: 1010,
      finishedAt: 1010 + durationMs,
      durationMs,
      waitMs: 10,
      attempt: retryCount + 1,
      maxAttempts: retryCount + 1,
      retryCount,
      timeoutMs: 30000,
      hardTimeout: true,
    },
  }
}

function makeToolResult(id: string, success: boolean, durationMs: number, options?: { retryCount?: number; timedOut?: boolean; cancelled?: boolean }): ToolResultInfo {
  return {
    toolCallId: id,
    toolName: 'read_file',
    success,
    content: success ? 'ok' : 'failed',
    metadata: {
      class: 'read',
      queue: 'read-other',
      lockKey: `tool:${id}`,
      startedAt: 1010,
      finishedAt: 1010 + durationMs,
      durationMs,
      waitMs: 10,
      attempts: (options?.retryCount ?? 0) + 1,
      retryCount: options?.retryCount ?? 0,
      timeoutMs: 30000,
      timedOut: options?.timedOut,
      cancelled: options?.cancelled,
      errorKind: options?.timedOut ? 'timeout' : options?.cancelled ? 'cancelled' : undefined,
    },
  }
}

describe('useAiChatObservability', () => {
  it('tracks response metrics, session history, error breakdown, and export snapshot', () => {
    const obs = useAiChatObservability()

    obs.markSendStart(1000)
    obs.markFirstToken(1125)
    obs.markResponseComplete(1800)
    obs.recordToolRun(
      [makeToolCall('warmup', 20)],
      [makeToolResult('warmup', true, 20)],
    )

    obs.markSendStart(2000)
    obs.markFirstToken(2185)
    obs.markResponseComplete(2950)
    obs.markHistoryLoadStart(2000)
    obs.markHistoryLoadComplete(12, 2150)
    obs.markCompactTriggered()
    obs.updatePendingToolQueueLength(3)

    const toolCalls = [
      makeToolCall('tool-1', 30),
      makeToolCall('tool-2', 70, 1),
      makeToolCall('tool-3', 20),
    ]
    const toolResults = [
      makeToolResult('tool-1', true, 30),
      makeToolResult('tool-2', false, 70, { retryCount: 1, timedOut: true }),
      makeToolResult('tool-3', false, 20, { cancelled: true }),
    ]

    obs.recordToolRun(toolCalls, toolResults)

    expect(obs.metrics.value.firstTokenLatencyMs).toBe(185)
    expect(obs.metrics.value.responseDurationMs).toBe(950)
    expect(obs.metrics.value.loadHistoryDurationMs).toBe(150)
    expect(obs.metrics.value.historyRestoreCount).toBe(12)
    expect(obs.metrics.value.compactTriggeredCount).toBe(1)
    expect(obs.metrics.value.pendingToolQueueLength).toBe(3)
    expect(obs.metrics.value.lastToolRun.totalCalls).toBe(3)
    expect(obs.metrics.value.lastToolRun.successCount).toBe(1)
    expect(obs.metrics.value.lastToolRun.errorCount).toBe(2)
    expect(obs.metrics.value.lastToolRun.timeoutCount).toBe(1)
    expect(obs.metrics.value.lastToolRun.cancelledCount).toBe(1)
    expect(obs.metrics.value.lastToolRun.retryCount).toBe(1)
    expect(obs.metrics.value.lastToolRun.averageDurationMs).toBe(40)
    expect(obs.metrics.value.lastToolRun.maxDurationMs).toBe(70)
    expect(obs.metrics.value.trend.sampleCount).toBe(2)
    expect(obs.metrics.value.trend.firstTokenAverageMs).toBe(155)
    expect(obs.metrics.value.trend.responseAverageMs).toBe(875)
    expect(obs.metrics.value.trend.toolRunAverageMs).toBe(30)
    expect(obs.metrics.value.trend.lastFirstTokenDeltaMs).toBe(60)
    expect(obs.metrics.value.trend.lastResponseDeltaMs).toBe(150)
    expect(obs.metrics.value.trend.lastToolRunDeltaMs).toBe(20)
    expect(obs.metrics.value.errorBreakdown).toEqual([
      { kind: 'timeout', count: 1 },
      { kind: 'cancelled', count: 1 },
    ])

    obs.markSendStart(4000)

    expect(obs.metrics.value.sessionHistory).toHaveLength(2)
    expect(obs.metrics.value.sessionHistory[0]).toMatchObject({
      firstTokenLatencyMs: 125,
      responseDurationMs: 800,
      toolCallCount: 1,
      success: true,
    })
    expect(obs.metrics.value.sessionHistory[1]).toMatchObject({
      firstTokenLatencyMs: 185,
      responseDurationMs: 950,
      toolCallCount: 3,
      toolErrorCount: 2,
      timeoutCount: 1,
      success: false,
    })

    const snapshot = obs.exportSnapshot(9000)
    expect(snapshot.exportedAt).toBe(9000)
    expect(snapshot.current.compactTriggeredCount).toBe(1)
    expect(snapshot.trend.sampleCount).toBe(2)
    expect(snapshot.sessionHistory).toHaveLength(2)
    expect(snapshot.errorBreakdown).toEqual([
      { kind: 'timeout', count: 1 },
      { kind: 'cancelled', count: 1 },
    ])
  })
})
