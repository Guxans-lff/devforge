import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createChatTaskDispatcher, type DispatchTaskExecutionResult } from '@/composables/ai/chatTaskDispatcher'
import type { SpawnedTask } from '@/composables/ai/chatSideEffects'

function makeTask(overrides: Partial<SpawnedTask> = {}): SpawnedTask {
  return {
    id: overrides.id ?? `task-${Math.random().toString(36).slice(2, 7)}`,
    description: overrides.description ?? 'task',
    status: overrides.status ?? 'pending',
    dispatchStatus: overrides.dispatchStatus,
    createdAt: overrides.createdAt ?? Date.now(),
    retryCount: overrides.retryCount ?? 0,
    dependsOn: overrides.dependsOn ?? [],
    executionMode: overrides.executionMode ?? 'headless',
    priority: overrides.priority ?? 'normal',
    autoRetryBudget: overrides.autoRetryBudget ?? 1,
    attemptCount: overrides.attemptCount ?? 0,
    ...overrides,
  }
}

describe('chatTaskDispatcher', () => {
  it('reconciles ready queued and blocked tasks by dependency state', () => {
    const state = ref<SpawnedTask[]>([
      makeTask({ id: 'task-1', description: 'root' }),
      makeTask({ id: 'task-2', description: 'after root', dependsOn: ['task-1'] }),
      makeTask({ id: 'task-3', description: 'missing dep', dependsOn: ['missing-task'] }),
      makeTask({ id: 'task-4', description: 'failed dep', status: 'error' }),
      makeTask({ id: 'task-5', description: 'after failed dep', dependsOn: ['task-4'] }),
      makeTask({ id: 'task-6', description: 'cancelled dep', status: 'cancelled' }),
      makeTask({ id: 'task-7', description: 'after cancelled dep', dependsOn: ['task-6'] }),
    ])

    const dispatcher = createChatTaskDispatcher({
      getTasks: () => state.value,
      setTasks: tasks => {
        state.value = tasks
      },
      executors: {
        headless: { mode: 'headless', run: vi.fn() },
        tab: { mode: 'tab', run: vi.fn() },
      },
    })

    const tasks = dispatcher.syncTasks(state.value)
    expect(tasks.find(task => task.id === 'task-1')?.dispatchStatus).toBe('ready')
    expect(tasks.find(task => task.id === 'task-2')?.dispatchStatus).toBe('queued')
    expect(tasks.find(task => task.id === 'task-3')?.dispatchStatus).toBe('blocked')
    expect(tasks.find(task => task.id === 'task-5')?.dispatchStatus).toBe('blocked')
    expect(tasks.find(task => task.id === 'task-7')?.dispatchStatus).toBe('blocked')
  })

  it('runs only up to maxParallel ready tasks and prefers higher priority', async () => {
    const state = ref<SpawnedTask[]>([
      makeTask({ id: 'task-1', description: 'normal', priority: 'normal' }),
      makeTask({ id: 'task-2', description: 'high', priority: 'high' }),
      makeTask({ id: 'task-3', description: 'low', priority: 'low' }),
    ])
    const started: string[] = []
    const releases = new Map<string, () => void>()

    const dispatcher = createChatTaskDispatcher({
      getTasks: () => state.value,
      setTasks: tasks => {
        state.value = tasks
      },
      maxParallel: 2,
      executors: {
        headless: {
          mode: 'headless',
          run: vi.fn(async (task) => {
            started.push(task.id)
            await new Promise<void>((resolve) => {
              releases.set(task.id, resolve)
            })
            return {
              status: 'done',
              summary: `${task.description} done`,
              startedAt: Date.now(),
              finishedAt: Date.now(),
            }
          }),
        },
        tab: { mode: 'tab', run: vi.fn() },
      },
    })

    dispatcher.syncTasks(state.value)
    const runPromise = dispatcher.runReadyTasks()
    await Promise.resolve()

    expect(started).toEqual(['task-2', 'task-1'])
    expect(state.value.filter(task => task.status === 'running').map(task => task.id).sort()).toEqual(['task-1', 'task-2'])

    releases.get('task-2')?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(['task-2', 'task-1', 'task-3'])

    releases.get('task-1')?.()
    releases.get('task-3')?.()
    await runPromise

    expect(state.value.find(task => task.id === 'task-2')?.status).toBe('done')
    expect(state.value.find(task => task.id === 'task-1')?.status).toBe('done')
    expect(state.value.find(task => task.id === 'task-3')?.status).toBe('done')
  })

  it('releases dependent tasks after predecessor completes', async () => {
    const state = ref<SpawnedTask[]>([
      makeTask({ id: 'task-1', description: 'prepare workspace' }),
      makeTask({ id: 'task-2', description: 'verify workspace', dependsOn: ['task-1'] }),
    ])

    const dispatcher = createChatTaskDispatcher({
      getTasks: () => state.value,
      setTasks: tasks => {
        state.value = tasks
      },
      executors: {
        headless: {
          mode: 'headless',
          run: vi.fn(async (task) => ({
            status: 'done',
            summary: `${task.description} complete`,
            startedAt: Date.now(),
            finishedAt: Date.now(),
          })),
        },
        tab: { mode: 'tab', run: vi.fn() },
      },
    })

    dispatcher.syncTasks(state.value)
    await dispatcher.runReadyTasks(['task-1'])

    expect(state.value.find(task => task.id === 'task-1')?.status).toBe('done')
    expect(state.value.find(task => task.id === 'task-2')?.status).toBe('done')
    expect(state.value.find(task => task.id === 'task-2')?.dispatchStatus).toBe('done')
  })

  it('retries retryable failures once and then succeeds', async () => {
    vi.useFakeTimers()
    const state = ref<SpawnedTask[]>([
      makeTask({ id: 'task-1', description: 'retry once', autoRetryBudget: 1 }),
    ])
    let attempts = 0

    const dispatcher = createChatTaskDispatcher({
      getTasks: () => state.value,
      setTasks: tasks => {
        state.value = tasks
      },
      executors: {
        headless: {
          mode: 'headless',
          run: vi.fn(async () => {
            attempts += 1
            if (attempts === 1) {
              return {
                status: 'error',
                error: 'network timeout',
                retryable: true,
                startedAt: Date.now(),
                finishedAt: Date.now(),
              }
            }
            return {
              status: 'done',
              summary: 'done after retry',
              startedAt: Date.now(),
              finishedAt: Date.now(),
            }
          }),
        },
        tab: { mode: 'tab', run: vi.fn() },
      },
    })

    dispatcher.syncTasks(state.value)
    const runPromise = dispatcher.runReadyTasks()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(250)
    await runPromise

    expect(attempts).toBe(2)
    expect(state.value[0]).toMatchObject({
      status: 'done',
      retryCount: 1,
      lastSummary: 'done after retry',
    })
    vi.useRealTimers()
  })

  it('does not block other ready tasks while a retryable task waits for retry backoff', async () => {
    vi.useFakeTimers()
    const state = ref<SpawnedTask[]>([
      makeTask({ id: 'task-1', description: 'retry once', autoRetryBudget: 1, priority: 'high' }),
      makeTask({ id: 'task-2', description: 'independent task', priority: 'normal' }),
    ])
    let task1Attempts = 0
    const runOrder: string[] = []

    const dispatcher = createChatTaskDispatcher({
      getTasks: () => state.value,
      setTasks: tasks => {
        state.value = tasks
      },
      maxParallel: 1,
      executors: {
        headless: {
          mode: 'headless',
          run: vi.fn(async (task) => {
            runOrder.push(task.id)
            if (task.id === 'task-1') {
              task1Attempts += 1
              if (task1Attempts === 1) {
                return {
                  status: 'error',
                  error: 'network timeout',
                  retryable: true,
                  startedAt: Date.now(),
                  finishedAt: Date.now(),
                }
              }
              return {
                status: 'done',
                summary: 'retried task done',
                startedAt: Date.now(),
                finishedAt: Date.now(),
              }
            }
            return {
              status: 'done',
              summary: 'independent done',
              startedAt: Date.now(),
              finishedAt: Date.now(),
            }
          }),
        },
        tab: { mode: 'tab', run: vi.fn() },
      },
    })

    dispatcher.syncTasks(state.value)
    const runPromise = dispatcher.runReadyTasks()
    await Promise.resolve()

    expect(runOrder).toEqual(['task-1', 'task-2'])
    expect(state.value.find(task => task.id === 'task-2')?.status).toBe('running')

    await vi.advanceTimersByTimeAsync(250)
    await runPromise

    expect(task1Attempts).toBe(2)
    expect(state.value.find(task => task.id === 'task-1')).toMatchObject({
      status: 'done',
      retryCount: 1,
    })
    expect(state.value.find(task => task.id === 'task-2')).toMatchObject({
      status: 'done',
    })
    vi.useRealTimers()
  })

  it('retries explicit retryable failures even when the error text is not network-shaped', async () => {
    vi.useFakeTimers()
    const state = ref<SpawnedTask[]>([
      makeTask({ id: 'task-1', description: 'structured retryable', autoRetryBudget: 1 }),
    ])
    let attempts = 0

    const dispatcher = createChatTaskDispatcher({
      getTasks: () => state.value,
      setTasks: tasks => {
        state.value = tasks
      },
      executors: {
        headless: {
          mode: 'headless',
          run: vi.fn(async () => {
            attempts += 1
            if (attempts === 1) {
              return {
                status: 'error',
                error: 'provider overloaded now',
                retryable: true,
                startedAt: Date.now(),
                finishedAt: Date.now(),
              }
            }
            return {
              status: 'done',
              summary: 'recovered after structured retryable failure',
              startedAt: Date.now(),
              finishedAt: Date.now(),
            }
          }),
        },
        tab: { mode: 'tab', run: vi.fn() },
      },
    })

    dispatcher.syncTasks(state.value)
    const runPromise = dispatcher.runReadyTasks()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(250)
    await runPromise

    expect(attempts).toBe(2)
    expect(state.value[0]).toMatchObject({
      status: 'done',
      retryCount: 1,
    })
    vi.useRealTimers()
  })

  it('cancels a running headless task without letting a late result mark it done', async () => {
    const state = ref<SpawnedTask[]>([
      makeTask({ id: 'task-1', description: 'inspect scheduler', executionMode: 'headless' }),
    ])
    const events: string[] = []
    let releaseRun!: (result: DispatchTaskExecutionResult) => void
    const runGate = new Promise<DispatchTaskExecutionResult>((resolve) => {
      releaseRun = resolve
    })
    const run = vi.fn(async () => runGate)
    const cancel = vi.fn()

    const dispatcher = createChatTaskDispatcher({
      getTasks: () => state.value,
      setTasks: tasks => {
        state.value = tasks
      },
      executors: {
        headless: {
          mode: 'headless',
          prepare: task => ({
            taskSessionId: `session-headless-${task.id}`,
          }),
          run,
          cancel,
        },
        tab: { mode: 'tab', run: vi.fn() },
      },
      onEvent: event => {
        events.push(`${event.type}:${event.taskId}`)
      },
    })

    dispatcher.syncTasks(state.value)
    const runPromise = dispatcher.runReadyTasks(['task-1'])
    await Promise.resolve()

    expect(run).toHaveBeenCalledTimes(1)
    expect(state.value[0]).toMatchObject({
      status: 'running',
      dispatchStatus: 'running',
      taskSessionId: 'session-headless-task-1',
    })

    await dispatcher.cancelTask('task-1', 'User cancelled headless task')

    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-1',
        status: 'running',
        dispatchStatus: 'running',
        executionMode: 'headless',
        taskSessionId: 'session-headless-task-1',
      }),
      'User cancelled headless task',
    )
    expect(state.value[0]).toMatchObject({
      status: 'cancelled',
      dispatchStatus: 'cancelled',
      lastError: 'User cancelled headless task',
      taskSessionId: 'session-headless-task-1',
    })

    releaseRun({
      status: 'done',
      summary: 'Late successful result should not win.',
      sessionId: 'session-headless-task-1-result',
      startedAt: 1000,
      finishedAt: 1400,
    })
    await runPromise

    expect(state.value[0]).toMatchObject({
      status: 'cancelled',
      dispatchStatus: 'cancelled',
      lastError: 'User cancelled headless task',
      resultSummary: 'Late successful result should not win.',
      resultSessionId: 'session-headless-task-1-result',
      taskSessionId: 'session-headless-task-1-result',
    })
    expect(events).toContain('started:task-1')
    expect(events.filter(event => event === 'cancelled:task-1')).toEqual(['cancelled:task-1'])
  })

  it('does not run dependents whose predecessors ended in error or cancellation', async () => {
    const state = ref<SpawnedTask[]>([
      makeTask({ id: 'task-1', description: 'failed prerequisite', status: 'error' }),
      makeTask({ id: 'task-2', description: 'after failed prerequisite', dependsOn: ['task-1'] }),
      makeTask({ id: 'task-3', description: 'cancelled prerequisite', status: 'cancelled' }),
      makeTask({ id: 'task-4', description: 'after cancelled prerequisite', dependsOn: ['task-3'] }),
      makeTask({ id: 'task-5', description: 'independent ready task' }),
    ])
    const run = vi.fn(async (task: SpawnedTask) => ({
      status: 'done' as const,
      summary: `${task.description} done`,
      startedAt: Date.now(),
      finishedAt: Date.now(),
    }))

    const dispatcher = createChatTaskDispatcher({
      getTasks: () => state.value,
      setTasks: tasks => {
        state.value = tasks
      },
      executors: {
        headless: { mode: 'headless', run },
        tab: { mode: 'tab', run: vi.fn() },
      },
    })

    dispatcher.syncTasks(state.value)
    await dispatcher.runReadyTasks()

    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-5' }))
    expect(state.value.find(task => task.id === 'task-2')).toMatchObject({
      status: 'pending',
      dispatchStatus: 'blocked',
    })
    expect(state.value.find(task => task.id === 'task-4')).toMatchObject({
      status: 'pending',
      dispatchStatus: 'blocked',
    })
    expect(state.value.find(task => task.id === 'task-5')).toMatchObject({
      status: 'done',
      dispatchStatus: 'done',
    })
  })
})
