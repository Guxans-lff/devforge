/**
 * Proactive Tick Store
 *
 * 管理主动任务列表，支持 tick 调度、暂停/恢复、用户输入时自动暂停。
 */
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { AiProactiveTask } from '@/types/ai'
import { createLogger } from '@/utils/logger'

const log = createLogger('ai.proactive')

export const useProactiveTickStore = defineStore('proactive-tick', () => {
  const tasks = ref<AiProactiveTask[]>([])
  const isPausedGlobally = ref(false)
  let tickTimer: ReturnType<typeof setTimeout> | null = null

  const activeTasks = computed(() =>
    tasks.value.filter(t => t.status === 'running' || t.status === 'waiting'),
  )

  const hasRunningTasks = computed(() =>
    tasks.value.some(t => t.status === 'running'),
  )

  function generateId(): string {
    return `proactive-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  }

  /** 创建并启动一个主动任务 */
  function startTask(params: {
    sessionId: string
    objective: string
    tickIntervalMs?: number
    maxTicks?: number
    allowedTools?: string[]
    stopConditions?: string[]
  }): AiProactiveTask {
    const now = Date.now()
    const task: AiProactiveTask = {
      id: generateId(),
      sessionId: params.sessionId,
      objective: params.objective,
      tickIntervalMs: params.tickIntervalMs ?? 5000,
      maxTicks: params.maxTicks ?? 60,
      tickCount: 0,
      nextTickAt: now,
      allowedTools: params.allowedTools ?? [],
      stopConditions: params.stopConditions ?? [],
      status: 'running',
      createdAt: now,
      updatedAt: now,
    }
    tasks.value = [task, ...tasks.value]
    log.info('proactive_task_started', { taskId: task.id, objective: task.objective })
    scheduleTick()
    return task
  }

  /** 暂停任务 */
  function pauseTask(taskId: string): void {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task || task.status !== 'running') return
    task.status = 'paused'
    task.updatedAt = Date.now()
    log.info('proactive_task_paused', { taskId })
  }

  /** 恢复任务 */
  function resumeTask(taskId: string): void {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task || task.status !== 'paused') return
    task.status = 'running'
    task.nextTickAt = Date.now()
    task.updatedAt = Date.now()
    log.info('proactive_task_resumed', { taskId })
    scheduleTick()
  }

  /** 停止任务 */
  function stopTask(taskId: string): void {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task) return
    task.status = 'done'
    task.updatedAt = Date.now()
    log.info('proactive_task_stopped', { taskId })
  }

  /** 标记任务失败 */
  function failTask(taskId: string, error: string): void {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task) return
    task.status = 'failed'
    task.error = error
    task.updatedAt = Date.now()
    log.warn('proactive_task_failed', { taskId, error })
  }

  /** 全局暂停（用户输入、权限弹窗、plan gate 时调用） */
  function pauseAll(): void {
    if (isPausedGlobally.value) return
    isPausedGlobally.value = true
    for (const task of tasks.value) {
      if (task.status === 'running') {
        task.status = 'paused'
        task.updatedAt = Date.now()
      }
    }
    log.info('proactive_all_paused', { count: tasks.value.filter(t => t.status === 'paused').length })
  }

  /** 全局恢复 */
  function resumeAll(): void {
    if (!isPausedGlobally.value) return
    isPausedGlobally.value = false
    for (const task of tasks.value) {
      if (task.status === 'paused') {
        task.status = 'running'
        task.nextTickAt = Date.now()
        task.updatedAt = Date.now()
      }
    }
    log.info('proactive_all_resumed', { count: tasks.value.filter(t => t.status === 'running').length })
    scheduleTick()
  }

  /** 删除任务 */
  function removeTask(taskId: string): void {
    tasks.value = tasks.value.filter(t => t.id !== taskId)
  }

  /** 清空已完成/失败的任务 */
  function clearCompleted(): void {
    tasks.value = tasks.value.filter(t => t.status === 'running' || t.status === 'paused' || t.status === 'waiting')
  }

  /** 执行一次 tick */
  async function executeTick(task: AiProactiveTask): Promise<void> {
    if (task.status !== 'running' || isPausedGlobally.value) return

    task.tickCount++
    task.status = 'running'
    task.updatedAt = Date.now()

    // MVP：简单的 tick 逻辑，检查 stopConditions 或 maxTicks
    // 实际场景中这里会调用工具、检查文件、查询后台 job 等
    try {
      // 模拟检查逻辑：如果 tickCount 达到 maxTicks，自动停止
      if (task.tickCount >= task.maxTicks) {
        task.status = 'done'
        task.lastTickSummary = `达到最大 tick 次数（${task.maxTicks}），任务自动结束。`
        log.info('proactive_task_done_max_ticks', { taskId: task.id })
        return
      }

      // TODO: 实际 tick 逻辑（检查后台 job、轮询文件、调用工具等）
      task.lastTickSummary = `第 ${task.tickCount} 次检查完成，目标：${task.objective}`
      task.nextTickAt = Date.now() + task.tickIntervalMs
    } catch (e) {
      task.status = 'failed'
      task.error = e instanceof Error ? e.message : String(e)
      log.warn('proactive_tick_error', { taskId: task.id }, e)
    }
  }

  /** 调度下一次 tick */
  function scheduleTick(): void {
    if (tickTimer) {
      clearTimeout(tickTimer)
      tickTimer = null
    }

    const running = tasks.value.filter(t => t.status === 'running')
    if (running.length === 0 || isPausedGlobally.value) return

    // 找到最近的 nextTickAt
    const now = Date.now()
    const nextTick = Math.min(...running.map(t => t.nextTickAt))
    const delay = Math.max(0, nextTick - now)

    tickTimer = setTimeout(() => {
      tickTimer = null
      const dueTasks = tasks.value.filter(t => t.status === 'running' && t.nextTickAt <= Date.now())
      for (const task of dueTasks) {
        void executeTick(task)
      }
      // 继续调度
      scheduleTick()
    }, delay)
  }

  return {
    tasks,
    activeTasks,
    hasRunningTasks,
    isPausedGlobally,
    startTask,
    pauseTask,
    resumeTask,
    stopTask,
    failTask,
    pauseAll,
    resumeAll,
    removeTask,
    clearCompleted,
    executeTick,
  }
})
