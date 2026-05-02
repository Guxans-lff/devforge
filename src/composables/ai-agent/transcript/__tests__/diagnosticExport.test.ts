import { describe, expect, it } from 'vitest'
import { createTranscriptStore } from '../transcriptStore'
import { generateTranscriptDiagnosticReport } from '../diagnosticExport'
import type { AiTranscriptEvent } from '../transcriptTypes'

function makeEvent(partial: Omit<AiTranscriptEvent, 'id'>): Omit<AiTranscriptEvent, 'id'> {
  return partial
}

describe('diagnosticExport', () => {
  it('exports P2 Agent Runtime context history', () => {
    const store = createTranscriptStore()
    store.appendEvent(makeEvent({
      sessionId: 's1',
      turnId: 't1',
      type: 'agent_runtime_context',
      timestamp: 1000,
      payload: {
        type: 'agent_runtime_context',
        data: {
          assignmentCount: 2,
          blockedCount: 1,
          warningCount: 1,
          verificationRisk: 'high',
          verificationCommandCount: 3,
          verificationGateStatus: 'block',
          verificationSafeToComplete: false,
          verificationMissingCommandCount: 2,
          verificationFailedCommandCount: 1,
          isolationBoundaryCount: 2,
          isolationMergeRequiredCount: 1,
          isolationBlockedCount: 1,
          isolationWorktreeCount: 1,
          isolationTemporaryWorkspaceCount: 1,
          isolationReviewRequiredCount: 1,
          isolationConfirmationRequiredCount: 7,
          isolationGateStatus: 'confirm_required',
          isolationSafeToAutoRun: false,
          lspDiagnosticCount: 4,
          lspSummary: '诊断 4 条：error 0，warning 4，info/hint 0。',
          warnings: ['检测到任务依赖环：a -> b'],
        },
      },
    }))

    const report = generateTranscriptDiagnosticReport(store, 's1')

    expect(report.agentRuntimeContextHistory).toHaveLength(1)
    expect(report.agentRuntimeContextHistory[0]).toMatchObject({
      assignmentCount: 2,
      blockedCount: 1,
      verificationRisk: 'high',
      verificationGateStatus: 'block',
      verificationSafeToComplete: false,
      verificationMissingCommandCount: 2,
      verificationFailedCommandCount: 1,
      isolationMergeRequiredCount: 1,
      isolationBlockedCount: 1,
      isolationWorktreeCount: 1,
      isolationTemporaryWorkspaceCount: 1,
      isolationReviewRequiredCount: 1,
      isolationConfirmationRequiredCount: 7,
      isolationGateStatus: 'confirm_required',
      isolationSafeToAutoRun: false,
      lspDiagnosticCount: 4,
      warnings: ['检测到任务依赖环：a -> b'],
    })
    expect(report.agentRuntimeGovernance).toMatchObject({
      status: 'critical',
      contextCount: 1,
      maxBlockedCount: 1,
      maxIsolationBlockedCount: 1,
      maxIsolationMergeRequiredCount: 1,
      maxIsolationWorktreeCount: 1,
      maxIsolationTemporaryWorkspaceCount: 1,
      maxIsolationReviewRequiredCount: 1,
      maxIsolationConfirmationRequiredCount: 7,
      highRiskCount: 1,
      verificationBlockedCount: 1,
      maxVerificationMissingCommandCount: 2,
      maxVerificationFailedCommandCount: 1,
    })
    expect(report.agentRuntimeGovernance.recommendations.join('\n')).toContain('阻塞的 Multi-Agent')
    expect(report.agentRuntimeGovernance.recommendations.join('\n')).toContain('Verification Gate 已阻止完成')
  })
})
