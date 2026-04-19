<script setup lang="ts">
/**
 * Dispatcher 模式 — 子任务列表面板
 *
 * 展示 AI 通过 [SPAWN:xxx] 声明的待执行子任务，支持手动触发执行。
 */
import { Network, Circle, Loader2, CheckCircle2, XCircle, Play } from 'lucide-vue-next'

const props = defineProps<{
  tasks: Array<{ id: string; description: string; status: 'pending' | 'running' | 'done' | 'error' }>
}>()

const emit = defineEmits<{
  (e: 'run', id: string): void
}>()
</script>

<template>
  <div v-if="tasks.length" class="my-2 rounded-lg border border-sky-500/20 bg-sky-500/5 overflow-hidden">
    <div class="flex items-center gap-2 px-3 py-2 border-b border-sky-500/10">
      <Network class="h-3.5 w-3.5 text-sky-400 shrink-0" />
      <span class="text-[12px] font-medium text-sky-400">子任务队列（Dispatcher）</span>
      <span class="text-[10px] text-sky-400/50 font-mono">{{ tasks.filter(t => t.status === 'done').length }}/{{ tasks.length }}</span>
    </div>
    <div class="divide-y divide-sky-500/10">
      <div
        v-for="task in tasks"
        :key="task.id"
        class="flex items-center gap-2 px-3 py-1.5"
      >
        <!-- 状态图标 -->
        <Loader2 v-if="task.status === 'running'" class="h-3 w-3 text-blue-400 animate-spin shrink-0" />
        <CheckCircle2 v-else-if="task.status === 'done'" class="h-3 w-3 text-emerald-500 shrink-0" />
        <XCircle v-else-if="task.status === 'error'" class="h-3 w-3 text-destructive shrink-0" />
        <Circle v-else class="h-3 w-3 text-muted-foreground/30 shrink-0" />
        <!-- 描述 -->
        <span class="text-[11px] text-foreground/70 flex-1 truncate">{{ task.description }}</span>
        <!-- 执行按钮（pending 态） -->
        <button
          v-if="task.status === 'pending'"
          class="shrink-0 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-sky-400 hover:bg-sky-500/10 transition-colors"
          @click="emit('run', task.id)"
        >
          <Play class="h-2.5 w-2.5" />
          执行
        </button>
      </div>
    </div>
  </div>
</template>
