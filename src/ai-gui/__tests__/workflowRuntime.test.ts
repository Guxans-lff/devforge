import { describe, expect, it } from 'vitest'
import {
  completeWorkflowStep,
  createWorkflowRuntime,
  failWorkflowStep,
  markWorkflowStepRunning,
  nextWorkflowAction,
  pauseWorkflowRuntime,
  restoreWorkflowRuntime,
  resumeWorkflowRuntime,
  startWorkflowRuntime,
} from '@/ai-gui/workflowRuntime'
import type { AiWorkflowScript } from '@/types/ai'

const workflow: AiWorkflowScript = {
  id: 'demo',
  name: 'Demo Workflow',
  description: 'demo',
  steps: [
    { type: 'inspect', prompt: 'inspect prompt' },
    { type: 'test', command: 'pnpm test:typecheck' },
  ],
}

describe('workflowRuntime', () => {
  it('creates and advances workflow steps', () => {
    let state = startWorkflowRuntime(createWorkflowRuntime(workflow, 1), 2)

    expect(nextWorkflowAction(state)).toMatchObject({ type: 'prompt', payload: 'inspect prompt' })

    state = markWorkflowStepRunning(state, 'step-1', 3)
    state = completeWorkflowStep(state, 'step-1', 'ok', 4)

    expect(nextWorkflowAction(state)).toMatchObject({ type: 'verify', payload: 'pnpm test:typecheck' })

    state = markWorkflowStepRunning(state, 'step-2', 5)
    state = completeWorkflowStep(state, 'step-2', 'passed', 6)

    expect(state.status).toBe('done')
  })

  it('marks a workflow as failed', () => {
    let state = startWorkflowRuntime(createWorkflowRuntime(workflow, 1), 2)
    state = failWorkflowStep(state, 'step-1', 'boom', 3)

    expect(state.status).toBe('failed')
    expect(state.steps[0]).toMatchObject({ status: 'failed', error: 'boom' })
  })

  it('pauses and resumes a workflow', () => {
    let state = startWorkflowRuntime(createWorkflowRuntime(workflow, 1), 2)
    state = pauseWorkflowRuntime(state, 3)
    expect(state.status).toBe('paused')
    expect(nextWorkflowAction(state)).toBeNull()

    state = resumeWorkflowRuntime(state, 4)
    expect(state.status).toBe('running')
    expect(nextWorkflowAction(state)).toMatchObject({ type: 'prompt' })
  })

  it('restores running workflows as interrupted and paused', () => {
    let state = startWorkflowRuntime(createWorkflowRuntime(workflow, 1), 2)
    state = markWorkflowStepRunning(state, 'step-1', 3)

    const restored = restoreWorkflowRuntime(state, 10)

    expect(restored.status).toBe('paused')
    expect(restored.interruptedAt).toBe(10)
    expect(restored.interruptedReason).toContain('已暂停')
    expect(restored.steps[0]).toMatchObject({
      status: 'failed',
      error: 'interrupted',
      finishedAt: 10,
    })
  })
})
