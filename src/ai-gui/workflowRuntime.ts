import type { AiWorkflowScript, AiWorkflowStep, AiWorkflowStepType } from '@/types/ai'

export type WorkflowRuntimeStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'
export type WorkflowRuntimeStatus = 'idle' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'

export interface WorkflowRuntimeStep {
  id: string
  index: number
  type: AiWorkflowStepType
  prompt?: string
  command?: string
  status: WorkflowRuntimeStepStatus
  startedAt?: number
  finishedAt?: number
  result?: string
  error?: string
  verificationJobId?: string
}

export interface WorkflowRuntimeState {
  runId: string
  workflowId: string
  workflowName: string
  status: WorkflowRuntimeStatus
  currentStepIndex: number
  createdAt: number
  updatedAt: number
  restoredAt?: number
  interruptedAt?: number
  interruptedReason?: string
  steps: WorkflowRuntimeStep[]
}

export interface WorkflowRuntimeAction {
  type: 'prompt' | 'verify' | 'summary' | 'none'
  step: WorkflowRuntimeStep
  payload?: string
}

function makeRunId(workflowId: string): string {
  return `workflow-${workflowId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function mapStep(step: AiWorkflowStep, index: number): WorkflowRuntimeStep {
  return {
    id: `step-${index + 1}`,
    index,
    type: step.type,
    prompt: step.prompt,
    command: step.command,
    status: 'pending',
  }
}

export function createWorkflowRuntime(workflow: AiWorkflowScript, now = Date.now()): WorkflowRuntimeState {
  return {
    runId: makeRunId(workflow.id),
    workflowId: workflow.id,
    workflowName: workflow.name,
    status: 'idle',
    currentStepIndex: 0,
    createdAt: now,
    updatedAt: now,
    steps: workflow.steps.map(mapStep),
  }
}

export function startWorkflowRuntime(state: WorkflowRuntimeState, now = Date.now()): WorkflowRuntimeState {
  if (state.status === 'done' || state.status === 'cancelled') return state
  return { ...state, status: 'running', updatedAt: now }
}

export function pauseWorkflowRuntime(state: WorkflowRuntimeState, now = Date.now()): WorkflowRuntimeState {
  if (state.status !== 'running') return state
  return { ...state, status: 'paused', updatedAt: now }
}

export function resumeWorkflowRuntime(state: WorkflowRuntimeState, now = Date.now()): WorkflowRuntimeState {
  if (state.status !== 'paused' && state.status !== 'failed') return state
  return { ...state, status: 'running', updatedAt: now }
}

export function cancelWorkflowRuntime(state: WorkflowRuntimeState, reason = 'cancelled', now = Date.now()): WorkflowRuntimeState {
  if (state.status === 'done' || state.status === 'cancelled') return state
  return {
    ...state,
    status: 'cancelled',
    updatedAt: now,
    steps: state.steps.map(step => step.status === 'running'
      ? { ...step, status: 'failed' as const, finishedAt: now, error: reason }
      : step),
  }
}

export function nextWorkflowAction(state: WorkflowRuntimeState): WorkflowRuntimeAction | null {
  if (state.status !== 'running') return null
  const step = state.steps.find(item => item.status === 'pending')
  if (!step) return null
  if (step.type === 'test') return { type: 'verify', step, payload: step.command }
  if (step.type === 'summarize') return { type: 'summary', step, payload: step.prompt }
  if (step.prompt) return { type: 'prompt', step, payload: step.prompt }
  return { type: 'none', step }
}

export function markWorkflowStepRunning(state: WorkflowRuntimeState, stepId: string, now = Date.now()): WorkflowRuntimeState {
  return {
    ...state,
    status: 'running',
    updatedAt: now,
    currentStepIndex: state.steps.find(step => step.id === stepId)?.index ?? state.currentStepIndex,
    steps: state.steps.map(step => step.id === stepId ? { ...step, status: 'running', startedAt: now, error: undefined } : step),
  }
}

export function completeWorkflowStep(state: WorkflowRuntimeState, stepId: string, result?: string, now = Date.now()): WorkflowRuntimeState {
  const steps = state.steps.map(step => step.id === stepId ? { ...step, status: 'done' as const, finishedAt: now, result } : step)
  const done = steps.every(step => step.status === 'done' || step.status === 'skipped')
  const nextPending = steps.find(step => step.status === 'pending')
  return {
    ...state,
    status: done ? 'done' : 'running',
    currentStepIndex: nextPending?.index ?? state.currentStepIndex,
    updatedAt: now,
    steps,
  }
}

export function attachWorkflowStepVerification(state: WorkflowRuntimeState, stepId: string, jobId: string, now = Date.now()): WorkflowRuntimeState {
  return {
    ...state,
    status: 'running',
    updatedAt: now,
    steps: state.steps.map(step => step.id === stepId ? { ...step, verificationJobId: jobId, result: `verification submitted: ${jobId}` } : step),
  }
}

export function failWorkflowStep(state: WorkflowRuntimeState, stepId: string, error: string, now = Date.now()): WorkflowRuntimeState {
  return {
    ...state,
    status: 'failed',
    updatedAt: now,
    steps: state.steps.map(step => step.id === stepId ? { ...step, status: 'failed', finishedAt: now, error } : step),
  }
}

export function resetWorkflowStep(state: WorkflowRuntimeState, stepId: string, now = Date.now()): WorkflowRuntimeState {
  return {
    ...state,
    status: 'idle',
    updatedAt: now,
    steps: state.steps.map(step => step.id === stepId ? { ...step, status: 'pending', startedAt: undefined, finishedAt: undefined, result: undefined, error: undefined, verificationJobId: undefined } : step),
  }
}

export function restoreWorkflowRuntime(state: WorkflowRuntimeState, now = Date.now()): WorkflowRuntimeState {
  if (state.status !== 'running') {
    return {
      ...state,
      restoredAt: now,
      updatedAt: now,
    }
  }

  return {
    ...state,
    status: 'paused',
    restoredAt: now,
    interruptedAt: now,
    interruptedReason: '应用重启或页面刷新时存在运行中的 Workflow，已暂停等待用户确认恢复。',
    updatedAt: now,
    steps: state.steps.map(step => step.status === 'running'
      ? {
          ...step,
          status: 'failed' as const,
          finishedAt: now,
          error: 'interrupted',
        }
      : step),
  }
}
