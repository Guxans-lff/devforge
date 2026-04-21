<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiChatMetricsSnapshot } from '@/composables/ai/useAiChatObservability'
import { useSettingsStore } from '@/stores/settings'
import { Activity, ChevronRight, Clock3, Copy, History, ShieldAlert, TrendingUp, Wrench } from 'lucide-vue-next'

type Tone = 'ok' | 'warn' | 'danger'

const props = defineProps<{
  metrics: AiChatMetricsSnapshot
}>()

const { t } = useI18n()
const settingsStore = useSettingsStore()
const expanded = ref(false)
const copied = ref(false)
const thresholds = computed(() => settingsStore.settings.aiDiagnosticsThresholds)

const metricCards = computed(() => [
  {
    key: 'first-token',
    label: t('ai.diagnostics.firstToken'),
    value: formatMs(props.metrics.firstTokenLatencyMs),
    hint: props.metrics.firstTokenAt ? t('ai.diagnostics.streamStarted') : t('ai.diagnostics.waiting'),
    icon: Clock3,
    tone: toneForMs(props.metrics.firstTokenLatencyMs, thresholds.value.firstTokenWarnMs, thresholds.value.firstTokenDangerMs),
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
  { label: t('ai.diagnostics.calls'), value: props.metrics.lastToolRun.totalCalls },
  { label: t('ai.diagnostics.success'), value: props.metrics.lastToolRun.successCount },
  { label: t('ai.diagnostics.errors'), value: props.metrics.lastToolRun.errorCount },
  { label: t('ai.diagnostics.timeouts'), value: props.metrics.lastToolRun.timeoutCount },
  { label: t('ai.diagnostics.cancelled'), value: props.metrics.lastToolRun.cancelledCount },
  { label: t('ai.diagnostics.retries'), value: props.metrics.lastToolRun.retryCount },
  { label: t('ai.diagnostics.avg'), value: formatMs(props.metrics.lastToolRun.averageDurationMs) },
  { label: t('ai.diagnostics.max'), value: formatMs(props.metrics.lastToolRun.maxDurationMs) },
])

const sessionHistorySummary = computed(() =>
  props.metrics.sessionHistory
    .slice()
    .reverse()
    .slice(0, 4)
    .map((session, index) => ({
      key: `${session.startedAt ?? index}`,
      label: t('ai.diagnostics.recentSessionN', { index: index + 1 }),
      value: `${formatMs(session.responseDurationMs)} / ${session.toolCallCount} ${t('ai.diagnostics.calls')}`,
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
  `${t('ai.diagnostics.firstToken')} ${formatMs(props.metrics.firstTokenLatencyMs)} / ${t('ai.diagnostics.avg')} ${formatMs(props.metrics.trend.firstTokenAverageMs)}`,
  `${t('ai.diagnostics.response')} ${formatMs(props.metrics.responseDurationMs)} / ${t('ai.diagnostics.avg')} ${formatMs(props.metrics.trend.responseAverageMs)}`,
  `${t('ai.diagnostics.tools')} ${props.metrics.lastToolRun.totalCalls}`,
].join(' | '))

const exportPayload = computed(() => JSON.stringify({
  exportedAt: Date.now(),
  current: {
    firstTokenLatencyMs: props.metrics.firstTokenLatencyMs,
    responseDurationMs: props.metrics.responseDurationMs,
    loadHistoryDurationMs: props.metrics.loadHistoryDurationMs,
    pendingToolQueueLength: props.metrics.pendingToolQueueLength,
    compactTriggeredCount: props.metrics.compactTriggeredCount,
    lastToolRun: props.metrics.lastToolRun,
  },
  trend: props.metrics.trend,
  sessionHistory: props.metrics.sessionHistory,
  errorBreakdown: props.metrics.errorBreakdown,
}, null, 2))

async function copySnapshot(): Promise<void> {
  await navigator.clipboard.writeText(exportPayload.value)
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

function formatMs(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(2)} s`
}

function formatDelta(value: number | null): string {
  if (value === null || Number.isNaN(value)) return t('ai.diagnostics.stable')
  if (value === 0) return t('ai.diagnostics.stable')
  const prefix = value > 0 ? '+' : '-'
  return t('ai.diagnostics.deltaVsPrev', {
    delta: `${prefix}${formatMs(Math.abs(value))}`,
  })
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

      <div class="grid gap-2 md:grid-cols-4">
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
        <div class="grid gap-2 md:grid-cols-4">
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
