import { defineStore } from 'pinia'
import { ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { useLogStore } from './log'
import { i18n } from '@/locales'

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
  /** 打包传输阶段：packing / uploading / extracting / completed */
  archivePhase?: string
  /** 打包传输的压缩包大小 */
  archiveSize?: number
  /** 打包传输的文件数 */
  archiveFileCount?: number
}

export const useTransferStore = defineStore('transfer', () => {
  const tasks = ref<Map<string, TransferTask>>(new Map())
  const history = ref<TransferTask[]>([])
  const logStore = useLogStore()

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

    // 后端批量入队时自动注册任务（文件夹递归上传场景）
    await listen<{
      id: string
      type: 'upload' | 'download'
      fileName: string
      localPath: string
      remotePath: string
      connectionId: string
      totalBytes: number
    }>(
      'transfer://task-added',
      (event) => {
        const p = event.payload
        if (!tasks.value.has(p.id)) {
          tasks.value.set(p.id, {
            id: p.id,
            type: p.type,
            fileName: p.fileName,
            localPath: p.localPath,
            remotePath: p.remotePath,
            connectionId: p.connectionId,
            totalBytes: p.totalBytes,
            transferredBytes: 0,
            speed: 0,
            status: 'pending',
            startTime: Date.now(),
          })
          tasks.value = new Map(tasks.value)
        }
      },
    )

    // 传输进度
    await listen<{ id: string; transferred: number; total: number; speed: number }>(
      'transfer://progress',
      (event) => {
        const { id, transferred, total, speed } = event.payload
        const task = tasks.value.get(id)
        if (task) {
          tasks.value.set(id, {
            ...task,
            transferredBytes: transferred,
            totalBytes: total,
            speed,
            status: 'transferring',
            // 打包模式：保留 archivePhase，更新为 uploading 阶段
            archivePhase: task.archivePhase ? 'uploading' : undefined,
          })
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
          // 打包模式：压缩包上传完成后还有解压步骤，不直接标记 completed
          // 等 archive-progress phase=completed 事件来最终标记
          if (task.archivePhase) {
            tasks.value.set(event.payload.id, {
              ...task,
              archivePhase: 'extracting',
              status: 'transferring',
            })
            tasks.value = new Map(tasks.value)
            return
          }

          const completed = { ...task, status: 'completed' as const, endTime: Date.now() }
          tasks.value.set(event.payload.id, completed)

          logStore.info('SFTP', (i18n.global as any).t('log.sftp.completed', { file: task.fileName }), {
            type: task.type,
            size: task.totalBytes,
            duration: Date.now() - (task.startTime || 0)
          })

          // 移到历史记录
          const next = [{ ...completed }, ...history.value]
          history.value = next.length > 100 ? next.slice(0, 100) : next
          // 触发响应式更新
          tasks.value = new Map(tasks.value)
          // 3秒后从活动列表移除（检查状态防止删除被复用的任务）
          const completedId = event.payload.id
          setTimeout(() => {
            const current = tasks.value.get(completedId)
            if (current && current.status === 'completed') {
              tasks.value.delete(completedId)
              tasks.value = new Map(tasks.value)
            }
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
          tasks.value.set(event.payload.id, {
            ...task,
            status: 'error',
            error: event.payload.error,
            endTime: Date.now(),
          })

          logStore.error('SFTP', (i18n.global as any).t('log.sftp.failed', { file: task.fileName, error: event.payload.error }), {
            error: event.payload.error,
            remotePath: task.remotePath
          })

          // 触发响应式更新
          tasks.value = new Map(tasks.value)
        }
      },
    )

    // 打包传输阶段进度
    await listen<{
      id: string
      phase: string
      totalBytes?: number
      fileCount?: number
      archiveSize?: number
      originalSize?: number
    }>(
      'transfer://archive-progress',
      (event) => {
        const { id, phase, totalBytes, fileCount, archiveSize } = event.payload
        let task = tasks.value.get(id)

        if (!task) {
          // 打包传输模式下，后端自动创建任务，前端需要补建
          task = {
            id,
            type: 'upload',
            fileName: `${fileCount ?? 0} 个文件 (打包传输)`,
            localPath: '',
            remotePath: '',
            connectionId: '',
            totalBytes: totalBytes ?? 0,
            transferredBytes: 0,
            speed: 0,
            status: 'transferring',
            startTime: Date.now(),
            archivePhase: phase,
            archiveFileCount: fileCount,
            archiveSize,
          }
          tasks.value.set(id, task)
        } else {
          tasks.value.set(id, {
            ...task,
            status: phase === 'completed' ? 'completed' : 'transferring',
            archivePhase: phase,
            archiveSize: archiveSize ?? task.archiveSize,
            archiveFileCount: fileCount ?? task.archiveFileCount,
            totalBytes: totalBytes ?? task.totalBytes,
            endTime: phase === 'completed' ? Date.now() : undefined,
          })
        }

        if (phase === 'completed') {
          const completed = tasks.value.get(id)!
          const next = [{ ...completed }, ...history.value]
          history.value = next.length > 100 ? next.slice(0, 100) : next
          setTimeout(() => {
            const current = tasks.value.get(id)
            if (current && current.status === 'completed') {
              tasks.value.delete(id)
              tasks.value = new Map(tasks.value)
            }
          }, 3000)
        }

        tasks.value = new Map(tasks.value)
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

    logStore.info('SFTP', (i18n.global as any).t('log.sftp.queueing', { type: task.type, file: task.fileName }), {
      local: task.localPath,
      remote: task.remotePath
    })

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
