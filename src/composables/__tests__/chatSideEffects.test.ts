import { describe, expect, it } from 'vitest'
import {
  markSpawnedTaskClosed,
  markSpawnedTaskDone,
  markSpawnedTaskError,
  markSpawnedTaskRunning,
  parseSpawnedTasks,
  resetSpawnedTaskForRetry,
  syncSpawnedTaskFromTabMeta,
} from '@/composables/ai/chatSideEffects'

describe('chatSideEffects spawned tasks', () => {
  it('parses spawned tasks with scheduling metadata', () => {
    const tasks = parseSpawnedTasks('[SPAWN:run migration]\n[SPAWN:verify logs]', {
      sourceMessageId: 'assistant-1',
      now: 1000,
    })

    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toMatchObject({
      description: 'run migration',
      status: 'pending',
      createdAt: 1000,
      sourceMessageId: 'assistant-1',
      retryCount: 0,
    })
  })

  it('tracks task lifecycle timestamps and retries', () => {
    const [task] = parseSpawnedTasks('[SPAWN:build index]', { now: 1000 })

    const running = markSpawnedTaskRunning(task!, {
      now: 1200,
      taskTabId: 'tab-1',
      taskSessionId: 'session-task-1',
    })
    expect(running).toMatchObject({
      status: 'running',
      startedAt: 1200,
      taskTabId: 'tab-1',
      taskSessionId: 'session-task-1',
      retryCount: 0,
    })

    const failed = markSpawnedTaskError(running, 'worker crashed', 1700)
    expect(failed).toMatchObject({
      status: 'error',
      finishedAt: 1700,
      durationMs: 500,
      lastError: 'worker crashed',
    })

    const retry = resetSpawnedTaskForRetry(failed, 1800)
    expect(retry).toMatchObject({
      status: 'pending',
      startedAt: undefined,
      finishedAt: undefined,
      durationMs: undefined,
      lastError: undefined,
      lastSummary: undefined,
      retryCount: 1,
    })

    const done = markSpawnedTaskDone(markSpawnedTaskRunning(retry, { now: 2000 }), 2600)
    expect(done).toMatchObject({
      status: 'done',
      startedAt: 2000,
      finishedAt: 2600,
      durationMs: 600,
    })
  })

  it('syncs running tasks from child task tab meta', () => {
    const [task] = parseSpawnedTasks('[SPAWN:build index]', { now: 1000 })
    const running = markSpawnedTaskRunning(task!, { now: 1200, taskTabId: 'tab-1' })

    const withSummary = syncSpawnedTaskFromTabMeta(running, {
      taskSummary: 'Finished rebuilding indexes',
    })
    expect(withSummary).toMatchObject({
      status: 'running',
      lastSummary: 'Finished rebuilding indexes',
    })

    const failed = syncSpawnedTaskFromTabMeta(running, {
      taskStatus: 'error',
      taskError: 'child task failed',
      taskSummary: 'Failed while rebuilding indexes',
    })
    expect(failed).toMatchObject({
      status: 'error',
      lastError: 'child task failed',
      lastSummary: 'Failed while rebuilding indexes',
    })

    const completed = syncSpawnedTaskFromTabMeta(running, {
      taskStatus: 'done',
      taskSummary: 'Indexes rebuilt successfully',
    })
    expect(completed.status).toBe('done')
    expect(completed.durationMs).toBeGreaterThanOrEqual(0)
    expect(completed.lastSummary).toBe('Indexes rebuilt successfully')
  })

  it('marks running tasks as closed errors while preserving summary', () => {
    const [task] = parseSpawnedTasks('[SPAWN:build index]', { now: 1000 })
    const running = markSpawnedTaskRunning({
      ...task!,
      lastSummary: 'Partial output',
    }, { now: 1200, taskTabId: 'tab-1' })

    const closed = markSpawnedTaskClosed(running, 'Task tab was closed', 1800)
    expect(closed).toMatchObject({
      status: 'error',
      lastError: 'Task tab was closed',
      lastSummary: 'Partial output',
      finishedAt: 1800,
      durationMs: 600,
    })
  })
})
