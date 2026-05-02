import {
  workspaceIsolationApplyChanges,
  workspaceIsolationCleanup,
  workspaceIsolationDiff,
  workspaceIsolationPrepare,
  type TaskIsolationBackendState,
  type WorkspaceIsolationDiffResult,
  type WorkspaceIsolationMode,
} from '@/api/workspace-isolation'
import type { VerificationCommand } from '@/composables/useVerificationJob'
import type { BackgroundJob } from '@/stores/background-job'
import type { WorkspaceIsolationExecutionPlanItem } from './workspaceIsolationPlan'
import {
  buildWorkspaceIsolationVerificationCommands,
  buildWorkspaceIsolationVerificationGate,
  formatVerificationGateReasons,
  formatWorkspaceIsolationDiffPreview,
  summarizeWorkspaceIsolationDiff,
} from './workspaceIsolationRuntime'
import type { ParsedVerificationReport } from './verificationReport'

export interface WorkspaceIsolationRuntimeContext {
  repoPath: string
  sessionId: string
  states: Record<string, TaskIsolationBackendState>
  jobs: BackgroundJob[]
  fallbackVerificationReport?: ParsedVerificationReport | null
  fallbackVerifying?: boolean
}

export interface WorkspaceIsolationRuntimeDeps {
  confirm: (message: string) => boolean
  notice: (kind: 'warn' | 'error' | 'info', text: string) => void
  setState: (taskId: string, state: TaskIsolationBackendState) => void
  setTaskIsolationWorkDir: (taskId: string, workspacePath: string) => void
  submitVerificationJob: (
    sessionId: string,
    workDir: string,
    commands: VerificationCommand[],
    options?: {
      title?: string
      contextSummary?: string
      meta?: Record<string, unknown>
    },
  ) => Promise<string>
}

export interface WorkspaceIsolationRuntimeActionOptions {
  prompt?: boolean
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? error)
  }
  return String(error)
}

function normalizeWorkspacePath(path?: string | null): string {
  return (path ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
}

export function backendIsolationMode(plan: WorkspaceIsolationExecutionPlanItem): WorkspaceIsolationMode | null {
  if (plan.mode === 'temporary' || plan.mode === 'worktree') return plan.mode
  return null
}

export function workspacePathForIsolationPlan(
  repoPath: string,
  plan: WorkspaceIsolationExecutionPlanItem,
): string | null {
  const relativePath = plan.workspace?.workspacePath
  if (!repoPath || !relativePath) return null
  return normalizeWorkspacePath(`${repoPath}/${relativePath}`)
}

function getValidDiff(
  context: WorkspaceIsolationRuntimeContext,
  taskId: string,
  workspacePath: string,
  mode: WorkspaceIsolationMode,
): WorkspaceIsolationDiffResult | null {
  const diff = context.states[taskId]?.diff
  if (!diff || normalizeWorkspacePath(diff.workspacePath) !== workspacePath || diff.mode !== mode) return null
  return diff
}

export function createWorkspaceIsolationRuntimeService(deps: WorkspaceIsolationRuntimeDeps) {
  async function prepare(
    context: WorkspaceIsolationRuntimeContext,
    taskId: string,
    plan: WorkspaceIsolationExecutionPlanItem,
    options?: WorkspaceIsolationRuntimeActionOptions,
  ): Promise<string | null> {
    const workspacePath = workspacePathForIsolationPlan(context.repoPath, plan)
    const mode = backendIsolationMode(plan)
    if (!workspacePath || !mode) {
      deps.setState(taskId, { status: 'error', message: '缺少 workspace root 或隔离执行计划。' })
      return null
    }

    if (options?.prompt !== false) {
      const confirmed = deps.confirm([
        '准备隔离执行空间？',
        '',
        `模式：${mode}`,
        `路径：${workspacePath}`,
        `允许路径：${plan.allowedPaths.join(', ') || '未配置'}`,
      ].join('\n'))
      if (!confirmed) return null
    }

    deps.setState(taskId, { status: 'preparing', message: '正在准备隔离执行空间。' })
    try {
      const result = await workspaceIsolationPrepare({
        repoPath: context.repoPath,
        workspacePath,
        branchName: plan.workspace?.branchName,
        mode,
        allowedPaths: plan.allowedPaths,
        blockedPaths: plan.blockedPaths,
      })
      deps.setState(taskId, {
        status: 'prepared',
        message: result.reusedExisting
          ? `已复用隔离空间，跳过 ${result.skippedPaths.length} 项。`
          : `隔离空间已准备，复制 ${result.copiedFiles} 个文件。`,
      })
      deps.setTaskIsolationWorkDir(taskId, result.workspacePath)
      deps.notice('info', `隔离执行空间已准备：${result.workspacePath}`)
      return result.workspacePath
    } catch (error) {
      const message = errorMessage(error)
      deps.setState(taskId, { status: 'error', message })
      deps.notice('error', `准备隔离执行空间失败：${message}`)
      return null
    }
  }

  async function diff(
    context: WorkspaceIsolationRuntimeContext,
    taskId: string,
    plan: WorkspaceIsolationExecutionPlanItem,
  ): Promise<void> {
    const workspacePath = workspacePathForIsolationPlan(context.repoPath, plan)
    const mode = backendIsolationMode(plan)
    if (!workspacePath || !mode) return

    deps.setState(taskId, { status: 'diffing', message: '正在检查隔离空间差异。' })
    try {
      const result = await workspaceIsolationDiff({ repoPath: context.repoPath, workspacePath, mode })
      deps.setState(taskId, {
        status: 'diffed',
        message: `Diff 已生成，共 ${result.entries.length} 个变更文件。`,
        diff: result,
      })
      deps.notice('info', `隔离空间 Diff：${summarizeWorkspaceIsolationDiff(result)}`)
    } catch (error) {
      const message = errorMessage(error)
      deps.setState(taskId, { status: 'error', message })
      deps.notice('error', `检查隔离空间 Diff 失败：${message}`)
    }
  }

  async function verify(
    context: WorkspaceIsolationRuntimeContext,
    taskId: string,
    plan: WorkspaceIsolationExecutionPlanItem,
  ): Promise<void> {
    const workspacePath = workspacePathForIsolationPlan(context.repoPath, plan)
    const mode = backendIsolationMode(plan)
    if (!workspacePath || !mode) return

    const diffResult = getValidDiff(context, taskId, workspacePath, mode)
    if (!diffResult) {
      const message = '请先生成最新 Diff，再验证隔离执行空间。'
      deps.setState(taskId, {
        ...(context.states[taskId] ?? {}),
        status: 'error',
        message,
      })
      deps.notice('warn', message)
      return
    }

    const commands = buildWorkspaceIsolationVerificationCommands(diffResult).map(item => item.command)
    if (commands.length === 0) {
      deps.notice('warn', '当前 Diff 未生成可执行的隔离验证命令。')
      return
    }

    deps.setState(taskId, {
      ...context.states[taskId],
      status: 'verifying',
      message: `正在隔离目录提交验证任务：${commands[0]}`,
      diff: diffResult,
    })
    try {
      const jobId = await deps.submitVerificationJob(
        context.sessionId,
        workspacePath,
        commands.map(command => ({ command, timeoutSeconds: 180 })),
        {
          title: `隔离验证：${plan.workspace?.slug ?? taskId}`,
          contextSummary: `Workspace Isolation ${taskId} · ${summarizeWorkspaceIsolationDiff(diffResult)}`,
          meta: {
            workspaceIsolationTaskId: taskId,
            workspaceIsolationPath: workspacePath,
            workspaceIsolationMode: mode,
          },
        },
      )
      deps.setState(taskId, {
        ...context.states[taskId],
        status: 'verified',
        message: `隔离验证任务已提交：${jobId}`,
        diff: diffResult,
        verificationJobId: jobId,
      })
      deps.notice('info', `隔离验证任务已提交：${jobId}`)
    } catch (error) {
      const message = errorMessage(error)
      deps.setState(taskId, { status: 'error', message, diff: diffResult })
      deps.notice('error', `提交隔离验证失败：${message}`)
    }
  }

  async function apply(
    context: WorkspaceIsolationRuntimeContext,
    taskId: string,
    plan: WorkspaceIsolationExecutionPlanItem,
  ): Promise<void> {
    const workspacePath = workspacePathForIsolationPlan(context.repoPath, plan)
    const mode = backendIsolationMode(plan)
    if (!workspacePath || mode !== 'temporary') return

    const diffResult = getValidDiff(context, taskId, workspacePath, mode)
    if (!diffResult) {
      const message = '请先生成最新 Diff，再回放临时隔离空间变更。'
      deps.setState(taskId, {
        ...(context.states[taskId] ?? {}),
        status: 'error',
        message,
      })
      deps.notice('warn', message)
      return
    }

    if (diffResult.entries.length === 0) {
      const confirmedEmpty = deps.confirm([
        '当前 Diff 没有检测到变更，仍要执行回放检查吗？',
        '',
        `路径：${workspacePath}`,
      ].join('\n'))
      if (!confirmedEmpty) return
    }

    const verificationGate = buildWorkspaceIsolationVerificationGate({
      taskId,
      diff: diffResult,
      jobs: context.jobs,
      fallbackReport: context.fallbackVerificationReport,
      fallbackVerifying: context.fallbackVerifying,
    })
    if (verificationGate.status === 'block') {
      const message = [
        'Verification Gate 阻止回放临时隔离空间变更。',
        '',
        formatVerificationGateReasons(verificationGate.reasons),
      ].join('\n')
      deps.setState(taskId, {
        ...(context.states[taskId] ?? {}),
        status: 'error',
        message,
        diff: diffResult,
      })
      deps.notice('error', message)
      return
    }
    if (verificationGate.status === 'warn') {
      const confirmedGate = deps.confirm([
        'Verification Gate 缺少完整通过证据，是否仍要继续回放？',
        '',
        formatVerificationGateReasons(verificationGate.reasons),
        '',
        verificationGate.missingCommands.length > 0
          ? `缺少通过证据的命令：\n${verificationGate.missingCommands.slice(0, 4).map(command => `- ${command}`).join('\n')}`
          : '',
      ].filter(Boolean).join('\n'))
      if (!confirmedGate) return
    }

    const confirmed = deps.confirm([
      '确认把临时隔离空间的变更回放到当前工作区？',
      '',
      summarizeWorkspaceIsolationDiff(diffResult),
      '',
      formatWorkspaceIsolationDiffPreview(diffResult),
      '',
      '该操作会覆盖 allowedPaths 内的同名文件，并删除隔离空间中标记删除的文件。',
      `路径：${workspacePath}`,
    ].join('\n'))
    if (!confirmed) return

    deps.setState(taskId, { status: 'applying', message: '正在回放临时隔离空间变更。' })
    try {
      const result = await workspaceIsolationApplyChanges({
        repoPath: context.repoPath,
        workspacePath,
        mode,
        confirmed: true,
      })
      deps.setState(taskId, {
        status: 'applied',
        message: `已回放 ${result.appliedFiles} 个文件，删除 ${result.deletedFiles} 个文件。`,
      })
      deps.notice('info', `隔离空间变更已回放：${result.appliedFiles} 个文件，删除 ${result.deletedFiles} 个文件。`)
    } catch (error) {
      const message = errorMessage(error)
      deps.setState(taskId, { status: 'error', message })
      deps.notice('error', `回放隔离空间变更失败：${message}`)
    }
  }

  async function cleanup(
    context: WorkspaceIsolationRuntimeContext,
    taskId: string,
    plan: WorkspaceIsolationExecutionPlanItem,
  ): Promise<void> {
    const workspacePath = workspacePathForIsolationPlan(context.repoPath, plan)
    const mode = backendIsolationMode(plan)
    if (!workspacePath || !mode) return

    const confirmed = deps.confirm([
      '确认清理隔离执行空间？',
      '',
      mode === 'worktree'
        ? 'Worktree 若仍有未处理变更，Git 可能拒绝清理；强制清理请在 Git 面板处理。'
        : '临时目录会被删除，未回放的文件会丢失。',
      `路径：${workspacePath}`,
    ].join('\n'))
    if (!confirmed) return

    deps.setState(taskId, { status: 'cleaning', message: '正在清理隔离执行空间。' })
    try {
      const result = await workspaceIsolationCleanup({
        repoPath: context.repoPath,
        workspacePath,
        mode,
        force: false,
      })
      deps.setState(taskId, {
        status: 'cleaned',
        message: result.removed ? '隔离执行空间已清理。' : '隔离执行空间不存在，无需清理。',
      })
      deps.notice('info', result.removed ? `隔离执行空间已清理：${result.workspacePath}` : '隔离执行空间不存在，无需清理。')
    } catch (error) {
      const message = errorMessage(error)
      deps.setState(taskId, { status: 'error', message })
      deps.notice('error', `清理隔离执行空间失败：${message}`)
    }
  }

  return {
    prepare,
    diff,
    verify,
    apply,
    cleanup,
  }
}
