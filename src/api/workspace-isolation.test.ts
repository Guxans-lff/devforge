import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  workspaceIsolationApplyChanges,
  workspaceIsolationCleanup,
  workspaceIsolationDiff,
  workspaceIsolationPrepare,
  workspaceIsolationValidatePath,
} from '@/api/workspace-isolation'

const { invokeCommandMock } = vi.hoisted(() => ({
  invokeCommandMock: vi.fn(),
}))

vi.mock('@/api/base', () => ({
  invokeCommand: invokeCommandMock,
}))

describe('workspace-isolation api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeCommandMock.mockResolvedValue(undefined)
  })

  it('routes workspace isolation commands through stable Tauri names', async () => {
    await workspaceIsolationValidatePath({
      repoPath: 'D:/repo',
      workspacePath: 'D:/repo/.devforge/tmp/agents/a',
      mode: 'temporary',
    })
    await workspaceIsolationPrepare({
      repoPath: 'D:/repo',
      workspacePath: 'D:/repo/.devforge/tmp/agents/a',
      mode: 'temporary',
      allowedPaths: ['src/**'],
      blockedPaths: ['src/secrets/**'],
    })
    await workspaceIsolationDiff({
      repoPath: 'D:/repo',
      workspacePath: 'D:/repo/.devforge/tmp/agents/a',
      mode: 'temporary',
    })
    await workspaceIsolationApplyChanges({
      repoPath: 'D:/repo',
      workspacePath: 'D:/repo/.devforge/tmp/agents/a',
      mode: 'temporary',
      confirmed: true,
    })
    await workspaceIsolationCleanup({
      repoPath: 'D:/repo',
      workspacePath: 'D:/repo/.devforge/tmp/agents/a',
      mode: 'temporary',
      force: false,
    })

    expect(invokeCommandMock).toHaveBeenNthCalledWith(1, 'workspace_isolation_validate_path', {
      repoPath: 'D:/repo',
      workspacePath: 'D:/repo/.devforge/tmp/agents/a',
      mode: 'temporary',
    }, { source: 'AI' })
    expect(invokeCommandMock).toHaveBeenNthCalledWith(2, 'workspace_isolation_prepare', {
      repoPath: 'D:/repo',
      workspacePath: 'D:/repo/.devforge/tmp/agents/a',
      mode: 'temporary',
      allowedPaths: ['src/**'],
      blockedPaths: ['src/secrets/**'],
    }, { source: 'AI' })
    expect(invokeCommandMock).toHaveBeenNthCalledWith(3, 'workspace_isolation_diff', {
      repoPath: 'D:/repo',
      workspacePath: 'D:/repo/.devforge/tmp/agents/a',
      mode: 'temporary',
    }, { source: 'AI' })
    expect(invokeCommandMock).toHaveBeenNthCalledWith(4, 'workspace_isolation_apply_changes', {
      repoPath: 'D:/repo',
      workspacePath: 'D:/repo/.devforge/tmp/agents/a',
      mode: 'temporary',
      confirmed: true,
    }, { source: 'AI' })
    expect(invokeCommandMock).toHaveBeenNthCalledWith(5, 'workspace_isolation_cleanup', {
      repoPath: 'D:/repo',
      workspacePath: 'D:/repo/.devforge/tmp/agents/a',
      mode: 'temporary',
      force: false,
    }, { source: 'AI' })
  })
})
