import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceIsolationRuntimeController } from '@/ai-gui/workspaceIsolationRuntimeController'
import type { WorkspaceIsolationExecutionPlanItem } from '@/ai-gui/workspaceIsolationPlan'

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
    blockedPaths: [],
    reason: 'test',
    mergeRequired: true,
    requiresReview: false,
    cleanupPolicy: 'delete_on_success',
    workspace: {
      slug: 'task-1',
      workspacePath: '.devforge/tmp/agents/task-1',
    },
    actions: [],
  }
}

function createHarness(context: ReturnType<Parameters<typeof createWorkspaceIsolationRuntimeController>[0]['getContext']>) {
  const states: Record<string, any> = {}
  const workDirs: Record<string, string> = {}
  const controller = createWorkspaceIsolationRuntimeController({
    confirm: () => true,
    getContext: () => context,
    notice: vi.fn(),
    setState: (taskId, state) => {
      states[taskId] = state
    },
    setTaskIsolationWorkDir: (taskId, workspacePath) => {
      workDirs[taskId] = workspacePath
    },
    submitVerificationJob: vi.fn(),
  })
  return { controller, states, workDirs }
}

describe('workspaceIsolationRuntimeController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.workspaceIsolationPrepare.mockResolvedValue({
      repoPath: 'D:/repo',
      workspacePath: 'D:/repo/.devforge/tmp/agents/task-1',
      mode: 'temporary',
      copiedFiles: 1,
      skippedPaths: [],
      reusedExisting: false,
    })
    api.workspaceIsolationDiff.mockResolvedValue({
      repoPath: 'D:/repo',
      workspacePath: 'D:/repo/.devforge/tmp/agents/task-1',
      mode: 'temporary',
      entries: [],
      summary: { added: 0, modified: 0, deleted: 0, unchanged: 0 },
    })
  })

  it('sets a task error when runtime context is unavailable', async () => {
    const harness = createHarness(null)

    await expect(harness.controller.prepare('task-1', makePlan())).resolves.toBeNull()
    await harness.controller.run('diff', 'task-1', makePlan())

    expect(api.workspaceIsolationPrepare).not.toHaveBeenCalled()
    expect(api.workspaceIsolationDiff).not.toHaveBeenCalled()
    expect(harness.states['task-1']).toEqual({
      status: 'error',
      message: '缺少 workspace root 或隔离执行计划。',
    })
  })

  it('forwards prepare and actions to the runtime service when context exists', async () => {
    const harness = createHarness({
      repoPath: 'D:/repo',
      sessionId: 'session-1',
      states: {},
      jobs: [],
      fallbackVerificationReport: null,
      fallbackVerifying: false,
    })

    await expect(harness.controller.prepare('task-1', makePlan(), { prompt: false })).resolves.toBe(
      'D:/repo/.devforge/tmp/agents/task-1',
    )
    await harness.controller.run('diff', 'task-1', makePlan())

    expect(api.workspaceIsolationPrepare).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: 'D:/repo',
      workspacePath: 'D:/repo/.devforge/tmp/agents/task-1',
    }))
    expect(api.workspaceIsolationDiff).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: 'D:/repo',
      workspacePath: 'D:/repo/.devforge/tmp/agents/task-1',
    }))
    expect(harness.workDirs['task-1']).toBe('D:/repo/.devforge/tmp/agents/task-1')
  })
})
