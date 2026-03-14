import { ref, computed, onBeforeUnmount } from 'vue'

/**
 * SQL 执行计时器
 * 提供实时计时功能，用于显示查询执行耗时
 */
export function useExecutionTimer() {
  const startTime = ref<number | null>(null)
  const elapsedMs = ref(0)
  let intervalId: ReturnType<typeof setInterval> | null = null

  /** 格式化耗时显示 */
  const elapsed = computed(() => {
    const ms = elapsedMs.value
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  })

  /** 是否正在计时 */
  const isRunning = computed(() => startTime.value !== null)

  /** 开始计时 */
  function start() {
    stop()
    startTime.value = Date.now()
    elapsedMs.value = 0
    intervalId = setInterval(() => {
      if (startTime.value) {
        elapsedMs.value = Date.now() - startTime.value
      }
    }, 100)
  }

  /** 停止计时并返回最终耗时 */
  function stop(): number {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
    if (startTime.value) {
      elapsedMs.value = Date.now() - startTime.value
    }
    startTime.value = null
    return elapsedMs.value
  }

  /** 重置 */
  function reset() {
    stop()
    elapsedMs.value = 0
  }

  onBeforeUnmount(() => {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  })

  return {
    elapsed,
    elapsedMs,
    isRunning,
    start,
    stop,
    reset,
  }
}
