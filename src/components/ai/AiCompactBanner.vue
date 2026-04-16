<script setup lang="ts">
/**
 * 压缩进行中提示条
 *
 * 显示在消息区顶部，压缩完成后自动消失。
 */
import { Loader2 } from 'lucide-vue-next'

defineProps<{
  visible: boolean
}>()
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-300 ease-out"
    enter-from-class="opacity-0 -translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition-all duration-200 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 -translate-y-2"
  >
    <div
      v-if="visible"
      class="mx-auto max-w-4xl px-5 py-2"
    >
      <div class="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2">
        <Loader2 class="h-3.5 w-3.5 animate-spin text-amber-500" />
        <span class="text-xs text-amber-600 dark:text-amber-400">正在压缩对话上下文…</span>
      </div>
    </div>
  </Transition>
</template>
