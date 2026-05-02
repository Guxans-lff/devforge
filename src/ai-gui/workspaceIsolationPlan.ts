import type { MultiAgentAssignment } from './multiAgentOrchestrator'
import type { WorkspaceIsolationBoundarySummary } from './workspaceIsolation'

export type WorkspaceIsolationExecutionMode = 'shared' | 'readonly' | 'temporary' | 'worktree' | 'blocked'
export type WorkspaceIsolationCleanupPolicy = 'none' | 'delete_on_success' | 'keep_for_review'
export type WorkspaceIsolationExecutionActionType =
  | 'validate_boundary'
  | 'prepare_workspace'
  | 'run_agent'
  | 'review_diff'
  | 'merge_back'
  | 'cleanup_workspace'
  | 'blocked'

export interface WorkspaceIsolationWorkspaceDescriptor {
  slug: string
  workspacePath: string
  branchName?: string
}

export interface WorkspaceIsolationExecutionAction {
  type: WorkspaceIsolationExecutionActionType
  label: string
  description: string
  requiresConfirmation: boolean
}

export interface WorkspaceIsolationExecutionPlanItem {
  agentId: string
  taskId: string
  mode: WorkspaceIsolationExecutionMode
  allowedPaths: string[]
  blockedPaths: string[]
  reason: string
  mergeRequired: boolean
  requiresReview: boolean
  cleanupPolicy: WorkspaceIsolationCleanupPolicy
  workspace?: WorkspaceIsolationWorkspaceDescriptor
  actions: WorkspaceIsolationExecutionAction[]
}

export interface WorkspaceIsolationExecutionPlan {
  items: WorkspaceIsolationExecutionPlanItem[]
  mergeRequiredCount: number
  blockedCount: number
  worktreeCount: number
  temporaryWorkspaceCount: number
  reviewRequiredCount: number
  confirmationRequiredCount: number
  gate: WorkspaceIsolationExecutionGate
  warnings: string[]
}

export interface WorkspaceIsolationExecutionGate {
  status: 'allow' | 'confirm_required' | 'blocked'
  reasons: string[]
  safeToAutoRun: boolean
}

function boundaryForAgent(
  agentId: string,
  boundaries: WorkspaceIsolationBoundarySummary[],
): WorkspaceIsolationBoundarySummary | undefined {
  return boundaries.find(boundary => boundary.ownerId.endsWith(`:${agentId}`))
}

function inferExecutionMode(
  assignment: MultiAgentAssignment,
  boundary?: WorkspaceIsolationBoundarySummary,
): WorkspaceIsolationExecutionMode {
  if (boundary?.reason) return 'blocked'
  if (assignment.role === 'reviewer' || assignment.role === 'verifier') return 'readonly'
  if (boundary?.strength === 'strict') return 'worktree'
  if (boundary?.strength === 'agent') return 'temporary'
  return 'shared'
}

function reasonForMode(mode: WorkspaceIsolationExecutionMode): string {
  switch (mode) {
    case 'blocked': return '隔离边界无效，不能创建执行空间。'
    case 'readonly': return '审查/验证任务默认只读执行。'
    case 'worktree': return 'strict 隔离需要独立 worktree，合并前必须审核。'
    case 'temporary': return 'agent 隔离使用临时执行空间，降低互相覆盖风险。'
    default: return 'session 隔离可在共享工作区执行。'
  }
}

function sanitizeSlugPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/[/.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'item'
}

export function createIsolationWorkspaceSlug(input: {
  sessionId: string
  agentId: string
  taskId: string
}): string {
  return [
    sanitizeSlugPart(input.sessionId),
    sanitizeSlugPart(input.agentId),
    sanitizeSlugPart(input.taskId),
  ].join('-')
}

function workspaceForMode(input: {
  sessionId: string
  agentId: string
  taskId: string
  mode: WorkspaceIsolationExecutionMode
}): WorkspaceIsolationWorkspaceDescriptor | undefined {
  if (input.mode !== 'worktree' && input.mode !== 'temporary') return undefined

  const slug = createIsolationWorkspaceSlug(input)
  if (input.mode === 'worktree') {
    return {
      slug,
      workspacePath: `.devforge/worktrees/${slug}`,
      branchName: `devforge/agent/${slug}`,
    }
  }

  return {
    slug,
    workspacePath: `.devforge/tmp/agents/${slug}`,
  }
}

function cleanupPolicyForMode(mode: WorkspaceIsolationExecutionMode): WorkspaceIsolationCleanupPolicy {
  if (mode === 'temporary') return 'delete_on_success'
  if (mode === 'worktree') return 'keep_for_review'
  return 'none'
}

function action(
  type: WorkspaceIsolationExecutionActionType,
  label: string,
  description: string,
  requiresConfirmation = false,
): WorkspaceIsolationExecutionAction {
  return {
    type,
    label,
    description,
    requiresConfirmation,
  }
}

function actionsForPlanItem(input: {
  mode: WorkspaceIsolationExecutionMode
  allowedPaths: string[]
  blockedPaths: string[]
  workspace?: WorkspaceIsolationWorkspaceDescriptor
  cleanupPolicy: WorkspaceIsolationCleanupPolicy
}): WorkspaceIsolationExecutionAction[] {
  if (input.mode === 'blocked') {
    return [
      action('blocked', '阻塞执行', '隔离边界校验失败，不能启动 Agent。'),
    ]
  }

  const actions: WorkspaceIsolationExecutionAction[] = [
    action(
      'validate_boundary',
      '校验边界',
      `确认 allowedPaths=${input.allowedPaths.join(', ') || '未配置'}，blockedPaths=${input.blockedPaths.join(', ') || '无'}。`,
    ),
  ]

  if (input.mode === 'worktree' && input.workspace) {
    actions.push(
      action(
        'prepare_workspace',
        '准备 Worktree',
        `计划创建 ${input.workspace.workspacePath}，分支 ${input.workspace.branchName}。`,
        true,
      ),
    )
  } else if (input.mode === 'temporary' && input.workspace) {
    actions.push(
      action(
        'prepare_workspace',
        '准备临时空间',
        `计划创建 ${input.workspace.workspacePath}，只复制允许路径内的上下文。`,
        true,
      ),
    )
  } else {
    actions.push(
      action(
        'prepare_workspace',
        input.mode === 'readonly' ? '准备只读上下文' : '复用共享工作区',
        input.mode === 'readonly' ? '不创建写入空间，仅允许读取和诊断。' : '复用当前工作区执行，写入仍受边界保护。',
      ),
    )
  }

  actions.push(action('run_agent', '运行 Agent', '在隔离策略约束下执行子任务。'))

  if (input.mode === 'worktree') {
    actions.push(
      action('review_diff', '审核 Diff', '合并前必须查看 worktree 产生的文件差异。', true),
      action('merge_back', '合并回主工作区', '审核通过后再将变更合并回当前工作区。', true),
    )
  } else if (input.mode === 'temporary') {
    actions.push(
      action('review_diff', '检查临时空间输出', '只接受 allowedPaths 内的文件变更。', true),
      action('merge_back', '回放允许变更', '将通过检查的变更回放到当前工作区。', true),
    )
  }

  if (input.cleanupPolicy === 'delete_on_success') {
    actions.push(action('cleanup_workspace', '清理临时空间', '任务成功后删除临时执行目录，失败时保留现场。'))
  } else if (input.cleanupPolicy === 'keep_for_review') {
    actions.push(action('cleanup_workspace', '保留审核现场', 'worktree 默认保留，等人工确认后再清理。', true))
  }

  return actions
}

function buildExecutionGate(input: {
  blockedCount: number
  confirmationRequiredCount: number
  reviewRequiredCount: number
}): WorkspaceIsolationExecutionGate {
  const reasons: string[] = []
  if (input.blockedCount > 0) {
    reasons.push(`${input.blockedCount} 个隔离执行空间处于阻塞状态。`)
  }
  if (input.confirmationRequiredCount > 0) {
    reasons.push(`${input.confirmationRequiredCount} 个执行动作需要人工确认。`)
  }
  if (input.reviewRequiredCount > 0) {
    reasons.push(`${input.reviewRequiredCount} 个执行空间要求合并前审核。`)
  }

  const status = input.blockedCount > 0
    ? 'blocked'
    : input.confirmationRequiredCount > 0 || input.reviewRequiredCount > 0
      ? 'confirm_required'
      : 'allow'

  return {
    status,
    reasons,
    safeToAutoRun: status === 'allow',
  }
}

export function buildWorkspaceIsolationExecutionPlan(input: {
  sessionId?: string
  assignments: MultiAgentAssignment[]
  boundaries: WorkspaceIsolationBoundarySummary[]
}): WorkspaceIsolationExecutionPlan {
  const sessionId = input.sessionId ?? 'session'
  const items = input.assignments.map(assignment => {
    const boundary = boundaryForAgent(assignment.agentId, input.boundaries)
    const mode = inferExecutionMode(assignment, boundary)
    const workspace = workspaceForMode({
      sessionId,
      agentId: assignment.agentId,
      taskId: assignment.taskId,
      mode,
    })
    const cleanupPolicy = cleanupPolicyForMode(mode)
    const allowedPaths = boundary?.allowedPaths ?? assignment.allowedPaths
    const blockedPaths = boundary?.blockedPaths ?? []
    return {
      agentId: assignment.agentId,
      taskId: assignment.taskId,
      mode,
      allowedPaths,
      blockedPaths,
      reason: boundary?.reason ?? reasonForMode(mode),
      mergeRequired: mode === 'worktree' || mode === 'temporary',
      requiresReview: mode === 'worktree',
      cleanupPolicy,
      workspace,
      actions: actionsForPlanItem({
        mode,
        allowedPaths,
        blockedPaths,
        workspace,
        cleanupPolicy,
      }),
    }
  })
  const blockedCount = items.filter(item => item.mode === 'blocked').length
  const mergeRequiredCount = items.filter(item => item.mergeRequired).length
  const worktreeCount = items.filter(item => item.mode === 'worktree').length
  const temporaryWorkspaceCount = items.filter(item => item.mode === 'temporary').length
  const reviewRequiredCount = items.filter(item => item.requiresReview).length
  const confirmationRequiredCount = items.reduce(
    (sum, item) => sum + item.actions.filter(step => step.requiresConfirmation).length,
    0,
  )
  const gate = buildExecutionGate({
    blockedCount,
    confirmationRequiredCount,
    reviewRequiredCount,
  })
  const warnings = [
    blockedCount > 0 ? `${blockedCount} 个 Agent 无法创建隔离执行空间。` : '',
    mergeRequiredCount > 0 ? `${mergeRequiredCount} 个 Agent 需要合并审核。` : '',
    worktreeCount > 0 ? `${worktreeCount} 个 Agent 计划使用独立 worktree，当前仅生成执行描述，不直接操作文件系统。` : '',
    gate.status === 'confirm_required' ? '隔离执行计划存在人工确认动作，不能静默自动执行。' : '',
  ].filter(Boolean)

  return {
    items,
    mergeRequiredCount,
    blockedCount,
    worktreeCount,
    temporaryWorkspaceCount,
    reviewRequiredCount,
    confirmationRequiredCount,
    gate,
    warnings,
  }
}
