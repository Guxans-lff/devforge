import { defineStore } from 'pinia'
import { ref } from 'vue'
import { listen } from '@tauri-apps/api/event'

export interface TransferTask {
  id: string
  type: 'upload' | 'download'
  fileName: string
  localPath: string
  remotePath: string
  connectionId: string
  totalBytes: number
  transferredBytes: number
  speed: number // bytes per second
  status: 'pending' | 'transferring' | 'completed' | 'error' | 'paused'
  error?: string
  startTime?: number
  endTime?: number
}

export const useTransferStore = defineStore('transfer', () => {
  const tasks = ref<Map<string, TransferTask>>(new Map())
  const history = ref<TransferTask[]>([])

  // 监听传输进度事件
  let listenersSetup = false
  let progressThrottleTimer: ReturnType<typeof setTimeout> | null = null
  let pendingProgressUpdates = false

  function flushProgressUpdates() {
    if (pendingProgressUpdates) {
      tasks.value = new Map(tasks.value)
      pendingProgressUpdates = false
    }
    progressThrottleTimer = null
  }

  async function setupListeners() {
    if (listenersSetup) return
    listenersSetup = true

    // 传输进度
    await listen<{ id: string; transferred: number; total: number; speed: number }>(
      'transfer://progress',
      (event) => {
        const { id, transferred, total, speed } = event.payload
        const task = tasks.value.get(id)
        if (task) {
          task.transferredBytes = transferred
          task.totalBytes = total
          task.speed = speed
          task.status = 'transferring'
          // 节流：最多每 200ms 触发一次响应式更新
          pendingProgressUpdates = true
          if (!progressThrottleTimer) {
            progressThrottleTimer = setTimeout(flushProgressUpdates, 200)
          }
        }
      },
    )

    // 传输完成
    await listen<{ id: string }>(
      'transfer://complete',
      (event) => {
        const task = tasks.value.get(event.payload.id)
        if (task) {
          task.status = 'completed'
          task.endTime = Date.now()
          // 移到历史记录
          history.value.unshift({ ...task })
          if (history.value.length > 100) {
            history.value = history.value.slice(0, 100)
          }
          // 触发响应式更新
          tasks.value = new Map(tasks.value)
          // 3秒后从活动列表移除
          setTimeout(() => {
            tasks.value.delete(event.payload.id)
            tasks.value = new Map(tasks.value)
          }, 3000)
        }
      },
    )

    // 传输错误
    await listen<{ id: string; error: string }>(
      'transfer://error',
      (event) => {
        const task = tasks.value.get(event.payload.id)
        if (task) {
          task.status = 'error'
          task.error = event.payload.error
          task.endTime = Date.now()
          // 触发响应式更新
          tasks.value = new Map(tasks.value)
        }
      },
    )
  }

  function addTask(task: Omit<TransferTask, 'transferredBytes' | 'speed' | 'status'>) {
    const fullTask: TransferTask = {
      ...task,
      transferredBytes: 0,
      speed: 0,
      status: 'pending',
      startTime: Date.now(),
    }
    tasks.value.set(task.id, fullTask)
    tasks.value = new Map(tasks.value)
  }

  function removeTask(id: string) {
    tasks.value.delete(id)
    tasks.value = new Map(tasks.value)
  }

  function clearCompleted() {
    const toDelete: string[] = []
    for (const [id, task] of tasks.value.entries()) {
      if (task.status === 'completed') {
        toDelete.push(id)
      }
    }
    toDelete.forEach(id => tasks.value.delete(id))
    tasks.value = new Map(tasks.value)
  }

  function clearHistory() {
    history.value = []
  }

  return {
    tasks,
    history,
    setupListeners,
    addTask,
    removeTask,
    clearCompleted,
    clearHistory,
  }
})
