<script setup lang="ts">
/**
 * Plan 面板 — 显示当前会话的结构化 Plan
 *
 * 侧栏/抽屉形式，展示 Plan 标题、描述、步骤列表及状态。
 */
import { computed, ref, watch } from 'vue'
import type { AiPlan, AiPlanChange, AiPlanStep, PlanStatus } from '@/types/plan'
import { getActivePlan, getSessionPlans } from '@/composables/ai-agent/planning/planStore'
import {
  ClipboardList,
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  SkipForward,
  ChevronRight,
  RotateCcw,
  Ban,
  History,
} from 'lucide-vue-next'

const props = defineProps<{
  sessionId: string
}>()

const emit = defineEmits<{
  (e: 'approve'): void
  (e: 'reject'): void
  (e: 'replan'): void
}>()

const activePlan = computed<AiPlan | undefined>(() => getActivePlan(props.sessionId))

const sessionPlans = computed(() => getSessionPlans(props.sessionId))

type ChangeHistoryFilter = 'all' | 'status' | 'step' | 'job' | 'other'

const historyPreviewLimit = 20
const historyFilter = ref<ChangeHistoryFilter>('all')

watch(() => activePlan.value?.id, () => {
  historyFilter.value = 'all'
})

const statusConfig: Record<PlanStatus, { label: string; color: string; bg: string }> = {
  draft: { label: '待确认', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  approved: { label: '已批准', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  in_progress: { label: '执行中', color: 'text-sky-400', bg: 'bg-sky-500/10' },
  completed: { label: '已完成', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  abandoned: { label: '已放弃', color: 'text-slate-400', bg: 'bg-slate-500/10' },
}

const changeTypeConfig: Record<AiPlanChange['type'], { label: string; color: string }> = {
  created: { label: '创建', color: 'text-violet-300' },
  updated: { label: '更新', color: 'text-sky-300' },
  approved: { label: '批准', color: 'text-emerald-300' },
  started: { label: '开始', color: 'text-sky-300' },
  completed: { label: '完成', color: 'text-emerald-300' },
  abandoned: { label: '放弃', color: 'text-slate-300' },
  step_status_changed: { label: '步骤', color: 'text-amber-300' },
  active_changed: { label: '切换', color: 'text-violet-300' },
  job_attached: { label: '任务', color: 'text-cyan-300' },
  job_updated: { label: '任务', color: 'text-cyan-300' },
}

const currentStatusConfig = computed(() => {
  const status = activePlan.value?.status
  return status ? statusConfig[status] : statusConfig.draft
})

function getStatusConfig(status: PlanStatus) {
  return statusConfig[status] ?? statusConfig.draft
}

function stepIcon(step: AiPlanStep) {
  switch (step.status) {
    case 'completed': return CheckCircle2
    case 'failed': return AlertTriangle
    case 'in_progress': return Loader2
    case 'skipped': return SkipForward
    default: return Circle
  }
}

function stepColor(step: AiPlanStep): string {
  switch (step.status) {
    case 'completed': return 'text-emerald-400'
    case 'failed': return 'text-rose-400'
    case 'in_progress': return 'text-sky-400'
    case 'skipped': return 'text-slate-400'
    default: return 'text-muted-foreground/40'
  }
}

const progressPercent = computed(() => {
  const plan = activePlan.value
  if (!plan || plan.steps.length === 0) return 0
  const done = plan.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length
  return Math.round((done / plan.steps.length) * 100)
})

const recentChanges = computed(() => {
  return allPlanChanges.value.slice(0, 5)
})

const allPlanChanges = computed(() => {
  const changes = activePlan.value?.changes ?? []
  return [...changes].reverse()
})

const filteredHistoryTotal = computed(() => {
  return allPlanChanges.value.filter(change => matchesHistoryFilter(change, historyFilter.value))
})

const filteredHistoryChanges = computed(() => {
  return filteredHistoryTotal.value.slice(0, historyPreviewLimit)
})

const historyFilterOptions = computed<Array<{ value: ChangeHistoryFilter; label: string; count: number }>>(() => {
  const changes = allPlanChanges.value
  return [
    { value: 'all', label: '全部', count: changes.length },
    { value: 'status', label: '状态', count: changes.filter(change => getChangeFilter(change.type) === 'status').length },
    { value: 'step', label: '步骤', count: changes.filter(change => getChangeFilter(change.type) === 'step').length },
    { value: 'job', label: '任务', count: changes.filter(change => getChangeFilter(change.type) === 'job').length },
    { value: 'other', label: '其他', count: changes.filter(change => getChangeFilter(change.type) === 'other').length },
  ]
})

function formatChangeTime(createdAt: number): string {
  const date = new Date(createdAt)
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${hour}:${minute}:${second}`
}

function getChangeTypeConfig(type: AiPlanChange['type']) {
  return changeTypeConfig[type] ?? changeTypeConfig.updated
}

function getChangeFilter(type: AiPlanChange['type']): Exclude<ChangeHistoryFilter, 'all'> {
  switch (type) {
    case 'approved':
    case 'started':
    case 'completed':
    case 'abandoned':
    case 'active_changed':
      return 'status'
    case 'step_status_changed':
      return 'step'
    case 'job_attached':
    case 'job_updated':
      return 'job'
    default:
      return 'other'
  }
}

function matchesHistoryFilter(change: AiPlanChange, filter: ChangeHistoryFilter): boolean {
  return filter === 'all' || getChangeFilter(change.type) === filter
}

function jobStatusClass(status: string): string {
  switch (status) {
    case 'succeeded': return 'text-emerald-400 bg-emerald-500/10'
    case 'failed': return 'text-rose-400 bg-rose-500/10'
    case 'cancelled': return 'text-slate-400 bg-slate-500/10'
    case 'running': return 'text-sky-400 bg-sky-500/10'
    default: return 'text-amber-400 bg-amber-500/10'
  }
}

function jobRefLabel(jobRef: NonNullable<AiPlanStep['jobRefs']>[number]): string {
  return `${jobRef.title || jobRef.kind}:${jobRef.status}`
}
</script>

<template>
  <div v-if="activePlan" class="rounded-lg border border-border/60 bg-card/50 overflow-hidden">
    <!-- 头部 -->
    <div class="flex items-center gap-2 px-3 py-2.5 border-b border-border/40">
      <ClipboardList class="h-3.5 w-3.5 text-violet-400 shrink-0" />
      <span class="text-[12px] font-medium text-foreground/90 truncate flex-1">
        {{ activePlan.title }}
      </span>
      <span
        class="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
        :class="[currentStatusConfig.color, currentStatusConfig.bg]"
      >
        {{ currentStatusConfig.label }}
      </span>
    </div>

    <!-- 描述 -->
    <div v-if="activePlan.description" class="px-3 py-2 text-[11px] text-muted-foreground/70 leading-relaxed border-b border-border/30">
      {{ activePlan.description }}
    </div>

    <!-- 进度条 -->
    <div class="px-3 py-2 border-b border-border/30">
      <div class="flex items-center justify-between mb-1">
        <span class="text-[10px] text-muted-foreground/60">执行进度</span>
        <span class="text-[10px] font-mono text-muted-foreground/80">{{ progressPercent }}%</span>
      </div>
      <div class="h-1 rounded-full bg-muted/60 overflow-hidden">
        <div
          class="h-full rounded-full bg-violet-500/60 transition-all duration-500"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
    </div>

    <!-- 最近变更 -->
    <div v-if="recentChanges.length > 0" data-testid="recent-changes" class="px-3 py-2 border-b border-border/30">
      <div class="flex items-center justify-between mb-1.5">
        <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
          <History class="h-3 w-3" />
          最近变更
        </div>
        <span class="text-[10px] text-muted-foreground/45">最近 {{ recentChanges.length }} 条</span>
      </div>
      <div class="space-y-1">
        <div
          v-for="change in recentChanges"
          :key="change.id"
          class="rounded-md bg-muted/20 px-2 py-1.5"
        >
          <div class="flex items-center gap-1.5 min-w-0">
            <span
              class="shrink-0 text-[9px] font-medium"
              :class="getChangeTypeConfig(change.type).color"
            >
              {{ getChangeTypeConfig(change.type).label }}
            </span>
            <span class="flex-1 min-w-0 truncate text-[10px] text-foreground/75">
              {{ change.summary }}
            </span>
            <span class="shrink-0 text-[9px] font-mono text-muted-foreground/45">
              {{ formatChangeTime(change.createdAt) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 完整变更历史 -->
    <div v-if="allPlanChanges.length > 5" class="border-b border-border/30">
      <details class="group">
        <summary class="flex items-center gap-1.5 px-3 py-2 cursor-pointer text-[10px] text-muted-foreground/60 hover:text-muted-foreground/80 select-none">
          <ChevronRight class="h-3 w-3 transition-transform group-open:rotate-90" />
          完整历史 ({{ allPlanChanges.length }})
        </summary>
        <div class="px-3 pb-2 space-y-2" data-testid="full-change-history">
          <div class="flex flex-wrap gap-1">
            <button
              v-for="option in historyFilterOptions"
              :key="option.value"
              type="button"
              :data-history-filter="option.value"
              class="rounded border px-1.5 py-0.5 text-[10px] transition-colors"
              :class="historyFilter === option.value
                ? 'border-violet-400/50 bg-violet-500/15 text-violet-200'
                : 'border-border/50 bg-muted/20 text-muted-foreground/60 hover:text-muted-foreground/85'"
              @click="historyFilter = option.value"
            >
              {{ option.label }} {{ option.count }}
            </button>
          </div>
          <div v-if="filteredHistoryChanges.length > 0" class="max-h-52 space-y-1 overflow-y-auto pr-1">
            <div
              v-for="change in filteredHistoryChanges"
              :key="change.id"
              class="rounded-md bg-muted/20 px-2 py-1.5"
              :data-change-type="change.type"
            >
              <div class="flex items-center gap-1.5 min-w-0">
                <span
                  class="shrink-0 text-[9px] font-medium"
                  :class="getChangeTypeConfig(change.type).color"
                >
                  {{ getChangeTypeConfig(change.type).label }}
                </span>
                <span class="flex-1 min-w-0 truncate text-[10px] text-foreground/75">
                  {{ change.summary }}
                </span>
                <span class="shrink-0 text-[9px] font-mono text-muted-foreground/45">
                  {{ formatChangeTime(change.createdAt) }}
                </span>
              </div>
            </div>
          </div>
          <div v-else class="rounded-md bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground/55">
            当前筛选无历史记录
          </div>
          <div
            v-if="filteredHistoryTotal.length > filteredHistoryChanges.length"
            class="text-[10px] text-muted-foreground/45"
          >
            已显示最近 {{ filteredHistoryChanges.length }} 条，共 {{ filteredHistoryTotal.length }} 条
          </div>
        </div>
      </details>
    </div>

    <!-- 步骤列表 -->
    <div class="px-1 py-1">
      <div
        v-for="step in activePlan.steps"
        :key="step.id"
        class="flex items-start gap-2 px-2 py-1.5 rounded-md"
        :class="step.status === 'in_progress' ? 'bg-violet-500/5' : ''"
      >
        <component
          :is="stepIcon(step)"
          class="h-3.5 w-3.5 shrink-0 mt-0.5"
          :class="[stepColor(step), { 'animate-spin': step.status === 'in_progress' }]"
        />
        <div class="flex-1 min-w-0">
          <div class="text-[11px] text-foreground/85 leading-snug">
            {{ step.title }}
          </div>
          <div v-if="step.description" class="text-[10px] text-muted-foreground/55 mt-0.5 leading-snug">
            {{ step.description }}
          </div>
          <div v-if="step.error" class="text-[10px] text-rose-400/80 mt-0.5">
            {{ step.error }}
          </div>
          <div v-if="step.jobRefs?.length" class="mt-1 flex flex-wrap gap-1">
            <span
              v-for="jobRef in step.jobRefs"
              :key="jobRef.jobId"
              class="rounded px-1.5 py-0.5 text-[9px] font-mono"
              :class="jobStatusClass(jobRef.status)"
              :title="jobRef.resultSummary || jobRef.error || jobRef.title || jobRef.jobId"
            >
              {{ jobRefLabel(jobRef) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div v-if="activePlan.status === 'draft'" class="flex items-center gap-1.5 px-3 py-2 border-t border-border/30">
      <button
        class="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors border border-emerald-500/20"
        @click="emit('approve')"
      >
        <CheckCircle2 class="h-3 w-3" />
        确认执行
      </button>
      <button
        class="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors border border-rose-500/20"
        @click="emit('reject')"
      >
        <Ban class="h-3 w-3" />
        放弃
      </button>
    </div>

    <div v-else-if="activePlan.status === 'in_progress'" class="flex items-center gap-1.5 px-3 py-2 border-t border-border/30">
      <button
        class="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors border border-rose-500/20"
        @click="emit('reject')"
      >
        <Ban class="h-3 w-3" />
        终止
      </button>
    </div>

    <div v-else-if="activePlan.status === 'completed' || activePlan.status === 'abandoned'" class="flex items-center gap-1.5 px-3 py-2 border-t border-border/30">
      <button
        class="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors border border-violet-500/20"
        @click="emit('replan')"
      >
        <RotateCcw class="h-3 w-3" />
        重新规划
      </button>
    </div>

    <!-- 历史 Plan 折叠 -->
    <div v-if="sessionPlans.length > 1" class="border-t border-border/30">
      <details class="group">
        <summary class="flex items-center gap-1.5 px-3 py-2 cursor-pointer text-[10px] text-muted-foreground/60 hover:text-muted-foreground/80 select-none">
          <ChevronRight class="h-3 w-3 transition-transform group-open:rotate-90" />
          历史计划 ({{ sessionPlans.length - 1 }})
        </summary>
        <div class="px-3 pb-2 space-y-1">
          <div
            v-for="plan in sessionPlans.filter(p => p.id !== activePlan?.id)"
            :key="plan.id"
            class="text-[10px] text-muted-foreground/50 truncate"
          >
            {{ plan.title }} — <span :class="getStatusConfig(plan.status).color">{{ getStatusConfig(plan.status).label }}</span>
          </div>
        </div>
      </details>
    </div>
  </div>
</template>
