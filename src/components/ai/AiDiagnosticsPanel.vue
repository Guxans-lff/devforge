<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiChatMetricsSnapshot } from '@/composables/ai/useAiChatObservability'
import type { AgentRuntimeSnapshot } from '@/composables/ai/AgentRuntimeSnapshot'
import { useSettingsStore } from '@/stores/settings'
import { useAiChatStore } from '@/stores/ai-chat'
import { buildGatewayDashboardSnapshot, type GatewayDashboardSnapshot } from '@/ai-gateway/gatewayDashboard'
import { describeGatewayPolicyValue } from '@/ai-gateway/gatewayPolicy'
import { buildCompactBoundaryProjection } from '@/composables/ai-agent/context/compactBoundary'
import type { AgentRuntimeGovernanceSnapshot, AiTranscriptEvent, AiTranscriptEventOf } from '@/composables/ai-agent/transcript/transcriptTypes'
import { Activity, ChevronRight, Clock3, Copy, History, Route, ShieldAlert, TrendingUp, Wrench } from 'lucide-vue-next'

type Tone = 'ok' | 'warn' | 'danger'

const props = defineProps<{
  metrics: AiChatMetricsSnapshot
  runtimeSnapshot?: AgentRuntimeSnapshot
  agentRuntimeContext?: AiTranscriptEventOf<'agent_runtime_context'>
  agentRuntimeGovernance?: AgentRuntimeGovernanceSnapshot
  loadFullTranscript?: () => Promise<unknown[]>
}>()

const { t } = useI18n()
const settingsStore = useSettingsStore()
const aiChatStore = useAiChatStore()
const expanded = ref(false)
const copied = ref(false)
const gatewayTick = ref(0)
let gatewayTimer: ReturnType<typeof setInterval> | null = null
const thresholds = computed(() => settingsStore.settings.aiDiagnosticsThresholds)

const gatewaySnapshot = computed<GatewayDashboardSnapshot>(() => {
  gatewayTick.value
  return buildGatewayDashboardSnapshot({
    sessionId: aiChatStore.activeSessionId,
    providers: aiChatStore.providers,
  })
})

const metricCards = computed(() => [
  {
    key: 'prepare',
    label: t('ai.diagnostics.prepare'),
    value: formatMs(props.metrics.prepareDurationMs),
    hint: props.metrics.prepareCompletedAt ? t('ai.diagnostics.prepared') : t('ai.diagnostics.preparing'),
    icon: Clock3,
    tone: toneForMs(props.metrics.prepareDurationMs, thresholds.value.firstTokenWarnMs, thresholds.value.firstTokenDangerMs),
  },
  {
    key: 'first-token',
    label: t('ai.diagnostics.firstToken'),
    value: formatMs(props.metrics.firstTokenLatencyMs),
    hint: props.metrics.firstTokenAt ? t('ai.diagnostics.streamStarted') : t('ai.diagnostics.waiting'),
    icon: Clock3,
    tone: toneForMs(props.metrics.firstTokenLatencyMs, thresholds.value.firstTokenWarnMs, thresholds.value.firstTokenDangerMs),
  },
  {
    key: 'request-first-token',
    label: t('ai.diagnostics.requestFirstToken'),
    value: formatMs(props.metrics.requestFirstTokenLatencyMs),
    hint: props.metrics.requestStartedAt ? t('ai.diagnostics.requestStarted') : t('ai.diagnostics.waiting'),
    icon: Activity,
    tone: toneForMs(props.metrics.requestFirstTokenLatencyMs, thresholds.value.firstTokenWarnMs, thresholds.value.firstTokenDangerMs),
  },
  {
    key: 'response',
    label: t('ai.diagnostics.response'),
    value: formatMs(props.metrics.responseDurationMs),
    hint: props.metrics.responseCompletedAt ? t('ai.diagnostics.completed') : t('ai.diagnostics.idle'),
    icon: Activity,
    tone: toneForMs(props.metrics.responseDurationMs, thresholds.value.responseWarnMs, thresholds.value.responseDangerMs),
  },
  {
    key: 'history',
    label: t('ai.diagnostics.historyLoad'),
    value: formatMs(props.metrics.loadHistoryDurationMs),
    hint: t('ai.diagnostics.restoredCount', { count: props.metrics.historyRestoreCount }),
    icon: History,
    tone: toneForMs(props.metrics.loadHistoryDurationMs, thresholds.value.historyWarnMs, thresholds.value.historyDangerMs),
  },
  {
    key: 'tool-queue',
    label: t('ai.diagnostics.toolQueue'),
    value: String(props.metrics.pendingToolQueueLength),
    hint: t('ai.diagnostics.pendingCalls'),
    icon: Wrench,
    tone: toneForCount(props.metrics.pendingToolQueueLength, thresholds.value.toolQueueWarnCount, thresholds.value.toolQueueDangerCount),
  },
])

const trendCards = computed(() => [
  {
    key: 'trend-samples',
    label: t('ai.diagnostics.samples'),
    value: String(props.metrics.trend.sampleCount),
    hint: t('ai.diagnostics.rollingWindow'),
    tone: 'ok' as Tone,
  },
  {
    key: 'trend-first-token',
    label: t('ai.diagnostics.avgFirstToken'),
    value: formatMs(props.metrics.trend.firstTokenAverageMs),
    hint: formatDelta(props.metrics.trend.lastFirstTokenDeltaMs),
    tone: toneForMs(props.metrics.trend.firstTokenAverageMs, thresholds.value.firstTokenWarnMs, thresholds.value.firstTokenDangerMs),
  },
  {
    key: 'trend-request-first-token',
    label: t('ai.diagnostics.avgRequestFirstToken'),
    value: formatMs(props.metrics.trend.requestFirstTokenAverageMs),
    hint: formatDelta(props.metrics.trend.lastRequestFirstTokenDeltaMs),
    tone: toneForMs(props.metrics.trend.requestFirstTokenAverageMs, thresholds.value.firstTokenWarnMs, thresholds.value.firstTokenDangerMs),
  },
  {
    key: 'trend-response',
    label: t('ai.diagnostics.avgResponse'),
    value: formatMs(props.metrics.trend.responseAverageMs),
    hint: formatDelta(props.metrics.trend.lastResponseDeltaMs),
    tone: toneForMs(props.metrics.trend.responseAverageMs, thresholds.value.responseWarnMs, thresholds.value.responseDangerMs),
  },
  {
    key: 'trend-tool',
    label: t('ai.diagnostics.avgToolRun'),
    value: formatMs(props.metrics.trend.toolRunAverageMs),
    hint: formatDelta(props.metrics.trend.lastToolRunDeltaMs),
    tone: toneForMs(props.metrics.trend.toolRunAverageMs, thresholds.value.toolRunWarnMs, thresholds.value.toolRunDangerMs),
  },
])

const toolSummary = computed(() => [
  { label: t('ai.diagnostics.requests'), value: props.metrics.requestCount },
  { label: t('ai.diagnostics.recoveries'), value: props.metrics.recoveryCount },
  { label: t('ai.diagnostics.providerReroutes'), value: props.metrics.providerRerouteCount },
  { label: t('ai.diagnostics.autoDowngrades'), value: props.metrics.autoDowngradeCount },
  { label: t('ai.diagnostics.autoProviderSwitches'), value: props.metrics.autoSwitchProviderCount },
  { label: t('ai.diagnostics.lastRoutingReason'), value: formatRoutingReason(props.metrics.lastRoutingReason) },
  { label: t('ai.diagnostics.calls'), value: props.metrics.lastToolRun.totalCalls },
  { label: t('ai.diagnostics.success'), value: props.metrics.lastToolRun.successCount },
  { label: t('ai.diagnostics.errors'), value: props.metrics.lastToolRun.errorCount },
  { label: t('ai.diagnostics.timeouts'), value: props.metrics.lastToolRun.timeoutCount },
  { label: t('ai.diagnostics.cancelled'), value: props.metrics.lastToolRun.cancelledCount },
  { label: t('ai.diagnostics.retries'), value: props.metrics.lastToolRun.retryCount },
  { label: t('ai.diagnostics.avg'), value: formatMs(props.metrics.lastToolRun.averageDurationMs) },
  { label: t('ai.diagnostics.max'), value: formatMs(props.metrics.lastToolRun.maxDurationMs) },
])

const gatewaySummary = computed(() => {
  const snapshot = gatewaySnapshot.value
  return [
    { label: t('ai.diagnostics.gatewayRequests'), value: snapshot.summary.requestCount },
    { label: t('ai.diagnostics.gatewaySuccessRate'), value: formatPercent(snapshot.summary.successRate) },
    { label: t('ai.diagnostics.gatewayCost'), value: formatCost(snapshot.summary.totalCost, snapshot.summary.currency) },
    { label: t('ai.diagnostics.gatewayTokens'), value: formatNumber(snapshot.summary.totalTokens) },
    { label: t('ai.diagnostics.gatewayErrors'), value: snapshot.summary.errorCount },
    { label: t('ai.diagnostics.gatewayCancelled'), value: snapshot.summary.cancelledCount },
  ]
})

const gatewayPolicySummary = computed(() => {
  const policy = aiChatStore.currentWorkspaceConfig?.gatewayPolicy
  return [
    { label: 'Fallback', value: describeGatewayPolicyValue(policy, 'fallbackEnabled', aiChatStore.providers) },
    { label: '备用 Provider', value: describeGatewayPolicyValue(policy, 'fallbackProviderIds', aiChatStore.providers) },
    { label: '路由策略', value: describeGatewayPolicyValue(policy, 'routingStrategy', aiChatStore.providers) },
    { label: '限流覆盖', value: describeGatewayPolicyValue(policy, 'rateLimit', aiChatStore.providers) },
  ]
})

const gatewayHealthTone = computed<Tone>(() => {
  const snapshot = gatewaySnapshot.value
  if (
    snapshot.securityBlocks.length > 0
    || snapshot.circuitBreakers.some(item => item.open)
    || snapshot.rateLimits.some(item => item.throttledCount > 0)
  ) {
    return 'danger'
  }
  if (snapshot.summary.errorCount > 0 || snapshot.recentFallbacks.length > 0) return 'warn'
  return 'ok'
})

const agentRuntimeContextSummary = computed(() => {
  const data = props.agentRuntimeContext?.payload.data
  if (!data) return null
  return [
    { label: 'Agent 分配', value: data.assignmentCount },
    { label: '阻塞任务', value: data.blockedCount },
    { label: '验证风险', value: data.verificationRisk },
    { label: '验证命令', value: data.verificationCommandCount },
    { label: '验证门禁', value: data.verificationGateStatus ?? 'unknown' },
    { label: '可完成', value: data.verificationSafeToComplete ? '是' : '否' },
    { label: '缺验证', value: data.verificationMissingCommandCount ?? 0 },
    { label: '失败验证', value: data.verificationFailedCommandCount ?? 0 },
    { label: '隔离边界', value: data.isolationBoundaryCount },
    { label: '需合并', value: data.isolationMergeRequiredCount ?? 0 },
    { label: '隔离阻塞', value: data.isolationBlockedCount ?? 0 },
    { label: 'Worktree', value: data.isolationWorktreeCount ?? 0 },
    { label: '临时空间', value: data.isolationTemporaryWorkspaceCount ?? 0 },
    { label: '需审核', value: data.isolationReviewRequiredCount ?? 0 },
    { label: '需确认动作', value: data.isolationConfirmationRequiredCount ?? 0 },
    { label: '隔离门禁', value: data.isolationGateStatus ?? 'unknown' },
    { label: '可自动执行', value: data.isolationSafeToAutoRun ? '是' : '否' },
    { label: 'LSP 诊断', value: data.lspDiagnosticCount },
  ]
})

const agentRuntimeContextData = computed(() => props.agentRuntimeContext?.payload.data ?? null)

const agentRuntimeContextTone = computed<Tone>(() => {
  const data = agentRuntimeContextData.value
  if (!data) return 'ok'
  if (data.blockedCount > 0 || data.verificationRisk === 'high' || data.verificationGateStatus === 'block') return 'danger'
  if (data.warningCount > 0 || data.verificationRisk === 'medium' || data.verificationGateStatus === 'warn' || data.lspDiagnosticCount > 0) return 'warn'
  return 'ok'
})

const agentRuntimeGovernanceTone = computed<Tone>(() => {
  if (props.agentRuntimeGovernance?.status === 'critical') return 'danger'
  if (props.agentRuntimeGovernance?.status === 'watch') return 'warn'
  return 'ok'
})

const sessionHistorySummary = computed(() =>
  props.metrics.sessionHistory
    .slice()
    .reverse()
    .slice(0, 4)
    .map((session, index) => ({
      key: `${session.startedAt ?? index}`,
      label: t('ai.diagnostics.recentSessionN', { index: index + 1 }),
      value: `${formatMs(session.responseDurationMs)} / ${session.requestCount} ${t('ai.diagnostics.requests')}`,
      hint: session.success
        ? t('ai.diagnostics.healthy')
        : t('ai.diagnostics.errorsAndTimeouts', {
          errors: session.toolErrorCount,
          timeouts: session.timeoutCount,
        }),
      tone: session.success ? 'ok' as Tone : session.timeoutCount > 0 ? 'danger' as Tone : 'warn' as Tone,
    })),
)

const overallTone = computed<Tone>(() => {
  if (
    props.metrics.lastToolRun.timeoutCount > 0
    || props.metrics.lastToolRun.errorCount > 0
    || props.metrics.pendingToolQueueLength > thresholds.value.toolQueueDangerCount
    || toneForMs(props.metrics.responseDurationMs, thresholds.value.responseWarnMs, thresholds.value.responseDangerMs) === 'danger'
  ) {
    return 'danger'
  }
  if (
    props.metrics.pendingToolQueueLength > thresholds.value.toolQueueWarnCount
    || toneForMs(props.metrics.firstTokenLatencyMs, thresholds.value.firstTokenWarnMs, thresholds.value.firstTokenDangerMs) !== 'ok'
    || toneForMs(props.metrics.responseDurationMs, thresholds.value.responseWarnMs, thresholds.value.responseDangerMs) !== 'ok'
  ) {
    return 'warn'
  }
  return 'ok'
})

const summaryText = computed(() => [
  `${t('ai.diagnostics.prepare')} ${formatMs(props.metrics.prepareDurationMs)}`,
  `${t('ai.diagnostics.firstToken')} ${formatMs(props.metrics.firstTokenLatencyMs)} / ${t('ai.diagnostics.avg')} ${formatMs(props.metrics.trend.firstTokenAverageMs)}`,
  `${t('ai.diagnostics.requestFirstToken')} ${formatMs(props.metrics.requestFirstTokenLatencyMs)}`,
  `${t('ai.diagnostics.response')} ${formatMs(props.metrics.responseDurationMs)} / ${t('ai.diagnostics.avg')} ${formatMs(props.metrics.trend.responseAverageMs)}`,
  `${t('ai.diagnostics.requests')} ${props.metrics.requestCount} / ${t('ai.diagnostics.recoveries')} ${props.metrics.recoveryCount}`,
  `${t('ai.diagnostics.providerReroutes')} ${props.metrics.providerRerouteCount} / ${t('ai.diagnostics.autoDowngrades')} ${props.metrics.autoDowngradeCount} / ${t('ai.diagnostics.autoProviderSwitches')} ${props.metrics.autoSwitchProviderCount}`,
].join(' | '))

const exportPayload = computed(() => JSON.stringify({
  exportedAt: Date.now(),
  current: {
    prepareDurationMs: props.metrics.prepareDurationMs,
    requestStartedAt: props.metrics.requestStartedAt,
    requestCount: props.metrics.requestCount,
    recoveryCount: props.metrics.recoveryCount,
    firstTokenLatencyMs: props.metrics.firstTokenLatencyMs,
    requestFirstTokenLatencyMs: props.metrics.requestFirstTokenLatencyMs,
    responseDurationMs: props.metrics.responseDurationMs,
    loadHistoryDurationMs: props.metrics.loadHistoryDurationMs,
    pendingToolQueueLength: props.metrics.pendingToolQueueLength,
    compactTriggeredCount: props.metrics.compactTriggeredCount,
    providerRerouteCount: props.metrics.providerRerouteCount,
    autoDowngradeCount: props.metrics.autoDowngradeCount,
    autoSwitchProviderCount: props.metrics.autoSwitchProviderCount,
    lastRoutingReason: props.metrics.lastRoutingReason,
    lastToolRun: props.metrics.lastToolRun,
  },
  trend: props.metrics.trend,
  sessionHistory: props.metrics.sessionHistory,
  errorBreakdown: props.metrics.errorBreakdown,
  gateway: gatewaySnapshot.value,
  gatewayPolicy: aiChatStore.currentWorkspaceConfig?.gatewayPolicy ?? null,
  runtimeSnapshot: props.runtimeSnapshot,
  agentRuntimeContext: props.agentRuntimeContext?.payload.data,
  agentRuntimeGovernance: props.agentRuntimeGovernance,
}, null, 2))

onMounted(() => {
  gatewayTimer = setInterval(() => {
    gatewayTick.value += 1
  }, 1500)
})

onBeforeUnmount(() => {
  if (gatewayTimer) {
    clearInterval(gatewayTimer)
    gatewayTimer = null
  }
})

async function copySnapshot(): Promise<void> {
  let payload = exportPayload.value
  if (props.loadFullTranscript) {
    try {
      const transcript = await props.loadFullTranscript()
      const transcriptEvents = transcript.filter(isTranscriptEvent)
      payload = JSON.stringify({
        ...JSON.parse(exportPayload.value),
        fullTranscript: {
          eventCount: transcript.length,
          events: transcript,
          compactBoundaryProjection: buildCompactBoundaryProjection(transcriptEvents),
        },
      }, null, 2)
    } catch {
      payload = JSON.stringify({
        ...JSON.parse(exportPayload.value),
        fullTranscript: {
          error: 'full_transcript_export_failed',
        },
      }, null, 2)
    }
  }
  await navigator.clipboard.writeText(payload)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 1200)
}

function toneForMs(value: number | null, warn: number, danger: number): Tone {
  if (value === null || Number.isNaN(value)) return 'ok'
  if (value > danger) return 'danger'
  if (value > warn) return 'warn'
  return 'ok'
}

function toneForCount(value: number, warn: number, danger: number): Tone {
  if (value > danger) return 'danger'
  if (value > warn) return 'warn'
  return 'ok'
}

function toneClass(tone: Tone): string {
  if (tone === 'danger') return 'border-rose-500/25 bg-rose-500/10'
  if (tone === 'warn') return 'border-amber-500/25 bg-amber-500/10'
  return 'border-emerald-500/20 bg-emerald-500/8'
}

function toneLabel(tone: Tone): string {
  if (tone === 'danger') return t('ai.diagnostics.critical')
  if (tone === 'warn') return t('ai.diagnostics.watch')
  return t('ai.diagnostics.healthy')
}

function formatRoutingReason(reason: AiChatMetricsSnapshot['lastRoutingReason']): string {
  if (reason === 'provider_circuit_open') return t('ai.diagnostics.routingReasonProviderCircuitOpen')
  if (reason === 'downgrade_model') return t('ai.diagnostics.routingReasonDowngradeModel')
  if (reason === 'switch_provider') return t('ai.diagnostics.routingReasonSwitchProvider')
  return t('ai.diagnostics.none')
}

function formatMs(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(2)} s`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatCost(value: number, currency: string): string {
  if (value <= 0) return `0 ${currency}`
  return `${value.toFixed(value < 0.01 ? 4 : 2)} ${currency}`
}

function formatDateTime(value: number | null): string {
  if (!value) return '--'
  return new Date(value).toLocaleTimeString()
}

function formatDelta(value: number | null): string {
  if (value === null || Number.isNaN(value)) return t('ai.diagnostics.stable')
  if (value === 0) return t('ai.diagnostics.stable')
  const prefix = value > 0 ? '+' : '-'
  return t('ai.diagnostics.deltaVsPrev', {
    delta: `${prefix}${formatMs(Math.abs(value))}`,
  })
}

function isTranscriptEvent(value: unknown): value is AiTranscriptEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<AiTranscriptEvent>
  return typeof event.id === 'string'
    && typeof event.sessionId === 'string'
    && typeof event.type === 'string'
    && typeof event.timestamp === 'number'
    && !!event.payload
}
</script>

<template>
  <div class="my-2 rounded-xl border px-3 py-2" :class="toneClass(overallTone)">
    <button
      class="flex w-full items-center gap-2 text-left"
      @click="expanded = !expanded"
    >
      <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-background/70 text-primary">
        <ShieldAlert class="h-4 w-4" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/75">
            {{ t('ai.diagnostics.title') }}
          </span>
          <span class="rounded-full bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground">
            {{ toneLabel(overallTone) }}
          </span>
          <span class="rounded-full bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground">
            {{ t('ai.diagnostics.compactionsCount', { count: metrics.compactTriggeredCount }) }}
          </span>
        </div>
        <p class="line-clamp-2 text-[11px] text-muted-foreground/75">
          {{ summaryText }}
        </p>
      </div>
      <ChevronRight
        class="h-4 w-4 shrink-0 text-muted-foreground/55 transition-transform"
        :class="expanded ? 'rotate-90' : ''"
      />
    </button>

    <div v-if="expanded" class="mt-3 space-y-3">
      <div class="flex items-center justify-end">
        <button
          class="inline-flex items-center gap-1 rounded-md border border-border/30 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
          @click="copySnapshot"
        >
          <Copy class="h-3.5 w-3.5" />
          {{ copied ? t('common.copied') : t('ai.diagnostics.copySnapshot') }}
        </button>
      </div>

      <div class="grid gap-2 md:grid-cols-5">
        <div
          v-for="card in metricCards"
          :key="card.key"
          class="rounded-lg border px-3 py-2"
          :class="toneClass(card.tone)"
        >
          <div class="mb-2 flex items-center gap-2 text-muted-foreground/70">
            <component :is="card.icon" class="h-3.5 w-3.5" />
            <span class="text-[10px] uppercase tracking-[0.16em]">{{ card.label }}</span>
          </div>
          <div class="text-sm font-semibold text-foreground/85">{{ card.value }}</div>
          <div class="text-[10px] text-muted-foreground/60">{{ card.hint }}</div>
        </div>
      </div>

      <div class="rounded-lg border border-border/25 bg-background/70 px-3 py-3">
        <div class="mb-2 flex items-center gap-2 text-muted-foreground/70">
          <TrendingUp class="h-3.5 w-3.5" />
          <span class="text-[10px] uppercase tracking-[0.16em]">{{ t('ai.diagnostics.trend') }}</span>
        </div>
        <div class="grid gap-2 md:grid-cols-5">
          <div
            v-for="card in trendCards"
            :key="card.key"
            class="rounded-lg border px-3 py-2"
            :class="toneClass(card.tone)"
          >
            <div class="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/65">
              {{ card.label }}
            </div>
            <div class="mt-1 text-sm font-semibold text-foreground/85">{{ card.value }}</div>
            <div class="text-[10px] text-muted-foreground/55">{{ card.hint }}</div>
          </div>
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <div class="rounded-lg border border-border/25 bg-background/70 px-3 py-3">
          <div class="mb-2 flex items-center gap-2 text-muted-foreground/70">
            <History class="h-3.5 w-3.5" />
            <span class="text-[10px] uppercase tracking-[0.16em]">{{ t('ai.diagnostics.sessionHistory') }}</span>
          </div>
          <div class="space-y-2">
            <div
              v-for="item in sessionHistorySummary"
              :key="item.key"
              class="rounded-lg border px-3 py-2"
              :class="toneClass(item.tone)"
            >
              <div class="flex items-center justify-between gap-2 text-[11px]">
                <span class="text-muted-foreground/65">{{ item.label }}</span>
                <span class="font-mono text-foreground/85">{{ item.value }}</span>
              </div>
              <div class="mt-1 text-[10px] text-muted-foreground/55">{{ item.hint }}</div>
            </div>
            <div v-if="sessionHistorySummary.length === 0" class="text-[11px] text-muted-foreground/55">
              {{ t('ai.diagnostics.noSessionHistory') }}
            </div>
          </div>
        </div>

        <div class="rounded-lg border border-border/25 bg-background/70 px-3 py-3">
          <div class="mb-2 flex items-center gap-2 text-muted-foreground/70">
            <ShieldAlert class="h-3.5 w-3.5" />
            <span class="text-[10px] uppercase tracking-[0.16em]">{{ t('ai.diagnostics.errorBreakdown') }}</span>
          </div>
          <div class="space-y-2">
            <div
              v-for="item in metrics.errorBreakdown"
              :key="item.kind"
              class="flex items-center justify-between rounded-lg border border-border/20 bg-background/60 px-3 py-2 text-[11px]"
            >
              <span class="text-muted-foreground/65">{{ item.kind }}</span>
              <span class="font-mono text-foreground/85">{{ item.count }}</span>
            </div>
            <div v-if="metrics.errorBreakdown.length === 0" class="text-[11px] text-muted-foreground/55">
              {{ t('ai.diagnostics.noErrors') }}
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="agentRuntimeContextSummary"
        class="rounded-lg border px-3 py-3"
        :class="toneClass(agentRuntimeGovernance ? agentRuntimeGovernanceTone : agentRuntimeContextTone)"
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 text-muted-foreground/70">
            <Activity class="h-3.5 w-3.5" />
            <span class="text-[10px] uppercase tracking-[0.16em]">P2 Agent Runtime</span>
          </div>
          <span class="rounded-full bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground">
            {{ toneLabel(agentRuntimeGovernance ? agentRuntimeGovernanceTone : agentRuntimeContextTone) }}
          </span>
        </div>
        <div class="grid gap-x-4 gap-y-2 md:grid-cols-6">
          <div
            v-for="item in agentRuntimeContextSummary"
            :key="item.label"
            class="flex items-center justify-between gap-2 text-[11px]"
          >
            <span class="text-muted-foreground/65">{{ item.label }}</span>
            <span class="font-mono text-foreground/85">{{ item.value }}</span>
          </div>
        </div>
        <div class="mt-2 text-[11px] text-muted-foreground/65">
          {{ agentRuntimeContextData?.lspSummary }}
        </div>
        <div v-if="agentRuntimeGovernance" class="mt-2 grid gap-x-4 gap-y-2 md:grid-cols-6">
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-muted-foreground/65">治理上下文</span>
            <span class="font-mono text-foreground/85">{{ agentRuntimeGovernance.contextCount }}</span>
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-muted-foreground/65">最高阻塞</span>
            <span class="font-mono text-foreground/85">{{ agentRuntimeGovernance.maxBlockedCount }}</span>
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-muted-foreground/65">隔离阻塞</span>
            <span class="font-mono text-foreground/85">{{ agentRuntimeGovernance.maxIsolationBlockedCount }}</span>
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-muted-foreground/65">合并审核</span>
            <span class="font-mono text-foreground/85">{{ agentRuntimeGovernance.maxIsolationMergeRequiredCount }}</span>
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-muted-foreground/65">Worktree</span>
            <span class="font-mono text-foreground/85">{{ agentRuntimeGovernance.maxIsolationWorktreeCount ?? 0 }}</span>
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-muted-foreground/65">临时空间</span>
            <span class="font-mono text-foreground/85">{{ agentRuntimeGovernance.maxIsolationTemporaryWorkspaceCount ?? 0 }}</span>
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-muted-foreground/65">需审核</span>
            <span class="font-mono text-foreground/85">{{ agentRuntimeGovernance.maxIsolationReviewRequiredCount ?? 0 }}</span>
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-muted-foreground/65">需确认动作</span>
            <span class="font-mono text-foreground/85">{{ agentRuntimeGovernance.maxIsolationConfirmationRequiredCount ?? 0 }}</span>
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-muted-foreground/65">最高 LSP</span>
            <span class="font-mono text-foreground/85">{{ agentRuntimeGovernance.maxLspDiagnosticCount }}</span>
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-muted-foreground/65">高风险次数</span>
            <span class="font-mono text-foreground/85">{{ agentRuntimeGovernance.highRiskCount }}</span>
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-muted-foreground/65">门禁阻塞</span>
            <span class="font-mono text-foreground/85">{{ agentRuntimeGovernance.verificationBlockedCount ?? 0 }}</span>
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-muted-foreground/65">门禁警告</span>
            <span class="font-mono text-foreground/85">{{ agentRuntimeGovernance.verificationWarningCount ?? 0 }}</span>
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-muted-foreground/65">最多缺验证</span>
            <span class="font-mono text-foreground/85">{{ agentRuntimeGovernance.maxVerificationMissingCommandCount ?? 0 }}</span>
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-muted-foreground/65">最多失败验证</span>
            <span class="font-mono text-foreground/85">{{ agentRuntimeGovernance.maxVerificationFailedCommandCount ?? 0 }}</span>
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-muted-foreground/65">治理警告</span>
            <span class="font-mono text-foreground/85">{{ agentRuntimeGovernance.warningCount }}</span>
          </div>
        </div>
        <div v-if="agentRuntimeGovernance?.recommendations.length" class="mt-2 space-y-1">
          <div
            v-for="recommendation in agentRuntimeGovernance.recommendations"
            :key="recommendation"
            class="rounded border border-sky-500/20 bg-sky-500/8 px-2 py-1 text-[10px] text-sky-200/85"
          >
            {{ recommendation }}
          </div>
        </div>
        <div v-if="agentRuntimeContextData && agentRuntimeContextData.warnings.length > 0" class="mt-2 space-y-1">
          <div
            v-for="warning in agentRuntimeContextData.warnings"
            :key="warning"
            class="rounded border border-amber-500/20 bg-amber-500/8 px-2 py-1 text-[10px] text-amber-300/85"
          >
            {{ warning }}
          </div>
        </div>
      </div>

      <div class="rounded-lg border px-3 py-3" :class="toneClass(gatewayHealthTone)">
        <div class="mb-2 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 text-muted-foreground/70">
            <Route class="h-3.5 w-3.5" />
            <span class="text-[10px] uppercase tracking-[0.16em]">{{ t('ai.diagnostics.gatewayDashboard') }}</span>
          </div>
          <span class="rounded-full bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground">
            {{ toneLabel(gatewayHealthTone) }}
          </span>
        </div>

        <div class="grid gap-x-4 gap-y-2 md:grid-cols-6">
          <div
            v-for="item in gatewaySummary"
            :key="item.label"
            class="flex items-center justify-between gap-2 text-[11px]"
          >
            <span class="text-muted-foreground/65">{{ item.label }}</span>
            <span class="font-mono text-foreground/85">{{ item.value }}</span>
          </div>
        </div>

        <div class="mt-3 grid gap-3 md:grid-cols-2">
          <div class="rounded-lg border border-border/20 bg-background/60 px-3 py-2">
            <div class="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/65">
              {{ t('ai.diagnostics.gatewayActualRoute') }}
            </div>
            <div v-if="gatewaySnapshot.currentRoute" class="space-y-1 text-[11px]">
              <div class="flex items-center justify-between gap-2">
                <span class="text-muted-foreground/65">{{ t('ai.diagnostics.provider') }}</span>
                <span class="font-mono text-foreground/85">{{ gatewaySnapshot.currentRoute.providerName }}</span>
              </div>
              <div class="flex items-center justify-between gap-2">
                <span class="text-muted-foreground/65">{{ t('ai.diagnostics.model') }}</span>
                <span class="font-mono text-foreground/85">{{ gatewaySnapshot.currentRoute.model }}</span>
              </div>
              <div class="flex items-center justify-between gap-2">
                <span class="text-muted-foreground/65">{{ t('ai.diagnostics.source') }}</span>
                <span class="font-mono text-foreground/85">{{ gatewaySnapshot.currentRoute.source }}</span>
              </div>
              <div class="flex items-center justify-between gap-2">
                <span class="text-muted-foreground/65">{{ t('ai.diagnostics.status') }}</span>
                <span class="font-mono text-foreground/85">{{ gatewaySnapshot.currentRoute.status }}</span>
              </div>
              <div class="flex items-center justify-between gap-2">
                <span class="text-muted-foreground/65">耗时</span>
                <span class="font-mono text-foreground/85">{{ formatMs(gatewaySnapshot.currentRoute.durationMs) }}</span>
              </div>
              <div class="flex items-center justify-between gap-2">
                <span class="text-muted-foreground/65">首 token</span>
                <span class="font-mono text-foreground/85">{{ formatMs(gatewaySnapshot.currentRoute.firstTokenLatencyMs) }}</span>
              </div>
              <div v-if="gatewaySnapshot.currentRoute.fallback" class="rounded border border-amber-500/20 bg-amber-500/8 px-2 py-1 text-[10px] text-amber-300/85">
                当前请求由 fallback 路由承接
              </div>
              <div v-if="gatewaySnapshot.currentRoute.errorType" class="rounded border border-rose-500/20 bg-rose-500/8 px-2 py-1 text-[10px] text-rose-300/85">
                {{ gatewaySnapshot.currentRoute.errorType }} · {{ gatewaySnapshot.currentRoute.errorMessage }}
              </div>
            </div>
            <div v-else class="text-[11px] text-muted-foreground/55">
              {{ t('ai.diagnostics.gatewayNoRoute') }}
            </div>
          </div>

          <div class="rounded-lg border border-border/20 bg-background/60 px-3 py-2">
            <div class="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/65">
              {{ t('ai.diagnostics.gatewayProviderSummary') }}
            </div>
            <div class="space-y-2">
              <div
                v-for="item in gatewaySnapshot.providerSummaries.slice(0, 4)"
                :key="item.providerId"
                class="flex items-center justify-between gap-2 text-[11px]"
              >
                <span class="truncate text-muted-foreground/65">{{ item.providerName }}</span>
                <span class="font-mono text-foreground/85">
                  {{ item.requestCount }} / {{ formatCost(item.totalCost, item.currency) }}
                </span>
              </div>
              <div v-if="gatewaySnapshot.providerSummaries.length === 0" class="text-[11px] text-muted-foreground/55">
                {{ t('ai.diagnostics.gatewayNoProviderSummary') }}
              </div>
            </div>
          </div>
        </div>

        <div class="mt-3 grid gap-3 md:grid-cols-2">
          <div class="rounded-lg border border-border/20 bg-background/60 px-3 py-2">
            <div class="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/65">
              {{ t('ai.diagnostics.gatewayFallbacks') }}
            </div>
            <div class="space-y-2">
              <div
                v-for="item in gatewaySnapshot.recentFallbacks"
                :key="`${item.requestId}-${item.retryIndex}`"
                class="rounded-md border border-border/20 bg-background/60 px-2 py-1.5 text-[11px]"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-muted-foreground/65">
                    {{ item.primaryProviderId }} / {{ item.primaryModel }}
                  </span>
                  <span class="font-mono text-foreground/85">{{ item.providerName }} / {{ item.model }}</span>
                </div>
                <div class="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground/55">
                  <span>{{ item.reason }} · {{ item.status }} · {{ formatMs(item.durationMs) }}</span>
                  <span>{{ item.errorType ?? formatDateTime(item.finishedAt) }}</span>
                </div>
                <div v-if="item.errorMessage" class="mt-1 truncate text-[10px] text-rose-300/75">
                  {{ item.errorMessage }}
                </div>
              </div>
              <div v-if="gatewaySnapshot.recentFallbacks.length === 0" class="text-[11px] text-muted-foreground/55">
                {{ t('ai.diagnostics.gatewayNoFallbacks') }}
              </div>
            </div>
          </div>

          <div class="rounded-lg border border-border/20 bg-background/60 px-3 py-2">
            <div class="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/65">
              {{ t('ai.diagnostics.gatewayRateLimitAndCircuit') }}
            </div>
            <div class="space-y-2">
              <div
                v-for="item in gatewaySnapshot.rateLimits"
                :key="`rate-${item.providerId}`"
                class="flex items-center justify-between gap-2 text-[11px]"
              >
                <span class="truncate text-muted-foreground/65">{{ item.providerName }}</span>
                <span class="font-mono text-foreground/85">
                  {{ item.currentCount }}/{{ item.maxRequests }} · {{ t('ai.diagnostics.gatewayThrottled') }} {{ item.throttledCount }}
                </span>
              </div>
              <div
                v-for="item in gatewaySnapshot.circuitBreakers"
                :key="`circuit-${item.providerId}`"
                class="flex items-center justify-between gap-2 text-[11px]"
              >
                <span class="truncate text-muted-foreground/65">{{ item.providerName }}</span>
                <span class="font-mono" :class="item.open ? 'text-rose-400' : 'text-foreground/85'">
                  {{ item.open ? t('ai.diagnostics.gatewayCircuitOpen') : t('ai.diagnostics.gatewayCircuitClosed') }}
                  · {{ item.failureCount }}
                </span>
              </div>
              <div
                v-if="gatewaySnapshot.rateLimits.length === 0 && gatewaySnapshot.circuitBreakers.length === 0"
                class="text-[11px] text-muted-foreground/55"
              >
                {{ t('ai.diagnostics.gatewayNoRateLimit') }}
              </div>
            </div>
          </div>
        </div>

        <div class="mt-3 rounded-lg border border-border/20 bg-background/60 px-3 py-2">
          <div class="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/65">
            Gateway Profile 策略
          </div>
          <div class="grid gap-x-4 gap-y-2 md:grid-cols-4">
            <div
              v-for="item in gatewayPolicySummary"
              :key="item.label"
              class="flex items-center justify-between gap-2 text-[11px]"
            >
              <span class="text-muted-foreground/65">{{ item.label }}</span>
              <span class="max-w-[180px] truncate font-mono text-foreground/85">{{ item.value }}</span>
            </div>
          </div>
        </div>

        <div
          v-if="gatewaySnapshot.securityBlocks.length > 0"
          class="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2"
        >
          <div class="mb-2 text-[10px] uppercase tracking-[0.16em] text-rose-300/85">
            {{ t('ai.diagnostics.gatewaySecurityBlocks') }}
          </div>
          <div class="space-y-2">
            <div
              v-for="item in gatewaySnapshot.securityBlocks"
              :key="item.requestId"
              class="flex items-center justify-between gap-2 text-[11px]"
            >
              <span class="truncate text-muted-foreground/70">{{ item.providerName }} / {{ item.model }}</span>
              <span class="font-mono text-rose-200">{{ item.reason }}</span>
            </div>
          </div>
        </div>
      </div>

      <div
        class="rounded-lg border px-3 py-3"
        :class="toneClass(
          metrics.lastToolRun.timeoutCount > 0 || metrics.lastToolRun.errorCount > 0 ? 'danger' : 'ok',
        )"
      >
        <div class="mb-2 flex items-center gap-2 text-muted-foreground/70">
          <Wrench class="h-3.5 w-3.5" />
          <span class="text-[10px] uppercase tracking-[0.16em]">{{ t('ai.diagnostics.lastToolRun') }}</span>
        </div>
        <div class="grid gap-x-4 gap-y-2 md:grid-cols-4">
          <div
            v-for="item in toolSummary"
            :key="item.label"
            class="flex items-center justify-between gap-2 text-[11px]"
          >
            <span class="text-muted-foreground/65">{{ item.label }}</span>
            <span class="font-mono text-foreground/85">{{ item.value }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
