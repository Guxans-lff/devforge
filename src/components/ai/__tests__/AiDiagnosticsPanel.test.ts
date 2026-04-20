import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AiDiagnosticsPanel from '@/components/ai/AiDiagnosticsPanel.vue'

describe('AiDiagnosticsPanel', () => {
  it('renders localized diagnostics and expands to show trend, history, and export action', async () => {
    const wrapper = mount(AiDiagnosticsPanel, {
      props: {
        metrics: {
          sessionStartedAt: 1000,
          firstTokenAt: 7200,
          firstTokenLatencyMs: 6200,
          responseCompletedAt: 49200,
          responseDurationMs: 48200,
          loadHistoryStartedAt: 2000,
          loadHistoryDurationMs: 2100,
          historyRestoreCount: 18,
          compactTriggeredCount: 2,
          pendingToolQueueLength: 4,
          lastToolRun: {
            totalCalls: 4,
            successCount: 3,
            errorCount: 1,
            cancelledCount: 0,
            timeoutCount: 1,
            retryCount: 1,
            totalDurationMs: 980,
            maxDurationMs: 420,
            averageDurationMs: 245,
          },
          trend: {
            sampleCount: 5,
            firstTokenAverageMs: 3100,
            responseAverageMs: 22300,
            toolRunAverageMs: 180,
            lastFirstTokenDeltaMs: 1500,
            lastResponseDeltaMs: -2200,
            lastToolRunDeltaMs: 40,
          },
          sessionHistory: [
            {
              startedAt: 1,
              firstTokenLatencyMs: 210,
              responseDurationMs: 980,
              toolCallCount: 2,
              toolErrorCount: 0,
              timeoutCount: 0,
              success: true,
            },
          ],
          errorBreakdown: [
            { kind: 'timeout', count: 2 },
            { kind: 'tool_error', count: 1 },
          ],
        },
      },
    })

    expect(wrapper.text()).toContain('ai.diagnostics.title')
    expect(wrapper.text()).toContain('ai.diagnostics.critical')
    expect(wrapper.text()).toContain('6.20 s')
    expect(wrapper.text()).toContain('ai.diagnostics.avg')
    expect(wrapper.text()).not.toContain('ai.diagnostics.lastToolRun')

    await wrapper.find('button').trigger('click')

    expect(wrapper.text()).toContain('ai.diagnostics.trend')
    expect(wrapper.text()).toContain('ai.diagnostics.sessionHistory')
    expect(wrapper.text()).toContain('ai.diagnostics.errorBreakdown')
    expect(wrapper.text()).toContain('ai.diagnostics.copySnapshot')
    expect(wrapper.text()).toContain('ai.diagnostics.deltaVsPrev')
    expect(wrapper.text()).toContain('ai.diagnostics.lastToolRun')
    expect(wrapper.text()).toContain('ai.diagnostics.timeouts')
    expect(wrapper.text()).toContain('420 ms')
  })
})
