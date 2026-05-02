<script setup lang="ts">
/**
 * Dispatcher 模式 — 子任务列表面板
 *
 * 展示 AI 通过 [SPAWN:xxx] 声明的待执行子任务，支持手动触发执行。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MultiAgentAssignment, MultiAgentRole } from '@/ai-gui/multiAgentOrchestrator'
import { buildSpawnedTaskIsolationContext } from '@/ai-gui/spawnedTaskIsolationPlan'
import type { WorkspaceIsolationExecutionPlanItem, WorkspaceIsolationExecutionMode } from '@/ai-gui/workspaceIsolationPlan'
import type { TaskIsolationBackendState, WorkspaceIsolationDiffEntry, WorkspaceIsolationMode } from '@/api/workspace-isolation'
import { analyzeSpawnedTasks, type SpawnedTask } from '@/composables/ai/chatSideEffects'
import { Network, Circle, Loader2, CheckCircle2, XCircle, Play, RotateCcw, AlertTriangle, ExternalLink, GitCompare, ShieldCheck, Trash2, UploadCloud } from 'lucide-vue-next'

const props = defineProps<{
  tasks: SpawnedTask[]
  isolationStates?: Record<string, TaskIsolationBackendState>
  workspaceRoot?: string
}>()

const emit = defineEmits<{
  (e: 'run', id: string): void
  (e: 'retry', id: string): void
  (e: 'open', id: string): void
  (e: 'complete', id: string): void
  (e: 'cancel', id: string): void
  (e: 'run-batch', ids: string[]): void
  (e: 'cancel-batch', ids: string[]): void
  (e: 'retry-batch', ids: string[]): void
  (e: 'synthesize'): void
  (e: 'isolation-prepare', taskId: string, plan: WorkspaceIsolationExecutionPlanItem): void
  (e: 'isolation-diff', taskId: string, plan: WorkspaceIsolationExecutionPlanItem): void
  (e: 'isolation-verify', taskId: string, plan: WorkspaceIsolationExecutionPlanItem): void
  (e: 'isolation-apply', taskId: string, plan: WorkspaceIsolationExecutionPlanItem): void
  (e: 'isolation-cleanup', taskId: string, plan: WorkspaceIsolationExecutionPlanItem): void
}>()

const { t } = useI18n()
const COLLAPSED_SOURCE_GROUPS_STORAGE_KEY = 'devforge-ai-task-collapsed-source-groups'

function loadCollapsedSourceGroupKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_SOURCE_GROUPS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

const collapsedSourceGroupKeys = ref(loadCollapsedSourceGroupKeys())

const stats = computed(() => ({
  done: props.tasks.filter(task => task.status === 'done').length,
  running: props.tasks.filter(task => task.status === 'running').length,
  pending: props.tasks.filter(task => task.status === 'pending').length,
  error: props.tasks.filter(task => task.status === 'error').length,
  cancelled: props.tasks.filter(task => task.status === 'cancelled').length,
  ready: props.tasks.filter(task => task.dispatchStatus === 'ready').length,
  queued: props.tasks.filter(task => task.dispatchStatus === 'queued').length,
  blocked: props.tasks.filter(task => task.dispatchStatus === 'blocked').length,
}))

const taskAnalysis = computed(() => analyzeSpawnedTasks(props.tasks))
const isolationContext = computed(() => buildSpawnedTaskIsolationContext(props.tasks, {
  sessionId: 'dispatcher-panel',
  maxAgents: Math.min(4, Math.max(1, props.tasks.length)),
}))
const multiAgentPlan = computed(() => isolationContext.value.multiAgentPlan)
const multiAgentAssignmentByTaskId = computed(() => isolationContext.value.assignmentByTaskId)
const isolationExecutionPlan = computed(() => isolationContext.value.isolationExecutionPlan)
const isolationPlanByTaskId = computed(() => isolationContext.value.isolationPlanByTaskId)

const canSynthesize = computed(() => stats.value.done > 0 || stats.value.error > 0 || stats.value.cancelled > 0)

function emitBatch(groupKey: string, ids: string[]): void {
  if (groupKey === 'pending') {
    emit('run-batch', ids)
    return
  }
  if (groupKey === 'running') {
    emit('cancel-batch', ids)
    return
  }
  if (groupKey === 'error' || groupKey === 'cancelled' || groupKey === 'done') {
    emit('retry-batch', ids)
  }
}

function getTaskRelation(task: SpawnedTask) {
  return taskAnalysis.value.relations.get(task.id) ?? {
    standalone: !task.sourceMessageId,
    sourceTaskIndex: 1,
    sourceTaskCount: 1,
    explicitDependencyIds: [],
    explicitDependencyDescriptions: [],
    explicitMissingDependencyIds: [],
    displayDependencyIds: [],
    displayDependencyDescriptions: [],
    displayMissingDependencyIds: [],
  }
}

function getMultiAgentAssignment(task: SpawnedTask): MultiAgentAssignment | undefined {
  return multiAgentAssignmentByTaskId.value.get(task.id)
}

function getMultiAgentRoleLabel(role: MultiAgentRole): string {
  switch (role) {
    case 'planner': return '规划'
    case 'implementer': return '实现'
    case 'reviewer': return '审查'
    case 'verifier': return '验证'
    default: return role
  }
}

function getTaskAgentLabel(task: SpawnedTask): string {
  const assignment = getMultiAgentAssignment(task)
  if (!assignment) return ''
  return `Agent ${assignment.agentId} · ${getMultiAgentRoleLabel(assignment.role)}`
}

function getTaskAllowedPathsLabel(task: SpawnedTask): string {
  const assignment = getMultiAgentAssignment(task)
  return assignment ? formatAllowedPaths(assignment.allowedPaths) : ''
}

function getTaskAllowedPathsTitle(task: SpawnedTask): string {
  const assignment = getMultiAgentAssignment(task)
  return assignment?.allowedPaths.join(', ') ?? ''
}

function getTaskIsolationPlan(task: SpawnedTask): WorkspaceIsolationExecutionPlanItem | undefined {
  return isolationPlanByTaskId.value.get(task.id)
}

function getTaskIsolationState(task: SpawnedTask): TaskIsolationBackendState | undefined {
  return props.isolationStates?.[task.id]
}

function toBackendIsolationMode(mode: WorkspaceIsolationExecutionMode): WorkspaceIsolationMode | null {
  if (mode === 'temporary' || mode === 'worktree') return mode
  return null
}

function canUseIsolationBackend(task: SpawnedTask): boolean {
  const plan = getTaskIsolationPlan(task)
  return Boolean(props.workspaceRoot && plan?.workspace && toBackendIsolationMode(plan.mode))
}

function emitIsolationAction(
  event: 'isolation-prepare' | 'isolation-diff' | 'isolation-verify' | 'isolation-apply' | 'isolation-cleanup',
  task: SpawnedTask,
): void {
  const plan = getTaskIsolationPlan(task)
  if (!plan?.workspace) return
  switch (event) {
    case 'isolation-prepare':
      emit('isolation-prepare', task.id, plan)
      break
    case 'isolation-diff':
      emit('isolation-diff', task.id, plan)
      break
    case 'isolation-verify':
      emit('isolation-verify', task.id, plan)
      break
    case 'isolation-apply':
      emit('isolation-apply', task.id, plan)
      break
    case 'isolation-cleanup':
      emit('isolation-cleanup', task.id, plan)
      break
  }
}

function getTaskIsolationStatusLabel(task: SpawnedTask): string {
  const state = getTaskIsolationState(task)
  if (!state) {
    return props.workspaceRoot ? '未准备' : '需要先添加 workspace root'
  }
  switch (state.status) {
    case 'preparing': return '准备中'
    case 'prepared': return '已准备'
    case 'diffing': return '检查 Diff 中'
    case 'diffed': return 'Diff 已生成'
    case 'verifying': return '验证中'
    case 'verified': return '验证已提交'
    case 'applying': return '回放中'
    case 'applied': return '已回放'
    case 'cleaning': return '清理中'
    case 'cleaned': return '已清理'
    case 'error': return '执行失败'
    default: return '未准备'
  }
}

function getTaskIsolationDiffSummary(task: SpawnedTask): string {
  const diff = getTaskIsolationState(task)?.diff
  if (!diff) return ''
  const summary = diff.summary
  const total = diff.entries.length
  return `新增 ${summary.added}，修改 ${summary.modified}，删除 ${summary.deleted}，共 ${total} 个`
}

function getTaskIsolationDiffEntries(task: SpawnedTask): WorkspaceIsolationDiffEntry[] {
  return getTaskIsolationState(task)?.diff?.entries.slice(0, 5) ?? []
}

function getTaskIsolationHiddenDiffCount(task: SpawnedTask): number {
  const diff = getTaskIsolationState(task)?.diff
  if (!diff) return 0
  return Math.max(0, diff.entries.length - 5)
}

function getDiffStatusLabel(status: string): string {
  switch (status) {
    case 'added': return '新增'
    case 'modified': return '修改'
    case 'deleted': return '删除'
    case 'renamed': return '重命名'
    case 'conflicted': return '冲突'
    default: return status
  }
}

function getDiffStatusClass(status: string): string {
  switch (status) {
    case 'added': return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
    case 'modified': return 'border-sky-500/20 bg-sky-500/10 text-sky-200'
    case 'deleted': return 'border-red-500/20 bg-red-500/10 text-red-200'
    case 'renamed': return 'border-violet-500/20 bg-violet-500/10 text-violet-200'
    case 'conflicted': return 'border-amber-500/20 bg-amber-500/10 text-amber-200'
    default: return 'border-muted-foreground/20 bg-background/40 text-muted-foreground'
  }
}

function getIsolationModeLabel(mode: WorkspaceIsolationExecutionMode): string {
  switch (mode) {
    case 'readonly': return '只读'
    case 'temporary': return '临时空间'
    case 'worktree': return 'Worktree'
    case 'blocked': return '隔离阻塞'
    default: return '共享'
  }
}

function getTaskIsolationLabel(task: SpawnedTask): string {
  const plan = getTaskIsolationPlan(task)
  if (!plan) return ''
  return `隔离 ${getIsolationModeLabel(plan.mode)}`
}

function getTaskIsolationTitle(task: SpawnedTask): string {
  const plan = getTaskIsolationPlan(task)
  if (!plan) return ''
  const workspace = plan.workspace
    ? `路径：${plan.workspace.workspacePath}${plan.workspace.branchName ? `；分支：${plan.workspace.branchName}` : ''}`
    : ''
  const cleanup = `清理策略：${getCleanupPolicyLabel(plan.cleanupPolicy)}`
  const actions = `动作：${plan.actions.map(item => item.label).join(' -> ')}`
  return [plan.reason, workspace, cleanup, actions].filter(Boolean).join('；')
}

function formatAllowedPaths(paths: string[]): string {
  if (paths.length === 0) return '未限定路径'
  const visible = paths.slice(0, 2).join(', ')
  return paths.length > 2 ? `${visible} +${paths.length - 2}` : visible
}

function getCleanupPolicyLabel(policy: WorkspaceIsolationExecutionPlanItem['cleanupPolicy']): string {
  switch (policy) {
    case 'delete_on_success': return '成功后删除'
    case 'keep_for_review': return '保留审核'
    default: return '不清理'
  }
}

function getTaskConfirmationCount(task: SpawnedTask): number {
  return getTaskIsolationPlan(task)?.actions.filter(item => item.requiresConfirmation).length ?? 0
}

function isTaskRunBlocked(task: SpawnedTask): boolean {
  const relation = getTaskRelation(task)
  if (relation.explicitMissingDependencyIds.length > 0) return true
  return relation.explicitDependencyIds.some((dependencyId) => {
    const dependency = props.tasks.find(item => item.id === dependencyId)
    return dependency?.status !== 'done'
  })
}

function getTaskRunBlockedReason(task: SpawnedTask): string | null {
  const relation = getTaskRelation(task)
  if (relation.explicitMissingDependencyIds.length > 0) {
    return t('ai.tasks.runBlockedMissing', { ids: relation.explicitMissingDependencyIds.join(', ') })
  }

  if (relation.explicitDependencyDescriptions.length > 0) {
    const unresolvedNames = relation.explicitDependencyIds
      .map((dependencyId) => props.tasks.find(item => item.id === dependencyId))
      .filter((dependency): dependency is SpawnedTask => dependency !== undefined && dependency.status !== 'done')
      .map(dependency => dependency.description)
    if (unresolvedNames.length > 0) {
      return t('ai.tasks.runBlockedBy', { task: unresolvedNames.join(', ') })
    }
  }

  return null
}

const taskGroups = computed(() => {
  const pending = props.tasks.filter(task => task.status === 'pending')
  const running = props.tasks.filter(task => task.status === 'running')
  const error = props.tasks.filter(task => task.status === 'error')
  const cancelled = props.tasks.filter(task => task.status === 'cancelled')
  const done = props.tasks.filter(task => task.status === 'done')
  const runnablePending = pending.filter(task => !isTaskRunBlocked(task))
  const blockedPendingCount = pending.length - runnablePending.length
  return [
    {
      key: 'pending',
      title: t('ai.tasks.groups.pending'),
      tasks: pending,
      sourceSections: analyzeSpawnedTasks(pending).sourceGroups,
      batchAction: runnablePending.length > 0 ? 'run' : null,
      batchIds: runnablePending.map(task => task.id),
      blockedCount: blockedPendingCount,
    },
    {
      key: 'running',
      title: t('ai.tasks.groups.running'),
      tasks: running,
      sourceSections: analyzeSpawnedTasks(running).sourceGroups,
      batchAction: running.length > 1 ? 'cancel' : null,
      batchIds: running.map(task => task.id),
      blockedCount: 0,
    },
    {
      key: 'error',
      title: t('ai.tasks.groups.error'),
      tasks: error,
      sourceSections: analyzeSpawnedTasks(error).sourceGroups,
      batchAction: error.length > 1 ? 'retry' : null,
      batchIds: error.map(task => task.id),
      blockedCount: 0,
    },
    {
      key: 'cancelled',
      title: t('ai.tasks.groups.cancelled'),
      tasks: cancelled,
      sourceSections: analyzeSpawnedTasks(cancelled).sourceGroups,
      batchAction: cancelled.length > 1 ? 'retry' : null,
      batchIds: cancelled.map(task => task.id),
      blockedCount: 0,
    },
    {
      key: 'done',
      title: t('ai.tasks.groups.done'),
      tasks: done,
      sourceSections: analyzeSpawnedTasks(done).sourceGroups,
      batchAction: done.length > 1 ? 'retry' : null,
      batchIds: done.map(task => task.id),
      blockedCount: 0,
    },
  ].filter(group => group.tasks.length > 0)
})

function getSourceSectionTitle(section: { key: string; sourceGroupNumber?: number; sourceMessageId?: string }): string {
  return section.sourceMessageId
    ? t('ai.tasks.sourceGroup', { index: section.sourceGroupNumber })
    : t('ai.tasks.sourceStandalone')
}

function isSourceSectionCollapsed(sectionKey: string): boolean {
  return collapsedSourceGroupKeys.value.has(sectionKey)
}

function toggleSourceSection(sectionKey: string): void {
  const next = new Set(collapsedSourceGroupKeys.value)
  if (next.has(sectionKey)) {
    next.delete(sectionKey)
  } else {
    next.add(sectionKey)
  }
  collapsedSourceGroupKeys.value = next
  localStorage.setItem(COLLAPSED_SOURCE_GROUPS_STORAGE_KEY, JSON.stringify(Array.from(next)))
}

function formatTime(ts?: number): string {
  if (!ts) return '--'
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatDuration(durationMs?: number): string {
  if (durationMs === undefined) return '--'
  if (durationMs < 1000) return `${durationMs} ms`
  return `${(durationMs / 1000).toFixed(2)} s`
}
</script>

<template>
  <div v-if="tasks.length" class="my-2 overflow-hidden rounded-xl border border-sky-500/20 bg-sky-500/5">
    <div class="border-b border-sky-500/10 px-3 py-2.5">
      <div class="flex items-center gap-2">
        <Network class="h-3.5 w-3.5 shrink-0 text-sky-400" />
        <span class="text-[12px] font-medium text-sky-400">{{ t('ai.chat.dispatcher') }}</span>
        <span class="text-[10px] font-mono text-sky-400/50">{{ stats.done }}/{{ tasks.length }}</span>
      </div>
      <div class="mt-2 flex flex-wrap gap-2 text-[10px] text-sky-100/70">
        <span class="rounded-full border border-sky-500/15 bg-background/40 px-2 py-0.5">{{ t('ai.tasks.pendingCount', { count: stats.pending }) }}</span>
        <span class="rounded-full border border-sky-500/15 bg-background/40 px-2 py-0.5">{{ t('ai.tasks.runningCount', { count: stats.running }) }}</span>
        <span class="rounded-full border border-sky-500/15 bg-background/40 px-2 py-0.5">{{ t('ai.tasks.doneCount', { count: stats.done }) }}</span>
        <span class="rounded-full border border-sky-500/15 bg-background/40 px-2 py-0.5">{{ t('ai.tasks.errorCount', { count: stats.error }) }}</span>
        <span class="rounded-full border border-sky-500/15 bg-background/40 px-2 py-0.5">{{ t('ai.tasks.cancelledCount', { count: stats.cancelled }) }}</span>
        <span class="rounded-full border border-sky-500/15 bg-background/40 px-2 py-0.5">{{ t('ai.tasks.readyCount', { count: stats.ready }) }}</span>
        <span class="rounded-full border border-sky-500/15 bg-background/40 px-2 py-0.5">{{ t('ai.tasks.queuedCount', { count: stats.queued }) }}</span>
        <span class="rounded-full border border-sky-500/15 bg-background/40 px-2 py-0.5">{{ t('ai.tasks.blockedCount', { count: stats.blocked }) }}</span>
        <button
          v-if="canSynthesize"
          class="ml-auto rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-sky-300 transition-colors hover:bg-sky-500/20"
          @click="emit('synthesize')"
        >
          {{ t('ai.tasks.synthesize') }}
        </button>
      </div>
      <div class="mt-2 rounded-lg border border-violet-500/15 bg-violet-500/5 px-2.5 py-2">
        <div class="flex flex-wrap items-center gap-2 text-[10px] text-violet-100/75">
          <span class="font-medium text-violet-300">Multi-Agent 预案</span>
          <span class="rounded-full border border-violet-400/20 bg-background/40 px-2 py-0.5">分配 {{ multiAgentPlan.assignments.length }}</span>
          <span class="rounded-full border border-amber-400/20 bg-background/40 px-2 py-0.5">阻塞 {{ multiAgentPlan.blocked.length }}</span>
          <span class="rounded-full border border-violet-400/20 bg-background/40 px-2 py-0.5">需合并 {{ isolationExecutionPlan.mergeRequiredCount }}</span>
          <span class="rounded-full border border-violet-400/20 bg-background/40 px-2 py-0.5">Worktree {{ isolationExecutionPlan.worktreeCount }}</span>
          <span class="rounded-full border border-violet-400/20 bg-background/40 px-2 py-0.5">临时空间 {{ isolationExecutionPlan.temporaryWorkspaceCount }}</span>
          <span class="rounded-full border border-amber-400/20 bg-background/40 px-2 py-0.5">需确认 {{ isolationExecutionPlan.confirmationRequiredCount }}</span>
          <span class="rounded-full border border-amber-400/20 bg-background/40 px-2 py-0.5">门禁 {{ isolationExecutionPlan.gate.status }}</span>
          <span class="rounded-full border border-red-400/20 bg-background/40 px-2 py-0.5">隔离阻塞 {{ isolationExecutionPlan.blockedCount }}</span>
        </div>
        <div v-if="isolationExecutionPlan.gate.reasons.length > 0" class="mt-1.5 space-y-1">
          <div
            v-for="reason in isolationExecutionPlan.gate.reasons"
            :key="reason"
            class="text-[10px] text-amber-300/85"
          >
            {{ reason }}
          </div>
        </div>
        <div v-if="multiAgentPlan.warnings.length > 0" class="mt-1.5 space-y-1">
          <div
            v-for="warning in multiAgentPlan.warnings"
            :key="warning"
            class="text-[10px] text-amber-300/85"
          >
            {{ warning }}
          </div>
        </div>
      </div>
    </div>
    <div class="space-y-3 px-3 py-3">
      <section
        v-for="group in taskGroups"
        :key="group.key"
        class="overflow-hidden rounded-lg border border-sky-500/10 bg-background/20"
      >
        <div class="flex items-center justify-between gap-3 border-b border-sky-500/10 px-3 py-2">
          <div class="flex items-center gap-2">
            <span class="text-[11px] font-medium text-foreground/80">{{ group.title }}</span>
            <span class="text-[10px] text-muted-foreground/55">{{ group.tasks.length }}</span>
            <span
              v-if="group.blockedCount > 0"
              class="rounded-full border border-amber-500/20 bg-amber-500/5 px-1.5 py-0.5 text-[10px] text-amber-300/80"
            >
              {{ t('ai.tasks.blockedCount', { count: group.blockedCount }) }}
            </span>
          </div>
          <button
            v-if="group.batchAction"
            class="rounded px-1.5 py-0.5 text-[10px] text-sky-400 transition-colors hover:bg-sky-500/10"
            @click="emitBatch(group.key, group.batchIds)"
          >
            {{ group.batchAction === 'run'
              ? group.blockedCount > 0 ? t('ai.tasks.batchRunRunnable') : t('ai.tasks.batchRun')
              : group.batchAction === 'cancel'
                ? t('ai.tasks.batchCancel')
                : t('ai.tasks.batchRetry') }}
          </button>
        </div>

        <div class="space-y-2 p-2.5">
          <section
            v-for="sourceSection in group.sourceSections"
            :key="sourceSection.key"
            :data-source-section-key="sourceSection.key"
            class="overflow-hidden rounded-md border border-sky-500/10 bg-background/10"
          >
            <button
              type="button"
              class="flex w-full items-center gap-2 border-b border-sky-500/10 px-3 py-2 text-left transition-colors hover:bg-sky-500/5"
              @click="toggleSourceSection(sourceSection.key)"
            >
              <span class="text-[10px] font-medium text-sky-200/80">{{ getSourceSectionTitle(sourceSection) }}</span>
              <span class="text-[10px] text-muted-foreground/55">{{ sourceSection.tasks.length }}</span>
              <span
                v-if="sourceSection.sourceMessageId"
                class="text-[10px] font-mono text-muted-foreground/55"
              >
                {{ sourceSection.sourceMessageId.slice(0, 8) }}
              </span>
              <span class="ml-auto text-[10px] text-muted-foreground/55">
                {{ isSourceSectionCollapsed(sourceSection.key) ? t('common.expand') : t('common.collapse') }}
              </span>
            </button>

            <div v-if="!isSourceSectionCollapsed(sourceSection.key)" class="divide-y divide-sky-500/10">
              <div
                v-for="task in sourceSection.tasks"
                :key="task.id"
                class="px-3 py-2.5"
              >
                <div class="flex items-start gap-2">
                  <Loader2 v-if="task.status === 'running'" class="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-blue-400" />
                  <CheckCircle2 v-else-if="task.status === 'done'" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  <XCircle v-else-if="task.status === 'error'" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  <Circle v-else-if="task.status === 'cancelled'" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <Circle v-else class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/30" />

                  <div class="min-w-0 flex-1">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="truncate text-[11px] font-medium text-foreground/80">{{ task.description }}</div>
                        <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground/55">
                          <span>{{ t('ai.tasks.createdAt') }} {{ formatTime(task.createdAt) }}</span>
                          <span v-if="task.startedAt">{{ t('ai.tasks.startedAt') }} {{ formatTime(task.startedAt) }}</span>
                          <span v-if="task.finishedAt">{{ t('ai.tasks.finishedAt') }} {{ formatTime(task.finishedAt) }}</span>
                          <span v-if="task.durationMs !== undefined">{{ t('ai.tasks.duration') }} {{ formatDuration(task.durationMs) }}</span>
                          <span v-if="task.sourceMessageId" class="font-mono">{{ t('ai.tasks.sourceMessage') }} {{ task.sourceMessageId.slice(0, 8) }}</span>
                          <span v-if="task.retryCount > 0">{{ t('ai.tasks.retryCount', { count: task.retryCount }) }}</span>
                          <span>{{ t('ai.tasks.autoRetryBudget', { count: task.autoRetryBudget ?? 1 }) }}</span>
                        </div>
                        <div class="mt-1.5 flex flex-wrap gap-1 text-[10px]">
                          <span
                            v-if="getMultiAgentAssignment(task)"
                            class="rounded-full border border-violet-500/20 bg-violet-500/5 px-2 py-0.5 text-violet-300/85"
                          >
                            {{ getTaskAgentLabel(task) }}
                          </span>
                          <span
                            v-if="getMultiAgentAssignment(task)"
                            class="rounded-full border border-violet-500/20 bg-background/40 px-2 py-0.5 font-mono text-violet-200/75"
                            :title="getTaskAllowedPathsTitle(task)"
                          >
                            {{ getTaskAllowedPathsLabel(task) }}
                          </span>
                          <span
                            v-if="getTaskIsolationPlan(task)"
                            class="rounded-full border border-purple-500/20 bg-purple-500/5 px-2 py-0.5 text-purple-200/85"
                            :title="getTaskIsolationTitle(task)"
                          >
                            {{ getTaskIsolationLabel(task) }}
                          </span>
                          <span
                            v-if="getTaskIsolationPlan(task)?.workspace"
                            class="rounded-full border border-purple-500/20 bg-background/40 px-2 py-0.5 font-mono text-purple-200/70"
                            :title="getTaskIsolationPlan(task)?.workspace?.workspacePath"
                          >
                            {{ getTaskIsolationPlan(task)?.workspace?.slug }}
                          </span>
                          <span
                            v-if="getTaskIsolationPlan(task)?.requiresReview"
                            class="rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-amber-300/80"
                          >
                            需审核
                          </span>
                          <span
                            v-if="getTaskConfirmationCount(task) > 0"
                            class="rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-amber-300/80"
                            :title="getTaskIsolationTitle(task)"
                          >
                            确认动作 {{ getTaskConfirmationCount(task) }}
                          </span>
                          <span class="rounded-full border border-sky-500/15 bg-background/40 px-2 py-0.5 text-sky-200/80">
                            {{ t('ai.tasks.executionMode', { mode: task.executionMode ?? 'headless' }) }}
                          </span>
                          <span class="rounded-full border border-sky-500/15 bg-background/40 px-2 py-0.5 text-sky-200/80">
                            {{ t('ai.tasks.dispatchStatus', { status: task.dispatchStatus ?? task.status }) }}
                          </span>
                          <span class="rounded-full border border-sky-500/15 bg-background/40 px-2 py-0.5 text-sky-200/80">
                            {{ getTaskRelation(task).standalone
                              ? t('ai.tasks.sourceStandalone')
                              : t('ai.tasks.sourceGroup', { index: getTaskRelation(task).sourceGroupNumber }) }}
                          </span>
                          <span
                            v-if="!getTaskRelation(task).standalone && getTaskRelation(task).sourceTaskCount > 1"
                            class="rounded-full border border-sky-500/15 bg-background/40 px-2 py-0.5 text-sky-200/80"
                          >
                            {{ t('ai.tasks.sourceStep', {
                              index: getTaskRelation(task).sourceTaskIndex,
                              count: getTaskRelation(task).sourceTaskCount,
                            }) }}
                          </span>
                          <span
                            v-if="getTaskRelation(task).displayDependencyDescriptions.length > 0"
                            class="rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-amber-300/80"
                          >
                            {{ t('ai.tasks.dependencyAfter', { task: getTaskRelation(task).displayDependencyDescriptions.join(', ') }) }}
                          </span>
                          <span
                            v-else-if="!getTaskRelation(task).standalone && getTaskRelation(task).sourceTaskCount > 1"
                            class="rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-amber-300/80"
                          >
                            {{ t('ai.tasks.dependencyRoot') }}
                          </span>
                          <span
                            v-if="getTaskRelation(task).displayMissingDependencyIds.length > 0"
                            class="rounded-full border border-destructive/20 bg-destructive/5 px-2 py-0.5 text-destructive/80"
                          >
                            {{ t('ai.tasks.dependencyMissing', { ids: getTaskRelation(task).displayMissingDependencyIds.join(', ') }) }}
                          </span>
                        </div>
                        <div
                          v-if="getTaskIsolationPlan(task)?.workspace"
                          class="mt-2 rounded-md border border-purple-500/15 bg-purple-500/5 px-2 py-1.5"
                        >
                          <div class="flex flex-wrap items-center gap-1.5 text-[10px] text-purple-100/75">
                            <span class="font-medium text-purple-200">隔离执行空间</span>
                            <span class="rounded-full border border-purple-500/20 bg-background/40 px-2 py-0.5">
                              {{ getTaskIsolationStatusLabel(task) }}
                            </span>
                            <span
                              v-if="getTaskIsolationDiffSummary(task)"
                              class="rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-amber-200/80"
                            >
                              {{ getTaskIsolationDiffSummary(task) }}
                            </span>
                          </div>
                          <div
                            v-if="getTaskIsolationState(task)?.message"
                            class="mt-1 line-clamp-2 text-[10px] text-muted-foreground/70"
                          >
                            {{ getTaskIsolationState(task)?.message }}
                          </div>
                          <div
                            v-if="getTaskIsolationDiffEntries(task).length > 0"
                            class="mt-1.5 space-y-1 rounded border border-border/40 bg-background/35 p-1.5"
                          >
                            <div
                              v-for="entry in getTaskIsolationDiffEntries(task)"
                              :key="`${entry.status}:${entry.path}`"
                              class="flex items-center gap-1.5 text-[10px]"
                            >
                              <span
                                class="shrink-0 rounded-full border px-1.5 py-0.5 leading-none"
                                :class="getDiffStatusClass(entry.status)"
                              >
                                {{ getDiffStatusLabel(entry.status) }}
                              </span>
                              <span class="min-w-0 flex-1 truncate text-muted-foreground/80" :title="entry.path">
                                {{ entry.path }}
                              </span>
                            </div>
                            <div
                              v-if="getTaskIsolationHiddenDiffCount(task) > 0"
                              class="text-[10px] text-muted-foreground/60"
                            >
                              还有 {{ getTaskIsolationHiddenDiffCount(task) }} 个变更未显示
                            </div>
                          </div>
                          <div class="mt-1.5 flex flex-wrap gap-1">
                            <button
                              type="button"
                              class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors"
                              :class="canUseIsolationBackend(task)
                                ? 'text-purple-200 hover:bg-purple-500/10'
                                : 'cursor-not-allowed text-muted-foreground/40'"
                              :disabled="!canUseIsolationBackend(task)"
                              @click="emitIsolationAction('isolation-prepare', task)"
                            >
                              <UploadCloud class="h-2.5 w-2.5" />
                              准备
                            </button>
                            <button
                              type="button"
                              class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors"
                              :class="canUseIsolationBackend(task)
                                ? 'text-sky-300 hover:bg-sky-500/10'
                                : 'cursor-not-allowed text-muted-foreground/40'"
                              :disabled="!canUseIsolationBackend(task)"
                              @click="emitIsolationAction('isolation-diff', task)"
                            >
                              <GitCompare class="h-2.5 w-2.5" />
                              Diff
                            </button>
                            <button
                              type="button"
                              class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors"
                              :class="canUseIsolationBackend(task)
                                ? 'text-violet-300 hover:bg-violet-500/10'
                                : 'cursor-not-allowed text-muted-foreground/40'"
                              :disabled="!canUseIsolationBackend(task)"
                              @click="emitIsolationAction('isolation-verify', task)"
                            >
                              <ShieldCheck class="h-2.5 w-2.5" />
                              验证
                            </button>
                            <button
                              v-if="getTaskIsolationPlan(task)?.mode === 'temporary'"
                              type="button"
                              class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors"
                              :class="canUseIsolationBackend(task)
                                ? 'text-emerald-300 hover:bg-emerald-500/10'
                                : 'cursor-not-allowed text-muted-foreground/40'"
                              :disabled="!canUseIsolationBackend(task)"
                              @click="emitIsolationAction('isolation-apply', task)"
                            >
                              回放
                            </button>
                            <button
                              type="button"
                              class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors"
                              :class="canUseIsolationBackend(task)
                                ? 'text-amber-300 hover:bg-amber-500/10'
                                : 'cursor-not-allowed text-muted-foreground/40'"
                              :disabled="!canUseIsolationBackend(task)"
                              @click="emitIsolationAction('isolation-cleanup', task)"
                            >
                              <Trash2 class="h-2.5 w-2.5" />
                              清理
                            </button>
                          </div>
                        </div>
                      </div>

                      <div class="flex shrink-0 items-center gap-1">
                        <button
                          v-if="task.status === 'pending'"
                          class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] transition-colors"
                          :class="isTaskRunBlocked(task)
                            ? 'cursor-not-allowed text-muted-foreground/40'
                            : 'text-sky-400 hover:bg-sky-500/10'"
                          :disabled="isTaskRunBlocked(task)"
                          @click="emit('run', task.id)"
                        >
                          <Play class="h-2.5 w-2.5" />
                          {{ t('ai.tasks.run') }}
                        </button>
                        <template v-else-if="task.status === 'running'">
                          <button
                            v-if="task.taskTabId"
                            class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-sky-400 transition-colors hover:bg-sky-500/10"
                            @click="emit('open', task.id)"
                          >
                            <ExternalLink class="h-2.5 w-2.5" />
                            {{ t('ai.tasks.open') }}
                          </button>
                          <button
                            class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-emerald-400 transition-colors hover:bg-emerald-500/10"
                            @click="emit('complete', task.id)"
                          >
                            <CheckCircle2 class="h-2.5 w-2.5" />
                            {{ t('ai.tasks.complete') }}
                          </button>
                          <button
                            class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-destructive/80 transition-colors hover:bg-destructive/10"
                            @click="emit('cancel', task.id)"
                          >
                            {{ t('common.cancel') }}
                          </button>
                        </template>
                        <template v-else-if="task.status === 'done'">
                          <button
                            v-if="task.taskTabId"
                            class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-sky-400 transition-colors hover:bg-sky-500/10"
                            @click="emit('open', task.id)"
                          >
                            <ExternalLink class="h-2.5 w-2.5" />
                            {{ t('ai.tasks.open') }}
                          </button>
                          <button
                            class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-amber-400 transition-colors hover:bg-amber-500/10"
                            @click="emit('retry', task.id)"
                          >
                            <RotateCcw class="h-2.5 w-2.5" />
                            {{ t('ai.tasks.runAgain') }}
                          </button>
                        </template>
                        <button
                          v-else-if="task.status === 'error' || task.status === 'cancelled'"
                          class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-amber-400 transition-colors hover:bg-amber-500/10"
                          @click="emit('retry', task.id)"
                        >
                          <RotateCcw class="h-2.5 w-2.5" />
                          {{ t('common.retry') }}
                        </button>
                      </div>
                    </div>
                    <div
                      v-if="task.resultSummary || task.lastSummary"
                      class="mt-2 line-clamp-3 rounded-md border border-sky-500/15 bg-background/50 px-2 py-1.5 text-[10px] text-foreground/70"
                    >
                      {{ task.resultSummary || task.lastSummary }}
                    </div>

                    <div
                      v-if="task.status === 'pending' && getTaskRunBlockedReason(task)"
                      class="mt-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[10px] text-amber-300/80"
                    >
                      {{ getTaskRunBlockedReason(task) }}
                    </div>

                    <div
                      v-if="task.lastError"
                      class="mt-2 flex items-start gap-1 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-[10px] text-destructive/80"
                    >
                      <AlertTriangle class="mt-0.5 h-3 w-3 shrink-0" />
                      <span class="line-clamp-2">{{ task.lastError }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  </div>
</template>
