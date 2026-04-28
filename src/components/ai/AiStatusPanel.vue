<script setup lang="ts">
import { computed } from 'vue'
import { Activity, AlertTriangle, Bot, CheckCircle2, Clock3, Loader2, Timer, TrendingUp, Wrench } from 'lucide-vue-next'
import type { AiTurnState } from '@/composables/ai/AiTurnRuntime'
import type { SpawnedTask } from '@/composables/ai/chatSideEffects'
import type { AiChatMetricsSnapshot } from '@/composables/ai/useAiChatObservability'

const props = defineProps<{
  turnState: AiTurnState
  metrics?: AiChatMetricsSnapshot | null
  isStreaming?: boolean
  isCompacting?: boolean
  queuedMessages?: number
  tasks?: SpawnedTask[]
}>()

const phaseLabelMap: Record<AiTurnState['phase'], string> = {
  idle: '空闲',
  preparing: '准备上下文',
  streaming: '生成回复',
  tool_executing: '执行工具',
  compacting: '压缩上下文',
  recovering: '恢复中',
  completed: '已完成',
  failed: '失败',
  aborted: '已取消',
}

const phaseLabel = computed(() => phaseLabelMap[props.turnState.phase] ?? props.turnState.phase)
const runningTasks = computed(() => (props.tasks ?? []).filter(task => task.status === 'running').length)
const waitingTasks = computed(() => (props.tasks ?? []).filter(task => task.dispatchStatus === 'ready' || task.dispatchStatus === 'blocked').length)
const doneTasks = computed(() => (props.tasks ?? []).filter(task => task.status === 'done').length)
const errorTasks = computed(() => (props.tasks ?? []).filter(task => task.status === 'error').length)
const runningToolIds = computed(() => props.turnState.executingToolIds ?? [])
const pendingToolCount = computed(() => props.turnState.pendingToolCalls?.length ?? 0)
const activeToolCount = computed(() => Math.max(runningToolIds.value.length, pendingToolCount.value, props.metrics?.pendingToolQueueLength ?? 0))
const elapsedMs = computed(() => {
  if (!props.turnState.startedAt) return null
  const end = props.turnState.finishedAt ?? Date.now()
  return Math.max(0, end - props.turnState.startedAt)
})

const showPanel = computed(() =>
  props.turnState.phase !== 'idle'
  || Boolean(props.isStreaming)
  || Boolean(props.isCompacting)
  || activeToolCount.value > 0
  || runningTasks.value > 0
  || waitingTasks.value > 0
  || errorTasks.value > 0
  || (props.queuedMessages ?? 0) > 0,
)

const statusTone = computed(() => {
  if (props.turnState.phase === 'failed') return 'border-destructive/25 bg-destructive/5 text-destructive'
  if (props.turnState.phase === 'completed') return 'border-emerald-500/20 bg-emerald-500/5 text-emerald-500'
  if (props.turnState.phase === 'aborted') return 'border-muted-foreground/20 bg-muted/15 text-muted-foreground'
  if (props.turnState.phase === 'recovering') return 'border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400'
  return 'border-primary/20 bg-primary/5 text-primary'
})

const statusIcon = computed(() => {
  if (props.turnState.phase === 'completed') return CheckCircle2
  if (props.turnState.phase === 'failed' || props.turnState.phase === 'recovering') return AlertTriangle
  if (props.isStreaming || props.isCompacting || props.turnState.phase === 'tool_executing') return Loader2
  return Activity
})

const showSpinner = computed(() => statusIcon.value === Loader2)

const metricItems = computed(() => {
  const metrics = props.metrics
  if (!metrics) return []
  return [
    metrics.prepareDurationMs !== null ? `准备 ${formatDuration(metrics.prepareDurationMs)}` : null,
    metrics.requestFirstTokenLatencyMs !== null ? `首 token ${formatDuration(metrics.requestFirstTokenLatencyMs)}` : null,
    metrics.responseDurationMs !== null ? `响应 ${formatDuration(metrics.responseDurationMs)}` : null,
    metrics.recoveryCount > 0 ? `恢复 ${metrics.recoveryCount} 次` : null,
    metrics.lastToolRun.totalCalls > 0 ? `上轮工具 ${metrics.lastToolRun.successCount}/${metrics.lastToolRun.totalCalls}` : null,
  ].filter(Boolean) as string[]
})

const timelineItems = computed(() => {
  const metrics = props.metrics
  if (!metrics) return []
  const items: string[] = []
  if (metrics.trend.sampleCount > 0) {
    if (metrics.trend.firstTokenAverageMs !== null) items.push(`平均首 token ${formatDuration(metrics.trend.firstTokenAverageMs)}`)
    if (metrics.trend.responseAverageMs !== null) items.push(`平均响应 ${formatDuration(metrics.trend.responseAverageMs)}`)
    if (metrics.trend.toolRunAverageMs !== null) items.push(`平均工具 ${formatDuration(metrics.trend.toolRunAverageMs)}`)
  }
  if (metrics.errorBreakdown && metrics.errorBreakdown.length > 0) {
    const recent = metrics.errorBreakdown.slice(0, 2).map(item => `${item.kind}×${item.count}`).join(' / ')
    items.push(`最近失败 ${recent}`)
  }
  return items
})

const toolPreview = computed(() => runningToolIds.value.slice(0, 3).join(', '))

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`
}
</script>

<template>
  <section
    v-if="showPanel"
    class="my-1.5 rounded-2xl border px-3 py-2.5 shadow-sm backdrop-blur"
    :class="statusTone"
    data-testid="ai-status-panel"
  >
    <div class="flex flex-wrap items-center gap-2 text-[11px]">
      <div class="flex min-w-0 items-center gap-2 font-medium">
        <component :is="statusIcon" class="h-3.5 w-3.5" :class="showSpinner ? 'animate-spin' : ''" />
        <span>{{ phaseLabel }}</span>
      </div>

      <div v-if="elapsedMs !== null" class="flex items-center gap-1 text-current/72">
        <Timer class="h-3.5 w-3.5" />
        <span>{{ formatDuration(elapsedMs) }}</span>
      </div>

      <div class="h-3 w-px bg-current/18" />

      <div class="flex items-center gap-1 text-current/75">
        <Wrench class="h-3.5 w-3.5" />
        <span>工具 {{ activeToolCount }}</span>
        <span v-if="toolPreview" class="max-w-[180px] truncate font-mono text-[10px] text-current/58" :title="runningToolIds.join(', ')">
          {{ toolPreview }}{{ runningToolIds.length > 3 ? '...' : '' }}
        </span>
      </div>

      <div class="flex items-center gap-1 text-current/75">
        <Bot class="h-3.5 w-3.5" />
        <span>任务 {{ runningTasks }} 运行 / {{ waitingTasks }} 等待 / {{ doneTasks }} 完成</span>
        <span v-if="errorTasks" class="text-destructive">/ {{ errorTasks }} 失败</span>
      </div>

      <div v-if="queuedMessages" class="ml-auto flex items-center gap-1 text-current/72">
        <Clock3 class="h-3.5 w-3.5" />
        <span>队列 {{ queuedMessages }}</span>
      </div>
    </div>

    <div v-if="metricItems.length" class="mt-2 flex flex-wrap gap-1.5 text-[10px] text-current/65">
      <span v-for="item in metricItems" :key="item" class="rounded bg-background/45 px-1.5 py-0.5">
        {{ item }}
      </span>
    </div>

    <div v-if="timelineItems.length" class="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-current/62">
      <TrendingUp class="h-3 w-3" />
      <span v-for="item in timelineItems" :key="item" class="rounded border border-current/10 bg-background/25 px-1.5 py-0.5">
        {{ item }}
      </span>
    </div>

    <p v-if="turnState.error" class="mt-1.5 line-clamp-2 text-[11px] text-current/72">
      {{ turnState.error }}
    </p>
  </section>
</template>
