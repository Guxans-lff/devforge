import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useJobWorker } from '../useJobWorker'

const mockStore = {
  startJob: vi.fn(),
  updateProgress: vi.fn(),
  succeedJob: vi.fn(),
  failJob: vi.fn(),
  finishCancel: vi.fn(),
  cancelJob: vi.fn(),
  hydrateJobs: vi.fn(),
  activeJobs: [],
}

vi.mock('@/stores/background-job', () => ({
  useBackgroundJobStore: () => mockStore,
}))

describe('useJobWorker', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockStore.activeJobs = []
  })

  it('registers and dispatches an executor', async () => {
    const worker = useJobWorker()
    const executor = vi.fn().mockResolvedValue('done')

    worker.registerExecutor('test_kind', executor)
    await worker.dispatch('job-1', 'test_kind', 'session-1', { foo: 'bar' })

    expect(mockStore.startJob).toHaveBeenCalledWith('job-1')
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-1',
      sessionId: 'session-1',
      payload: { foo: 'bar' },
    }))
    expect(mockStore.succeedJob).toHaveBeenCalledWith('job-1', 'done')
  })

  it('fails job when executor throws', async () => {
    const worker = useJobWorker()
    worker.registerExecutor('fail_kind', async () => {
      throw new Error('boom')
    })

    await worker.dispatch('job-2', 'fail_kind', 'session-1')

    expect(mockStore.failJob).toHaveBeenCalledWith('job-2', 'boom')
  })

  it('fails job immediately when no executor registered', async () => {
    const worker = useJobWorker()

    await expect(worker.dispatch('job-3', 'unknown', 'session-1'))
      .rejects.toThrow('No executor registered for kind: unknown')

    expect(mockStore.failJob).toHaveBeenCalledWith('job-3', 'No executor registered for kind: unknown')
  })

  it('tracks active jobs', async () => {
    const worker = useJobWorker()
    let resolveExec!: () => void
    const execPromise = new Promise<void>((resolve) => { resolveExec = resolve })

    worker.registerExecutor('slow', async () => {
      await execPromise
    })

    const dispatchPromise = worker.dispatch('job-4', 'slow', 'session-1')
    expect(worker.isActive('job-4')).toBe(true)
    expect(worker.getActiveJobCount()).toBe(1)

    resolveExec()
    await dispatchPromise

    expect(worker.isActive('job-4')).toBe(false)
    expect(worker.getActiveJobCount()).toBe(0)
  })

  it('cancels an active job via abort signal', async () => {
    const worker = useJobWorker()
    let aborted = false

    worker.registerExecutor('cancellable', async (ctx) => {
      if (ctx.signal.aborted) {
        aborted = true
        throw new Error('aborted')
      }
      return new Promise((resolve, reject) => {
        ctx.signal.addEventListener('abort', () => {
          aborted = true
          reject(new Error('aborted'))
        })
        setTimeout(() => resolve('finished'), 1000)
      })
    })

    const dispatchPromise = worker.dispatch('job-5', 'cancellable', 'session-1')
    worker.cancel('job-5')

    await dispatchPromise
    expect(mockStore.cancelJob).toHaveBeenCalledWith('job-5')
    expect(mockStore.finishCancel).toHaveBeenCalledWith('job-5')
  })

  it('marks restored active jobs as interrupted when no executor is active', async () => {
    mockStore.activeJobs = [
      { id: 'job-restored-1', status: 'running' },
      { id: 'job-restored-2', status: 'queued' },
    ]
    const worker = useJobWorker()

    await worker.recoverInterruptedJobs('session-1')

    expect(mockStore.hydrateJobs).toHaveBeenCalledWith('session-1')
    expect(mockStore.failJob).toHaveBeenCalledWith('job-restored-1', '应用已重启，任务执行器已中断，请重新提交。')
    expect(mockStore.failJob).toHaveBeenCalledWith('job-restored-2', '应用已重启，任务执行器已中断，请重新提交。')
  })

  it('propagates progress updates', async () => {
    const worker = useJobWorker()
    worker.registerExecutor('progressive', async (ctx) => {
      ctx.onProgress(25)
      ctx.onProgress(50)
      ctx.onProgress(75)
    })

    await worker.dispatch('job-6', 'progressive', 'session-1')

    expect(mockStore.updateProgress).toHaveBeenCalledWith('job-6', 25)
    expect(mockStore.updateProgress).toHaveBeenCalledWith('job-6', 50)
    expect(mockStore.updateProgress).toHaveBeenCalledWith('job-6', 75)
    expect(mockStore.succeedJob).toHaveBeenCalledWith('job-6', undefined)
  })

  it('overwrites existing executor of same kind', () => {
    const worker = useJobWorker()
    const first = vi.fn()
    const second = vi.fn().mockResolvedValue(undefined)

    worker.registerExecutor('dup', first)
    worker.registerExecutor('dup', second)

    // 不应该抛错，只是覆盖
    expect(() => worker.registerExecutor('dup', second)).not.toThrow()
  })
})
