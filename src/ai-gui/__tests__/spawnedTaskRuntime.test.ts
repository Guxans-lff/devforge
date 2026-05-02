import { describe, expect, it } from 'vitest'
import {
  buildSpawnedTaskAutoStartSpec,
  buildSpawnedTaskCancelTabMeta,
  buildSpawnedTaskTabSpec,
  markSpawnedTaskCompleted,
  markSpawnedTaskForRetry,
  prepareSpawnedTasksForRun,
  resolveHeadlessSpawnedTaskWorkDir,
  resolveSpawnedTaskRuntimeIds,
  selectReadySpawnedTasks,
  syncRunningSpawnedTaskFromTab,
} from '@/ai-gui/spawnedTaskRuntime'
import type { SpawnedTask } from '@/composables/ai/chatSideEffects'

function task(input: Partial<SpawnedTask> & { id: string; description: string }): SpawnedTask {
  return {
    status: 'pending',
    createdAt: 1,
    retryCount: 0,
    ...input,
  }
}

describe('spawnedTaskRuntime', () => {
  it('resolves stable tab and session ids with deterministic fallback', () => {
    expect(resolveSpawnedTaskRuntimeIds(task({ id: 'task-1', description: 'implement' }), 123)).toEqual({
      taskTabId: 'ai-task-task-1-123',
      taskSessionId: 'session-task-task-1-123',
    })
    expect(resolveSpawnedTaskRuntimeIds(task({
      id: 'task-1',
      description: 'implement',
      taskTabId: 'tab-existing',
      taskSessionId: 'session-existing',
    }), 123)).toEqual({
      taskTabId: 'tab-existing',
      taskSessionId: 'session-existing',
    })
  })

  it('builds task tab metadata and carries isolation workdir', () => {
    const spec = buildSpawnedTaskTabSpec(task({
      id: 'task-1',
      description: 'implement src/runtime.ts and update tests',
      isolationWorkDir: 'D:\\repo\\.devforge\\tmp\\agents\\task-1\\',
    }), 123)

    expect(spec).toMatchObject({
      taskTabId: 'ai-task-task-1-123',
      taskSessionId: 'session-task-task-1-123',
      title: '[Task] implement src/runtim',
      meta: {
        sessionId: 'session-task-task-1-123',
        initialMessage: 'implement src/runtime.ts and update tests',
        sourceTaskId: 'task-1',
        taskExecutionMode: 'tab',
        taskAutoStarted: true,
        isolationWorkDir: 'D:/repo/.devforge/tmp/agents/task-1',
        workDir: 'D:/repo/.devforge/tmp/agents/task-1',
      },
    })
  })

  it('extracts auto-start payload from tab meta', () => {
    expect(buildSpawnedTaskAutoStartSpec({
      taskAutoStarted: true,
      initialMessage: '  run task  ',
      isolationWorkDir: 'D:\\repo\\tmp\\',
    })).toEqual({
      shouldStart: true,
      initialMessage: 'run task',
      isolationWorkDir: 'D:/repo/tmp',
    })

    expect(buildSpawnedTaskAutoStartSpec({
      taskAutoStarted: true,
      initialMessage: '   ',
    })).toEqual({
      shouldStart: false,
      initialMessage: '',
      isolationWorkDir: '',
    })
  })

  it('prefers isolation workdir for headless tasks', () => {
    expect(resolveHeadlessSpawnedTaskWorkDir(task({
      id: 'task-1',
      description: 'implement',
      isolationWorkDir: 'D:\\repo\\iso\\',
    }), 'D:/repo')).toBe('D:/repo/iso')
    expect(resolveHeadlessSpawnedTaskWorkDir(task({
      id: 'task-1',
      description: 'implement',
    }), 'D:/repo')).toBe('D:/repo')
  })

  it('selects ready spawned tasks by optional id filter', () => {
    const tasks = [
      task({ id: 'task-1', description: 'ready 1', dispatchStatus: 'ready' }),
      task({ id: 'task-2', description: 'running', dispatchStatus: 'running' }),
      task({ id: 'task-3', description: 'ready 3', dispatchStatus: 'ready' }),
    ]

    expect(selectReadySpawnedTasks(tasks).map(item => item.id)).toEqual(['task-1', 'task-3'])
    expect(selectReadySpawnedTasks(tasks, ['task-3', 'task-2']).map(item => item.id)).toEqual(['task-3'])
  })

  it('prepares spawned tasks sequentially and returns runnable ids', async () => {
    const tasks = [
      task({ id: 'task-1', description: 'prepare 1' }),
      task({ id: 'task-2', description: 'prepare 2' }),
      task({ id: 'task-3', description: 'prepare 3' }),
    ]
    const visited: string[] = []

    await expect(prepareSpawnedTasksForRun(tasks, async (item) => {
      visited.push(item.id)
      return item.id !== 'task-2'
    })).resolves.toEqual(['task-1', 'task-3'])
    expect(visited).toEqual(['task-1', 'task-2', 'task-3'])
  })

  it('marks spawned tasks for retry and completion without mutating unrelated tasks', () => {
    const tasks = [
      task({
        id: 'task-1',
        description: 'failed',
        status: 'error',
        dispatchStatus: 'error',
        retryCount: 1,
        lastError: 'failed',
      }),
      task({ id: 'task-2', description: 'other', status: 'pending', dispatchStatus: 'ready' }),
    ]

    const retryResult = markSpawnedTaskForRetry(tasks, 'task-1')
    expect(retryResult.task).toMatchObject({
      id: 'task-1',
      status: 'pending',
      retryCount: 2,
      lastError: undefined,
    })
    expect(retryResult.tasks[1]).toBe(tasks[1])

    const completeResult = markSpawnedTaskCompleted(retryResult.tasks, 'task-2')
    expect(completeResult.task).toMatchObject({
      id: 'task-2',
      status: 'done',
    })
    expect(markSpawnedTaskCompleted(tasks, 'missing')).toEqual({ tasks, task: null })
  })

  it('builds cancellation tab metadata from task summary', () => {
    expect(buildSpawnedTaskCancelTabMeta(task({
      id: 'task-1',
      description: 'cancel',
      lastSummary: 'partial result',
    }), 'cancelled by user')).toEqual({
      taskCancelRequested: true,
      taskStatus: 'cancelled',
      taskError: 'cancelled by user',
      taskSummary: 'partial result',
    })
  })

  it('marks running task as error when its task tab disappears', () => {
    const runningTask = task({
      id: 'task-1',
      description: 'tab task',
      status: 'running',
      dispatchStatus: 'running',
      taskTabId: 'tab-1',
      taskSessionId: 'session-1',
      startedAt: 100,
      lastSummary: 'partial',
    })

    const result = syncRunningSpawnedTaskFromTab(runningTask, undefined, {
      taskClosed: 'tab closed',
      taskFailed: 'task failed',
    }, 200)

    expect(result.task).toMatchObject({
      id: 'task-1',
      status: 'error',
      lastError: 'tab closed',
      durationMs: 100,
    })
    expect(result.completion).toEqual({
      taskId: 'task-1',
      status: 'error',
      error: 'tab closed',
      summary: 'partial',
      sessionId: 'session-1',
      taskTabId: 'tab-1',
      startedAt: 100,
      finishedAt: 200,
    })
  })

  it('syncs terminal task tab metadata into completion result', () => {
    const runningTask = task({
      id: 'task-1',
      description: 'tab task',
      status: 'running',
      dispatchStatus: 'running',
      taskTabId: 'tab-1',
      taskSessionId: 'session-1',
      startedAt: 100,
    })

    const result = syncRunningSpawnedTaskFromTab(runningTask, {
      id: 'tab-1',
      sessionId: 'session-tab',
      taskStatus: 'done',
      taskSummary: 'done summary',
    }, {
      taskClosed: 'tab closed',
      taskFailed: 'task failed',
    }, 200)

    expect(result.task).toMatchObject({
      id: 'task-1',
      status: 'done',
      lastSummary: 'done summary',
      resultSummary: 'done summary',
    })
    expect(result.completion).toEqual({
      taskId: 'task-1',
      status: 'done',
      error: undefined,
      summary: 'done summary',
      sessionId: 'session-tab',
      taskTabId: 'tab-1',
      startedAt: 100,
      finishedAt: 200,
    })
  })
})
