/**
 * 后台 Job 状态管理（前端侧）
 *
 * 轻量级任务跟踪，UI 提交后异步执行，不阻塞主交互。
 * 当前支持：AI Compact
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  cleanupBackgroundJobs,
  listBackgroundJobs,
  submitBackgroundJob,
  updateBackgroundJob,
  type BackgroundJobDto,
} from '@/api/background-job'
import { attachJobToActivePlanStep, updateJobRefByJobId } from '@/composables/ai-agent/planning/planStore'
import { createLogger } from '@/utils/logger'

const log = createLogger('ai.background-job')

export type BackgroundJobKind =
  | 'ai_compact'
  | 'ai_compact_auto'
  | 'workspace_index'
  | 'resource_scan'
  | 'schema_compare'
  | 'schema_compare_sql'
  | 'erp_module_load'
  | 'verification'
  | 'diagnostic_capture'

export type BackgroundJobStatus = 'queued' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled'

export interface BackgroundJob {
  id: string
  kind: BackgroundJobKind
  sessionId: string
  status: BackgroundJobStatus
  progress: number // 0-100
  createdAt: number
  startedAt?: number
  finishedAt?: number
  result?: string
  error?: string
  title?: string
  contextSummary?: string
  meta?: Record<string, unknown>
}

export interface SubmitBackgroundJobOptions {
  title?: string
  contextSummary?: string
  meta?: Record<string, unknown>
}

function genJobId(): string {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function normalizeBackendJob(job: BackgroundJobDto): BackgroundJob {
  const now = Date.now()
  return {
    id: job.id,
    kind: job.kind as BackgroundJobKind,
    sessionId: job.sessionId ?? job.session_id ?? 'unknown',
    status: job.status as BackgroundJobStatus,
    progress: job.progress ?? 0,
    createdAt: job.createdAt ?? job.created_at ?? now,
    startedAt: job.startedAt ?? job.started_at ?? undefined,
    finishedAt: job.finishedAt ?? job.finished_at ?? undefined,
    result: job.result ?? undefined,
    error: job.error ?? undefined,
  }
}

function syncPlanJobRef(job: BackgroundJob): void {
  updateJobRefByJobId(job.id, {
    kind: job.kind,
    status: job.status,
    title: job.title,
    resultSummary: job.contextSummary ?? job.result?.slice(0, 500),
    error: job.error,
  })
}

function shouldAttachToPlan(kind: BackgroundJobKind): boolean {
  return kind === 'verification'
    || kind === 'schema_compare'
    || kind === 'schema_compare_sql'
    || kind === 'erp_module_load'
    || kind === 'resource_scan'
}

function jobKindTitle(kind: BackgroundJobKind): string {
  switch (kind) {
    case 'verification': return '验证任务'
    case 'schema_compare': return 'Schema 对比'
    case 'schema_compare_sql': return 'Schema 迁移 SQL'
    case 'erp_module_load': return 'ERP 模块加载'
    case 'resource_scan': return '资源扫描'
    default: return kind
  }
}

export const useBackgroundJobStore = defineStore('background-job', () => {
  const jobs = ref<BackgroundJob[]>([])
  const hydrated = ref(false)

  const activeJobs = computed(() =>
    jobs.value.filter(j => j.status === 'queued' || j.status === 'running' || j.status === 'cancelling'),
  )

  const jobsBySession = computed(() => {
    const map = new Map<string, BackgroundJob[]>()
    for (const job of jobs.value) {
      const list = map.get(job.sessionId) ?? []
      list.push(job)
      map.set(job.sessionId, list)
    }
    return map
  })

  function findActiveJob(sessionId: string, kind: BackgroundJobKind): BackgroundJob | undefined {
    return jobs.value.find(j => j.sessionId === sessionId && j.kind === kind && (j.status === 'queued' || j.status === 'running'))
  }

  async function submitJob(kind: BackgroundJobKind, sessionId: string, options?: SubmitBackgroundJobOptions): Promise<string> {
    // 同类去重：取消旧的 running/queued job
    const existing = findActiveJob(sessionId, kind)
    if (existing) {
      await cancelJob(existing.id)
    }

    const job: BackgroundJob = {
      id: genJobId(),
      kind,
      sessionId,
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      title: options?.title,
      contextSummary: options?.contextSummary,
      meta: options?.meta,
    }
    jobs.value = [...jobs.value, job]
    if (shouldAttachToPlan(kind)) {
      attachJobToActivePlanStep(sessionId, {
        jobId: job.id,
        kind,
        status: job.status,
        title: options?.title ?? jobKindTitle(kind),
        resultSummary: options?.contextSummary,
        attachedAt: job.createdAt,
      })
    }
    log.info('job_submitted', { jobId: job.id, kind, sessionId })

    try {
      await submitBackgroundJob(job.id, kind, sessionId)
    } catch (e) {
      log.warn('job_backend_submit_failed', { jobId: job.id }, e)
    }

    return job.id
  }

  async function hydrateJobs(sessionId?: string): Promise<void> {
    try {
      const restored = (await listBackgroundJobs(sessionId)).map(normalizeBackendJob)
      const restoredIds = new Set(restored.map(job => job.id))
      const localOnly = sessionId
        ? jobs.value.filter(job => job.sessionId !== sessionId && !restoredIds.has(job.id))
        : jobs.value.filter(job => !restoredIds.has(job.id))
      jobs.value = [...localOnly, ...restored].sort((left, right) => right.createdAt - left.createdAt)
      for (const job of restored) {
        syncPlanJobRef(job)
      }
      hydrated.value = true
      log.info('jobs_hydrated', { sessionId, count: restored.length })
    } catch (e) {
      hydrated.value = false
      log.warn('jobs_hydrate_failed', { sessionId }, e)
    }
  }

  async function startJob(jobId: string): Promise<void> {
    const idx = jobs.value.findIndex(j => j.id === jobId)
    if (idx === -1) return
    jobs.value = jobs.value.map((j, i) =>
      i === idx ? { ...j, status: 'running' as const, startedAt: Date.now() } : j,
    )
    syncPlanJobRef(jobs.value.find(j => j.id === jobId)!)
    log.info('job_started', { jobId })

    try {
      await updateBackgroundJob(jobId, 'running', 0)
    } catch (e) {
      log.warn('job_backend_update_failed', { jobId }, e)
    }
  }

  async function updateProgress(jobId: string, progress: number): Promise<void> {
    const idx = jobs.value.findIndex(j => j.id === jobId)
    if (idx === -1) return
    const clamped = Math.min(100, Math.max(0, progress))
    jobs.value = jobs.value.map((j, i) =>
      i === idx ? { ...j, progress: clamped } : j,
    )

    try {
      await updateBackgroundJob(jobId, 'running', clamped)
    } catch (e) {
      log.warn('job_backend_update_failed', { jobId }, e)
    }
  }

  async function succeedJob(jobId: string, result?: string): Promise<void> {
    const idx = jobs.value.findIndex(j => j.id === jobId)
    if (idx === -1) return
    jobs.value = jobs.value.map((j, i) =>
      i === idx ? { ...j, status: 'succeeded' as const, finishedAt: Date.now(), progress: 100, result } : j,
    )
    syncPlanJobRef(jobs.value.find(j => j.id === jobId)!)
    log.info('job_succeeded', { jobId })

    try {
      await updateBackgroundJob(jobId, 'succeeded', 100, result)
    } catch (e) {
      log.warn('job_backend_update_failed', { jobId }, e)
    }
  }

  async function failJob(jobId: string, error: string): Promise<void> {
    const idx = jobs.value.findIndex(j => j.id === jobId)
    if (idx === -1) return
    jobs.value = jobs.value.map((j, i) =>
      i === idx ? { ...j, status: 'failed' as const, finishedAt: Date.now(), error } : j,
    )
    syncPlanJobRef(jobs.value.find(j => j.id === jobId)!)
    log.warn('job_failed', { jobId, error })

    try {
      await updateBackgroundJob(jobId, 'failed', 0, undefined, error)
    } catch (e) {
      log.warn('job_backend_update_failed', { jobId }, e)
    }
  }

  async function cancelJob(jobId: string): Promise<void> {
    const idx = jobs.value.findIndex(j => j.id === jobId)
    if (idx === -1) return
    const job = jobs.value[idx]!
    if (job.status === 'running') {
      jobs.value = jobs.value.map((j, i) =>
        i === idx ? { ...j, status: 'cancelling' as const } : j,
      )
    } else if (job.status === 'queued') {
      jobs.value = jobs.value.map((j, i) =>
        i === idx ? { ...j, status: 'cancelled' as const, finishedAt: Date.now() } : j,
      )
    }
    syncPlanJobRef(jobs.value.find(j => j.id === jobId)!)
    log.info('job_cancelled', { jobId })

    try {
      await updateBackgroundJob(jobId, 'cancelled', 0, undefined, 'cancelled by user')
    } catch (e) {
      log.warn('job_backend_update_failed', { jobId }, e)
    }
  }

  async function cancelActiveByKind(sessionId: string, kind: BackgroundJobKind): Promise<void> {
    const active = findActiveJob(sessionId, kind)
    if (active) await cancelJob(active.id)
  }

  async function submitErpModuleLoadJob(sessionId: string, options?: SubmitBackgroundJobOptions): Promise<string> {
    return submitJob('erp_module_load', sessionId, options)
  }

  async function submitResourceScanJob(sessionId: string, options?: SubmitBackgroundJobOptions): Promise<string> {
    return submitJob('resource_scan', sessionId, options)
  }

  async function submitVerificationJob(sessionId: string, options?: SubmitBackgroundJobOptions): Promise<string> {
    return submitJob('verification', sessionId, options)
  }

  async function finishCancel(jobId: string): Promise<void> {
    const idx = jobs.value.findIndex(j => j.id === jobId)
    if (idx === -1) return
    jobs.value = jobs.value.map((j, i) =>
      i === idx ? { ...j, status: 'cancelled' as const, finishedAt: Date.now() } : j,
    )
    syncPlanJobRef(jobs.value.find(j => j.id === jobId)!)

    try {
      await updateBackgroundJob(jobId, 'cancelled', 0, undefined, 'cancelled by user')
    } catch (e) {
      log.warn('job_backend_update_failed', { jobId }, e)
    }
  }

  function clearCompleted(): void {
    jobs.value = jobs.value.filter(j =>
      j.status === 'queued' || j.status === 'running' || j.status === 'cancelling',
    )
  }

  async function cleanupCompleted(retainHours = 24): Promise<void> {
    clearCompleted()
    try {
      await cleanupBackgroundJobs(retainHours)
    } catch (e) {
      log.warn('jobs_backend_cleanup_failed', { retainHours }, e)
    }
  }

  return {
    jobs,
    hydrated,
    activeJobs,
    jobsBySession,
    hydrateJobs,
    submitJob,
    submitErpModuleLoadJob,
    submitResourceScanJob,
    submitVerificationJob,
    startJob,
    updateProgress,
    succeedJob,
    failJob,
    cancelJob,
    cancelActiveByKind,
    finishCancel,
    clearCompleted,
    cleanupCompleted,
  }
})
