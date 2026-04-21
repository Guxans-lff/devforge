import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createChatTaskDispatcher } from '@/composables/ai/chatTaskDispatcher'
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
    await dispatcher.runReadyTasks()

    expect(attempts).toBe(2)
    expect(state.value[0]).toMatchObject({
      status: 'done',
      retryCount: 1,
      lastSummary: 'done after retry',
    })
  })
})
