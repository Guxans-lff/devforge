/**
 * Plan Store - 结构化 Plan 的内存态状态管理。
 *
 * 按 sessionId 索引 plans；同一 session 同一时间只有一个 active plan。
 * 当前使用 localStorage 做轻量持久化，后续可升级为后端 session store。
 */

import { computed, reactive } from 'vue'
import type {
  AiPlan,
  AiPlanChange,
  AiPlanStep,
  AiPlanStepJobRef,
  AiPlanSummary,
  CreateAiPlanOptions,
  PlanStepStatus,
} from '@/types/plan'
import { genId } from '@/composables/ai/chatHelpers'

interface PlanStoreState {
  plans: Map<string, AiPlan>
  activePlanIds: Map<string, string>
}

interface PersistedPlanStoreSnapshot {
  version: 1
  savedAt: number
  plans: AiPlan[]
  activePlanIds: Array<[string, string]>
}

type PlanPatch = Partial<Omit<AiPlan, 'id' | 'sessionId' | 'createdAt' | 'changes'>>
type PlanChangeDraft = Omit<AiPlanChange, 'id' | 'planId' | 'sessionId' | 'createdAt'> & {
  createdAt?: number
}

export const PLAN_STORE_STORAGE_KEY = 'devforge.ai.plans.v1'

const MAX_PERSISTED_PLANS = 50
const PLAN_STATUSES: AiPlan['status'][] = ['draft', 'approved', 'in_progress', 'completed', 'abandoned']
const STEP_STATUSES: PlanStepStatus[] = ['pending', 'in_progress', 'completed', 'failed', 'skipped']
const CHANGE_TYPES: AiPlanChange['type'][] = [
  'created',
  'updated',
  'approved',
  'started',
  'completed',
  'abandoned',
  'step_status_changed',
  'active_changed',
  'job_attached',
  'job_updated',
]
const CHANGE_ACTORS: AiPlanChange['actor'][] = ['user', 'assistant', 'system']
const JOB_REF_STATUSES: AiPlanStepJobRef['status'][] = ['queued', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled']

const state = reactive<PlanStoreState>({
  plans: new Map(),
  activePlanIds: new Map(),
})

let hasLoadedPersistedPlans = false

function now(): number {
  return Date.now()
}

function generateStepId(index: number): string {
  return `step-${genId()}-${index}`
}

function clonePlanChange(change: AiPlanChange): AiPlanChange {
  return {
    ...change,
    metadata: change.metadata ? { ...change.metadata } : undefined,
  }
}

function appendPlanChange(plan: AiPlan, change: PlanChangeDraft): AiPlanChange {
  const entry: AiPlanChange = {
    id: `change-${genId()}`,
    planId: plan.id,
    sessionId: plan.sessionId,
    createdAt: change.createdAt ?? now(),
    actor: change.actor,
    type: change.type,
    summary: change.summary,
    stepId: change.stepId,
    fromStatus: change.fromStatus,
    toStatus: change.toStatus,
    metadata: change.metadata,
  }

  plan.changes.push(entry)
  return entry
}

function isTerminalStatus(status: AiPlan['status']): boolean {
  return status === 'completed' || status === 'abandoned'
}

function normalizeStep(step: Omit<AiPlanStep, 'id'>, index: number): AiPlanStep {
  return {
    ...step,
    id: generateStepId(index),
    index,
    status: step.status ?? 'pending',
  }
}

function findStep(plan: AiPlan, stepId: string): AiPlanStep | undefined {
  return plan.steps.find(step => step.id === stepId)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isPlanOrStepStatus(value: unknown): value is AiPlanChange['fromStatus'] {
  return isString(value)
    && ([...PLAN_STATUSES, ...STEP_STATUSES] as string[]).includes(value)
}

function sanitizeStep(value: unknown): AiPlanStep | null {
  if (!isRecord(value)) return null
  if (!isString(value.id) || !isNumber(value.index) || !isString(value.title)) return null
  if (!STEP_STATUSES.includes(value.status as PlanStepStatus)) return null

  const jobRefs = Array.isArray(value.jobRefs)
    ? value.jobRefs.map(sanitizeJobRef).filter((jobRef): jobRef is AiPlanStepJobRef => Boolean(jobRef))
    : undefined

  return {
    id: value.id,
    index: value.index,
    title: value.title,
    description: isString(value.description) ? value.description : undefined,
    status: value.status as PlanStepStatus,
    startedAt: isNumber(value.startedAt) ? value.startedAt : undefined,
    completedAt: isNumber(value.completedAt) ? value.completedAt : undefined,
    error: isString(value.error) ? value.error : undefined,
    toolCalls: Array.isArray(value.toolCalls) ? value.toolCalls.filter(isString) : undefined,
    jobRefs,
  }
}

function sanitizeJobRef(value: unknown): AiPlanStepJobRef | null {
  if (!isRecord(value)) return null
  if (!isString(value.jobId) || !isString(value.kind) || !isNumber(value.attachedAt)) return null
  if (!JOB_REF_STATUSES.includes(value.status as AiPlanStepJobRef['status'])) return null

  return {
    jobId: value.jobId,
    kind: value.kind,
    status: value.status as AiPlanStepJobRef['status'],
    title: isString(value.title) ? value.title : undefined,
    attachedAt: value.attachedAt,
    updatedAt: isNumber(value.updatedAt) ? value.updatedAt : undefined,
    resultSummary: isString(value.resultSummary) ? value.resultSummary : undefined,
    error: isString(value.error) ? value.error : undefined,
  }
}

function sanitizeChange(value: unknown, planId: string, sessionId: string): AiPlanChange | null {
  if (!isRecord(value)) return null
  if (!isString(value.id) || !isNumber(value.createdAt) || !isString(value.summary)) return null
  if (!CHANGE_TYPES.includes(value.type as AiPlanChange['type'])) return null
  if (!CHANGE_ACTORS.includes(value.actor as AiPlanChange['actor'])) return null

  return {
    id: value.id,
    planId,
    sessionId,
    type: value.type as AiPlanChange['type'],
    createdAt: value.createdAt,
    actor: value.actor as AiPlanChange['actor'],
    summary: value.summary,
    stepId: isString(value.stepId) ? value.stepId : undefined,
    fromStatus: isPlanOrStepStatus(value.fromStatus) ? value.fromStatus : undefined,
    toStatus: isPlanOrStepStatus(value.toStatus) ? value.toStatus : undefined,
    metadata: isRecord(value.metadata) ? { ...value.metadata } : undefined,
  }
}

function sanitizePlan(value: unknown): AiPlan | null {
  if (!isRecord(value)) return null
  if (!isString(value.id) || !isString(value.sessionId) || !isString(value.title)) return null
  if (!PLAN_STATUSES.includes(value.status as AiPlan['status'])) return null
  if (!isNumber(value.createdAt) || !isNumber(value.updatedAt)) return null
  if (!Array.isArray(value.steps)) return null

  const steps = value.steps.map(sanitizeStep).filter((step): step is AiPlanStep => Boolean(step))
  if (steps.length !== value.steps.length) return null

  const rawChanges = Array.isArray(value.changes) ? value.changes : []
  const changes = rawChanges
    .map(change => sanitizeChange(change, value.id as string, value.sessionId as string))
    .filter((change): change is AiPlanChange => Boolean(change))

  return {
    id: value.id,
    sessionId: value.sessionId,
    title: value.title,
    description: isString(value.description) ? value.description : undefined,
    status: value.status as AiPlan['status'],
    steps,
    relatedFiles: Array.isArray(value.relatedFiles) ? value.relatedFiles.filter(isString) : [],
    sourceMessageId: isString(value.sourceMessageId) ? value.sourceMessageId : undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    approvedAt: isNumber(value.approvedAt) ? value.approvedAt : undefined,
    completedAt: isNumber(value.completedAt) ? value.completedAt : undefined,
    changes,
  }
}

function buildPersistedSnapshot(): PersistedPlanStoreSnapshot {
  const plans = Array.from(state.plans.values())
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_PERSISTED_PLANS)

  const planIds = new Set(plans.map(plan => plan.id))
  const activePlanIds = Array.from(state.activePlanIds.entries())
    .filter(([, planId]) => planIds.has(planId))

  return {
    version: 1,
    savedAt: now(),
    plans,
    activePlanIds,
  }
}

function persistPlans(storage: Storage | undefined = globalThis.localStorage): void {
  if (!storage) return
  try {
    const snapshot = buildPersistedSnapshot()
    if (snapshot.plans.length === 0) {
      storage.removeItem(PLAN_STORE_STORAGE_KEY)
      return
    }
    storage.setItem(PLAN_STORE_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // localStorage 不可用或配额不足时，不阻塞主链路。
  }
}

function applyPersistedSnapshot(snapshot: PersistedPlanStoreSnapshot): void {
  state.plans.clear()
  state.activePlanIds.clear()

  for (const plan of snapshot.plans) {
    state.plans.set(plan.id, plan)
  }

  for (const [sessionId, planId] of snapshot.activePlanIds) {
    const plan = state.plans.get(planId)
    if (plan?.sessionId === sessionId) {
      state.activePlanIds.set(sessionId, planId)
    }
  }
}

function normalizePersistedSnapshot(value: unknown): PersistedPlanStoreSnapshot | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.plans)) return null

  const plans = value.plans
    .map(sanitizePlan)
    .filter((plan): plan is AiPlan => Boolean(plan))
    .slice(0, MAX_PERSISTED_PLANS)

  const activePlanIds = Array.isArray(value.activePlanIds)
    ? value.activePlanIds
        .filter((entry): entry is [string, string] => Array.isArray(entry) && isString(entry[0]) && isString(entry[1]))
    : []

  return {
    version: 1,
    savedAt: isNumber(value.savedAt) ? value.savedAt : now(),
    plans,
    activePlanIds,
  }
}

export function loadPersistedPlans(storage: Storage | undefined = globalThis.localStorage): boolean {
  hasLoadedPersistedPlans = true
  if (!storage) return false

  try {
    const raw = storage.getItem(PLAN_STORE_STORAGE_KEY)
    if (!raw) return false

    const snapshot = normalizePersistedSnapshot(JSON.parse(raw))
    if (!snapshot) return false

    applyPersistedSnapshot(snapshot)
    return true
  } catch {
    return false
  }
}

export function savePersistedPlans(storage: Storage | undefined = globalThis.localStorage): void {
  persistPlans(storage)
}

export function ensurePlansLoaded(): void {
  if (hasLoadedPersistedPlans) return
  loadPersistedPlans()
}

export function createPlan(options: CreateAiPlanOptions): AiPlan {
  ensurePlansLoaded()
  const planId = genId()
  const timestamp = now()
  const steps = options.steps.map(normalizeStep)

  const plan: AiPlan = {
    id: planId,
    sessionId: options.sessionId,
    title: options.title,
    description: options.description,
    status: 'draft',
    steps,
    relatedFiles: options.relatedFiles ?? [],
    sourceMessageId: options.sourceMessageId,
    createdAt: timestamp,
    updatedAt: timestamp,
    changes: [],
  }

  appendPlanChange(plan, {
    type: 'created',
    actor: 'assistant',
    summary: `创建计划：${plan.title}`,
    toStatus: 'draft',
    createdAt: timestamp,
  })

  const oldActiveId = state.activePlanIds.get(options.sessionId)
  if (oldActiveId) {
    const oldPlan = state.plans.get(oldActiveId)
    if (oldPlan && !isTerminalStatus(oldPlan.status)) {
      const previousStatus = oldPlan.status
      oldPlan.status = 'abandoned'
      oldPlan.updatedAt = timestamp
      appendPlanChange(oldPlan, {
        type: 'abandoned',
        actor: 'system',
        summary: `新计划创建后自动放弃旧计划：${oldPlan.title}`,
        fromStatus: previousStatus,
        toStatus: 'abandoned',
        createdAt: timestamp,
      })
    }
  }

  state.plans.set(planId, plan)
  state.activePlanIds.set(options.sessionId, planId)
  persistPlans()

  return plan
}

export function updatePlan(planId: string, patch: PlanPatch): AiPlan | null {
  ensurePlansLoaded()
  const plan = state.plans.get(planId)
  if (!plan) return null

  const changedFields: string[] = []

  if (patch.title !== undefined && patch.title !== plan.title) {
    plan.title = patch.title
    changedFields.push('title')
  }
  if (patch.description !== undefined && patch.description !== plan.description) {
    plan.description = patch.description
    changedFields.push('description')
  }
  if (patch.steps !== undefined && patch.steps !== plan.steps) {
    plan.steps = patch.steps
    changedFields.push('steps')
  }
  if (patch.relatedFiles !== undefined && patch.relatedFiles !== plan.relatedFiles) {
    plan.relatedFiles = patch.relatedFiles
    changedFields.push('relatedFiles')
  }
  if (patch.sourceMessageId !== undefined && patch.sourceMessageId !== plan.sourceMessageId) {
    plan.sourceMessageId = patch.sourceMessageId
    changedFields.push('sourceMessageId')
  }
  if (patch.approvedAt !== undefined && patch.approvedAt !== plan.approvedAt) {
    plan.approvedAt = patch.approvedAt
    changedFields.push('approvedAt')
  }
  if (patch.completedAt !== undefined && patch.completedAt !== plan.completedAt) {
    plan.completedAt = patch.completedAt
    changedFields.push('completedAt')
  }
  if (patch.updatedAt !== undefined && patch.updatedAt !== plan.updatedAt) {
    plan.updatedAt = patch.updatedAt
    changedFields.push('updatedAt')
  }

  if (patch.status !== undefined && patch.status !== plan.status) {
    const previousStatus = plan.status
    plan.status = patch.status
    changedFields.push('status')
    appendPlanChange(plan, {
      type: 'updated',
      actor: 'user',
      summary: `更新计划状态：${previousStatus} -> ${patch.status}`,
      fromStatus: previousStatus,
      toStatus: patch.status,
      metadata: { fields: ['status'] },
    })
  }

  if (changedFields.length === 0) {
    return plan
  }

  plan.updatedAt = now()
  const nonStatusFields = changedFields.filter(field => field !== 'status' && field !== 'updatedAt')
  if (nonStatusFields.length > 0) {
    appendPlanChange(plan, {
      type: 'updated',
      actor: 'user',
      summary: `更新计划字段：${nonStatusFields.join(', ')}`,
      metadata: { fields: nonStatusFields },
    })
  }

  persistPlans()
  return plan
}

export function getPlan(planId: string): AiPlan | undefined {
  ensurePlansLoaded()
  return state.plans.get(planId)
}

export function deletePlan(planId: string): boolean {
  ensurePlansLoaded()
  if (!state.plans.has(planId)) return false

  for (const [sessionId, activeId] of state.activePlanIds.entries()) {
    if (activeId === planId) {
      state.activePlanIds.delete(sessionId)
      break
    }
  }

  state.plans.delete(planId)
  persistPlans()
  return true
}

export function approvePlan(planId: string): AiPlan | null {
  ensurePlansLoaded()
  const plan = state.plans.get(planId)
  if (!plan || plan.status !== 'draft') return null

  const previousStatus = plan.status
  plan.status = 'approved'
  plan.approvedAt = now()
  plan.updatedAt = now()
  appendPlanChange(plan, {
    type: 'approved',
    actor: 'user',
    summary: `批准计划：${plan.title}`,
    fromStatus: previousStatus,
    toStatus: 'approved',
  })

  persistPlans()
  return plan
}

export function startPlanExecution(planId: string): AiPlan | null {
  ensurePlansLoaded()
  const plan = state.plans.get(planId)
  if (!plan || plan.status !== 'approved') return null

  const previousStatus = plan.status
  plan.status = 'in_progress'
  plan.updatedAt = now()
  appendPlanChange(plan, {
    type: 'started',
    actor: 'system',
    summary: `开始执行计划：${plan.title}`,
    fromStatus: previousStatus,
    toStatus: 'in_progress',
  })

  persistPlans()
  return plan
}

export function completePlan(planId: string): AiPlan | null {
  ensurePlansLoaded()
  const plan = state.plans.get(planId)
  if (!plan || plan.status !== 'in_progress') return null

  const previousStatus = plan.status
  plan.status = 'completed'
  plan.completedAt = now()
  plan.updatedAt = now()
  appendPlanChange(plan, {
    type: 'completed',
    actor: 'system',
    summary: `完成计划：${plan.title}`,
    fromStatus: previousStatus,
    toStatus: 'completed',
  })

  persistPlans()
  return plan
}

export function abandonPlan(planId: string): AiPlan | null {
  ensurePlansLoaded()
  const plan = state.plans.get(planId)
  if (!plan || plan.status === 'completed') return null

  const previousStatus = plan.status
  plan.status = 'abandoned'
  plan.updatedAt = now()
  appendPlanChange(plan, {
    type: 'abandoned',
    actor: 'user',
    summary: `放弃计划：${plan.title}`,
    fromStatus: previousStatus,
    toStatus: 'abandoned',
  })

  persistPlans()
  return plan
}

export function updateStepStatus(
  planId: string,
  stepId: string,
  status: PlanStepStatus,
  options?: { error?: string },
): AiPlan | null {
  ensurePlansLoaded()
  const plan = state.plans.get(planId)
  if (!plan) return null

  const step = findStep(plan, stepId)
  if (!step) return null

  const previousStatus = step.status
  if (previousStatus === status && (!options?.error || step.error === options.error)) {
    return plan
  }

  step.status = status
  if (status === 'in_progress' && !step.startedAt) {
    step.startedAt = now()
  }
  if (status === 'completed' || status === 'skipped') {
    step.completedAt = now()
  }
  if (status === 'failed') {
    step.error = options?.error
  } else if (options?.error) {
    step.error = options.error
  }

  plan.updatedAt = now()
  appendPlanChange(plan, {
    type: 'step_status_changed',
    actor: 'system',
    summary: `步骤「${step.title}」状态：${previousStatus} -> ${status}`,
    stepId: step.id,
    fromStatus: previousStatus,
    toStatus: status,
    metadata: options?.error ? { error: options.error } : undefined,
  })

  persistPlans()
  return plan
}

export function markStepInProgress(planId: string, stepIndex: number): AiPlan | null {
  ensurePlansLoaded()
  const plan = state.plans.get(planId)
  if (!plan) return null

  const step = plan.steps[stepIndex]
  if (!step) return null

  return updateStepStatus(planId, step.id, 'in_progress')
}

export function markStepCompleted(planId: string, stepIndex: number): AiPlan | null {
  ensurePlansLoaded()
  const plan = state.plans.get(planId)
  if (!plan) return null

  const step = plan.steps[stepIndex]
  if (!step) return null

  const updated = updateStepStatus(planId, step.id, 'completed')
  if (!updated) return null

  if (updated.status === 'in_progress' && updated.steps.every(item => item.status === 'completed' || item.status === 'skipped')) {
    const previousPlanStatus = updated.status
    updated.status = 'completed'
    updated.completedAt = now()
    updated.updatedAt = now()
    appendPlanChange(updated, {
      type: 'completed',
      actor: 'system',
      summary: `所有步骤完成，计划自动完成：${updated.title}`,
      fromStatus: previousPlanStatus,
      toStatus: 'completed',
    })
    persistPlans()
  }

  return updated
}

export function markStepFailed(planId: string, stepIndex: number, error: string): AiPlan | null {
  ensurePlansLoaded()
  const plan = state.plans.get(planId)
  if (!plan) return null

  const step = plan.steps[stepIndex]
  if (!step) return null

  return updateStepStatus(planId, step.id, 'failed', { error })
}

export function attachStepJobRef(
  planId: string,
  stepId: string,
  jobRef: Omit<AiPlanStepJobRef, 'attachedAt' | 'updatedAt'> & { attachedAt?: number; updatedAt?: number },
): AiPlan | null {
  ensurePlansLoaded()
  const plan = state.plans.get(planId)
  if (!plan) return null

  const step = findStep(plan, stepId)
  if (!step) return null

  const mutationTime = now()
  const eventTime = jobRef.updatedAt ?? jobRef.attachedAt ?? mutationTime
  const refs = step.jobRefs ?? []
  const existingIndex = refs.findIndex(ref => ref.jobId === jobRef.jobId)
  const existing = existingIndex >= 0 ? refs[existingIndex] : undefined
  const nextRef: AiPlanStepJobRef = {
    jobId: jobRef.jobId,
    kind: jobRef.kind,
    status: jobRef.status,
    title: jobRef.title ?? existing?.title,
    attachedAt: existing?.attachedAt ?? jobRef.attachedAt ?? eventTime,
    updatedAt: jobRef.updatedAt ?? eventTime,
    resultSummary: jobRef.resultSummary ?? existing?.resultSummary,
    error: jobRef.error,
  }

  step.jobRefs = existingIndex >= 0
    ? refs.map((ref, index) => index === existingIndex ? nextRef : ref)
    : [...refs, nextRef]
  plan.updatedAt = Math.max(plan.updatedAt, eventTime, mutationTime)
  appendPlanChange(plan, {
    type: existingIndex >= 0 ? 'job_updated' : 'job_attached',
    actor: 'system',
    summary: existingIndex >= 0
      ? `更新步骤「${step.title}」关联任务：${jobRef.kind}/${jobRef.jobId} -> ${jobRef.status}`
      : `步骤「${step.title}」关联任务：${jobRef.kind}/${jobRef.jobId}`,
    stepId: step.id,
    metadata: {
      jobId: jobRef.jobId,
      kind: jobRef.kind,
      status: jobRef.status,
    },
  })
  persistPlans()

  return plan
}

export function updateStepJobRef(
  planId: string,
  stepId: string,
  jobId: string,
  patch: Partial<Pick<AiPlanStepJobRef, 'status' | 'title' | 'resultSummary' | 'error' | 'kind'>>,
): AiPlan | null {
  ensurePlansLoaded()
  const plan = state.plans.get(planId)
  if (!plan) return null

  const step = findStep(plan, stepId)
  if (!step?.jobRefs?.length) return null

  const existing = step.jobRefs.find(ref => ref.jobId === jobId)
  if (!existing) return null

  return attachStepJobRef(planId, stepId, {
    ...existing,
    ...patch,
    attachedAt: existing.attachedAt,
    updatedAt: now(),
  })
}

export function attachJobToActivePlanStep(
  sessionId: string,
  jobRef: Omit<AiPlanStepJobRef, 'attachedAt' | 'updatedAt'> & { attachedAt?: number; updatedAt?: number; stepId?: string },
): AiPlan | null {
  const plan = getActivePlan(sessionId)
  if (!plan) return null

  const step = jobRef.stepId
    ? findStep(plan, jobRef.stepId)
    : plan.steps.find(item => item.status === 'in_progress')
      ?? plan.steps.find(item => item.status === 'pending')
      ?? plan.steps[0]
  if (!step) return null

  return attachStepJobRef(plan.id, step.id, jobRef)
}

export function updateJobRefByJobId(
  jobId: string,
  patch: Partial<Pick<AiPlanStepJobRef, 'status' | 'title' | 'resultSummary' | 'error' | 'kind'>>,
): AiPlan | null {
  ensurePlansLoaded()
  for (const plan of state.plans.values()) {
    for (const step of plan.steps) {
      if (step.jobRefs?.some(ref => ref.jobId === jobId)) {
        return updateStepJobRef(plan.id, step.id, jobId, patch)
      }
    }
  }
  return null
}

export function getActivePlan(sessionId: string): AiPlan | undefined {
  ensurePlansLoaded()
  const planId = state.activePlanIds.get(sessionId)
  return planId ? state.plans.get(planId) : undefined
}

export function getSessionPlans(sessionId: string): AiPlan[] {
  ensurePlansLoaded()
  return Array.from(state.plans.values())
    .filter(plan => plan.sessionId === sessionId)
    .sort((left, right) => right.createdAt - left.createdAt)
}

export function setActivePlan(sessionId: string, planId: string): boolean {
  ensurePlansLoaded()
  const plan = state.plans.get(planId)
  if (!plan || plan.sessionId !== sessionId) return false

  const previousActivePlanId = state.activePlanIds.get(sessionId)
  if (previousActivePlanId === planId) return true

  state.activePlanIds.set(sessionId, planId)
  plan.updatedAt = now()
  appendPlanChange(plan, {
    type: 'active_changed',
    actor: 'user',
    summary: `设置为当前会话 active plan：${plan.title}`,
    metadata: { previousActivePlanId },
  })

  persistPlans()
  return true
}

export function clearActivePlan(sessionId: string): void {
  ensurePlansLoaded()
  state.activePlanIds.delete(sessionId)
  persistPlans()
}

export function getPlanCount(): number {
  ensurePlansLoaded()
  return state.plans.size
}

export function getActivePlanCount(): number {
  ensurePlansLoaded()
  return Array.from(state.plans.values()).filter(plan => !isTerminalStatus(plan.status)).length
}

export function clearAllPlans(): void {
  state.plans.clear()
  state.activePlanIds.clear()
  hasLoadedPersistedPlans = true
  persistPlans()
}

export function buildPlanSummary(plan: AiPlan): AiPlanSummary {
  const completedStepCount = plan.steps.filter(step => step.status === 'completed' || step.status === 'skipped').length
  const activeStep = plan.steps.find(step => step.status === 'in_progress')
  const lastChange = plan.changes[plan.changes.length - 1]
  const activeStepJobRefs = activeStep?.jobRefs?.slice(-3)
  const recentChangeSummaries = plan.changes
    .slice(Math.max(plan.changes.length - 3, 0))
    .map(change => change.summary)
  const attentionJobSummaries = plan.steps
    .flatMap(step => (step.jobRefs ?? []).map(jobRef => ({ step, jobRef })))
    .filter(({ jobRef }) => jobRef.status === 'running' || jobRef.status === 'queued' || jobRef.status === 'failed')
    .slice(-3)
    .map(({ step, jobRef }) => {
      const title = jobRef.title || jobRef.kind
      const detail = jobRef.error || jobRef.resultSummary
      return `${step.title}: ${title} [${jobRef.status}]${detail ? ` - ${detail.slice(0, 160)}` : ''}`
    })

  return {
    planId: plan.id,
    title: plan.title,
    status: plan.status,
    stepCount: plan.steps.length,
    completedStepCount,
    activeStepTitle: activeStep?.title,
    lastChangeSummary: lastChange?.summary,
    lastChangeAt: lastChange?.createdAt,
    activeStepJobRefs,
    recentChangeSummaries,
    attentionJobSummaries,
  }
}

export function formatPlanSummaryForContext(summary: AiPlanSummary): string {
  const lines: string[] = []
  lines.push(`[Active Plan] ${summary.title}`)
  lines.push(`Status: ${summary.status}`)
  lines.push(`Progress: ${summary.completedStepCount}/${summary.stepCount} steps completed`)
  if (summary.activeStepTitle) {
    lines.push(`Current step: ${summary.activeStepTitle}`)
  }
  if (summary.lastChangeSummary) {
    lines.push(`Last change: ${summary.lastChangeSummary}`)
  }
  if (summary.recentChangeSummaries?.length) {
    lines.push(`Recent plan changes:\n${summary.recentChangeSummaries.map(item => `- ${item}`).join('\n')}`)
  }
  if (summary.activeStepJobRefs?.length) {
    const jobs = summary.activeStepJobRefs.map(jobRef => {
      const title = jobRef.title || jobRef.kind
      const detail = jobRef.error || jobRef.resultSummary
      return `- ${title} (${jobRef.kind}) status=${jobRef.status}${detail ? ` detail=${detail.slice(0, 160)}` : ''}`
    })
    lines.push(`Current step jobs:\n${jobs.join('\n')}`)
  }
  if (summary.attentionJobSummaries?.length) {
    lines.push(`Plan jobs needing attention:\n${summary.attentionJobSummaries.map(item => `- ${item}`).join('\n')}`)
  }

  return lines.join('\n')
}

export function getPlanChanges(planId: string): AiPlanChange[] {
  ensurePlansLoaded()
  return state.plans.get(planId)?.changes.map(clonePlanChange) ?? []
}

export function usePlanStore() {
  return {
    plans: computed(() => {
      ensurePlansLoaded()
      return Array.from(state.plans.values())
    }),
    activePlanIds: computed(() => {
      ensurePlansLoaded()
      return new Map(state.activePlanIds)
    }),
    createPlan,
    updatePlan,
    getPlan,
    deletePlan,
    approvePlan,
    startPlanExecution,
    completePlan,
    abandonPlan,
    updateStepStatus,
    markStepInProgress,
    markStepCompleted,
    markStepFailed,
    attachStepJobRef,
    updateStepJobRef,
    attachJobToActivePlanStep,
    updateJobRefByJobId,
    getActivePlan,
    getSessionPlans,
    setActivePlan,
    clearActivePlan,
    getPlanCount,
    getActivePlanCount,
    clearAllPlans,
    buildPlanSummary,
    formatPlanSummaryForContext,
    getPlanChanges,
    loadPersistedPlans,
    savePersistedPlans,
    ensurePlansLoaded,
  }
}
