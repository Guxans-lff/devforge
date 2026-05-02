import { describe, expect, it } from 'vitest'
import type { WorkspaceIsolationDiffResult } from '@/api/workspace-isolation'
import type { BackgroundJob } from '@/stores/background-job'
import {
  buildWorkspaceIsolationVerificationCommands,
  buildWorkspaceIsolationVerificationGate,
  formatVerificationGateReasons,
  formatWorkspaceIsolationDiffPreview,
  latestWorkspaceIsolationVerificationJob,
  summarizeWorkspaceIsolationDiff,
} from '../workspaceIsolationRuntime'

function makeDiff(overrides?: Partial<WorkspaceIsolationDiffResult>): WorkspaceIsolationDiffResult {
  return {
    repoPath: 'D:/Project/devforge',
    workspacePath: 'D:/Project/devforge/.devforge/tmp/agents/task-1',
    mode: 'temporary',
    entries: [
      { path: 'src/ai-gui/runtime.ts', status: 'modified' },
      { path: 'src-tauri/src/commands/workspace_isolation.rs', status: 'added' },
      { path: 'docs/old.md', status: 'deleted' },
      { path: 'src/renamed.ts', status: 'renamed' },
      { path: 'src/conflict.ts', status: 'conflicted' },
      { path: 'src/extra.ts', status: 'modified' },
    ],
    summary: { added: 1, modified: 3, deleted: 1, unchanged: 2 },
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

describe('workspaceIsolationRuntime', () => {
  it('formats diff summary and preview with Chinese labels', () => {
    const diff = makeDiff()

    expect(summarizeWorkspaceIsolationDiff(diff)).toBe('新增 1，修改 3，删除 1，共 6 个变更文件')
    expect(formatWorkspaceIsolationDiffPreview(diff)).toContain('- 修改 src/ai-gui/runtime.ts')
    expect(formatWorkspaceIsolationDiffPreview(diff)).toContain('- 新增 src-tauri/src/commands/workspace_isolation.rs')
    expect(formatWorkspaceIsolationDiffPreview(diff)).toContain('- 还有 1 个变更未显示')
    expect(formatVerificationGateReasons([])).toBe('- 无')
  })

  it('builds verification commands from isolation diff', () => {
    const commands = buildWorkspaceIsolationVerificationCommands(makeDiff()).map(item => item.command)

    expect(commands).toContain('pnpm vitest run src/ai-gui src/ai-gateway src/composables/__tests__')
    expect(commands).toContain('pnpm test:typecheck')
    expect(commands).toContain('cargo check --manifest-path src-tauri/Cargo.toml')
  })

  it('uses latest task-scoped verification job before fallback report', () => {
    const diff = makeDiff({ entries: [{ path: 'src/ai-gui/runtime.ts', status: 'modified' }] })
    const failedFallback = {
      status: 'failed' as const,
      commandCount: 1,
      commands: [{ command: 'pnpm test:typecheck', status: 'failed' as const, output: 'type error' }],
      summary: '验证失败',
    }
    const jobs = [
      makeVerificationJob({
        id: 'older',
        createdAt: 1000,
        meta: { workspaceIsolationTaskId: 'task-1' },
        result: [
          'Verification passed | duration=200ms | commands=2',
          '$ pnpm vitest run src/ai-gui src/ai-gateway src/composables/__tests__\nstatus=ok duration=100ms\nok',
          '$ pnpm test:typecheck\nstatus=ok duration=100ms\nok',
        ].join('\n\n---\n\n'),
      }),
      makeVerificationJob({
        id: 'newer-other-task',
        createdAt: 2000,
        meta: { workspaceIsolationTaskId: 'task-2' },
      }),
    ]

    expect(latestWorkspaceIsolationVerificationJob(jobs, 'task-1')?.id).toBe('older')
    expect(buildWorkspaceIsolationVerificationGate({
      taskId: 'task-1',
      diff,
      jobs,
      fallbackReport: failedFallback,
    }).status).toBe('allow')
  })

  it('blocks when task-scoped verification failed', () => {
    const diff = makeDiff({ entries: [{ path: 'src/ai-gui/runtime.ts', status: 'modified' }] })
    const gate = buildWorkspaceIsolationVerificationGate({
      taskId: 'task-1',
      diff,
      jobs: [
        makeVerificationJob({
          id: 'failed',
          status: 'failed',
          meta: { workspaceIsolationTaskId: 'task-1' },
          error: 'Verification failed | duration=100ms | commands=1\n\n---\n\n$ pnpm test:typecheck\nstatus=failed duration=100ms\ntype error',
        }),
      ],
    })

    expect(gate.status).toBe('block')
    expect(gate.reasons.join('\n')).toContain('最近验证存在失败命令')
  })
})
