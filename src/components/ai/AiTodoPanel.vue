<script setup lang="ts">
/**
 * AI 任务清单展示
 *
 * 对应 todo_write 工具，用毛玻璃卡片 + 进度条展示 AI 的任务编排。
 * 只读组件——状态来自 parsedArgs.todos，由 AI 侧持续更新。
 */
import { computed } from 'vue'
import { CheckCircle2, Circle, Loader2 } from 'lucide-vue-next'

interface TodoItem {
  id: string
  content: string
  activeForm: string
  status: 'pending' | 'in_progress' | 'completed'
}

const props = defineProps<{
  todos: TodoItem[]
}>()

const stats = computed(() => {
  const done = props.todos.filter(t => t.status === 'completed').length
  const doing = props.todos.filter(t => t.status === 'in_progress').length
  return { done, doing, total: props.todos.length }
})

const percent = computed(() =>
  stats.value.total === 0 ? 0 : Math.round((stats.value.done / stats.value.total) * 100),
)
</script>

<template>
  <div class="rounded-lg border border-border/40 bg-muted/10 px-3 py-2">
    <div class="mb-2 flex items-center gap-2">
      <span class="text-[11px] font-semibold text-foreground/80">任务清单</span>
      <span class="text-[10px] text-muted-foreground">
        {{ stats.done }} / {{ stats.total }} 已完成
        <span v-if="stats.doing > 0" class="ml-1 text-blue-500">· 进行中 {{ stats.doing }}</span>
      </span>
      <div class="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          class="h-full rounded-full bg-emerald-500 transition-all duration-300"
          :style="{ width: `${percent}%` }"
        />
      </div>
    </div>
    <ul class="space-y-1">
      <li
        v-for="t in todos"
        :key="t.id"
        class="flex items-start gap-2 text-[11px] leading-5"
        :class="{
          'text-foreground/60': t.status === 'pending',
          'text-blue-500 font-medium': t.status === 'in_progress',
          'text-muted-foreground/60 line-through': t.status === 'completed',
        }"
      >
        <CheckCircle2 v-if="t.status === 'completed'" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <Loader2 v-else-if="t.status === 'in_progress'" class="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
        <Circle v-else class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
        <span>{{ t.status === 'in_progress' ? t.activeForm : t.content }}</span>
      </li>
    </ul>
  </div>
</template>
