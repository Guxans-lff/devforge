import type { WorkspaceIsolationDiffResult } from '@/api/workspace-isolation'
import type { BackgroundJob } from '@/stores/background-job'
import { buildVerificationAgentPlan } from './verificationAgent'
import { buildVerificationGateDecision, type VerificationGateDecision } from './verificationGate'
import { parseVerificationReport, type ParsedVerificationReport } from './verificationReport'

export function summarizeWorkspaceIsolationDiff(diff: WorkspaceIsolationDiffResult): string {
  return `新增 ${diff.summary.added}，修改 ${diff.summary.modified}，删除 ${diff.summary.deleted}，共 ${diff.entries.length} 个变更文件`
}

export function getWorkspaceIsolationDiffStatusLabel(status: string): string {
  switch (status) {
    case 'added': return '新增'
    case 'modified': return '修改'
    case 'deleted': return '删除'
    case 'renamed': return '重命名'
    case 'conflicted': return '冲突'
    default: return status
  }
}

export function formatWorkspaceIsolationDiffPreview(diff: WorkspaceIsolationDiffResult, limit = 5): string {
  if (diff.entries.length === 0) return '无变更文件'
  const visibleEntries = diff.entries.slice(0, limit)
    .map(entry => `- ${getWorkspaceIsolationDiffStatusLabel(entry.status)} ${entry.path}`)
  const hiddenCount = diff.entries.length - visibleEntries.length
  if (hiddenCount > 0) {
    visibleEntries.push(`- 还有 ${hiddenCount} 个变更未显示`)
  }
  return visibleEntries.join('\n')
}

export function formatVerificationGateReasons(reasons: string[]): string {
  return reasons.length > 0 ? reasons.map(reason => `- ${reason}`).join('\n') : '- 无'
}

export function latestWorkspaceIsolationVerificationJob(
  jobs: BackgroundJob[],
  taskId: string,
): BackgroundJob | null {
  return jobs
    .filter(job => job.kind === 'verification' && job.meta?.workspaceIsolationTaskId === taskId)
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
}

export function buildWorkspaceIsolationVerificationCommands(diff: WorkspaceIsolationDiffResult) {
  const changedFiles = diff.entries.map(entry => entry.path)
  return buildVerificationAgentPlan({
    changedFiles,
    includeTypecheck: true,
    includeRustCheck: changedFiles.some(file => file.replace(/\\/g, '/').startsWith('src-tauri/')),
    maxCommands: 4,
  }).commands
}

export function buildWorkspaceIsolationVerificationGate(input: {
  taskId: string
  diff: WorkspaceIsolationDiffResult
  jobs: BackgroundJob[]
  fallbackReport?: ParsedVerificationReport | null
  fallbackVerifying?: boolean
}): VerificationGateDecision {
  const changedFiles = input.diff.entries.map(entry => entry.path)
  const plan = buildVerificationAgentPlan({
    changedFiles,
    includeTypecheck: true,
    includeRustCheck: changedFiles.some(file => file.replace(/\\/g, '/').startsWith('src-tauri/')),
    maxCommands: 4,
  })
  const isolationJob = latestWorkspaceIsolationVerificationJob(input.jobs, input.taskId)
  const isolationReport = parseVerificationReport(isolationJob?.result ?? isolationJob?.error)
  const isolationVerifying = isolationJob
    ? isolationJob.status === 'queued' || isolationJob.status === 'running' || isolationJob.status === 'cancelling'
    : false

  return buildVerificationGateDecision({
    changedFiles,
    plan,
    report: isolationReport ?? input.fallbackReport ?? null,
    verifying: isolationVerifying || Boolean(input.fallbackVerifying),
  })
}
