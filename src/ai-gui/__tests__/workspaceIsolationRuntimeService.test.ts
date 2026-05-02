import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceIsolationDiffResult } from '@/api/workspace-isolation'
import type { BackgroundJob } from '@/stores/background-job'
import type { WorkspaceIsolationExecutionPlanItem } from '../workspaceIsolationPlan'
import { createWorkspaceIsolationRuntimeService } from '../workspaceIsolationRuntimeService'

const api = vi.hoisted(() => ({
  workspaceIsolationPrepare: vi.fn(),
  workspaceIsolationDiff: vi.fn(),
  workspaceIsolationApplyChanges: vi.fn(),
  workspaceIsolationCleanup: vi.fn(),
}))

vi.mock('@/api/workspace-isolation', () => ({
  workspaceIsolationPrepare: api.workspaceIsolationPrepare,
  workspaceIsolationDiff: api.workspaceIsolationDiff,
  workspaceIsolationApplyChanges: api.workspaceIsolationApplyChanges,
  workspaceIsolationCleanup: api.workspaceIsolationCleanup,
}))

function makePlan(): WorkspaceIsolationExecutionPlanItem {
  return {
    agentId: 'implementer-1',
    taskId: 'task-1',
    mode: 'temporary',
    allowedPaths: ['src/**'],
    blockedPaths: ['node_modules/**'],
    reason: 'test',
    mergeRequired: true,
    requiresReview: true,
    cleanupPolicy: 'delete_on_success',
    workspace: {
      slug: 'task-1',
      workspacePath: '.devforge/tmp/agents/task-1',
    },
    actions: [],
  }
}

function makeDiff(overrides?: Partial<WorkspaceIsolationDiffResult>): WorkspaceIsolationDiffResult {
  return {
    repoPath: 'D:/Project/devforge',
    workspacePath: 'D:/Project/devforge/.devforge/tmp/agents/task-1',
    mode: 'temporary',
    entries: [{ path: 'src/ai-gui/runtime.ts', status: 'modified' }],
    summary: { added: 0, modified: 1, deleted: 0, unchanged: 0 },
    ...overrides,
  }
}

function makeVerificationJob(overrides: Partial<BackgroundJob>): BackgroundJob {
  return {
    id: 'job-1',
    kind: 'verification',
    sessionId: 'session-1',
    status: 'succeeded',
    progress: 100,
    createdAt: 1000,
    finishedAt: 1200,
    ...overrides,
  }
}

function createHarness(overrides?: {
  confirm?: (message: string) => boolean
  states?: Record<string, any>
  jobs?: BackgroundJob[]
}) {
  const states: Record<string, any> = overrides?.states ?? {}
  const notices: Array<{ kind: 'warn' | 'error' | 'info'; text: string }> = []
  const workDirs: Record<string, string> = {}
  const submitVerificationJob = vi.fn().mockResolvedValue('job-verify-1')
  const confirm = vi.fn(overrides?.confirm ?? (() => true))
  const service = createWorkspaceIsolationRuntimeService({
    confirm,
    notice: (kind, text) => notices.push({ kind, text }),
    setState: (taskId, state) => {
      states[taskId] = state
    },
    setTaskIsolationWorkDir: (taskId, workspacePath) => {
      workDirs[taskId] = workspacePath
    },
    submitVerificationJob,
  })
  const context = {
    repoPath: 'D:/Project/devforge',
    sessionId: 'session-1',
    states,
    jobs: overrides?.jobs ?? [],
    fallbackVerificationReport: null,
    fallbackVerifying: false,
  }
  return { service, context, states, notices, workDirs, submitVerificationJob, confirm }
}

describe('workspaceIsolationRuntimeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.workspaceIsolationPrepare.mockResolvedValue({
      repoPath: 'D:/Project/devforge',
      workspacePath: 'D:/Project/devforge/.devforge/tmp/agents/task-1',
      mode: 'temporary',
      copiedFiles: 2,
      skippedPaths: [],
      reusedExisting: false,
    })
    api.workspaceIsolationDiff.mockResolvedValue(makeDiff())
    api.workspaceIsolationApplyChanges.mockResolvedValue({
      repoPath: 'D:/Project/devforge',
      workspacePath: 'D:/Project/devforge/.devforge/tmp/agents/task-1',
      appliedFiles: 1,
      deletedFiles: 0,
      skippedPaths: [],
    })
    api.workspaceIsolationCleanup.mockResolvedValue({
      workspacePath: 'D:/Project/devforge/.devforge/tmp/agents/task-1',
      mode: 'temporary',
      removed: true,
    })
  })

  it('prepares workspace and updates task workdir', async () => {
    const harness = createHarness()

    await expect(harness.service.prepare(harness.context, 'task-1', makePlan())).resolves.toBe('D:/Project/devforge/.devforge/tmp/agents/task-1')

    expect(api.workspaceIsolationPrepare).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: 'D:/Project/devforge',
      workspacePath: 'D:/Project/devforge/.devforge/tmp/agents/task-1',
      allowedPaths: ['src/**'],
    }))
    expect(harness.states['task-1']).toMatchObject({ status: 'prepared' })
    expect(harness.workDirs['task-1']).toBe('D:/Project/devforge/.devforge/tmp/agents/task-1')
  })

  it('diffs workspace and stores diff result', async () => {
    const harness = createHarness()

    await harness.service.diff(harness.context, 'task-1', makePlan())

    expect(api.workspaceIsolationDiff).toHaveBeenCalled()
    expect(harness.states['task-1']).toMatchObject({
      status: 'diffed',
      diff: expect.objectContaining({ entries: expect.any(Array) }),
    })
    expect(harness.notices.some(item => item.text.includes('隔离空间 Diff'))).toBe(true)
  })

  it('submits verification job in isolation workspace', async () => {
    const diff = makeDiff()
    const harness = createHarness({ states: { 'task-1': { status: 'diffed', diff } } })

    await harness.service.verify(harness.context, 'task-1', makePlan())

    expect(harness.submitVerificationJob).toHaveBeenCalledWith(
      'session-1',
      'D:/Project/devforge/.devforge/tmp/agents/task-1',
      expect.arrayContaining([expect.objectContaining({ command: 'pnpm vitest run src/ai-gui src/ai-gateway src/composables/__tests__' })]),
      expect.objectContaining({
        meta: expect.objectContaining({ workspaceIsolationTaskId: 'task-1' }),
      }),
    )
    expect(harness.states['task-1']).toMatchObject({ status: 'verified', verificationJobId: 'job-verify-1' })
  })

  it('blocks apply when task-scoped verification failed', async () => {
    const diff = makeDiff()
    const harness = createHarness({
      states: { 'task-1': { status: 'diffed', diff } },
      jobs: [
        makeVerificationJob({
          status: 'failed',
          meta: { workspaceIsolationTaskId: 'task-1' },
          error: 'Verification failed | duration=100ms | commands=1\n\n---\n\n$ pnpm test:typecheck\nstatus=failed duration=100ms\ntype error',
        }),
      ],
    })

    await harness.service.apply(harness.context, 'task-1', makePlan())

    expect(api.workspaceIsolationApplyChanges).not.toHaveBeenCalled()
    expect(harness.states['task-1']).toMatchObject({ status: 'error' })
    expect(harness.notices.some(item => item.text.includes('Verification Gate 阻止回放'))).toBe(true)
  })

  it('applies changes after confirmations when diff is valid', async () => {
    const diff = makeDiff()
    const harness = createHarness({ states: { 'task-1': { status: 'diffed', diff } } })

    await harness.service.apply(harness.context, 'task-1', makePlan())

    expect(api.workspaceIsolationApplyChanges).toHaveBeenCalledWith(expect.objectContaining({
      confirmed: true,
      mode: 'temporary',
    }))
    expect(harness.states['task-1']).toMatchObject({ status: 'applied' })
  })

  it('cleans up workspace after confirmation', async () => {
    const harness = createHarness()

    await harness.service.cleanup(harness.context, 'task-1', makePlan())

    expect(api.workspaceIsolationCleanup).toHaveBeenCalledWith(expect.objectContaining({
      force: false,
      workspacePath: 'D:/Project/devforge/.devforge/tmp/agents/task-1',
    }))
    expect(harness.states['task-1']).toMatchObject({ status: 'cleaned' })
  })
})
