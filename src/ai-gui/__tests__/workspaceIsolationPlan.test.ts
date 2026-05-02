import { describe, expect, it } from 'vitest'
import { buildWorkspaceIsolationExecutionPlan, createIsolationWorkspaceSlug } from '@/ai-gui/workspaceIsolationPlan'
import type { MultiAgentAssignment } from '@/ai-gui/multiAgentOrchestrator'
import type { WorkspaceIsolationBoundarySummary } from '@/ai-gui/workspaceIsolation'

function assignment(input: Partial<MultiAgentAssignment> & { taskId: string; agentId: string }): MultiAgentAssignment {
  return {
    role: 'implementer',
    allowedPaths: ['src/**'],
    dependsOn: [],
    reason: 'test',
    ...input,
  }
}

function boundary(input: Partial<WorkspaceIsolationBoundarySummary> & { ownerId: string }): WorkspaceIsolationBoundarySummary {
  return {
    strength: 'agent',
    allowedPaths: ['src/**'],
    blockedPaths: [],
    writable: true,
    ...input,
  }
}

describe('workspaceIsolationPlan', () => {
  it('plans readonly, temporary and worktree execution spaces by role and strength', () => {
    const plan = buildWorkspaceIsolationExecutionPlan({
      sessionId: 'session-1',
      assignments: [
        assignment({ taskId: 't1', agentId: 'implementer-1', role: 'implementer' }),
        assignment({ taskId: 't2', agentId: 'verifier-1', role: 'verifier' }),
        assignment({ taskId: 't3', agentId: 'implementer-2', role: 'implementer' }),
      ],
      boundaries: [
        boundary({ ownerId: 'tool:s1:implementer-1', strength: 'agent' }),
        boundary({ ownerId: 'tool:s1:verifier-1', strength: 'session' }),
        boundary({ ownerId: 'tool:s1:implementer-2', strength: 'strict' }),
      ],
    })

    expect(plan.items.map(item => item.mode)).toEqual(['temporary', 'readonly', 'worktree'])
    expect(plan.items[0]).toMatchObject({
      cleanupPolicy: 'delete_on_success',
      mergeRequired: true,
      requiresReview: false,
      workspace: {
        slug: 'session-1-implementer-1-t1',
        workspacePath: '.devforge/tmp/agents/session-1-implementer-1-t1',
      },
    })
    expect(plan.items[0]?.actions.map(item => item.type)).toEqual([
      'validate_boundary',
      'prepare_workspace',
      'run_agent',
      'review_diff',
      'merge_back',
      'cleanup_workspace',
    ])
    expect(plan.items[0]?.actions.filter(item => item.requiresConfirmation)).toHaveLength(3)
    expect(plan.items[1]).toMatchObject({
      cleanupPolicy: 'none',
      mergeRequired: false,
      requiresReview: false,
      workspace: undefined,
    })
    expect(plan.items[1]?.actions.map(item => item.type)).toEqual([
      'validate_boundary',
      'prepare_workspace',
      'run_agent',
    ])
    expect(plan.items[2]).toMatchObject({
      cleanupPolicy: 'keep_for_review',
      mergeRequired: true,
      requiresReview: true,
      workspace: {
        slug: 'session-1-implementer-2-t3',
        workspacePath: '.devforge/worktrees/session-1-implementer-2-t3',
        branchName: 'devforge/agent/session-1-implementer-2-t3',
      },
    })
    expect(plan.items[2]?.actions.filter(item => item.requiresConfirmation)).toHaveLength(4)
    expect(plan.mergeRequiredCount).toBe(2)
    expect(plan.blockedCount).toBe(0)
    expect(plan.worktreeCount).toBe(1)
    expect(plan.temporaryWorkspaceCount).toBe(1)
    expect(plan.reviewRequiredCount).toBe(1)
    expect(plan.confirmationRequiredCount).toBe(7)
    expect(plan.gate).toMatchObject({
      status: 'confirm_required',
      safeToAutoRun: false,
    })
    expect(plan.gate.reasons.join('\n')).toContain('7 个执行动作需要人工确认')
    expect(plan.warnings).toContain('2 个 Agent 需要合并审核。')
    expect(plan.warnings.join('\n')).toContain('独立 worktree')
  })

  it('blocks execution spaces when boundary summary has a hard reason', () => {
    const plan = buildWorkspaceIsolationExecutionPlan({
      assignments: [
        assignment({ taskId: 't1', agentId: 'implementer-1' }),
      ],
      boundaries: [
        boundary({
          ownerId: 'tool:s1:implementer-1',
          strength: 'strict',
          allowedPaths: [],
          reason: 'strict 模式建议显式配置 allowedPaths，避免无限制写入。',
        }),
      ],
    })

    expect(plan.items[0]).toMatchObject({
      mode: 'blocked',
      mergeRequired: false,
      cleanupPolicy: 'none',
      requiresReview: false,
      workspace: undefined,
    })
    expect(plan.items[0]?.actions).toEqual([
      {
        type: 'blocked',
        label: '阻塞执行',
        description: '隔离边界校验失败，不能启动 Agent。',
        requiresConfirmation: false,
      },
    ])
    expect(plan.blockedCount).toBe(1)
    expect(plan.confirmationRequiredCount).toBe(0)
    expect(plan.gate).toMatchObject({
      status: 'blocked',
      safeToAutoRun: false,
    })
    expect(plan.warnings).toContain('1 个 Agent 无法创建隔离执行空间。')
  })

  it('allows automatic execution for shared readonly plans without confirmation actions', () => {
    const plan = buildWorkspaceIsolationExecutionPlan({
      assignments: [
        assignment({ taskId: 't1', agentId: 'reviewer-1', role: 'reviewer' }),
      ],
      boundaries: [
        boundary({ ownerId: 'tool:s1:reviewer-1', strength: 'session' }),
      ],
    })

    expect(plan.items[0]?.mode).toBe('readonly')
    expect(plan.confirmationRequiredCount).toBe(0)
    expect(plan.gate).toEqual({
      status: 'allow',
      reasons: [],
      safeToAutoRun: true,
    })
  })

  it('creates deterministic filesystem-safe workspace slugs', () => {
    expect(createIsolationWorkspaceSlug({
      sessionId: 'Session/中文 1',
      agentId: 'Implementer#1',
      taskId: '../Task:Runtime.vue',
    })).toBe('session-1-implementer-1-task-runtime-vue')
  })
})
