import type { AgentRuntimeContextHistoryItem } from '@/composables/ai-agent/transcript/transcriptTypes'

export type AdvancedAgentGovernanceStatus = 'healthy' | 'watch' | 'critical'

export interface AdvancedAgentGovernanceSnapshot {
  status: AdvancedAgentGovernanceStatus
  contextCount: number
  latestRisk?: string
  maxBlockedCount: number
  maxIsolationBlockedCount: number
  maxIsolationMergeRequiredCount: number
  maxIsolationWorktreeCount: number
  maxIsolationTemporaryWorkspaceCount: number
  maxIsolationReviewRequiredCount: number
  maxIsolationConfirmationRequiredCount: number
  maxLspDiagnosticCount: number
  highRiskCount: number
  verificationBlockedCount: number
  verificationWarningCount: number
  maxVerificationMissingCommandCount: number
  maxVerificationFailedCommandCount: number
  warningCount: number
  recommendations: string[]
}

function maxBy(items: number[]): number {
  return items.length > 0 ? Math.max(...items) : 0
}

export function buildAdvancedAgentGovernanceSnapshot(
  history: AgentRuntimeContextHistoryItem[],
): AdvancedAgentGovernanceSnapshot {
  const latest = history.length > 0 ? history[history.length - 1] : undefined
  const maxBlockedCount = maxBy(history.map(item => item.blockedCount))
  const maxIsolationBlockedCount = maxBy(history.map(item => item.isolationBlockedCount ?? 0))
  const maxIsolationMergeRequiredCount = maxBy(history.map(item => item.isolationMergeRequiredCount ?? 0))
  const maxIsolationWorktreeCount = maxBy(history.map(item => item.isolationWorktreeCount ?? 0))
  const maxIsolationTemporaryWorkspaceCount = maxBy(history.map(item => item.isolationTemporaryWorkspaceCount ?? 0))
  const maxIsolationReviewRequiredCount = maxBy(history.map(item => item.isolationReviewRequiredCount ?? 0))
  const maxIsolationConfirmationRequiredCount = maxBy(history.map(item => item.isolationConfirmationRequiredCount ?? 0))
  const maxLspDiagnosticCount = maxBy(history.map(item => item.lspDiagnosticCount))
  const highRiskCount = history.filter(item => item.verificationRisk === 'high').length
  const verificationBlockedCount = history.filter(item => item.verificationGateStatus === 'block').length
  const verificationWarningCount = history.filter(item => item.verificationGateStatus === 'warn').length
  const maxVerificationMissingCommandCount = maxBy(history.map(item => item.verificationMissingCommandCount ?? 0))
  const maxVerificationFailedCommandCount = maxBy(history.map(item => item.verificationFailedCommandCount ?? 0))
  const unsafeAutoRunCount = history.filter(item => item.isolationSafeToAutoRun === false).length
  const warningCount = history.reduce((sum, item) => sum + item.warningCount, 0)
  const recommendations: string[] = []

  if (maxBlockedCount > 0) {
    recommendations.push('存在阻塞的 Multi-Agent 任务，优先检查依赖环或缺失依赖。')
  }
  if (maxIsolationBlockedCount > 0) {
    recommendations.push('存在无法创建隔离执行空间的 Agent，需要收紧 allowedPaths 或调整隔离强度。')
  }
  if (maxIsolationMergeRequiredCount > 0) {
    recommendations.push('存在需要合并审核的隔离执行空间，合入前应查看 diff。')
  }
  if (maxIsolationWorktreeCount > 0) {
    recommendations.push('存在 worktree 隔离计划，真实执行前需要确认分支名、路径和清理策略。')
  }
  if (maxIsolationTemporaryWorkspaceCount > 0) {
    recommendations.push('存在临时隔离空间计划，成功后应自动清理，失败时保留现场。')
  }
  if (maxIsolationConfirmationRequiredCount > 0) {
    recommendations.push('存在需要人工确认的隔离执行动作，禁止静默创建、合并或清理工作区。')
  }
  if (unsafeAutoRunCount > 0) {
    recommendations.push('隔离门禁未放行自动执行，应先处理阻塞或完成确认。')
  }
  if (highRiskCount > 0) {
    recommendations.push('存在 high 风险验证计划，合入前必须保留验证证据。')
  }
  if (verificationBlockedCount > 0 || maxVerificationFailedCommandCount > 0) {
    recommendations.push('Verification Gate 已阻止完成，必须先修复失败命令并重新验证。')
  }
  if (verificationWarningCount > 0 || maxVerificationMissingCommandCount > 0) {
    recommendations.push('Verification Gate 缺少通过证据，完成前应补齐缺失验证命令。')
  }
  if (maxLspDiagnosticCount > 0) {
    recommendations.push('存在 LSP/静态诊断问题，建议在 Verification Agent 前先清理。')
  }
  if (warningCount > 0) {
    recommendations.push('存在运行时治理警告，需要在诊断面板或导出报告中复核。')
  }

  const status: AdvancedAgentGovernanceStatus = maxBlockedCount > 0 || maxIsolationBlockedCount > 0 || highRiskCount > 0 || verificationBlockedCount > 0
    ? 'critical'
    : maxIsolationMergeRequiredCount > 0 || unsafeAutoRunCount > 0 || verificationWarningCount > 0 || maxLspDiagnosticCount > 0 || warningCount > 0
      ? 'watch'
      : 'healthy'

  return {
    status,
    contextCount: history.length,
    latestRisk: latest?.verificationRisk,
    maxBlockedCount,
    maxIsolationBlockedCount,
    maxIsolationMergeRequiredCount,
    maxIsolationWorktreeCount,
    maxIsolationTemporaryWorkspaceCount,
    maxIsolationReviewRequiredCount,
    maxIsolationConfirmationRequiredCount,
    maxLspDiagnosticCount,
    highRiskCount,
    verificationBlockedCount,
    verificationWarningCount,
    maxVerificationMissingCommandCount,
    maxVerificationFailedCommandCount,
    warningCount,
    recommendations,
  }
}
