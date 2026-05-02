import {
  markSpawnedTaskClosed,
  markSpawnedTaskDone,
  resetSpawnedTaskForRetry,
  syncSpawnedTaskFromTabMeta,
  type SpawnedTask,
} from '@/composables/ai/chatSideEffects'

export interface SpawnedTaskRuntimeIds {
  taskTabId: string
  taskSessionId: string
}

export interface SpawnedTaskTabSpec extends SpawnedTaskRuntimeIds {
  title: string
  meta: {
    sessionId: string
    initialMessage: string
    sourceTaskId: string
    taskExecutionMode: 'tab'
    taskAutoStarted: true
    isolationWorkDir?: string
    workDir?: string
  }
}

export interface SpawnedTaskAutoStartSpec {
  shouldStart: boolean
  initialMessage: string
  isolationWorkDir: string
}

function normalizeWorkspacePath(path?: string | null): string {
  return (path ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
}

export function resolveSpawnedTaskRuntimeIds(task: SpawnedTask, now = Date.now()): SpawnedTaskRuntimeIds {
  return {
    taskTabId: task.taskTabId ?? `ai-task-${task.id}-${now}`,
    taskSessionId: task.taskSessionId ?? `session-task-${task.id}-${now}`,
  }
}

export function buildSpawnedTaskTabSpec(task: SpawnedTask, now = Date.now()): SpawnedTaskTabSpec {
  const runtime = resolveSpawnedTaskRuntimeIds(task, now)
  const isolationWorkDir = normalizeWorkspacePath(task.isolationWorkDir)
  return {
    ...runtime,
    title: `[Task] ${task.description.slice(0, 20)}`,
    meta: {
      sessionId: runtime.taskSessionId,
      initialMessage: task.description,
      sourceTaskId: task.id,
      taskExecutionMode: 'tab',
      taskAutoStarted: true,
      isolationWorkDir: isolationWorkDir || undefined,
      workDir: isolationWorkDir || undefined,
    },
  }
}

export function buildSpawnedTaskAutoStartSpec(meta?: Record<string, unknown>): SpawnedTaskAutoStartSpec {
  const initialMessage = typeof meta?.initialMessage === 'string'
    ? meta.initialMessage.trim()
    : ''
  const isolationWorkDir = typeof meta?.isolationWorkDir === 'string'
    ? normalizeWorkspacePath(meta.isolationWorkDir)
    : ''

  return {
    shouldStart: meta?.taskAutoStarted === true && initialMessage.length > 0,
    initialMessage,
    isolationWorkDir,
  }
}

export function resolveHeadlessSpawnedTaskWorkDir(task: SpawnedTask, fallbackWorkDir: string): string {
  return normalizeWorkspacePath(task.isolationWorkDir) || fallbackWorkDir
}

export function selectReadySpawnedTasks(tasks: SpawnedTask[], taskIds?: string[]): SpawnedTask[] {
  return tasks
    .filter(task => task.dispatchStatus === 'ready')
    .filter(task => !taskIds || taskIds.includes(task.id))
}

export async function prepareSpawnedTasksForRun(
  tasks: SpawnedTask[],
  ensureReady: (task: SpawnedTask) => Promise<boolean>,
): Promise<string[]> {
  const preparedTaskIds: string[] = []
  for (const task of tasks) {
    if (await ensureReady(task)) {
      preparedTaskIds.push(task.id)
    }
  }
  return preparedTaskIds
}

export interface SpawnedTaskMutationResult {
  tasks: SpawnedTask[]
  task: SpawnedTask | null
}

export interface SpawnedTaskCancelTabMeta extends Record<string, unknown> {
  taskCancelRequested: true
  taskStatus: 'cancelled'
  taskError: string
  taskSummary?: string
}

export interface SpawnedTaskTabSnapshot {
  id: string
  sessionId?: unknown
  taskStatus?: unknown
  taskError?: unknown
  taskSummary?: unknown
}

export interface SpawnedTaskTabCompletion {
  taskId: string
  status: 'done' | 'error' | 'cancelled'
  error?: string
  summary?: string
  sessionId?: string
  taskTabId?: string
  startedAt: number
  finishedAt: number
}

export interface SpawnedTaskTabSyncResult {
  task: SpawnedTask
  completion?: SpawnedTaskTabCompletion
}

function updateSpawnedTaskById(
  tasks: SpawnedTask[],
  taskId: string,
  updater: (task: SpawnedTask) => SpawnedTask,
): SpawnedTaskMutationResult {
  let updatedTask: SpawnedTask | null = null
  const nextTasks = tasks.map((task) => {
    if (task.id !== taskId) return task
    updatedTask = updater(task)
    return updatedTask
  })
  return { tasks: nextTasks, task: updatedTask }
}

export function markSpawnedTaskForRetry(
  tasks: SpawnedTask[],
  taskId: string,
): SpawnedTaskMutationResult {
  return updateSpawnedTaskById(tasks, taskId, task => resetSpawnedTaskForRetry(task))
}

export function markSpawnedTaskCompleted(
  tasks: SpawnedTask[],
  taskId: string,
): SpawnedTaskMutationResult {
  return updateSpawnedTaskById(tasks, taskId, task => markSpawnedTaskDone(task))
}

export function buildSpawnedTaskCancelTabMeta(
  task: SpawnedTask,
  cancelMessage: string,
): SpawnedTaskCancelTabMeta {
  return {
    taskCancelRequested: true,
    taskStatus: 'cancelled',
    taskError: cancelMessage,
    taskSummary: task.lastSummary,
  }
}

function isTerminalTaskStatus(status: unknown): status is 'done' | 'error' | 'cancelled' {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

export function syncRunningSpawnedTaskFromTab(
  task: SpawnedTask,
  tab: SpawnedTaskTabSnapshot | undefined,
  messages: {
    taskClosed: string
    taskFailed: string
  },
  now = Date.now(),
): SpawnedTaskTabSyncResult {
  if (task.status !== 'running' || !task.taskTabId) {
    return { task }
  }

  if (!tab) {
    const closedTask = markSpawnedTaskClosed(task, messages.taskClosed, now)
    return {
      task: closedTask,
      completion: {
        taskId: task.id,
        status: 'error',
        error: messages.taskClosed,
        summary: task.lastSummary,
        sessionId: task.taskSessionId,
        taskTabId: task.taskTabId,
        startedAt: task.startedAt ?? now,
        finishedAt: now,
      },
    }
  }

  const syncedTask = syncSpawnedTaskFromTabMeta(task, {
    taskStatus: tab.taskStatus,
    taskError: tab.taskError || messages.taskFailed,
    taskSummary: tab.taskSummary,
  })

  if (!isTerminalTaskStatus(tab.taskStatus)) {
    return { task: syncedTask }
  }

  return {
    task: syncedTask,
    completion: {
      taskId: task.id,
      status: tab.taskStatus,
      error: typeof tab.taskError === 'string' ? tab.taskError : undefined,
      summary: typeof tab.taskSummary === 'string' ? tab.taskSummary : undefined,
      sessionId: typeof tab.sessionId === 'string' ? tab.sessionId : task.taskSessionId,
      taskTabId: tab.id,
      startedAt: task.startedAt ?? now,
      finishedAt: now,
    },
  }
}
