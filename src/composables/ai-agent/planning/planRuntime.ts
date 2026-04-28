/**
 * Plan Runtime — Plan 生命周期管理与执行追踪
 *
 * 绑定到 useAiChat 的 plan gate 流程，负责：
 * - 从 AI 输出文本创建结构化 Plan
 * - 用户批准/放弃 Plan
 * - 通过 Hook 系统追踪步骤执行
 * - 压缩后自动注入 active plan 摘要
 */

import type { Logger } from '@/utils/logger'
import type { AiPlan, AiPlanStep, AiPlanSummary } from '@/types/plan'
import type { ToolCallInfo, ToolResultInfo } from '@/types/ai'
import { parsePlanFromText, toCreatePlanOptions } from './planParser'
import {
  createPlan,
  getActivePlan,
  approvePlan as storeApprovePlan,
  abandonPlan as storeAbandonPlan,
  startPlanExecution,
  markStepInProgress,
  markStepCompleted,
  markStepFailed,
  buildPlanSummary,
  formatPlanSummaryForContext,
  updateStepStatus,
} from './planStore'

export interface PlanRuntimeOptions {
  /** 当前会话 ID */
  sessionId: string
  /** Logger */
  log: Logger
  /** Plan 创建回调 */
  onPlanCreated?: (plan: AiPlan) => void
  /** Plan 状态变更回调 */
  onPlanStatusChanged?: (plan: AiPlan) => void
  /** 步骤状态变更回调 */
  onStepStatusChanged?: (plan: AiPlan, step: AiPlanStep) => void
}

export interface PlanRuntime {
  /** 处理 AI 输出的计划文本（plan gate 模式下） */
  handlePlanText: (text: string) => AiPlan | null
  /** 获取当前 session 的 active plan */
  getActivePlan: () => AiPlan | undefined
  /** 批准当前 active plan */
  approveCurrentPlan: () => AiPlan | null
  /** 放弃当前 active plan */
  abandonCurrentPlan: () => AiPlan | null
  /** 开始执行当前 plan（用户批准后调用） */
  startExecution: () => AiPlan | null
  /** 追踪工具调用对应的 plan 步骤 */
  trackStepFromToolUse: (toolCall: ToolCallInfo, result: ToolResultInfo) => void
  /** 获取当前 plan 摘要（用于压缩后注入） */
  getActivePlanSummary: () => AiPlanSummary | null
  /** 将 plan 摘要格式化为上下文文本 */
  formatPlanContext: () => string | null
  /** 手动标记步骤状态 */
  markStep: (stepIndex: number, status: AiPlanStep['status'], error?: string) => AiPlan | null
}

/**
 * 创建 Plan Runtime 实例
 */
export function createPlanRuntime(options: PlanRuntimeOptions): PlanRuntime {
  const { sessionId, log, onPlanCreated, onPlanStatusChanged, onStepStatusChanged } = options

  // ─────────────────────────── Plan 文本处理 ───────────────────────────

  function handlePlanText(text: string): AiPlan | null {
    if (!text || text.trim().length === 0) {
      log.warn('plan_runtime_empty_text', { sessionId })
      return null
    }

    try {
      const parsed = parsePlanFromText(text)
      const createOptions = toCreatePlanOptions(parsed, sessionId)
      const plan = createPlan(createOptions)

      log.info('plan_runtime_created', {
        planId: plan.id,
        sessionId,
        stepCount: plan.steps.length,
        title: plan.title,
      })

      onPlanCreated?.(plan)
      return plan
    } catch (error) {
      log.warn('plan_runtime_parse_failed', { sessionId, text: text.slice(0, 200) }, error)
      return null
    }
  }

  // ─────────────────────────── 状态转换 ───────────────────────────

  function getActivePlanLocal(): AiPlan | undefined {
    return getActivePlan(sessionId)
  }

  function approveCurrentPlan(): AiPlan | null {
    const plan = getActivePlanLocal()
    if (!plan) {
      log.warn('plan_runtime_approve_no_plan', { sessionId })
      return null
    }
    if (plan.status !== 'draft') {
      log.warn('plan_runtime_approve_wrong_status', { planId: plan.id, status: plan.status })
      return null
    }

    const approved = storeApprovePlan(plan.id)
    if (approved) {
      log.info('plan_runtime_approved', { planId: plan.id, sessionId })
      onPlanStatusChanged?.(approved)
    }
    return approved
  }

  function abandonCurrentPlan(): AiPlan | null {
    const plan = getActivePlanLocal()
    if (!plan) {
      log.warn('plan_runtime_abandon_no_plan', { sessionId })
      return null
    }
    if (plan.status === 'completed') {
      log.warn('plan_runtime_abandon_completed', { planId: plan.id })
      return null
    }

    const abandoned = storeAbandonPlan(plan.id)
    if (abandoned) {
      log.info('plan_runtime_abandoned', { planId: plan.id, sessionId })
      onPlanStatusChanged?.(abandoned)
    }
    return abandoned
  }

  function startExecution(): AiPlan | null {
    const plan = getActivePlanLocal()
    if (!plan) return null

    const started = startPlanExecution(plan.id)
    if (started) {
      log.info('plan_runtime_started', { planId: plan.id, sessionId })
      onPlanStatusChanged?.(started)
    }
    return started
  }

  // ─────────────────────────── 步骤追踪 ───────────────────────────

  /**
   * 通过工具调用追踪 plan 步骤
   *
   * 启发式策略：
   * - 找到第一个 pending 步骤，标记为 in_progress
   * - 工具成功则标记为 completed，失败则标记为 failed
   * - 若所有步骤完成，plan 自动变为 completed
   */
  function trackStepFromToolUse(toolCall: ToolCallInfo, result: ToolResultInfo): void {
    const plan = getActivePlanLocal()
    if (!plan || plan.status !== 'in_progress') return

    // 找到当前 pending 或 in_progress 的步骤
    let currentStepIndex = plan.steps.findIndex(s => s.status === 'in_progress')
    if (currentStepIndex === -1) {
      currentStepIndex = plan.steps.findIndex(s => s.status === 'pending')
      if (currentStepIndex !== -1) {
        markStepInProgress(plan.id, currentStepIndex)
      }
    }

    if (currentStepIndex === -1) return

    const step = plan.steps[currentStepIndex]!
    const updatedStep: AiPlanStep = { ...step }

    if (result.success) {
      const updated = markStepCompleted(plan.id, currentStepIndex)
      if (updated) {
        updatedStep.status = 'completed'
        updatedStep.completedAt = Date.now()
        log.info('plan_runtime_step_completed', {
          planId: plan.id,
          stepIndex: currentStepIndex,
          toolName: toolCall.name,
        })
        onStepStatusChanged?.(updated, updatedStep)
        onPlanStatusChanged?.(updated)
      }
    } else {
      const errorMsg = result.content?.slice(0, 200) || 'Tool execution failed'
      const updated = markStepFailed(plan.id, currentStepIndex, errorMsg)
      if (updated) {
        updatedStep.status = 'failed'
        updatedStep.error = errorMsg
        log.warn('plan_runtime_step_failed', {
          planId: plan.id,
          stepIndex: currentStepIndex,
          toolName: toolCall.name,
          error: errorMsg,
        })
        onStepStatusChanged?.(updated, updatedStep)
        onPlanStatusChanged?.(updated)
      }
    }
  }

  // ─────────────────────────── 手动步骤操作 ───────────────────────────

  function markStep(stepIndex: number, status: AiPlanStep['status'], error?: string): AiPlan | null {
    const plan = getActivePlanLocal()
    if (!plan) return null
    if (stepIndex < 0 || stepIndex >= plan.steps.length) return null

    const stepId = plan.steps[stepIndex]!.id
    const updated = updateStepStatus(plan.id, stepId, status, error ? { error } : undefined)
    if (updated) {
      onStepStatusChanged?.(updated, updated.steps[stepIndex]!)
      onPlanStatusChanged?.(updated)
    }
    return updated
  }

  // ─────────────────────────── 上下文注入 ───────────────────────────

  function getActivePlanSummary(): AiPlanSummary | null {
    const plan = getActivePlanLocal()
    if (!plan) return null
    return buildPlanSummary(plan)
  }

  function formatPlanContext(): string | null {
    const summary = getActivePlanSummary()
    if (!summary) return null
    return formatPlanSummaryForContext(summary)
  }

  return {
    handlePlanText,
    getActivePlan: getActivePlanLocal,
    approveCurrentPlan,
    abandonCurrentPlan,
    startExecution,
    trackStepFromToolUse,
    getActivePlanSummary,
    formatPlanContext,
    markStep,
  }
}
