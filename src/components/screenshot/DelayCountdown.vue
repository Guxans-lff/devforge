<script setup lang="ts">
/**
 * 延迟截图倒计时浮窗
 * 居中显示大号倒计时数字，到时自动触发截图
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  /** 延迟秒数 */
  seconds: number
}>()

const emit = defineEmits<{
  /** 倒计时结束 */
  done: []
  /** 用户取消 */
  cancel: []
}>()

const remaining = ref(props.seconds)
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timer = setInterval(() => {
    remaining.value--
    if (remaining.value <= 0) {
      clearInterval(timer!)
      timer = null
      emit('done')
    }
  }, 1000)

  // ESC 取消
  document.addEventListener('keydown', handleKeyDown)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  document.removeEventListener('keydown', handleKeyDown)
})

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (timer) clearInterval(timer)
    emit('cancel')
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[9998] flex items-center justify-center pointer-events-none">
      <!-- 半透明背景 -->
      <div class="absolute inset-0 bg-black/20 pointer-events-auto" @click="emit('cancel')" />

      <!-- 倒计时数字 -->
      <div class="relative z-10 flex flex-col items-center">
        <div
          class="text-[120px] font-bold text-white leading-none drop-shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
          style="font-variant-numeric: tabular-nums;"
        >
          {{ remaining }}
        </div>
        <div class="mt-4 text-sm text-white/70">
          按 ESC 取消
        </div>
      </div>
    </div>
  </Teleport>
</template>
