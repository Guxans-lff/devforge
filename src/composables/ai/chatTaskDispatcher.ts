import {
  markSpawnedTaskCancelled,
  markSpawnedTaskDone,
  markSpawnedTaskError,
  markSpawnedTaskRunning,
  normalizeSpawnedTask,
  resetSpawnedTaskForRetry,
  type SpawnedTask,
  type TaskDispatchStatus,
  type TaskExecutionMode,
  type TaskPriority,
} from './chatSideEffects'

export interface DispatchTaskExecutionResult {
  status: 'done' | 'error' | 'cancelled'
  summary?: string
  error?: string
  sessionId?: string
  taskTabId?: string
  startedAt: number
  finishedAt: number
  retryable?: boolean
}

export interface DispatchTaskExecutor {
  mode: TaskExecutionMode
  prepare?: (task: SpawnedTask) => Partial<SpawnedTask>
  run: (task: SpawnedTask) => Promise<DispatchTaskExecutionResult>
  cancel?: (task: SpawnedTask, reason: string) => Promise<void> | void
}

export interface DispatcherRuntimeEvent {
  type:
    | 'blocked'
    | 'ready'
    | 'started'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'retried'
  taskId: string
  message: string
}

export interface ChatTaskDispatcherOptions {
  getTasks: () => SpawnedTask[]
  setTasks: (tasks: SpawnedTask[]) => void
  executors: Record<TaskExecutionMode, DispatchTaskExecutor>
  maxParallel?: number | (() => number)
  autoRetryCount?: number | (() => number)
  defaultExecutionMode?: TaskExecutionMode | (() => TaskExecutionMode)
  onEvent?: (event: DispatcherRuntimeEvent) => void
}

interface DispatchStats {
  running: number
  ready: number
  queued: number
  blocked: number
  done: number
  error: number
  cancelled: number
  runnable: number
}

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
}

const RETRYABLE_ERROR_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /network/i,
  /connection reset/i,
  /temporarily unavailable/i,
  /rate limit/i,
  /429/,
]

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function replaceTask(tasks: SpawnedTask[], nextTask: SpawnedTask): SpawnedTask[] {
  return tasks.map(task => task.id === nextTask.id ? nextTask : task)
}

function countByDispatchStatus(tasks: SpawnedTask[], status: TaskDispatchStatus): number {
  return tasks.filter(task => normalizeSpawnedTask(task).dispatchStatus === status).length
}

function resolveOption<T>(value: T | (() => T) | undefined, fallback: T): T {
  if (typeof value === 'function') return (value as () => T)()
  return value ?? fallback
}

function isRetryableFailure(result: DispatchTaskExecutionResult): boolean {
  if (!result.retryable) return false
  if (result.status !== 'error') return false
  const errorMessage = result.error
  if (!errorMessage) return false
  return RETRYABLE_ERROR_PATTERNS.some(pattern => pattern.test(errorMessage))
}

export function classifyDispatchStatus(task: SpawnedTask, allTasks: SpawnedTask[]): TaskDispatchStatus {
  const normalized = normalizeSpawnedTask(task)
  if (normalized.status === 'running') return 'running'
  if (normalized.status === 'done') return 'done'
  if (normalized.status === 'error') return 'error'
  if (normalized.status === 'cancelled') return 'cancelled'

  const dependsOn = normalized.dependsOn ?? []
  if (dependsOn.length === 0) return 'ready'

  const missingDependency = dependsOn.some(dependencyId => !allTasks.some(candidate => candidate.id === dependencyId))
  if (missingDependency) return 'blocked'

  const unresolvedDependency = dependsOn.some((dependencyId) => {
    const dependency = allTasks.find(candidate => candidate.id === dependencyId)
    return dependency?.status !== 'done'
  })
  return unresolvedDependency ? 'queued' : 'ready'
}

export function reconcileSpawnedTasks(
  tasks: SpawnedTask[],
  defaults?: {
    defaultExecutionMode?: TaskExecutionMode
    autoRetryCount?: number
  },
): SpawnedTask[] {
  return tasks.map(task => {
    const normalized = normalizeSpawnedTask(task, {
      executionMode: defaults?.defaultExecutionMode,
      autoRetryBudget: defaults?.autoRetryCount,
    })
    const dispatchStatus = classifyDispatchStatus(normalized, tasks)
    return {
      ...normalized,
      dispatchStatus,
      executionMode: normalized.executionMode ?? defaults?.defaultExecutionMode ?? 'headless',
      autoRetryBudget: normalized.autoRetryBudget ?? defaults?.autoRetryCount ?? 1,
    }
  })
}

export function createChatTaskDispatcher(options: ChatTaskDispatcherOptions) {
  const runningTasks = new Set<string>()
  const cancelledTasks = new Set<string>()

  function resolveMaxParallel(): number {
    return Math.max(1, resolveOption(options.maxParallel, 3))
  }

  function resolveAutoRetryCount(): number {
    return Math.max(0, resolveOption(options.autoRetryCount, 1))
  }

  function resolveDefaultExecutionMode(): TaskExecutionMode {
    return resolveOption(options.defaultExecutionMode, 'headless')
  }

  function snapshot(): SpawnedTask[] {
    return reconcileSpawnedTasks(options.getTasks(), {
      defaultExecutionMode: resolveDefaultExecutionMode(),
      autoRetryCount: resolveAutoRetryCount(),
    })
  }

  function writeTasks(tasks: SpawnedTask[]): SpawnedTask[] {
    const reconciled = reconcileSpawnedTasks(tasks, {
      defaultExecutionMode: resolveDefaultExecutionMode(),
      autoRetryCount: resolveAutoRetryCount(),
    })
    options.setTasks(reconciled)
    return reconciled
  }

  function emit(event: DispatcherRuntimeEvent): void {
    options.onEvent?.(event)
  }

  function getStats(): DispatchStats {
    const tasks = snapshot()
    return {
      running: countByDispatchStatus(tasks, 'running'),
      ready: countByDispatchStatus(tasks, 'ready'),
      queued: countByDispatchStatus(tasks, 'queued'),
      blocked: countByDispatchStatus(tasks, 'blocked'),
      done: countByDispatchStatus(tasks, 'done'),
      error: countByDispatchStatus(tasks, 'error'),
      cancelled: countByDispatchStatus(tasks, 'cancelled'),
      runnable: tasks.filter(task => task.dispatchStatus === 'ready').length,
    }
  }

  function enqueue(tasks: SpawnedTask[]): SpawnedTask[] {
    const current = options.getTasks()
    const currentIds = new Set(current.map(task => task.id))
    const incoming = tasks.filter(task => !currentIds.has(task.id))
    const next = writeTasks([...current, ...incoming])

    for (const task of next.filter(candidate => incoming.some(incomingTask => incomingTask.id === candidate.id))) {
      if (task.dispatchStatus === 'blocked') {
        const missing = (task.dependsOn ?? []).filter(dependencyId =>
          !next.some(candidate => candidate.id === dependencyId),
        )
        if (missing.length > 0) {
          emit({
            type: 'blocked',
            taskId: task.id,
            message: `Task "${task.description}" is blocked by missing dependencies: ${missing.join(', ')}`,
          })
        }
      }
      if (task.dispatchStatus === 'ready') {
        emit({
          type: 'ready',
          taskId: task.id,
          message: `Task "${task.description}" is ready to run.`,
        })
      }
    }

    return next
  }

  function updateTask(taskId: string, updater: (task: SpawnedTask) => SpawnedTask): SpawnedTask | null {
    const tasks = snapshot()
    const current = tasks.find(task => task.id === taskId)
    if (!current) return null
    const updated = updater(current)
    writeTasks(replaceTask(tasks, updated))
    return updated
  }

  async function cancelTask(taskId: string, reason: string): Promise<SpawnedTask | null> {
    cancelledTasks.add(taskId)
    runningTasks.delete(taskId)
    const current = snapshot().find(task => task.id === taskId)
    if (current?.dispatchStatus === 'running') {
      const executor = options.executors[current.executionMode ?? resolveDefaultExecutionMode()]
      await executor?.cancel?.(current, reason)
    }
    const cancelled = updateTask(taskId, task => markSpawnedTaskCancelled(task, reason))
    if (cancelled) {
      emit({
        type: 'cancelled',
        taskId,
        message: `Task "${cancelled.description}" was cancelled.`,
      })
      await drain()
    }
    return cancelled
  }

  async function runTask(taskId: string, optionsOverride?: { startedByDispatcher?: boolean }): Promise<void> {
    const task = snapshot().find(item => item.id === taskId)
    if (!task) return
    if (runningTasks.has(taskId)) return
    if (task.dispatchStatus !== 'ready') return
    if (runningTasks.size >= resolveMaxParallel()) return

    const executor = options.executors[task.executionMode ?? resolveDefaultExecutionMode()]
    if (!executor) return

    runningTasks.add(taskId)
    cancelledTasks.delete(taskId)
    const preparedPatch = executor.prepare?.(task) ?? {}

    const started = updateTask(taskId, current => markSpawnedTaskRunning({
      ...current,
      ...preparedPatch,
    }, {
      taskTabId: preparedPatch.taskTabId ?? current.taskTabId,
      taskSessionId: preparedPatch.taskSessionId ?? current.taskSessionId,
      startedByDispatcher: optionsOverride?.startedByDispatcher ?? true,
    }))
    if (!started) {
      runningTasks.delete(taskId)
      return
    }

    emit({
      type: 'started',
      taskId,
      message: `Task "${started.description}" started in ${started.executionMode} mode.`,
    })

    try {
      const result = await executor.run(started)
      runningTasks.delete(taskId)

      if (cancelledTasks.has(taskId) || result.status === 'cancelled') {
        updateTask(taskId, current => markSpawnedTaskCancelled({
          ...current,
          lastSummary: result.summary ?? current.lastSummary,
          resultSummary: result.summary ?? current.resultSummary ?? current.lastSummary,
          lastError: result.error ?? current.lastError,
          resultSessionId: result.sessionId ?? current.resultSessionId,
          taskTabId: result.taskTabId ?? current.taskTabId,
          taskSessionId: result.sessionId ?? current.taskSessionId,
        }, result.error ?? currentTaskCancelReason(current)))
        emit({
          type: 'cancelled',
          taskId,
          message: `Task "${started.description}" was cancelled.`,
        })
        await drain()
        return
      }

      if (result.status === 'done') {
        updateTask(taskId, current => markSpawnedTaskDone({
          ...current,
          lastSummary: result.summary ?? current.lastSummary,
          resultSummary: result.summary ?? current.resultSummary ?? current.lastSummary,
          resultSessionId: result.sessionId ?? current.resultSessionId,
          taskSessionId: result.sessionId ?? current.taskSessionId,
          taskTabId: result.taskTabId ?? current.taskTabId,
        }, result.finishedAt))
        emit({
          type: 'completed',
          taskId,
          message: `Task "${started.description}" completed.`,
        })
        await drain()
        return
      }

      const currentTask = snapshot().find(item => item.id === taskId)
      if (!currentTask) {
        await drain()
        return
      }

      const failedTask = markSpawnedTaskError({
        ...currentTask,
        lastSummary: result.summary ?? currentTask.lastSummary,
        resultSummary: result.summary ?? currentTask.resultSummary ?? currentTask.lastSummary,
        resultSessionId: result.sessionId ?? currentTask.resultSessionId,
        taskSessionId: result.sessionId ?? currentTask.taskSessionId,
        taskTabId: result.taskTabId ?? currentTask.taskTabId,
      }, result.error ?? 'Task failed', result.finishedAt)
      writeTasks(replaceTask(snapshot(), failedTask))

      if (isRetryableFailure(result) && (failedTask.retryCount < (failedTask.autoRetryBudget ?? resolveAutoRetryCount()))) {
        emit({
          type: 'retried',
          taskId,
          message: `Task "${failedTask.description}" failed and will retry automatically.`,
        })
        await sleep(1500)
        const reset = updateTask(taskId, current => resetSpawnedTaskForRetry(current))
        if (reset) {
          await drain()
        }
        return
      }

      emit({
        type: 'failed',
        taskId,
        message: `Task "${failedTask.description}" failed: ${failedTask.lastError ?? 'Unknown error'}`,
      })
      await drain()
    } catch (error) {
      runningTasks.delete(taskId)
      const err = error instanceof Error ? error.message : String(error)
      updateTask(taskId, current => markSpawnedTaskError(current, err))
      emit({
        type: 'failed',
        taskId,
        message: `Task "${task.description}" failed: ${err}`,
      })
      await drain()
    }
  }

  async function runReadyTasks(taskIds?: string[]): Promise<void> {
    const tasks = snapshot()
    const candidates = tasks
      .filter(task => task.dispatchStatus === 'ready')
      .filter(task => !taskIds || taskIds.includes(task.id))
      .sort((left, right) => {
        const priorityDiff = PRIORITY_WEIGHT[left.priority ?? 'normal'] - PRIORITY_WEIGHT[right.priority ?? 'normal']
        if (priorityDiff !== 0) return priorityDiff
        return left.createdAt - right.createdAt
      })

    const slots = Math.max(0, resolveMaxParallel() - runningTasks.size)
    await Promise.all(candidates.slice(0, slots).map(task => runTask(task.id, { startedByDispatcher: true })))
  }

  async function drain(): Promise<void> {
    await runReadyTasks()
  }

  function syncTasks(tasks: SpawnedTask[]): SpawnedTask[] {
    return writeTasks(tasks)
  }

  return {
    enqueue,
    syncTasks,
    runTask,
    runReadyTasks,
    cancelTask,
    drain,
    snapshot,
    getStats,
  }
}

function currentTaskCancelReason(task: SpawnedTask): string {
  return task.lastError ?? 'Task cancelled'
}
