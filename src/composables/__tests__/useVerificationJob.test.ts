import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useVerificationJob } from '@/composables/useVerificationJob'
import { useBackgroundJobStore } from '@/stores/background-job'
import {
  clearAllPlans,
  createPlan,
  getActivePlan,
  markStepInProgress,
  approvePlan,
  startPlanExecution,
} from '@/composables/ai-agent/planning/planStore'

const api = vi.hoisted(() => ({
  submitBackgroundJob: vi.fn().mockResolvedValue(undefined),
  updateBackgroundJob: vi.fn().mockResolvedValue(undefined),
  listBackgroundJobs: vi.fn().mockResolvedValue([]),
  cleanupBackgroundJobs: vi.fn().mockResolvedValue(0),
}))

const aiExecuteToolMock = vi.hoisted(() => vi.fn())

vi.mock('@/api/background-job', () => api)
vi.mock('@/api/ai/tools', () => ({
  aiExecuteTool: aiExecuteToolMock,
}))

describe('useVerificationJob', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearAllPlans()
    vi.clearAllMocks()
    api.submitBackgroundJob.mockResolvedValue(undefined)
    api.updateBackgroundJob.mockResolvedValue(undefined)
    aiExecuteToolMock.mockResolvedValue({ success: true, content: 'ok' })
  })

  it('attaches verification job to current active plan step', async () => {
    const plan = createPlan({
      sessionId: 'session-1',
      title: 'Verify plan',
      steps: [
        { index: 0, title: 'Run tests' },
        { index: 1, title: 'Summarize' },
      ],
    })
    approvePlan(plan.id)
    startPlanExecution(plan.id)
    markStepInProgress(plan.id, 0)

    const verification = useVerificationJob()
    const jobId = await verification.submitVerificationJob('session-1', 'D:/Project/demo', [
      { command: 'pnpm test', timeoutSeconds: 10 },
    ])

    const jobRef = getActivePlan('session-1')!.steps[0]!.jobRefs![0]!
    expect(jobRef).toMatchObject({
      jobId,
      kind: 'verification',
      title: '验证任务',
    })
    expect(['queued', 'running', 'succeeded']).toContain(jobRef.status)
  })

  it('keeps verification job metadata for workspace isolation evidence', async () => {
    const verification = useVerificationJob()
    const jobId = await verification.submitVerificationJob(
      'session-1',
      'D:/Project/demo/.devforge/tmp/agents/task-1',
      [{ command: 'pnpm test:typecheck', timeoutSeconds: 10 }],
      {
        title: '隔离验证：task-1',
        contextSummary: 'Workspace Isolation task-1',
        meta: {
          workspaceIsolationTaskId: 'task-1',
          workspaceIsolationMode: 'temporary',
        },
      },
    )

    const store = useBackgroundJobStore()
    const job = store.jobs.find(item => item.id === jobId)
    expect(job).toMatchObject({
      title: '隔离验证：task-1',
      contextSummary: 'Workspace Isolation task-1',
      meta: {
        workspaceIsolationTaskId: 'task-1',
        workspaceIsolationMode: 'temporary',
      },
    })
  })
})
