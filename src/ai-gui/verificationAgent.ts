import type { VerificationCommand } from '@/composables/useVerificationJob'

export type VerificationAgentRisk = 'low' | 'medium' | 'high'

export interface VerificationAgentInput {
  changedFiles: string[]
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'cargo'
  includeTypecheck?: boolean
  includeRustCheck?: boolean
  maxCommands?: number
}

export interface VerificationAgentPlan {
  risk: VerificationAgentRisk
  commands: VerificationCommand[]
  rationale: string[]
}

export interface VerificationAgentEvaluation {
  passed: boolean
  confidence: 'low' | 'medium' | 'high'
  summary: string
  failedCommands: string[]
  incompleteCommands: string[]
  evidence: string[]
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function hasAny(files: string[], pattern: RegExp): boolean {
  return files.some(file => pattern.test(file))
}

function packageRun(packageManager: VerificationAgentInput['packageManager'], script: string): string {
  if (packageManager === 'npm') return `npm run ${script}`
  if (packageManager === 'yarn') return `yarn ${script}`
  return `pnpm ${script}`
}

export function buildVerificationAgentPlan(input: VerificationAgentInput): VerificationAgentPlan {
  const changedFiles = unique(input.changedFiles.map(file => file.replace(/\\/g, '/')))
  const maxCommands = Math.max(1, input.maxCommands ?? 5)
  const packageManager = input.packageManager ?? 'pnpm'
  const commands: VerificationCommand[] = []
  const rationale: string[] = []

  const touchesFrontend = hasAny(changedFiles, /\.(vue|tsx?|jsx?)$/i)
  const touchesRust = hasAny(changedFiles, /\.rs$/i) || hasAny(changedFiles, /^src-tauri\//i)
  const touchesAi = hasAny(changedFiles, /(^src\/(ai-gui|ai-gateway|composables\/ai|composables\/ai-agent)|^src-tauri\/src\/services\/ai)/i)
  const touchesTests = hasAny(changedFiles, /(__tests__|\.test\.)/i)
  const touchesConfig = hasAny(changedFiles, /(package\.json|pnpm-lock\.yaml|Cargo\.toml|tauri\.conf\.json)$/i)

  if (touchesAi) {
    commands.push({ command: 'pnpm vitest run src/ai-gui src/ai-gateway src/composables/__tests__', timeoutSeconds: 180 })
    rationale.push('AI 主链路或治理模块变更，优先跑 AI 相关单测。')
  }

  if (touchesFrontend || touchesTests || touchesConfig || input.includeTypecheck) {
    commands.push({ command: packageRun(packageManager, 'test:typecheck'), timeoutSeconds: 180 })
    rationale.push('前端 TypeScript/Vue 变更需要类型检查兜底。')
  }

  if (touchesRust || input.includeRustCheck) {
    commands.push({ command: 'cargo check --manifest-path src-tauri/Cargo.toml', timeoutSeconds: 180 })
    rationale.push('Rust/Tauri 变更需要 cargo check。')
  }

  if (commands.length === 0) {
    commands.push({ command: packageRun(packageManager, 'test'), timeoutSeconds: 180 })
    rationale.push('未识别专用验证范围，回退到项目单测。')
  }

  const risk: VerificationAgentRisk = touchesRust || touchesAi || touchesConfig
    ? 'high'
    : touchesFrontend
      ? 'medium'
      : 'low'

  return {
    risk,
    commands: commands.slice(0, maxCommands),
    rationale,
  }
}

export function evaluateVerificationAgentOutput(rawOutput: string): VerificationAgentEvaluation {
  const lines = rawOutput.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const commandBlocks = lines
    .map((line, index) => ({ line, index }))
    .filter(item => /^\$\s+/.test(item.line))
    .map(item => {
      const nextCommandIndex = lines.findIndex((line, index) => index > item.index && /^\$\s+/.test(line))
      const endIndex = nextCommandIndex === -1 ? lines.length : nextCommandIndex
      return {
        command: item.line.replace(/^\$\s+/, ''),
        output: lines.slice(item.index + 1, endIndex).join('\n'),
      }
    })
  const failedCommands = commandBlocks
    .filter(block => /status=(failed|error)|failed|error/i.test(block.output))
    .map(block => block.command)
  const incompleteCommands = commandBlocks
    .filter(block => !/status=(ok|failed|error|cancelled)/i.test(block.output))
    .map(block => block.command)

  const hasPassedMarker = /Verification passed/i.test(rawOutput)
  const hasFailedMarker = /Verification failed/i.test(rawOutput)
  const passed = (hasPassedMarker || /status=ok/i.test(rawOutput))
    && failedCommands.length === 0
    && incompleteCommands.length === 0
  const failed = hasFailedMarker || failedCommands.length > 0
  const confidence = passed
    ? 'high'
    : failed
      ? 'medium'
      : incompleteCommands.length > 0
        ? 'medium'
        : 'low'

  return {
    passed: passed && !failed,
    confidence,
    summary: passed && !failed
      ? '验证通过，未发现失败命令。'
      : failed
        ? `验证失败，失败命令 ${failedCommands.length} 条。`
        : incompleteCommands.length > 0
          ? `验证结果不完整，${incompleteCommands.length} 条命令缺少状态。`
          : '验证结果不完整，需要补充证据。',
    failedCommands,
    incompleteCommands,
    evidence: lines.slice(0, 20),
  }
}
