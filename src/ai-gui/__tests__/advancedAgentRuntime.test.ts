import { describe, expect, it } from 'vitest'
import {
  buildAdvancedAgentRuntimeContext,
  buildAdvancedAgentRuntimePayload,
  createAdvancedAgentRuntimePayloadSignature,
} from '@/ai-gui/advancedAgentRuntime'
import { parseVerificationReport } from '@/ai-gui/verificationReport'
import type { SpawnedTask } from '@/composables/ai/chatSideEffects'

function task(input: Partial<SpawnedTask> & { id: string; description: string }): SpawnedTask {
  return {
    status: 'pending',
    createdAt: 1,
    retryCount: 0,
    ...input,
  }
}

describe('advancedAgentRuntime', () => {
  it('builds a consumable P2 runtime context from tasks, files and isolation config', async () => {
    const context = await buildAdvancedAgentRuntimeContext({
      sessionId: 'session-1',
      tasks: [
        task({ id: 't1', description: '实现 src/ai-gui/runtime.ts' }),
        task({ id: 't2', description: '验证 pnpm test', dependsOn: ['t1'] }),
      ],
      changedFiles: ['src/ai-gui/runtime.ts', 'src-tauri/src/services/ai/runtime.rs'],
      workspaceIsolation: {
        strength: 'strict',
        allowedPaths: ['src/ai-gui/**'],
        blockedPaths: ['src/secrets/**'],
      },
      lspFiles: [
        {
          path: 'src/ai-gui/runtime.ts',
          content: 'const value: any = 1',
        },
      ],
      maxAgents: 2,
    })

    expect(context.multiAgentPlan.assignments).toHaveLength(2)
    expect(context.multiAgentPlan.assignments[0]).toMatchObject({
      agentId: 'implementer-1',
      role: 'implementer',
    })
    expect(context.isolationBoundaries[0]).toMatchObject({
      ownerId: 'tool:session-1:implementer-1',
      strength: 'strict',
      allowedPaths: ['src/ai-gui/**'],
      blockedPaths: ['src/secrets/**'],
    })
    expect(context.isolationExecutionPlan.items[0]).toMatchObject({
      agentId: 'implementer-1',
      mode: 'worktree',
      mergeRequired: true,
      requiresReview: true,
      cleanupPolicy: 'keep_for_review',
      workspace: {
        workspacePath: '.devforge/worktrees/session-1-implementer-1-t1',
        branchName: 'devforge/agent/session-1-implementer-1-t1',
      },
    })
    expect(context.isolationExecutionPlan.mergeRequiredCount).toBe(1)
    expect(context.isolationExecutionPlan.worktreeCount).toBe(1)
    expect(context.isolationExecutionPlan.reviewRequiredCount).toBe(1)
    expect(context.isolationExecutionPlan.confirmationRequiredCount).toBe(4)
    expect(context.isolationExecutionPlan.gate).toMatchObject({
      status: 'confirm_required',
      safeToAutoRun: false,
    })
    expect(context.verificationPlan.commands.map(item => item.command)).toContain('pnpm vitest run src/ai-gui src/ai-gateway src/composables/__tests__')
    expect(context.verificationPlan.commands.map(item => item.command)).toContain('cargo check --manifest-path src-tauri/Cargo.toml')
    expect(context.verificationGate.status).toBe('warn')
    expect(context.verificationGate.missingCommands.length).toBeGreaterThan(0)
    expect(context.lspSummary).toContain('诊断 1 条')
    expect(context.lspDiagnostics[0]).toMatchObject({
      path: 'src/ai-gui/runtime.ts',
      severity: 'warning',
    })
  })

  it('builds stable payload signatures for transcript de-duplication', async () => {
    const context = await buildAdvancedAgentRuntimeContext({
      sessionId: 'session-1',
      tasks: [
        task({ id: 't1', description: '实现 src/ai-gui/runtime.ts' }),
      ],
      changedFiles: ['src/ai-gui/runtime.ts'],
    })

    const payload = buildAdvancedAgentRuntimePayload(context)
    const signature = createAdvancedAgentRuntimePayloadSignature(payload)

    expect(payload).toMatchObject({
      assignmentCount: 1,
      blockedCount: 0,
      verificationRisk: 'high',
      verificationGateStatus: 'warn',
      verificationSafeToComplete: false,
      verificationFailedCommandCount: 0,
      isolationMergeRequiredCount: 1,
      isolationBlockedCount: 0,
      isolationWorktreeCount: 0,
      isolationTemporaryWorkspaceCount: 1,
      isolationReviewRequiredCount: 0,
      isolationConfirmationRequiredCount: 3,
      isolationGateStatus: 'confirm_required',
      isolationSafeToAutoRun: false,
    })
    expect(createAdvancedAgentRuntimePayloadSignature({ ...payload })).toBe(signature)
  })

  it('records failed Verification Gate evidence in runtime payload', async () => {
    const context = await buildAdvancedAgentRuntimeContext({
      sessionId: 'session-1',
      tasks: [
        task({ id: 't1', description: '实现 src/ai-gui/runtime.ts' }),
      ],
      changedFiles: ['src/ai-gui/runtime.ts'],
      verificationReport: parseVerificationReport([
        'Verification failed | duration=100ms | commands=1',
        '$ pnpm test:typecheck\nstatus=failed duration=100ms\ntype error',
      ].join('\n\n---\n\n')),
    })

    const payload = buildAdvancedAgentRuntimePayload(context)

    expect(context.verificationGate.status).toBe('block')
    expect(payload).toMatchObject({
      verificationGateStatus: 'block',
      verificationSafeToComplete: false,
      verificationFailedCommandCount: 1,
    })
    expect(payload.verificationMissingCommandCount).toBeGreaterThan(0)
    expect(payload.warnings.join('\n')).toContain('最近验证存在失败命令')
  })
})
