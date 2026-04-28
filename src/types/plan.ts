/**
 * Plan 对象化类型定义
 *
 * 结构化 Plan，支持步骤级状态追踪和生命周期管理。
 */

/** Plan 整体状态 */
export type PlanStatus = 'draft' | 'approved' | 'in_progress' | 'completed' | 'abandoned'

/** Plan 步骤状态 */
export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'

export type PlanChangeType =
  | 'created'
  | 'updated'
  | 'approved'
  | 'started'
  | 'completed'
  | 'abandoned'
  | 'step_status_changed'
  | 'active_changed'
  | 'job_attached'
  | 'job_updated'

export interface AiPlanChange {
  id: string
  planId: string
  sessionId: string
  type: PlanChangeType
  createdAt: number
  actor: 'user' | 'assistant' | 'system'
  summary: string
  stepId?: string
  fromStatus?: PlanStatus | PlanStepStatus
  toStatus?: PlanStatus | PlanStepStatus
  metadata?: Record<string, unknown>
}

export interface AiPlanStepJobRef {
  jobId: string
  kind: string
  status: 'queued' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled'
  title?: string
  attachedAt: number
  updatedAt?: number
  resultSummary?: string
  error?: string
}

/** 单个 Plan 步骤 */
export interface AiPlanStep {
  /** 步骤唯一 ID */
  id: string
  /** 步骤序号（从 0 开始） */
  index: number
  /** 步骤标题 */
  title: string
  /** 步骤详细描述 */
  description?: string
  /** 当前状态 */
  status: PlanStepStatus
  /** 开始执行时间 */
  startedAt?: number
  /** 完成时间 */
  completedAt?: number
  /** 失败原因 */
  error?: string
  /** 关联的工具调用 ID 列表 */
  toolCalls?: string[]
  /** 关联的后台任务/验证任务 */
  jobRefs?: AiPlanStepJobRef[]
}

/** Plan 对象 */
export interface AiPlan {
  /** Plan 唯一 ID */
  id: string
  /** 所属会话 ID */
  sessionId: string
  /** Plan 标题 */
  title: string
  /** Plan 描述/目标 */
  description?: string
  /** 当前状态 */
  status: PlanStatus
  /** 步骤列表 */
  steps: AiPlanStep[]
  /** 关联文件路径 */
  relatedFiles: string[]
  /** 来源 AI 消息 ID */
  sourceMessageId?: string
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
  /** 批准时间 */
  approvedAt?: number
  /** 完成时间 */
  completedAt?: number
  /** 变更历史 */
  changes: AiPlanChange[]
}

/** Plan 创建参数 */
export interface CreateAiPlanOptions {
  sessionId: string
  title: string
  description?: string
  steps: Omit<AiPlanStep, 'id'>[]
  relatedFiles?: string[]
  sourceMessageId?: string
}

/** Plan 创建结果 */
export interface CreateAiPlanResult {
  plan: AiPlan
  isNew: boolean
}

/** Plan 执行摘要（用于压缩后注入上下文） */
export interface AiPlanSummary {
  planId: string
  title: string
  status: PlanStatus
  stepCount: number
  completedStepCount: number
  activeStepTitle?: string
  lastChangeSummary?: string
  lastChangeAt?: number
  activeStepJobRefs?: AiPlanStepJobRef[]
  recentChangeSummaries?: string[]
  attentionJobSummaries?: string[]
}
