import { useBackgroundJobStore } from '@/stores/background-job'
import { useJobWorker } from '@/composables/useJobWorker'
import { aiExecuteTool } from '@/api/ai/tools'

export interface VerificationCommand {
  command: string
  timeoutSeconds?: number
}

export interface VerificationCommandResult {
  command: string
  success: boolean
  durationMs: number
  output: string
}

export interface VerificationReport {
  status: 'passed' | 'failed'
  startedAt: number
  finishedAt: number
  durationMs: number
  commands: VerificationCommandResult[]
}

function formatReport(report: VerificationReport): string {
  const header = [
    `Verification ${report.status}`,
    `duration=${report.durationMs}ms`,
    `commands=${report.commands.length}`,
  ].join(' | ')
  const details = report.commands.map(item => [
    `$ ${item.command}`,
    `status=${item.success ? 'ok' : 'failed'} duration=${item.durationMs}ms`,
    item.output,
  ].join('\n'))
  return [header, ...details].join('\n\n---\n\n').slice(0, 6000)
}

export function useVerificationJob() {
  const store = useBackgroundJobStore()
  const worker = useJobWorker()

  worker.registerExecutor('verification', async (ctx) => {
    const payload = ctx.payload as { workDir?: string; commands?: VerificationCommand[] } | undefined
    const workDir = payload?.workDir
    const commands = payload?.commands ?? []
    if (!workDir) throw new Error('缺少 workDir，无法执行验证任务')
    if (commands.length === 0) throw new Error('缺少验证命令')

    const startedAt = Date.now()
    const results: VerificationCommandResult[] = []

    for (let index = 0; index < commands.length; index += 1) {
      if (ctx.signal.aborted) throw new Error('验证任务已取消')
      const item = commands[index]!
      const commandStartedAt = Date.now()
      ctx.onProgress(Math.round((index / commands.length) * 90))

      const result = await aiExecuteTool(
        'bash',
        JSON.stringify({ command: item.command, timeout_seconds: item.timeoutSeconds ?? 120 }),
        workDir,
        ctx.sessionId,
        `${ctx.jobId}-${index}`,
        (item.timeoutSeconds ?? 120) * 1000,
      )
      const commandResult: VerificationCommandResult = {
        command: item.command,
        success: result.success,
        durationMs: Date.now() - commandStartedAt,
        output: result.content,
      }
      results.push(commandResult)
      if (!result.success) {
        const failedAt = Date.now()
        const report: VerificationReport = {
          status: 'failed',
          startedAt,
          finishedAt: failedAt,
          durationMs: failedAt - startedAt,
          commands: results,
        }
        throw new Error(formatReport(report))
      }
    }

    const finishedAt = Date.now()
    ctx.onProgress(100)
    return formatReport({
      status: 'passed',
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      commands: results,
    })
  })

  async function submitVerificationJob(sessionId: string, workDir: string, commands: VerificationCommand[]): Promise<string> {
    const jobId = await store.submitVerificationJob(sessionId)
    void worker.dispatch(jobId, 'verification', sessionId, { workDir, commands }, { timeoutMs: 10 * 60 * 1000 })
    return jobId
  }

  return {
    submitVerificationJob,
    cancelVerificationJob: worker.cancel,
  }
}
