import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBackgroundJobStore } from '@/stores/background-job'
import {
  clearAllPlans,
  createPlan,
  getActivePlan,
} from '@/composables/ai-agent/planning/planStore'

const api = vi.hoisted(() => ({
  submitBackgroundJob: vi.fn().mockResolvedValue(undefined),
  updateBackgroundJob: vi.fn().mockResolvedValue(undefined),
  listBackgroundJobs: vi.fn().mockResolvedValue([]),
  cleanupBackgroundJobs: vi.fn().mockResolvedValue(0),
}))

vi.mock('@/api/background-job', () => api)

describe('background-job store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    clearAllPlans()
    api.submitBackgroundJob.mockResolvedValue(undefined)
    api.updateBackgroundJob.mockResolvedValue(undefined)
    api.listBackgroundJobs.mockResolvedValue([])
    api.cleanupBackgroundJobs.mockResolvedValue(0)
  })

  it('submits ERP module loading as a background job', async () => {
    const store = useBackgroundJobStore()

    const jobId = await store.submitErpModuleLoadJob('session-1')

    expect(store.jobs[0]).toMatchObject({ id: jobId, kind: 'erp_module_load', sessionId: 'session-1', status: 'queued' })
    expect(api.submitBackgroundJob).toHaveBeenCalledWith(jobId, 'erp_module_load', 'session-1')
  })

  it('submits resource scan as a background job', async () => {
    const store = useBackgroundJobStore()

    const jobId = await store.submitResourceScanJob('workspace:D:/Project/demo')

    expect(store.jobs[0]).toMatchObject({ id: jobId, kind: 'resource_scan', sessionId: 'workspace:D:/Project/demo', status: 'queued' })
    expect(api.submitBackgroundJob).toHaveBeenCalledWith(jobId, 'resource_scan', 'workspace:D:/Project/demo')
  })

  it('submits verification as a background job', async () => {
    const store = useBackgroundJobStore()

    const jobId = await store.submitVerificationJob('session-verify')

    expect(store.jobs[0]).toMatchObject({ id: jobId, kind: 'verification', sessionId: 'session-verify', status: 'queued' })
    expect(api.submitBackgroundJob).toHaveBeenCalledWith(jobId, 'verification', 'session-verify')
  })

  it('hydrates jobs from backend and normalizes camelCase records', async () => {
    api.listBackgroundJobs.mockResolvedValueOnce([
      {
        id: 'job-1',
        kind: 'schema_compare',
        status: 'running',
        sessionId: 'session-1',
        createdAt: 100,
        startedAt: 110,
        finishedAt: null,
        progress: 30,
        result: null,
        error: null,
      },
    ])
    const store = useBackgroundJobStore()

    await store.hydrateJobs('session-1')

    expect(store.hydrated).toBe(true)
    expect(store.jobs).toEqual([
      expect.objectContaining({ id: 'job-1', kind: 'schema_compare', sessionId: 'session-1', progress: 30 }),
    ])
  })

  it('cleans completed jobs locally and in backend', async () => {
    const store = useBackgroundJobStore()
    const jobId = await store.submitJob('ai_compact', 'session-1')
    await store.succeedJob(jobId, 'done')

    await store.cleanupCompleted(12)

    expect(store.jobs).toEqual([])
    expect(api.cleanupBackgroundJobs).toHaveBeenCalledWith(12)
  })

  it('syncs background job status into plan job refs', async () => {
    const store = useBackgroundJobStore()
    createPlan({ sessionId: 'session-1', title: 'Plan', steps: [{ index: 0, title: 'Run verification' }] })
    const jobId = await store.submitVerificationJob('session-1')

    await store.startJob(jobId)
    expect(getActivePlan('session-1')!.steps[0]!.jobRefs![0]!.status).toBe('running')

    await store.succeedJob(jobId, 'Verification passed')
    expect(getActivePlan('session-1')!.steps[0]!.jobRefs![0]).toMatchObject({
      status: 'succeeded',
      resultSummary: 'Verification passed',
    })
  })

  it('auto-attaches evidence background jobs to active plan step', async () => {
    const store = useBackgroundJobStore()
    createPlan({ sessionId: 'session-1', title: 'Plan', steps: [{ index: 0, title: 'Compare schema' }] })

    const jobId = await store.submitJob('schema_compare', 'session-1', {
      title: 'Schema 对比：dev → prod',
      contextSummary: 'dev@local -> prod@remote',
    })

    expect(store.jobs[0]).toMatchObject({
      title: 'Schema 对比：dev → prod',
      contextSummary: 'dev@local -> prod@remote',
    })
    expect(getActivePlan('session-1')!.steps[0]!.jobRefs![0]).toMatchObject({
      jobId,
      kind: 'schema_compare',
      status: 'queued',
      title: 'Schema 对比：dev → prod',
      resultSummary: 'dev@local -> prod@remote',
    })
  })

  it('does not attach compact jobs to plan evidence by default', async () => {
    const store = useBackgroundJobStore()
    createPlan({ sessionId: 'session-1', title: 'Plan', steps: [{ index: 0, title: 'Do work' }] })

    await store.submitJob('ai_compact', 'session-1')

    expect(getActivePlan('session-1')!.steps[0]!.jobRefs).toBeUndefined()
  })
})
