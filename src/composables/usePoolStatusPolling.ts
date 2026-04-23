import { ref, type Ref } from 'vue'
import * as dbApi from '@/api/database'
import type { PoolStatus } from '@/types/connection'

interface UsePoolStatusPollingOptions {
  connectionId: () => string
  isConnected: Ref<boolean>
  intervalMs?: number
}

export function usePoolStatusPolling(options: UsePoolStatusPollingOptions) {
  const poolStatus = ref<PoolStatus | null>(null)
  const intervalMs = options.intervalMs ?? 10000

  let timer: ReturnType<typeof setInterval> | null = null
  let isActive = false
  let visibilityListenerAttached = false

  function canPoll(): boolean {
    return isActive && options.isConnected.value
  }

  async function fetchPoolStatus() {
    if (!canPoll()) return
    try {
      poolStatus.value = await dbApi.dbGetPoolStatus(options.connectionId())
    } catch {
      // Pool status is observability only; connection/query flow should continue.
    }
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function start() {
    stop()
    if (!canPoll()) return

    void fetchPoolStatus()
    if (typeof document !== 'undefined' && document.hidden) return

    timer = setInterval(() => {
      void fetchPoolStatus()
    }, intervalMs)
  }

  function reset() {
    stop()
    poolStatus.value = null
  }

  function handleVisibilityChange() {
    if (typeof document !== 'undefined' && document.hidden) {
      stop()
    } else {
      start()
    }
  }

  function attachVisibilityListener() {
    if (visibilityListenerAttached || typeof document === 'undefined') return
    document.addEventListener('visibilitychange', handleVisibilityChange)
    visibilityListenerAttached = true
  }

  function detachVisibilityListener() {
    if (!visibilityListenerAttached || typeof document === 'undefined') return
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    visibilityListenerAttached = false
  }

  function activate() {
    isActive = true
    attachVisibilityListener()
    start()
  }

  function deactivate() {
    isActive = false
    stop()
  }

  function dispose() {
    deactivate()
    detachVisibilityListener()
  }

  return {
    poolStatus,
    fetchPoolStatus,
    start,
    stop,
    reset,
    activate,
    deactivate,
    dispose,
  }
}
