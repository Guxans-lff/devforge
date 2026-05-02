import { describe, expect, it } from 'vitest'
import { buildAdvancedAgentGovernanceSnapshot } from '@/ai-gui/advancedAgentGovernance'

describe('advancedAgentGovernance', () => {
  it('marks empty or clean runtime history as healthy', () => {
    expect(buildAdvancedAgentGovernanceSnapshot([])).toMatchObject({
      status: 'healthy',
      contextCount: 0,
      maxBlockedCount: 0,
      maxIsolationBlockedCount: 0,
      maxIsolationMergeRequiredCount: 0,
      maxIsolationWorktreeCount: 0,
      maxIsolationTemporaryWorkspaceCount: 0,
      maxIsolationReviewRequiredCount: 0,
      maxIsolationConfirmationRequiredCount: 0,
      highRiskCount: 0,
      recommendations: [],
    })
  })

  it('escalates blocked and high-risk contexts to critical with recommendations', () => {
    const snapshot = buildAdvancedAgentGovernanceSnapshot([
      {
        timestamp: 1,
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
        lspSummary: '诊断 4 条',
        warnings: ['检测到任务依赖环'],
      },
    ])

    expect(snapshot).toMatchObject({
      status: 'critical',
      latestRisk: 'high',
      maxBlockedCount: 1,
      maxIsolationBlockedCount: 1,
      maxIsolationMergeRequiredCount: 1,
      maxIsolationWorktreeCount: 1,
      maxIsolationTemporaryWorkspaceCount: 1,
      maxIsolationReviewRequiredCount: 1,
      maxIsolationConfirmationRequiredCount: 7,
      maxLspDiagnosticCount: 4,
      highRiskCount: 1,
      verificationBlockedCount: 1,
      maxVerificationMissingCommandCount: 2,
      maxVerificationFailedCommandCount: 1,
      warningCount: 1,
    })
    expect(snapshot.recommendations.join('\n')).toContain('阻塞的 Multi-Agent')
    expect(snapshot.recommendations.join('\n')).toContain('high 风险验证计划')
    expect(snapshot.recommendations.join('\n')).toContain('Verification Gate 已阻止完成')
    expect(snapshot.recommendations.join('\n')).toContain('隔离执行空间')
    expect(snapshot.recommendations.join('\n')).toContain('worktree 隔离计划')
    expect(snapshot.recommendations.join('\n')).toContain('临时隔离空间计划')
    expect(snapshot.recommendations.join('\n')).toContain('需要人工确认')
    expect(snapshot.recommendations.join('\n')).toContain('隔离门禁未放行')
  })

  it('marks diagnostics-only history as watch', () => {
    expect(buildAdvancedAgentGovernanceSnapshot([
      {
        timestamp: 1,
        assignmentCount: 1,
        blockedCount: 0,
        warningCount: 0,
        verificationRisk: 'medium',
        verificationCommandCount: 1,
        verificationGateStatus: 'warn',
        verificationSafeToComplete: false,
        verificationMissingCommandCount: 1,
        verificationFailedCommandCount: 0,
        isolationBoundaryCount: 1,
        isolationMergeRequiredCount: 0,
        isolationBlockedCount: 0,
        lspDiagnosticCount: 2,
        lspSummary: '诊断 2 条',
        warnings: [],
      },
    ])).toMatchObject({
      status: 'watch',
      maxLspDiagnosticCount: 2,
      verificationWarningCount: 1,
      maxVerificationMissingCommandCount: 1,
    })
  })
})
