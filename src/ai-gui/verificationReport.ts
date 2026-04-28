import type { BackgroundJob } from '@/stores/background-job'

export interface ParsedVerificationCommand {
  command: string
  status: 'ok' | 'failed' | 'unknown'
  durationMs?: number
  output: string
}

export interface ParsedVerificationReport {
  status: 'passed' | 'failed' | 'unknown'
  durationMs?: number
  commandCount: number
  commands: ParsedVerificationCommand[]
  summary: string
}

function parseStatus(value?: string): ParsedVerificationReport['status'] {
  if (value === 'passed') return 'passed'
  if (value === 'failed') return 'failed'
  return 'unknown'
}

export function parseVerificationReport(raw?: string): ParsedVerificationReport | null {
  if (!raw?.trim()) return null
  const sections = raw.split(/\n\n---\n\n/g)
  const header = sections[0] ?? ''
  const status = parseStatus(header.match(/Verification\s+(passed|failed)/)?.[1])
  const durationMs = Number(header.match(/duration=(\d+)ms/)?.[1] ?? NaN)
  const commandCount = Number(header.match(/commands=(\d+)/)?.[1] ?? NaN)
  const commands = sections.slice(1).map((section): ParsedVerificationCommand => {
    const lines = section.split(/\r?\n/)
    const command = (lines[0] ?? '').replace(/^\$\s*/, '')
    const statusLine = lines[1] ?? ''
    const statusValue = statusLine.match(/status=(ok|failed)/)?.[1]
    const commandDuration = Number(statusLine.match(/duration=(\d+)ms/)?.[1] ?? NaN)
    return {
      command,
      status: statusValue === 'ok' || statusValue === 'failed' ? statusValue : 'unknown',
      durationMs: Number.isFinite(commandDuration) ? commandDuration : undefined,
      output: lines.slice(2).join('\n').trim(),
    }
  })

  return {
    status,
    durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
    commandCount: Number.isFinite(commandCount) ? commandCount : commands.length,
    commands,
    summary: status === 'passed'
      ? `验证通过，执行 ${commands.length} 条命令。`
      : status === 'failed'
        ? `验证失败，已执行 ${commands.length} 条命令。`
        : '无法识别验证报告格式。',
  }
}

export function latestVerificationJob(jobs: BackgroundJob[]): BackgroundJob | null {
  return jobs
    .filter(job => job.kind === 'verification')
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
}
