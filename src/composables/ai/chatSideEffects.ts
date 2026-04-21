import { aiUpdateJournalSection } from '@/api/ai'
import type { Logger } from '@/utils/logger'
import { genId } from './chatHelpers'

export interface SpawnedTask {
  id: string
  description: string
  status: 'pending' | 'running' | 'done' | 'error'
  createdAt: number
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  lastError?: string
  lastSummary?: string
  sourceMessageId?: string
  taskTabId?: string
  taskSessionId?: string
  retryCount: number
}

export function parseAndWriteJournalSections(text: string, workDirPath: string, log: Logger): void {
  const regex = /<!-- @@@journal:(\S+) -->([\s\S]*?)<!-- @@@end:journal:\1 -->/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const marker = match[1]!
    const content = match[2]!.trim()
    aiUpdateJournalSection(workDirPath, marker, content)
      .catch(error => log.warn('journal_write_failed', { marker }, error))
  }
}

export function parseSpawnedTasks(text: string, options?: { sourceMessageId?: string; now?: number }): SpawnedTask[] {
  const regex = /\[SPAWN:([^\]]+)\]/g
  const tasks: SpawnedTask[] = []
  const createdAt = options?.now ?? Date.now()
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    tasks.push({
      id: genId(),
      description: match[1]!.trim(),
      status: 'pending',
      createdAt,
      sourceMessageId: options?.sourceMessageId,
      retryCount: 0,
    })
  }

  return tasks
}

export function markSpawnedTaskRunning(
  task: SpawnedTask,
  options?: { now?: number; taskTabId?: string; taskSessionId?: string },
): SpawnedTask {
  const now = options?.now ?? Date.now()
  return {
    ...task,
    status: 'running',
    startedAt: now,
    finishedAt: undefined,
    durationMs: undefined,
    lastError: undefined,
    taskTabId: options?.taskTabId ?? task.taskTabId,
    taskSessionId: options?.taskSessionId ?? task.taskSessionId,
  }
}

export function markSpawnedTaskDone(task: SpawnedTask, now = Date.now()): SpawnedTask {
  const startedAt = task.startedAt ?? now
  return {
    ...task,
    status: 'done',
    startedAt,
    finishedAt: now,
    durationMs: Math.max(0, now - startedAt),
    lastError: undefined,
    lastSummary: task.lastSummary,
  }
}

export function markSpawnedTaskError(task: SpawnedTask, error: string, now = Date.now()): SpawnedTask {
  const startedAt = task.startedAt ?? now
  return {
    ...task,
    status: 'error',
    startedAt,
    finishedAt: now,
    durationMs: Math.max(0, now - startedAt),
    lastError: error,
    lastSummary: task.lastSummary,
  }
}

export function resetSpawnedTaskForRetry(task: SpawnedTask, now = Date.now()): SpawnedTask {
  return {
    ...task,
    status: 'pending',
    createdAt: task.createdAt || now,
    startedAt: undefined,
    finishedAt: undefined,
    durationMs: undefined,
    lastError: undefined,
    lastSummary: undefined,
    taskTabId: undefined,
    taskSessionId: undefined,
    retryCount: task.retryCount + 1,
  }
}

export function syncSpawnedTaskFromTabMeta(
  task: SpawnedTask,
  tabMeta?: Record<string, unknown>,
): SpawnedTask {
  if (task.status !== 'running') return task
  const withSummary = tabMeta?.taskSummary
    ? { ...task, lastSummary: String(tabMeta.taskSummary) }
    : task
  const taskStatus = tabMeta?.taskStatus
  if (taskStatus === 'done') {
    return markSpawnedTaskDone(withSummary)
  }
  if (taskStatus === 'error') {
    return markSpawnedTaskError(withSummary, String(tabMeta?.taskError || 'Task failed'))
  }
  return withSummary
}

export function markSpawnedTaskClosed(task: SpawnedTask, error: string, now = Date.now()): SpawnedTask {
  return markSpawnedTaskError(task, error, now)
}
