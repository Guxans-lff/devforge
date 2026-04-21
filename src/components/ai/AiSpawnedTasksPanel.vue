<script setup lang="ts">
/**
 * Dispatcher 模式 — 子任务列表面板
 *
 * 展示 AI 通过 [SPAWN:xxx] 声明的待执行子任务，支持手动触发执行。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SpawnedTask } from '@/composables/ai/chatSideEffects'
import { Network, Circle, Loader2, CheckCircle2, XCircle, Play, RotateCcw, AlertTriangle, ExternalLink } from 'lucide-vue-next'

const props = defineProps<{
  tasks: SpawnedTask[]
}>()

const emit = defineEmits<{
  (e: 'run', id: string): void
  (e: 'retry', id: string): void
  (e: 'open', id: string): void
  (e: 'complete', id: string): void
}>()

const { t } = useI18n()

const stats = computed(() => ({
  done: props.tasks.filter(task => task.status === 'done').length,
  running: props.tasks.filter(task => task.status === 'running').length,
  pending: props.tasks.filter(task => task.status === 'pending').length,
  error: props.tasks.filter(task => task.status === 'error').length,
}))

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
      </div>
    </div>
    <div class="divide-y divide-sky-500/10">
      <div
        v-for="task in tasks"
        :key="task.id"
        class="px-3 py-2.5"
      >
        <div class="flex items-start gap-2">
          <Loader2 v-if="task.status === 'running'" class="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-blue-400" />
          <CheckCircle2 v-else-if="task.status === 'done'" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
          <XCircle v-else-if="task.status === 'error'" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
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
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-1">
                <button
                  v-if="task.status === 'pending'"
                  class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-sky-400 transition-colors hover:bg-sky-500/10"
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
                  v-else-if="task.status === 'error'"
                  class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-amber-400 transition-colors hover:bg-amber-500/10"
                  @click="emit('retry', task.id)"
                >
                  <RotateCcw class="h-2.5 w-2.5" />
                  {{ t('common.retry') }}
                </button>
              </div>
            </div>

            <div
              v-if="task.lastSummary"
              class="mt-2 line-clamp-3 rounded-md border border-sky-500/15 bg-background/50 px-2 py-1.5 text-[10px] text-foreground/70"
            >
              {{ task.lastSummary }}
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
  </div>
</template>
