import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AiDiagnosticsPanel from '@/components/ai/AiDiagnosticsPanel.vue'
import { setupTestPinia } from '@/__tests__/helpers'
import { useSettingsStore } from '@/stores/settings'
import { useAiChatStore } from '@/stores/ai-chat'
import { clearUsageRecords, recordUsage } from '@/ai-gateway/usageTracker'
import { AiGatewayError } from '@/ai-gateway/types'

describe('AiDiagnosticsPanel', () => {
  beforeEach(() => {
    clearUsageRecords()
  })

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
        runtimeSnapshot: {
          turnId: 'turn-1',
          phase: 'streaming',
          health: 'healthy',
          isBusy: true,
          canAbort: true,
          durationMs: 800,
          activeToolCount: 1,
          pendingToolCount: 1,
          textDeltaLength: 12,
          thinkingDeltaLength: 5,
          transitionCount: 3,
          lastTransitionReason: 'request_start',
          lastTransitionAt: 1200,
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
    expect(wrapper.vm.$props.runtimeSnapshot?.turnId).toBe('turn-1')
  })

  it('copies base diagnostics with a standard empty transcript report', async () => {
    setupTestPinia()
    const aiStore = useAiChatStore()
    aiStore.activeSessionId = 's-base-export'
    aiStore.currentWorkDir = 'D:/Project/devforge'
    recordUsage({
      requestId: 'req-base-export',
      sessionId: 's-base-export',
      source: 'chat',
      kind: 'chat_completions',
      providerId: 'provider-base',
      model: 'model-base',
      startedAt: 100,
      firstTokenAt: 120,
      finishedAt: 180,
      status: 'success',
      usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
      cost: { inputCost: 0.01, outputCost: 0.01, totalCost: 0.02, currency: 'USD' },
    })
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

    const wrapper = mount(AiDiagnosticsPanel, {
      props: {
        metrics: {
          sessionStartedAt: 1000,
          prepareCompletedAt: 1100,
          prepareDurationMs: 100,
          requestStartedAt: 1200,
          requestCount: 1,
          recoveryCount: 0,
          firstTokenAt: 1300,
          firstTokenLatencyMs: 100,
          requestFirstTokenLatencyMs: 100,
          responseCompletedAt: 1800,
          responseDurationMs: 600,
          loadHistoryStartedAt: null,
          loadHistoryDurationMs: null,
          historyRestoreCount: 0,
          compactTriggeredCount: 0,
          providerRerouteCount: 0,
          autoDowngradeCount: 0,
          autoSwitchProviderCount: 0,
          lastRoutingReason: null,
          pendingToolQueueLength: 0,
          lastToolRun: {
            totalCalls: 0,
            successCount: 0,
            errorCount: 0,
            cancelledCount: 0,
            timeoutCount: 0,
            retryCount: 0,
            totalDurationMs: 0,
            maxDurationMs: 0,
            averageDurationMs: 0,
          },
          trend: {
            sampleCount: 0,
            firstTokenAverageMs: null,
            requestFirstTokenAverageMs: null,
            responseAverageMs: null,
            toolRunAverageMs: null,
            lastFirstTokenDeltaMs: null,
            lastRequestFirstTokenDeltaMs: null,
            lastResponseDeltaMs: null,
            lastToolRunDeltaMs: null,
          },
          sessionHistory: [],
          errorBreakdown: [],
        },
      },
    })

    await wrapper.find('button').trigger('click')
    await wrapper.findAll('button')[1]!.trigger('click')

    const copied = JSON.parse(String(writeText.mock.calls.at(-1)?.[0]))
    expect(copied).toMatchObject({
      schemaVersion: 2,
      session: {
        sessionId: 's-base-export',
        workDir: 'D:/Project/devforge',
      },
      gateway: {
        summary: {
          requestCount: 1,
          totalTokens: 10,
        },
      },
      transcriptDiagnosticReport: {
        sessionId: 's-base-export',
        eventCount: 0,
        gatewayDashboard: {
          currentRoute: {
            requestId: 'req-base-export',
            model: 'model-base',
          },
        },
      },
    })
  })

  it('renders Gateway route latency, fallback, and error details', async () => {
    setupTestPinia()
    const aiStore = useAiChatStore()
    aiStore.providers = [{
      id: 'provider-fallback',
      name: 'Fallback Provider',
      providerType: 'openai_compat',
      endpoint: 'https://api.example.com',
      models: [],
      isDefault: false,
      createdAt: 1,
    }]
    await aiStore.saveWorkspaceConfig('D:/Project/devforge', {
      gatewayPolicy: {
        fallbackEnabled: true,
        fallbackProviderIds: ['provider-fallback'],
        routingStrategy: 'cost',
        rateLimit: { windowMs: 30000, maxRequests: 5 },
      },
    })
    aiStore.currentWorkDir = 'D:/Project/devforge'
    recordUsage({
      requestId: 'req-gateway-error',
      sessionId: 'session-gateway',
      source: 'chat',
      kind: 'chat_completions',
      providerProfileId: 'profile-coding',
      providerId: 'provider-fallback',
      model: 'model-fallback',
      primaryProviderId: 'provider-primary',
      primaryModel: 'model-primary',
      fallbackReason: 'switch_provider',
      fallbackChainId: 'provider-primary->provider-fallback',
      retryIndex: 1,
      startedAt: 100,
      firstTokenAt: 140,
      finishedAt: 220,
      status: 'error',
      usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
      cost: { inputCost: 0.01, outputCost: 0.01, totalCost: 0.02, currency: 'USD' },
      error: new AiGatewayError('provider_error', 'Endpoint security check failed: Private IP is not allowed', false),
    })

    const wrapper = mount(AiDiagnosticsPanel, {
      props: {
        metrics: {
          sessionStartedAt: 1000,
          prepareCompletedAt: 1100,
          prepareDurationMs: 100,
          requestStartedAt: 1200,
          requestCount: 1,
          recoveryCount: 0,
          firstTokenAt: 1300,
          firstTokenLatencyMs: 100,
          requestFirstTokenLatencyMs: 100,
          responseCompletedAt: 1800,
          responseDurationMs: 600,
          loadHistoryStartedAt: null,
          loadHistoryDurationMs: null,
          historyRestoreCount: 0,
          compactTriggeredCount: 0,
          providerRerouteCount: 0,
          autoDowngradeCount: 0,
          autoSwitchProviderCount: 0,
          lastRoutingReason: null,
          pendingToolQueueLength: 0,
          lastToolRun: {
            totalCalls: 0,
            successCount: 0,
            errorCount: 0,
            cancelledCount: 0,
            timeoutCount: 0,
            retryCount: 0,
            totalDurationMs: 0,
            maxDurationMs: 0,
            averageDurationMs: 0,
          },
          trend: {
            sampleCount: 0,
            firstTokenAverageMs: null,
            requestFirstTokenAverageMs: null,
            responseAverageMs: null,
            toolRunAverageMs: null,
            lastFirstTokenDeltaMs: null,
            lastRequestFirstTokenDeltaMs: null,
            lastResponseDeltaMs: null,
            lastToolRunDeltaMs: null,
          },
          sessionHistory: [],
          errorBreakdown: [],
        },
      },
    })

    await wrapper.find('button').trigger('click')

    expect(wrapper.text()).toContain('Fallback Provider')
    expect(wrapper.text()).toContain('profile-coding')
    expect(wrapper.text()).toContain('model-fallback')
    expect(wrapper.text()).toContain('provider-primary / model-primary')
    expect(wrapper.text()).toContain('100')
    expect(wrapper.text()).toContain('(80 / 20)')
    expect(wrapper.text()).toContain('0.02 USD')
    expect(wrapper.text()).toContain('Token 100')
    expect(wrapper.text()).toContain('120 ms')
    expect(wrapper.text()).toContain('40 ms')
    expect(wrapper.text()).toContain('当前请求由 fallback 路由承接')
    expect(wrapper.text()).toContain('switch_provider')
    expect(wrapper.text()).toContain('provider-primary->provider-fallback')
    expect(wrapper.text()).toContain('provider_error')
    expect(wrapper.text()).toContain('Private IP is not allowed')
    expect(wrapper.text()).toContain('Gateway Profile 策略')
    expect(wrapper.text()).toContain('SLA 报表')
    expect(wrapper.text()).toContain('critical')
    expect(wrapper.text()).toContain('错误率')
    expect(wrapper.text()).toContain('模型路由')
    expect(wrapper.text()).toContain('TTFB')
    expect(wrapper.text()).toContain('err')
    expect(wrapper.text()).toContain('fb')
    expect(wrapper.text()).toContain('Profile 汇总')
    expect(wrapper.text()).toContain('备用 Provider')
    expect(wrapper.text()).toContain('Fallback Provider')
    expect(wrapper.text()).toContain('成本优先')
    expect(wrapper.text()).toContain('30000ms / 5 次')
    expect(wrapper.text()).toContain('Fallback 列表包含当前主 Provider')
    expect(wrapper.text()).toContain('当前只有一个 Provider')
  })

  it('renders Gateway policy risks for missing and weak fallback providers', async () => {
    setupTestPinia()
    const aiStore = useAiChatStore()
    aiStore.providers = [
      {
        id: 'provider-primary',
        name: 'Primary Provider',
        providerType: 'openai_compat',
        endpoint: 'https://api.primary.example.com',
        models: [{
          id: 'primary-model',
          name: 'Primary Model',
          capabilities: {
            streaming: true,
            vision: true,
            thinking: true,
            toolUse: true,
            maxContext: 1000000,
            maxOutput: 128000,
          },
        }],
        isDefault: true,
        createdAt: 1,
      },
      {
        id: 'provider-weak',
        name: 'Weak Provider',
        providerType: 'openai_compat',
        endpoint: 'https://api.weak.example.com',
        models: [{
          id: 'weak-model',
          name: 'Weak Model',
          capabilities: {
            streaming: false,
            vision: false,
            thinking: false,
            toolUse: false,
            maxContext: 4096,
            maxOutput: 1024,
          },
        }],
        isDefault: false,
        createdAt: 2,
      },
    ]
    await aiStore.saveSession({
      id: 'session-policy-risk',
      title: 'Gateway Policy Risk',
      providerId: 'provider-primary',
      model: 'primary-model',
      messages: [],
      createdAt: 100,
      updatedAt: 100,
    })
    aiStore.setActiveSession('session-policy-risk')
    await aiStore.saveWorkspaceConfig('D:/Project/devforge', {
      gatewayPolicy: {
        fallbackEnabled: true,
        fallbackProviderIds: ['provider-primary', 'provider-weak', 'provider-missing'],
        routingStrategy: 'capability',
        rateLimit: { windowMs: 5000, maxRequests: 100 },
      },
    })
    aiStore.currentWorkDir = 'D:/Project/devforge'

    const wrapper = mount(AiDiagnosticsPanel, {
      props: {
        metrics: {
          sessionStartedAt: 1000,
          prepareCompletedAt: 1100,
          prepareDurationMs: 100,
          requestStartedAt: 1200,
          requestCount: 1,
          recoveryCount: 0,
          firstTokenAt: 1300,
          firstTokenLatencyMs: 100,
          requestFirstTokenLatencyMs: 100,
          responseCompletedAt: 1800,
          responseDurationMs: 600,
          loadHistoryStartedAt: null,
          loadHistoryDurationMs: null,
          historyRestoreCount: 0,
          compactTriggeredCount: 0,
          providerRerouteCount: 0,
          autoDowngradeCount: 0,
          autoSwitchProviderCount: 0,
          lastRoutingReason: null,
          pendingToolQueueLength: 0,
          lastToolRun: {
            totalCalls: 0,
            successCount: 0,
            errorCount: 0,
            cancelledCount: 0,
            timeoutCount: 0,
            retryCount: 0,
            totalDurationMs: 0,
            maxDurationMs: 0,
            averageDurationMs: 0,
          },
          trend: {
            sampleCount: 0,
            firstTokenAverageMs: null,
            requestFirstTokenAverageMs: null,
            responseAverageMs: null,
            toolRunAverageMs: null,
            lastFirstTokenDeltaMs: null,
            lastRequestFirstTokenDeltaMs: null,
            lastResponseDeltaMs: null,
            lastToolRunDeltaMs: null,
          },
          sessionHistory: [],
          errorBreakdown: [],
        },
      },
    })

    await wrapper.find('button').trigger('click')

    expect(wrapper.text()).toContain('能力优先')
    expect(wrapper.text()).toContain('Fallback Provider 不存在：provider-missing')
    expect(wrapper.text()).toContain('Fallback 列表包含当前主 Provider')
    expect(wrapper.text()).toContain('Fallback Provider 模型能力可能不足：Weak Provider')
    expect(wrapper.text()).toContain('Profile 限流窗口较短且请求数偏高')
  })

  it('filters Gateway diagnostics by provider profile from the panel', async () => {
    setupTestPinia()
    const aiStore = useAiChatStore()
    aiStore.providers = [
      {
        id: 'provider-a',
        name: 'Provider A',
        providerType: 'openai_compat',
        endpoint: 'https://api.a.example.com',
        models: [],
        isDefault: true,
        createdAt: 1,
      },
      {
        id: 'provider-b',
        name: 'Provider B',
        providerType: 'openai_compat',
        endpoint: 'https://api.b.example.com',
        models: [],
        isDefault: false,
        createdAt: 1,
      },
    ]
    recordUsage({
      requestId: 'req-profile-a',
      sessionId: 'session-profile-filter',
      source: 'chat',
      kind: 'chat_completions',
      providerProfileId: 'profile-a',
      providerId: 'provider-a',
      model: 'model-a',
      startedAt: 100,
      firstTokenAt: 120,
      finishedAt: 180,
      status: 'success',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      cost: { inputCost: 0.01, outputCost: 0.01, totalCost: 0.02, currency: 'USD' },
    })
    recordUsage({
      requestId: 'req-profile-b',
      sessionId: 'session-profile-filter',
      source: 'chat',
      kind: 'chat_completions',
      providerProfileId: 'profile-b',
      providerId: 'provider-b',
      model: 'model-b',
      startedAt: 200,
      firstTokenAt: 240,
      finishedAt: 320,
      status: 'success',
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      cost: { inputCost: 0.02, outputCost: 0.02, totalCost: 0.04, currency: 'USD' },
    })

    aiStore.activeSessionId = 'session-profile-filter'
    const wrapper = mount(AiDiagnosticsPanel, {
      props: {
        metrics: {
          sessionStartedAt: 1000,
          prepareCompletedAt: 1100,
          prepareDurationMs: 100,
          requestStartedAt: 1200,
          requestCount: 1,
          recoveryCount: 0,
          firstTokenAt: 1300,
          firstTokenLatencyMs: 100,
          requestFirstTokenLatencyMs: 100,
          responseCompletedAt: 1800,
          responseDurationMs: 600,
          loadHistoryStartedAt: null,
          loadHistoryDurationMs: null,
          historyRestoreCount: 0,
          compactTriggeredCount: 0,
          providerRerouteCount: 0,
          autoDowngradeCount: 0,
          autoSwitchProviderCount: 0,
          lastRoutingReason: null,
          pendingToolQueueLength: 0,
          lastToolRun: {
            totalCalls: 0,
            successCount: 0,
            errorCount: 0,
            cancelledCount: 0,
            timeoutCount: 0,
            retryCount: 0,
            totalDurationMs: 0,
            maxDurationMs: 0,
            averageDurationMs: 0,
          },
          trend: {
            sampleCount: 0,
            firstTokenAverageMs: null,
            requestFirstTokenAverageMs: null,
            responseAverageMs: null,
            toolRunAverageMs: null,
            lastFirstTokenDeltaMs: null,
            lastRequestFirstTokenDeltaMs: null,
            lastResponseDeltaMs: null,
            lastToolRunDeltaMs: null,
          },
          sessionHistory: [],
          errorBreakdown: [],
        },
      },
    })

    await wrapper.find('button').trigger('click')
    expect(wrapper.find('[data-testid="gateway-profile-filter"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="gateway-profile-summary-card"]')).toHaveLength(2)

    await wrapper.find('[data-testid="gateway-profile-filter"]').setValue('profile-b')

    const cards = wrapper.findAll('[data-testid="gateway-profile-summary-card"]')
    expect(cards).toHaveLength(1)
    expect(cards[0]?.text()).toContain('profile-b')
    expect(cards[0]?.text()).not.toContain('profile-a')
    expect(wrapper.text()).toContain('Provider B')
    expect(wrapper.text()).not.toContain('Provider A / model-a')
  })

  it('filters Gateway diagnostics by source and status from the panel', async () => {
    setupTestPinia()
    const aiStore = useAiChatStore()
    aiStore.providers = [
      {
        id: 'provider-a',
        name: 'Provider A',
        providerType: 'openai_compat',
        endpoint: 'https://api.a.example.com',
        models: [],
        isDefault: true,
        createdAt: 1,
      },
    ]
    recordUsage({
      requestId: 'req-chat-success',
      sessionId: 'session-source-filter',
      source: 'chat',
      kind: 'chat_completions',
      providerProfileId: 'profile-a',
      providerId: 'provider-a',
      model: 'model-chat',
      startedAt: 100,
      firstTokenAt: 120,
      finishedAt: 180,
      status: 'success',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      cost: { inputCost: 0.01, outputCost: 0.01, totalCost: 0.02, currency: 'USD' },
    })
    recordUsage({
      requestId: 'req-compact-error',
      sessionId: 'session-source-filter',
      source: 'compact',
      kind: 'compact',
      providerProfileId: 'profile-a',
      providerId: 'provider-a',
      model: 'model-compact',
      startedAt: 200,
      finishedAt: 320,
      status: 'error',
      error: new AiGatewayError('context_too_long', 'context exceeded', false),
      usage: { promptTokens: 20, completionTokens: 0, totalTokens: 20 },
      cost: { inputCost: 0.02, outputCost: 0, totalCost: 0.02, currency: 'USD' },
    })

    aiStore.activeSessionId = 'session-source-filter'
    const wrapper = mount(AiDiagnosticsPanel, {
      props: {
        metrics: {
          sessionStartedAt: 1000,
          prepareCompletedAt: 1100,
          prepareDurationMs: 100,
          requestStartedAt: 1200,
          requestCount: 1,
          recoveryCount: 0,
          firstTokenAt: 1300,
          firstTokenLatencyMs: 100,
          requestFirstTokenLatencyMs: 100,
          responseCompletedAt: 1800,
          responseDurationMs: 600,
          loadHistoryStartedAt: null,
          loadHistoryDurationMs: null,
          historyRestoreCount: 0,
          compactTriggeredCount: 0,
          providerRerouteCount: 0,
          autoDowngradeCount: 0,
          autoSwitchProviderCount: 0,
          lastRoutingReason: null,
          pendingToolQueueLength: 0,
          lastToolRun: {
            totalCalls: 0,
            successCount: 0,
            errorCount: 0,
            cancelledCount: 0,
            timeoutCount: 0,
            retryCount: 0,
            totalDurationMs: 0,
            maxDurationMs: 0,
            averageDurationMs: 0,
          },
          trend: {
            sampleCount: 0,
            firstTokenAverageMs: null,
            requestFirstTokenAverageMs: null,
            responseAverageMs: null,
            toolRunAverageMs: null,
            lastFirstTokenDeltaMs: null,
            lastRequestFirstTokenDeltaMs: null,
            lastResponseDeltaMs: null,
            lastToolRunDeltaMs: null,
          },
          sessionHistory: [],
          errorBreakdown: [],
        },
      },
    })

    await wrapper.find('button').trigger('click')
    expect(wrapper.find('[data-testid="gateway-source-filter"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="gateway-status-filter"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="gateway-provider-filter"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="gateway-kind-filter"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('请求类型')
    expect(wrapper.text()).toContain('model-chat')
    expect(wrapper.text()).toContain('model-compact')

    await wrapper.find('[data-testid="gateway-provider-filter"]').setValue('provider-a')
    await wrapper.find('[data-testid="gateway-kind-filter"]').setValue('compact')
    await wrapper.find('[data-testid="gateway-source-filter"]').setValue('compact')
    await wrapper.find('[data-testid="gateway-status-filter"]').setValue('error')

    expect(wrapper.text()).toContain('model-compact')
    expect(wrapper.text()).toContain('context_too_long')
    expect(wrapper.text()).not.toContain('model-chat')
  })

  it('copies full transcript when backend export loader is provided', async () => {
    setupTestPinia()
    const aiStore = useAiChatStore()
    aiStore.activeSessionId = 's1'
    recordUsage({
      requestId: 'req-export-gateway',
      sessionId: 's1',
      source: 'chat',
      kind: 'chat_completions',
      providerProfileId: 'profile-export',
      providerId: 'provider-export',
      model: 'model-export',
      startedAt: 1000,
      firstTokenAt: 1050,
      finishedAt: 1200,
      status: 'success',
      usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
      cost: { inputCost: 0.01, outputCost: 0.02, totalCost: 0.03, currency: 'USD' },
    })
    await aiStore.saveWorkspaceConfig('D:/Project/devforge', {
      gatewayPolicy: {
        fallbackEnabled: false,
        routingStrategy: 'speed',
      },
    })
    aiStore.currentWorkDir = 'D:/Project/devforge'
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

    const wrapper = mount(AiDiagnosticsPanel, {
      props: {
        metrics: {
          sessionStartedAt: 1000,
          prepareCompletedAt: 1100,
          prepareDurationMs: 100,
          requestStartedAt: 1200,
          requestCount: 1,
          recoveryCount: 0,
          firstTokenAt: 1300,
          firstTokenLatencyMs: 100,
          requestFirstTokenLatencyMs: 100,
          responseCompletedAt: 1800,
          responseDurationMs: 600,
          loadHistoryStartedAt: null,
          loadHistoryDurationMs: null,
          historyRestoreCount: 0,
          compactTriggeredCount: 0,
          providerRerouteCount: 0,
          autoDowngradeCount: 0,
          autoSwitchProviderCount: 0,
          lastRoutingReason: null,
          pendingToolQueueLength: 0,
          lastToolRun: {
            totalCalls: 0,
            successCount: 0,
            errorCount: 0,
            cancelledCount: 0,
            timeoutCount: 0,
            retryCount: 0,
            totalDurationMs: 0,
            maxDurationMs: 0,
            averageDurationMs: 0,
          },
          trend: {
            sampleCount: 0,
            firstTokenAverageMs: null,
            requestFirstTokenAverageMs: null,
            responseAverageMs: null,
            toolRunAverageMs: null,
            lastFirstTokenDeltaMs: null,
            lastRequestFirstTokenDeltaMs: null,
            lastResponseDeltaMs: null,
            lastToolRunDeltaMs: null,
          },
          sessionHistory: [],
          errorBreakdown: [],
        },
        loadFullTranscript: vi.fn().mockResolvedValue([
          {
            id: 'evt-1',
            sessionId: 's1',
            type: 'compact',
            timestamp: 1000,
            payload: {
              type: 'compact',
              data: {
                trigger: 'auto',
                originalMessageCount: 8,
                originalTokens: 12000,
                summaryLength: 600,
                source: 'ai',
              },
            },
          },
          {
            id: 'evt-2',
            sessionId: 's1',
            turnId: 't2',
            type: 'user_message',
            timestamp: 2000,
            payload: { type: 'user_message', data: { contentPreview: 'api_key=sk-abcdefghijklmnopqrstuvwxyz', attachmentCount: 0 } },
          },
        ]),
      },
    })

    await wrapper.find('button').trigger('click')
    await wrapper.findAll('button')[1]!.trigger('click')

    const lastCall = writeText.mock.calls[writeText.mock.calls.length - 1]
    const copied = JSON.parse(String(lastCall?.[0]))
    expect(copied.schemaVersion).toBe(2)
    expect(copied.session).toMatchObject({
      sessionId: 's1',
      workDir: 'D:/Project/devforge',
    })
    expect(copied.fullTranscript.eventCount).toBe(2)
    expect(copied.fullTranscript.events[0].id).toBe('evt-1')
    expect(JSON.stringify(copied)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    expect(copied.fullTranscript.events[1].payload.data.contentPreview).toBe('api_key=[REDACTED]')
    expect(copied.fullTranscript.compactBoundaryProjection).toMatchObject({
      hasBoundary: true,
      projectedEventCount: 1,
      originalTokens: 12000,
    })
    expect(copied.transcriptDiagnosticReport).toMatchObject({
      sessionId: 's1',
      eventCount: 2,
      compactBoundaryProjection: {
        hasBoundary: true,
        originalTokens: 12000,
      },
      gatewayDashboard: {
        summary: {
          requestCount: 1,
          totalTokens: 20,
          totalCost: 0.03,
        },
        currentRoute: {
          requestId: 'req-export-gateway',
          providerProfileId: 'profile-export',
          model: 'model-export',
        },
      },
    })
    expect(copied.gatewayPolicy).toMatchObject({
      fallbackEnabled: false,
      routingStrategy: 'speed',
    })
  })

  it('copies diagnostics with Gateway snapshot when full transcript export fails', async () => {
    setupTestPinia()
    const aiStore = useAiChatStore()
    aiStore.activeSessionId = 's-failed-export'
    recordUsage({
      requestId: 'req-failed-export',
      sessionId: 's-failed-export',
      source: 'chat',
      kind: 'chat_completions',
      providerId: 'provider-failed-export',
      model: 'model-failed-export',
      startedAt: 100,
      finishedAt: 200,
      status: 'error',
      usage: { promptTokens: 4, completionTokens: 0, totalTokens: 4 },
      cost: { inputCost: 0.01, outputCost: 0, totalCost: 0.01, currency: 'USD' },
    })
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

    const wrapper = mount(AiDiagnosticsPanel, {
      props: {
        metrics: {
          sessionStartedAt: 1000,
          prepareCompletedAt: 1100,
          prepareDurationMs: 100,
          requestStartedAt: 1200,
          requestCount: 1,
          recoveryCount: 0,
          firstTokenAt: 1300,
          firstTokenLatencyMs: 100,
          requestFirstTokenLatencyMs: 100,
          responseCompletedAt: 1800,
          responseDurationMs: 600,
          loadHistoryStartedAt: null,
          loadHistoryDurationMs: null,
          historyRestoreCount: 0,
          compactTriggeredCount: 0,
          providerRerouteCount: 0,
          autoDowngradeCount: 0,
          autoSwitchProviderCount: 0,
          lastRoutingReason: null,
          pendingToolQueueLength: 0,
          lastToolRun: {
            totalCalls: 0,
            successCount: 0,
            errorCount: 0,
            cancelledCount: 0,
            timeoutCount: 0,
            retryCount: 0,
            totalDurationMs: 0,
            maxDurationMs: 0,
            averageDurationMs: 0,
          },
          trend: {
            sampleCount: 0,
            firstTokenAverageMs: null,
            requestFirstTokenAverageMs: null,
            responseAverageMs: null,
            toolRunAverageMs: null,
            lastFirstTokenDeltaMs: null,
            lastRequestFirstTokenDeltaMs: null,
            lastResponseDeltaMs: null,
            lastToolRunDeltaMs: null,
          },
          sessionHistory: [],
          errorBreakdown: [],
        },
        loadFullTranscript: vi.fn().mockRejectedValue(new Error('backend down')),
      },
    })

    await wrapper.find('button').trigger('click')
    await wrapper.findAll('button')[1]!.trigger('click')

    const lastCall = writeText.mock.calls[writeText.mock.calls.length - 1]
    const copied = JSON.parse(String(lastCall?.[0]))
    expect(copied.fullTranscript).toEqual({ error: 'full_transcript_export_failed' })
    expect(copied.transcriptDiagnosticReport).toMatchObject({
      sessionId: 's-failed-export',
      eventCount: 0,
      error: 'full_transcript_export_failed',
      gatewayDashboard: {
        summary: {
          requestCount: 1,
          errorCount: 1,
          totalTokens: 4,
        },
        currentRoute: {
          requestId: 'req-failed-export',
          model: 'model-failed-export',
        },
      },
    })
  })

  it('renders P2 Agent Runtime context when transcript event is available', async () => {
    setupTestPinia()

    const wrapper = mount(AiDiagnosticsPanel, {
      props: {
        metrics: {
          sessionStartedAt: 1000,
          prepareCompletedAt: 1100,
          prepareDurationMs: 100,
          requestStartedAt: 1200,
          requestCount: 1,
          recoveryCount: 0,
          firstTokenAt: 1300,
          firstTokenLatencyMs: 100,
          requestFirstTokenLatencyMs: 100,
          responseCompletedAt: 1800,
          responseDurationMs: 600,
          loadHistoryStartedAt: null,
          loadHistoryDurationMs: null,
          historyRestoreCount: 0,
          compactTriggeredCount: 0,
          providerRerouteCount: 0,
          autoDowngradeCount: 0,
          autoSwitchProviderCount: 0,
          lastRoutingReason: null,
          pendingToolQueueLength: 0,
          lastToolRun: {
            totalCalls: 0,
            successCount: 0,
            errorCount: 0,
            cancelledCount: 0,
            timeoutCount: 0,
            retryCount: 0,
            totalDurationMs: 0,
            maxDurationMs: 0,
            averageDurationMs: 0,
          },
          trend: {
            sampleCount: 1,
            firstTokenAverageMs: 100,
            requestFirstTokenAverageMs: 100,
            responseAverageMs: 600,
            toolRunAverageMs: 0,
            lastFirstTokenDeltaMs: 0,
            lastRequestFirstTokenDeltaMs: 0,
            lastResponseDeltaMs: 0,
            lastToolRunDeltaMs: 0,
          },
          sessionHistory: [],
          errorBreakdown: [],
        },
        agentRuntimeContext: {
          id: 'evt-1',
          sessionId: 's1',
          type: 'agent_runtime_context',
          timestamp: 1000,
          payload: {
            type: 'agent_runtime_context',
            data: {
              assignmentCount: 3,
              blockedCount: 1,
              warningCount: 1,
              verificationRisk: 'high',
              verificationCommandCount: 2,
              verificationGateStatus: 'block',
              verificationSafeToComplete: false,
              verificationMissingCommandCount: 2,
              verificationFailedCommandCount: 1,
              isolationBoundaryCount: 3,
              isolationMergeRequiredCount: 1,
              isolationBlockedCount: 1,
              isolationWorktreeCount: 1,
              isolationTemporaryWorkspaceCount: 1,
              isolationReviewRequiredCount: 1,
              isolationConfirmationRequiredCount: 7,
              isolationGateStatus: 'confirm_required',
              isolationSafeToAutoRun: false,
              lspDiagnosticCount: 4,
              lspSummary: '诊断 4 条：error 0，warning 4，info/hint 0。',
              warnings: ['检测到任务依赖环：a -> b'],
            },
          },
        },
        agentRuntimeGovernance: {
          status: 'critical',
          contextCount: 2,
          latestRisk: 'high',
          maxBlockedCount: 1,
          maxIsolationBlockedCount: 1,
          maxIsolationMergeRequiredCount: 1,
          maxIsolationWorktreeCount: 1,
          maxIsolationTemporaryWorkspaceCount: 1,
          maxIsolationReviewRequiredCount: 1,
          maxIsolationConfirmationRequiredCount: 7,
          maxLspDiagnosticCount: 4,
          highRiskCount: 1,
          verificationBlockedCount: 1,
          verificationWarningCount: 0,
          maxVerificationMissingCommandCount: 2,
          maxVerificationFailedCommandCount: 1,
          warningCount: 2,
          recommendations: [
            '存在阻塞的 Multi-Agent 任务，优先检查依赖环或缺失依赖。',
            '存在需要合并审核的隔离执行空间，合入前应查看 diff。',
            '存在 high 风险验证计划，合入前必须保留验证证据。',
            'Verification Gate 已阻止完成，必须先修复失败命令并重新验证。',
          ],
        },
      },
    })

    await wrapper.find('button').trigger('click')

    expect(wrapper.text()).toContain('P2 Agent Runtime')
    expect(wrapper.text()).toContain('Agent 分配')
    expect(wrapper.text()).toContain('验证风险')
    expect(wrapper.text()).toContain('验证门禁')
    expect(wrapper.text()).toContain('缺验证')
    expect(wrapper.text()).toContain('失败验证')
    expect(wrapper.text()).toContain('block')
    expect(wrapper.text()).toContain('high')
    expect(wrapper.text()).toContain('诊断 4 条')
    expect(wrapper.text()).toContain('治理上下文')
    expect(wrapper.text()).toContain('高风险次数')
    expect(wrapper.text()).toContain('门禁阻塞')
    expect(wrapper.text()).toContain('最多缺验证')
    expect(wrapper.text()).toContain('最多失败验证')
    expect(wrapper.text()).toContain('合并审核')
    expect(wrapper.text()).toContain('Worktree')
    expect(wrapper.text()).toContain('临时空间')
    expect(wrapper.text()).toContain('需审核')
    expect(wrapper.text()).toContain('需确认动作')
    expect(wrapper.text()).toContain('隔离门禁')
    expect(wrapper.text()).toContain('confirm_required')
    expect(wrapper.text()).toContain('可自动执行')
    expect(wrapper.text()).toContain('存在阻塞的 Multi-Agent')
    expect(wrapper.text()).toContain('合入前应查看 diff')
    expect(wrapper.text()).toContain('Verification Gate 已阻止完成')
    expect(wrapper.text()).toContain('检测到任务依赖环')
  })
})
