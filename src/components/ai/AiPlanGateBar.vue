<script setup lang="ts">
/**
 * Plan Gate 确认条
 *
 * AI 在规划门控模式下输出执行计划后，显示此条供用户确认或拒绝。
 */
import { CheckCircle2, XCircle, ClipboardList } from 'lucide-vue-next'

const props = defineProps<{
  /** AI 输出的计划文本 */
  plan: string
}>()

const emit = defineEmits<{
  (e: 'approve'): void
  (e: 'reject'): void
}>()
</script>

<template>
  <div class="my-2 rounded-lg border border-amber-500/25 bg-amber-500/5 overflow-hidden">
    <!-- 标题栏 -->
    <div class="flex items-center gap-2 px-3 py-2 border-b border-amber-500/15">
      <ClipboardList class="h-3.5 w-3.5 text-amber-400 shrink-0" />
      <span class="text-[12px] font-medium text-amber-400">执行计划 — 请确认后再继续</span>
      <div class="flex items-center gap-1.5 ml-auto">
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
          <XCircle class="h-3 w-3" />
          重新规划
        </button>
      </div>
    </div>
    <!-- 计划内容 -->
    <div class="px-3 py-2 text-[12px] text-amber-200/70 leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto select-text">
      {{ plan }}
    </div>
  </div>
</template>
