import type { AiWorkspaceIsolationConfig } from '@/types/ai'
import type { SpawnedTask } from '@/composables/ai/chatSideEffects'
import {
  buildAdvancedAgentRuntimeContext,
  type AdvancedAgentRuntimeContext,
} from './advancedAgentRuntime'
import type { ParsedVerificationReport } from './verificationReport'
import type { WorkspaceIsolationExecutionPlanItem } from './workspaceIsolationPlan'
import {
  backendIsolationMode,
  workspacePathForIsolationPlan,
} from './workspaceIsolationRuntimeService'

export interface SpawnedTaskRuntimeGateDecision {
  allowed: boolean
  requiresConfirmation: boolean
  message: string
  context?: AdvancedAgentRuntimeContext
}

export interface SpawnedTaskRuntimeGateInput {
  sessionId: string
  tasks: SpawnedTask[]
  workspaceIsolation?: AiWorkspaceIsolationConfig
  verificationReport?: ParsedVerificationReport | null
  verifying?: boolean
  maxAgents?: number
  resolveReferencedPaths: (text: string) => string[]
}

export type SpawnedTaskIsolationPrepareDecision =
  | { required: false; reason: 'already_prepared' | 'no_workspace_plan' | 'unsupported_mode' }
  | {
    required: true
    plan: WorkspaceIsolationExecutionPlanItem
    mode: 'temporary' | 'worktree'
    workspacePath: string
    confirmMessage: string
  }

export interface SpawnedTaskIsolationPrepareInput {
  task: SpawnedTask
  plan?: WorkspaceIsolationExecutionPlanItem | null
  repoPath?: string | null
}

export async function evaluateSpawnedTaskRuntimeGate(
  input: SpawnedTaskRuntimeGateInput,
): Promise<SpawnedTaskRuntimeGateDecision> {
  const workspaceIsolation = input.workspaceIsolation
  if (!workspaceIsolation || workspaceIsolation.strength === 'off') {
    return { allowed: true, requiresConfirmation: false, message: '' }
  }

  const context = await buildAdvancedAgentRuntimeContext({
    sessionId: input.sessionId,
    tasks: input.tasks,
    changedFiles: input.tasks.flatMap(task => input.resolveReferencedPaths(task.description)),
    workspaceIsolation,
    verificationReport: input.verificationReport,
    verifying: input.verifying,
    maxAgents: input.maxAgents,
  })
  const gate = context.isolationExecutionPlan.gate
  const message = gate.reasons.length > 0
    ? gate.reasons.join('\n')
    : '隔离执行计划需要人工确认。'

  return {
    allowed: gate.status !== 'blocked',
    requiresConfirmation: !gate.safeToAutoRun,
    message,
    context,
  }
}

export function buildSpawnedTaskIsolationPrepareDecision(
  input: SpawnedTaskIsolationPrepareInput,
): SpawnedTaskIsolationPrepareDecision {
  if (input.task.isolationWorkDir) {
    return { required: false, reason: 'already_prepared' }
  }
  if (!input.plan?.workspace) {
    return { required: false, reason: 'no_workspace_plan' }
  }

  const mode = backendIsolationMode(input.plan)
  if (!mode) {
    return { required: false, reason: 'unsupported_mode' }
  }

  const workspacePath = input.repoPath
    ? workspacePathForIsolationPlan(input.repoPath, input.plan) ?? input.plan.workspace.workspacePath
    : input.plan.workspace.workspacePath

  return {
    required: true,
    plan: input.plan,
    mode,
    workspacePath,
    confirmMessage: [
      '该子任务需要先准备隔离执行空间，确认后会创建隔离目录并在其中运行任务。',
      '',
      `任务：${input.task.description}`,
      `模式：${mode}`,
      `路径：${workspacePath}`,
    ].join('\n'),
  }
}

export function filterUnconfirmedSpawnedTasks(
  tasks: SpawnedTask[],
  confirmedTaskIds: Set<string>,
): SpawnedTask[] {
  return tasks.filter(task => !confirmedTaskIds.has(task.id))
}

export function buildSpawnedTaskRuntimeConfirmMessage(
  tasks: SpawnedTask[],
  gateMessage: string,
): string {
  const taskSummary = tasks
    .slice(0, 5)
    .map(task => `- ${task.description}`)
    .join('\n')
  const suffix = tasks.length > 5 ? `\n- 另外 ${tasks.length - 5} 个任务` : ''

  return [
    '这些子任务涉及隔离执行动作，需要确认后再启动。',
    '',
    gateMessage,
    '',
    taskSummary + suffix,
  ].join('\n')
}

export function buildSpawnedTaskAutoRunBlockedNotice(gateMessage: string): string {
  return [
    '子任务已准备好，但隔离门禁未自动放行：',
    gateMessage,
    '请在任务面板手动确认后运行。',
  ].join('\n')
}
