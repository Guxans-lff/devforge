import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AiDiagnosticsPanel from '@/components/ai/AiDiagnosticsPanel.vue'
import { setupTestPinia } from '@/__tests__/helpers'
import { useSettingsStore } from '@/stores/settings'

describe('AiDiagnosticsPanel', () => {
  it('renders localized diagnostics and expands to show trend, history, and export action', async () => {
    setupTestPinia()
    const settingsStore = useSettingsStore()
    settingsStore.update({
      aiDiagnosticsThresholds: {
        ...settingsStore.settings.aiDiagnosticsThresholds,
        firstTokenWarnMs: 5000,
        firstTokenDangerMs: 7000,
        responseWarnMs: 40000,
        responseDangerMs: 50000,
        toolQueueWarnCount: 3,
        toolQueueDangerCount: 5,
      },
    })

    const wrapper = mount(AiDiagnosticsPanel, {
      props: {
        metrics: {
          sessionStartedAt: 1000,
          prepareCompletedAt: 2600,
          prepareDurationMs: 1600,
          requestStartedAt: 6800,
          requestCount: 2,
          recoveryCount: 1,
          firstTokenAt: 7200,
          firstTokenLatencyMs: 6200,
          requestFirstTokenLatencyMs: 400,
          responseCompletedAt: 49200,
          responseDurationMs: 48200,
          loadHistoryStartedAt: 2000,
          loadHistoryDurationMs: 2100,
          historyRestoreCount: 18,
          compactTriggeredCount: 2,
          providerRerouteCount: 1,
          autoDowngradeCount: 2,
          autoSwitchProviderCount: 1,
          lastRoutingReason: 'switch_provider',
          pendingToolQueueLength: 4,
          lastToolRun: {
            totalCalls: 4,
            successCount: 4,
            errorCount: 0,
            cancelledCount: 0,
            timeoutCount: 0,
            retryCount: 0,
            totalDurationMs: 980,
            maxDurationMs: 420,
            averageDurationMs: 245,
          },
          trend: {
            sampleCount: 5,
            firstTokenAverageMs: 3100,
            requestFirstTokenAverageMs: 780,
            responseAverageMs: 22300,
            toolRunAverageMs: 180,
            lastFirstTokenDeltaMs: 1500,
            lastRequestFirstTokenDeltaMs: -120,
            lastResponseDeltaMs: -2200,
            lastToolRunDeltaMs: 40,
          },
          sessionHistory: [
            {
              startedAt: 1,
              prepareDurationMs: 55,
              firstTokenLatencyMs: 210,
              requestCount: 2,
              requestFirstTokenLatencyMs: 90,
              recoveryCount: 1,
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
    expect(wrapper.text()).toContain('ai.diagnostics.watch')
    expect(wrapper.text()).toContain('ai.diagnostics.prepare')
    expect(wrapper.text()).toContain('6.20 s')
    expect(wrapper.text()).toContain('400 ms')
    expect(wrapper.text()).toContain('ai.diagnostics.avg')
    expect(wrapper.text()).not.toContain('ai.diagnostics.lastToolRun')

    await wrapper.find('button').trigger('click')

    expect(wrapper.text()).toContain('ai.diagnostics.trend')
    expect(wrapper.text()).toContain('ai.diagnostics.sessionHistory')
    expect(wrapper.text()).toContain('ai.diagnostics.errorBreakdown')
    expect(wrapper.text()).toContain('ai.diagnostics.copySnapshot')
    expect(wrapper.text()).toContain('ai.diagnostics.deltaVsPrev')
    expect(wrapper.text()).toContain('ai.diagnostics.avgRequestFirstToken')
    expect(wrapper.text()).toContain('ai.diagnostics.requests')
    expect(wrapper.text()).toContain('ai.diagnostics.recoveries')
    expect(wrapper.text()).toContain('ai.diagnostics.providerReroutes')
    expect(wrapper.text()).toContain('ai.diagnostics.autoDowngrades')
    expect(wrapper.text()).toContain('ai.diagnostics.autoProviderSwitches')
    expect(wrapper.text()).toContain('ai.diagnostics.lastRoutingReason')
    expect(wrapper.text()).toContain('ai.diagnostics.routingReasonSwitchProvider')
    expect(wrapper.text()).toContain('ai.diagnostics.lastToolRun')
    expect(wrapper.text()).toContain('ai.diagnostics.timeouts')
    expect(wrapper.text()).toContain('420 ms')
  })
})
