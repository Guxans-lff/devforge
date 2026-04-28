import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import * as jobWorkerModule from '@/composables/useJobWorker'

const mockBgStore = {
  activeJobs: [{ id: 'job-1', status: 'running' }, { id: 'job-2', status: 'queued' }],
  cancelJob: vi.fn(),
}

const mockTickStore = {
  activeTasks: [{ id: 'task-1', status: 'running' }],
  isPausedGlobally: false,
  pauseAll: vi.fn(),
  resumeAll: vi.fn(),
  stopTask: vi.fn(),
}

// 使用普通函数避免 vitest mockReset 清除返回值
// 只有需要断言调用历史的才用 vi.fn()
const mockWorker = {
  getActiveJobCount: () => 1,
  activeJobs: { value: new Map([['job-w-1', { jobId: 'job-w-1' }]]) },
  cancel: vi.fn(),
}

vi.mock('@/stores/background-job', () => ({
  useBackgroundJobStore: () => mockBgStore,
}))

vi.mock('@/stores/proactive-tick', () => ({
  useProactiveTickStore: () => mockTickStore,
}))

// Dynamically import useAgentControl after setting up spies
async function getUseAgentControl() {
  const { useAgentControl } = await import('../useAgentControl')
  return useAgentControl
}

describe('useAgentControl', () => {
  let useAgentControl: typeof import('../useAgentControl').useAgentControl

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.spyOn(jobWorkerModule, 'useJobWorker').mockReturnValue(mockWorker as any)
    useAgentControl = await getUseAgentControl()
  })

  it('reports composite status', () => {
    const control = useAgentControl()
    expect(control.status.value).toMatchObject({
      activeJobs: 2,
      activeProactiveTasks: 1,
      activeWorkerJobs: 1,
      isPausedGlobally: false,
    })
  })

  it('pauseAll delegates to tickStore.pauseAll', () => {
    const control = useAgentControl()
    control.pauseAll()
    expect(mockTickStore.pauseAll).toHaveBeenCalled()
  })

  it('resumeAll delegates to tickStore.resumeAll', () => {
    const control = useAgentControl()
    control.resumeAll()
    expect(mockTickStore.resumeAll).toHaveBeenCalled()
  })

  it('cancelAll cancels all jobs and tasks', () => {
    const control = useAgentControl()
    control.cancelAll()

    expect(mockBgStore.cancelJob).toHaveBeenCalledTimes(2)
    expect(mockBgStore.cancelJob).toHaveBeenCalledWith('job-1')
    expect(mockBgStore.cancelJob).toHaveBeenCalledWith('job-2')

    expect(mockWorker.cancel).toHaveBeenCalledTimes(1)
    expect(mockWorker.cancel).toHaveBeenCalledWith('job-w-1')

    expect(mockTickStore.stopTask).toHaveBeenCalledTimes(1)
    expect(mockTickStore.stopTask).toHaveBeenCalledWith('task-1')
  })

  it('killSwitch triggers cancelAll', () => {
    const control = useAgentControl()
    control.killSwitch()

    expect(mockBgStore.cancelJob).toHaveBeenCalled()
    expect(mockWorker.cancel).toHaveBeenCalled()
    expect(mockTickStore.stopTask).toHaveBeenCalled()
  })
})
