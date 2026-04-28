import { describe, expect, it } from 'vitest'
import { createWorkflowRuntime, markWorkflowStepRunning, startWorkflowRuntime } from '@/ai-gui/workflowRuntime'
import { loadWorkflowRuntime, saveWorkflowRuntime } from '@/ai-gui/workflowPersistence'
import type { AiWorkflowScript } from '@/types/ai'

const workflow: AiWorkflowScript = {
  id: 'persist-demo',
  name: 'Persist Demo',
  description: 'demo',
  steps: [
    { type: 'inspect', prompt: 'inspect' },
  ],
}

function createMemoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => data.delete(key),
    setItem: (key, value) => data.set(key, value),
  }
}

describe('workflowPersistence', () => {
  it('restores saved running workflow as paused interrupted state', () => {
    const storage = createMemoryStorage()
    let state = startWorkflowRuntime(createWorkflowRuntime(workflow, 1), 2)
    state = markWorkflowStepRunning(state, 'step-1', 3)

    saveWorkflowRuntime(state, storage)
    const restored = loadWorkflowRuntime(storage, 10)

    expect(restored).toMatchObject({
      status: 'paused',
      interruptedAt: 10,
    })
    expect(restored?.steps[0]).toMatchObject({
      status: 'failed',
      error: 'interrupted',
    })
  })

  it('removes saved workflow when state is null', () => {
    const storage = createMemoryStorage()
    saveWorkflowRuntime(startWorkflowRuntime(createWorkflowRuntime(workflow, 1), 2), storage)

    saveWorkflowRuntime(null, storage)

    expect(loadWorkflowRuntime(storage)).toBeNull()
  })
})
