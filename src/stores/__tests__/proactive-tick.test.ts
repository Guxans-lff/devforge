import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProactiveTickStore } from '../proactive-tick'

describe('useProactiveTickStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  it('starts a task and tracks it', () => {
    const store = useProactiveTickStore()
    const task = store.startTask({ sessionId: 's1', objective: 'wait for tests' })

    expect(task.status).toBe('running')
    expect(task.sessionId).toBe('s1')
    expect(task.objective).toBe('wait for tests')
    expect(task.tickCount).toBe(0)
    expect(store.activeTasks.length).toBe(1)
    expect(store.hasRunningTasks).toBe(true)
  })

  it('pauses and resumes a task', () => {
    const store = useProactiveTickStore()
    const task = store.startTask({ sessionId: 's1', objective: 'wait' })

    store.pauseTask(task.id)
    expect(store.tasks[0].status).toBe('paused')

    store.resumeTask(task.id)
    expect(store.tasks[0].status).toBe('running')
  })

  it('stops a task', () => {
    const store = useProactiveTickStore()
    const task = store.startTask({ sessionId: 's1', objective: 'wait' })

    store.stopTask(task.id)
    expect(store.tasks[0].status).toBe('done')
  })

  it('fails a task', () => {
    const store = useProactiveTickStore()
    const task = store.startTask({ sessionId: 's1', objective: 'wait' })

    store.failTask(task.id, 'something broke')
    expect(store.tasks[0].status).toBe('failed')
    expect(store.tasks[0].error).toBe('something broke')
  })

  it('pauses all running tasks globally', () => {
    const store = useProactiveTickStore()
    const t1 = store.startTask({ sessionId: 's1', objective: 'a' })
    const t2 = store.startTask({ sessionId: 's1', objective: 'b' })

    store.pauseAll()
    expect(store.isPausedGlobally).toBe(true)
    expect(t1.status).toBe('paused')
    expect(t2.status).toBe('paused')
  })

  it('resumes all paused tasks globally', () => {
    const store = useProactiveTickStore()
    store.startTask({ sessionId: 's1', objective: 'a' })
    store.startTask({ sessionId: 's1', objective: 'b' })
    store.pauseAll()

    store.resumeAll()
    expect(store.isPausedGlobally).toBe(false)
    expect(store.tasks.every(t => t.status === 'running')).toBe(true)
  })

  it('removes a task', () => {
    const store = useProactiveTickStore()
    const task = store.startTask({ sessionId: 's1', objective: 'wait' })

    store.removeTask(task.id)
    expect(store.tasks.length).toBe(0)
  })

  it('clears completed tasks', () => {
    const store = useProactiveTickStore()
    const t1 = store.startTask({ sessionId: 's1', objective: 'a' })
    const t2 = store.startTask({ sessionId: 's1', objective: 'b' })
    store.stopTask(t1.id)
    store.failTask(t2.id, 'err')

    store.clearCompleted()
    expect(store.tasks.length).toBe(0)
  })

  it('auto stops task when maxTicks reached', async () => {
    const store = useProactiveTickStore()
    const task = store.startTask({ sessionId: 's1', objective: 'wait', tickIntervalMs: 100, maxTicks: 2 })

    await store.executeTick(task)
    expect(task.tickCount).toBe(1)
    expect(task.status).toBe('running')

    await store.executeTick(task)
    expect(task.tickCount).toBe(2)
    expect(task.status).toBe('done')
  })
})
