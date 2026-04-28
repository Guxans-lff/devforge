<script setup lang="ts">
/**
 * Proactive Tick 任务面板
 *
 * 展示当前主动任务列表，支持启动、暂停、恢复、停止。
 */
import { computed } from 'vue'
import { useProactiveTickStore } from '@/stores/proactive-tick'
import {
  Play, Pause, Square, Trash2, Clock, CheckCircle2,
  AlertCircle, Loader2,
} from 'lucide-vue-next'
import type { AiProactiveTask } from '@/types/ai'

const props = defineProps<{
  sessionId: string
}>()

const store = useProactiveTickStore()

const sessionTasks = computed(() =>
  store.tasks.filter(t => t.sessionId === props.sessionId),
)

function statusIcon(task: AiProactiveTask) {
  if (task.status === 'running') return Loader2
  if (task.status === 'paused') return Pause
  if (task.status === 'done') return CheckCircle2
  if (task.status === 'failed') return AlertCircle
  return Clock
}

function statusClass(task: AiProactiveTask): string {
  if (task.status === 'running') return 'text-amber-500'
  if (task.status === 'paused') return 'text-blue-500'
  if (task.status === 'done') return 'text-emerald-500'
  if (task.status === 'failed') return 'text-destructive'
  return 'text-muted-foreground'
}

function statusLabel(task: AiProactiveTask): string {
  if (task.status === 'running') return '运行中'
  if (task.status === 'paused') return '已暂停'
  if (task.status === 'done') return '已完成'
  if (task.status === 'failed') return '失败'
  return '等待中'
}

function handleStart() {
  const objective = window.prompt('输入主动任务目标（例如：等测试跑完后继续分析）：')
  if (!objective?.trim()) return
  store.startTask({
    sessionId: props.sessionId,
    objective: objective.trim(),
    tickIntervalMs: 5000,
    maxTicks: 120,
  })
}

function handlePause(taskId: string) {
  store.pauseTask(taskId)
}

function handleResume(taskId: string) {
  store.resumeTask(taskId)
}

function handleStop(taskId: string) {
  store.stopTask(taskId)
}

function handleRemove(taskId: string) {
  store.removeTask(taskId)
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <h4 class="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground/50">
        主动任务
      </h4>
      <button
        class="inline-flex items-center gap-1 rounded-md border border-border/30 px-2 py-0.5 text-[10px] hover:bg-muted/30 transition-colors"
        @click="handleStart"
      >
        <Play class="h-3 w-3" /> 新建
      </button>
    </div>

    <div v-if="sessionTasks.length === 0" class="rounded-xl border border-dashed border-border/25 bg-muted/10 px-3 py-2 text-center">
      <p class="text-[11px] text-muted-foreground/60">暂无主动任务</p>
    </div>

    <div v-else class="space-y-1.5">
      <div
        v-for="task in sessionTasks"
        :key="task.id"
        class="group rounded-xl border border-border/25 bg-background/55 px-2.5 py-2"
      >
        <div class="flex items-start gap-2">
          <component
            :is="statusIcon(task)"
            class="mt-0.5 h-3.5 w-3.5 shrink-0"
            :class="[statusClass(task), task.status === 'running' ? 'animate-spin' : '']"
          />
          <div class="min-w-0 flex-1">
            <p class="text-[11px] font-medium leading-tight">{{ task.objective }}</p>
            <p class="mt-0.5 text-[10px] text-muted-foreground/60">
              {{ statusLabel(task) }} · tick {{ task.tickCount }}/{{ task.maxTicks }}
              <span v-if="task.lastTickSummary" class="truncate">· {{ task.lastTickSummary }}</span>
            </p>
            <p v-if="task.error" class="mt-0.5 text-[10px] text-destructive">{{ task.error }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              v-if="task.status === 'running'"
              class="rounded p-1 hover:bg-muted/50 text-muted-foreground"
              title="暂停"
              @click="handlePause(task.id)"
            >
              <Pause class="h-3 w-3" />
            </button>
            <button
              v-if="task.status === 'paused'"
              class="rounded p-1 hover:bg-muted/50 text-muted-foreground"
              title="恢复"
              @click="handleResume(task.id)"
            >
              <Play class="h-3 w-3" />
            </button>
            <button
              v-if="task.status === 'running' || task.status === 'paused'"
              class="rounded p-1 hover:bg-muted/50 text-muted-foreground"
              title="停止"
              @click="handleStop(task.id)"
            >
              <Square class="h-3 w-3" />
            </button>
            <button
              v-if="task.status === 'done' || task.status === 'failed'"
              class="rounded p-1 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
              title="删除"
              @click="handleRemove(task.id)"
            >
              <Trash2 class="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
