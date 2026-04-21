import { describe, expect, it } from 'vitest'
import {
  analyzeSpawnedTasks,
  markSpawnedTaskClosed,
  markSpawnedTaskCancelled,
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

  it('parses explicit aliases and dependencies while keeping legacy spawn syntax compatible', () => {
    const tasks = parseSpawnedTasks([
      '[SPAWN:#setup: prepare workspace]',
      '[SPAWN:#verify depends=setup: verify workspace]',
      '[SPAWN:legacy task]',
    ].join('\n'), {
      sourceMessageId: 'assistant-2',
      now: 2000,
    })

    expect(tasks).toHaveLength(3)
    expect(tasks[0]).toMatchObject({
      description: 'prepare workspace',
      spawnAlias: 'setup',
      dependsOn: [],
    })
    expect(tasks[1]).toMatchObject({
      description: 'verify workspace',
      spawnAlias: 'verify',
      dependsOn: [tasks[0]!.id],
    })
    expect(tasks[2]).toMatchObject({
      description: 'legacy task',
      spawnAlias: undefined,
      dependsOn: [],
    })
  })

  it('analyzes source groups and display dependencies for spawned tasks', () => {
    const tasks = parseSpawnedTasks([
      '[SPAWN:#setup: prepare workspace]',
      '[SPAWN:#verify depends=setup: verify workspace]',
      '[SPAWN:legacy task]',
    ].join('\n'), {
      sourceMessageId: 'assistant-2',
      now: 2000,
    })
    const analysis = analyzeSpawnedTasks(tasks)

    expect(analysis.sourceGroups).toHaveLength(1)
    expect(analysis.sourceGroups[0]).toMatchObject({
      key: 'source:assistant-2',
      sourceMessageId: 'assistant-2',
      sourceGroupNumber: 1,
    })
    expect(analysis.relations.get(tasks[0]!.id)).toMatchObject({
      sourceTaskIndex: 1,
      explicitDependencyIds: [],
      displayDependencyIds: [],
    })
    expect(analysis.relations.get(tasks[1]!.id)).toMatchObject({
      sourceTaskIndex: 2,
      explicitDependencyIds: [tasks[0]!.id],
      displayDependencyIds: [tasks[0]!.id],
      displayDependencyDescriptions: ['prepare workspace'],
    })
    expect(analysis.relations.get(tasks[2]!.id)).toMatchObject({
      sourceTaskIndex: 3,
      explicitDependencyIds: [],
      displayDependencyIds: [tasks[1]!.id],
      displayDependencyDescriptions: ['verify workspace'],
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

    const cancelled = syncSpawnedTaskFromTabMeta(running, {
      taskStatus: 'cancelled',
      taskError: 'Task cancelled by user',
      taskSummary: 'Stopped after collecting partial data',
    })
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      lastError: 'Task cancelled by user',
      lastSummary: 'Stopped after collecting partial data',
    })
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

  it('marks running tasks as cancelled while preserving summary', () => {
    const [task] = parseSpawnedTasks('[SPAWN:build index]', { now: 1000 })
    const running = markSpawnedTaskRunning({
      ...task!,
      lastSummary: 'Partial output',
    }, { now: 1200, taskTabId: 'tab-1' })

    const cancelled = markSpawnedTaskCancelled(running, 'Task cancelled', 1800)
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      lastError: 'Task cancelled',
      lastSummary: 'Partial output',
      finishedAt: 1800,
      durationMs: 600,
    })
  })
})
