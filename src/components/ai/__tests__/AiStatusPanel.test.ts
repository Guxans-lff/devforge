import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import AiStatusPanel from '@/components/ai/AiStatusPanel.vue'
import type { AiTurnState } from '@/composables/ai/AiTurnRuntime'
import type { AiChatMetricsSnapshot } from '@/composables/ai/useAiChatObservability'

const IconStub = defineComponent({
  name: 'IconStub',
  setup() {
    return () => h('span')
  },
})

function turnState(overrides: Partial<AiTurnState> = {}): AiTurnState {
  return {
    phase: 'tool_executing',
    turnId: 'turn-1',
    startedAt: Date.now() - 1500,
    executingToolIds: ['tool-a', 'tool-b'],
    ...overrides,
  }
}

function metrics(): AiChatMetricsSnapshot {
  return {
    sessionStartedAt: Date.now() - 3000,
    prepareCompletedAt: Date.now() - 2500,
    prepareDurationMs: 120,
    requestStartedAt: Date.now() - 2000,
    requestCount: 1,
    recoveryCount: 1,
    firstTokenAt: Date.now() - 1800,
    firstTokenLatencyMs: 300,
    requestFirstTokenLatencyMs: 260,
    responseCompletedAt: Date.now() - 300,
    responseDurationMs: 1700,
    loadHistoryStartedAt: null,
    loadHistoryDurationMs: null,
    historyRestoreCount: 0,
    compactTriggeredCount: 0,
    providerRerouteCount: 0,
    autoDowngradeCount: 0,
    autoSwitchProviderCount: 0,
    lastRoutingReason: null,
    pendingToolQueueLength: 2,
    lastToolRun: {
      totalCalls: 2,
      successCount: 1,
      errorCount: 1,
      cancelledCount: 0,
      timeoutCount: 0,
      retryCount: 1,
      totalDurationMs: 1000,
      maxDurationMs: 700,
      averageDurationMs: 500,
    },
    trend: {
      sampleCount: 1,
      firstTokenAverageMs: 300,
      requestFirstTokenAverageMs: 260,
      responseAverageMs: 1700,
      toolRunAverageMs: 500,
      lastFirstTokenDeltaMs: null,
      lastRequestFirstTokenDeltaMs: null,
      lastResponseDeltaMs: null,
      lastToolRunDeltaMs: null,
    },
    sessionHistory: [],
    errorBreakdown: [{ kind: 'timeout', count: 1 }],
  }
}

describe('AiStatusPanel', () => {
  function mountComponent(props = {}) {
    return mount(AiStatusPanel, {
      props: {
        turnState: turnState(),
        metrics: metrics(),
        tasks: [
          { id: 'task-1', title: 'Task 1', prompt: 'p', status: 'running', dispatchStatus: 'running' },
          { id: 'task-2', title: 'Task 2', prompt: 'p', status: 'done', dispatchStatus: 'done' },
        ],
        ...props,
      },
      global: {
        stubs: {
          Activity: IconStub,
          AlertTriangle: IconStub,
          Bot: IconStub,
          CheckCircle2: IconStub,
          Clock3: IconStub,
          Loader2: IconStub,
          Timer: IconStub,
          TrendingUp: IconStub,
          Wrench: IconStub,
        },
      },
    })
  }

  it('renders phase, tool ids, task counts, metrics and timeline', () => {
    const wrapper = mountComponent()

    expect(wrapper.text()).toContain('执行工具')
    expect(wrapper.text()).toContain('工具 2')
    expect(wrapper.text()).toContain('tool-a, tool-b')
    expect(wrapper.text()).toContain('任务 1 运行 / 0 等待 / 1 完成')
    expect(wrapper.text()).toContain('准备 120ms')
    expect(wrapper.text()).toContain('恢复 1 次')
    expect(wrapper.text()).toContain('上轮工具 1/2')
    expect(wrapper.text()).toContain('平均首 token 300ms')
    expect(wrapper.text()).toContain('平均响应 1.7s')
    expect(wrapper.text()).toContain('最近失败 timeout×1')
  })

  it('hides when idle and no activity exists', () => {
    const wrapper = mountComponent({
      turnState: turnState({ phase: 'idle', executingToolIds: [], startedAt: undefined }),
      metrics: null,
      tasks: [],
    })

    expect(wrapper.find('[data-testid="ai-status-panel"]').exists()).toBe(false)
  })
})
