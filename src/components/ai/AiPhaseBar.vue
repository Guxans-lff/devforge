<script setup lang="ts">
/**
 * Phase Tracking 进度条
 *
 * 显示 AI 多步任务中由 [PHASE:N/M label] 标记解析出的当前阶段。
 */
import { CheckCircle2, Circle, Loader2 } from 'lucide-vue-next'

const props = defineProps<{
  current: number
  total: number
  label: string
  isStreaming?: boolean
}>()
</script>

<template>
  <div class="my-1.5 flex items-center gap-2 px-3 py-1.5 rounded-md border border-border/20 bg-muted/10">
    <div class="flex items-center gap-1">
      <template v-for="i in total" :key="i">
        <!-- 当前步：流式中显旋转图标 -->
        <component
          :is="i === current && isStreaming ? Loader2 : i < current ? CheckCircle2 : Circle"
          class="h-3 w-3 shrink-0"
          :class="{
            'animate-spin text-blue-400': i === current && isStreaming,
            'text-emerald-500': i < current,
            'text-blue-400': i === current && !isStreaming,
            'text-muted-foreground/25': i > current,
          }"
        />
        <div
          v-if="i < total"
          class="h-px w-3 shrink-0"
          :class="i < current ? 'bg-emerald-500/50' : 'bg-border/30'"
        />
      </template>
    </div>
    <span class="text-[11px] font-mono" :class="isStreaming ? 'text-blue-400/80' : 'text-foreground/60'">
      {{ current }}/{{ total }} {{ label }}
    </span>
  </div>
</template>
