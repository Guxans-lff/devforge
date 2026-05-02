import type { VerificationAgentPlan } from './verificationAgent'
import type { ParsedVerificationReport } from './verificationReport'

export type VerificationGateStatus = 'allow' | 'warn' | 'block'

export interface VerificationGateInput {
  changedFiles: string[]
  plan?: VerificationAgentPlan | null
  report?: ParsedVerificationReport | null
  verifying?: boolean
}

export interface VerificationGateDecision {
  status: VerificationGateStatus
  safeToComplete: boolean
  requiredCommands: string[]
  missingCommands: string[]
  failedCommands: string[]
  reasons: string[]
}

function unique(items: string[]): string[] {
  return [...new Set(items.map(item => item.trim()).filter(Boolean))]
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

function hasRiskyChanges(files: string[]): boolean {
  return files.some(file => /(^src\/(ai-gui|ai-gateway|composables\/ai|composables\/ai-agent)|^src-tauri\/|package\.json|pnpm-lock\.yaml|Cargo\.toml)/i.test(file))
}

export function buildVerificationGateDecision(input: VerificationGateInput): VerificationGateDecision {
  const changedFiles = unique(input.changedFiles.map(file => file.replace(/\\/g, '/')))
  const requiredCommands = unique(input.plan?.commands.map(item => normalizeCommand(item.command)) ?? [])
  const reportCommands = input.report?.commands ?? []
  const completedCommands = new Set(
    reportCommands
      .filter(item => item.status === 'ok')
      .map(item => normalizeCommand(item.command)),
  )
  const failedCommands = unique(
    reportCommands
      .filter(item => item.status === 'failed')
      .map(item => normalizeCommand(item.command)),
  )
  const missingCommands = requiredCommands.filter(command => !completedCommands.has(command))
  const reasons: string[] = []

  if (input.verifying) {
    reasons.push('验证任务仍在运行，暂不应标记完成。')
  }
  if (failedCommands.length > 0 || input.report?.status === 'failed') {
    reasons.push('最近验证存在失败命令。')
  }
  if (requiredCommands.length > 0 && missingCommands.length > 0) {
    reasons.push(`${missingCommands.length} 条 Verification Agent 命令缺少通过证据。`)
  }
  if (!input.report && requiredCommands.length > 0) {
    reasons.push('尚未产生 Verification Agent 验证报告。')
  }
  if (changedFiles.length > 0 && requiredCommands.length === 0 && hasRiskyChanges(changedFiles)) {
    reasons.push('存在高风险变更，但没有生成验证命令。')
  }

  const status: VerificationGateStatus = failedCommands.length > 0 || input.report?.status === 'failed'
    ? 'block'
    : input.verifying || reasons.length > 0
      ? 'warn'
      : 'allow'

  return {
    status,
    safeToComplete: status === 'allow',
    requiredCommands,
    missingCommands,
    failedCommands,
    reasons,
  }
}
