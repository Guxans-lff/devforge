/**
 * Job Worker Runtime
 *
 * 执行器注册与调度框架。把后台 job 的执行逻辑从 UI 组件中解耦，
 * 支持超时、取消信号和进度回调。
 *
 * 使用方式：
 *   const worker = useJobWorker()
 *   worker.registerExecutor('ai_compact', async (ctx) => { ... })
 *   await worker.dispatch(jobId, 'ai_compact', sessionId, payload, { timeoutMs: 30000 })
 */

import { ref } from 'vue'
import { useBackgroundJobStore } from '@/stores/background-job'
import { createLogger } from '@/utils/logger'
import type { BackgroundJob } from '@/stores/background-job'

const log = createLogger('ai.job-worker')

export interface JobWorkerContext {
  jobId: string
  sessionId: string
  payload?: unknown
  signal: AbortSignal
  onProgress: (progress: number) => void
}

export type JobWorkerExecutor = (ctx: JobWorkerContext) => Promise<string | void>

interface ActiveJob {
  jobId: string
  kind: string
  controller: AbortController
  startTime: number
}

export function useJobWorker() {
  const store = useBackgroundJobStore()
  const executors = new Map<string, JobWorkerExecutor>()
  const activeJobs = ref<Map<string, ActiveJob>>(new Map())

  function registerExecutor(kind: string, executor: JobWorkerExecutor): void {
    if (executors.has(kind)) {
      log.warn('executor_overwrite', { kind })
    }
    executors.set(kind, executor)
    log.info('executor_registered', { kind })
  }

  function unregisterExecutor(kind: string): void {
    executors.delete(kind)
    log.info('executor_unregistered', { kind })
  }

  async function dispatch(
    jobId: string,
    kind: string,
    sessionId: string,
    payload?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    const executor = executors.get(kind)
    if (!executor) {
      const err = `No executor registered for kind: ${kind}`
      await store.failJob(jobId, err)
      throw new Error(err)
    }

    const controller = new AbortController()
    activeJobs.value.set(jobId, {
      jobId,
      kind,
      controller,
      startTime: Date.now(),
    })

    await store.startJob(jobId)

    // 如果在 startJob 期间被外部取消，直接结束
    if (controller.signal.aborted) {
      await store.finishCancel(jobId)
      activeJobs.value.delete(jobId)
      return
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutMs = options?.timeoutMs
    if (timeoutMs && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        controller.abort('timeout')
        log.warn('job_timeout', { jobId, kind, timeoutMs })
      }, timeoutMs)
    }

    try {
      const result = await executor({
        jobId,
        sessionId,
        payload,
        signal: controller.signal,
        onProgress: (progress: number) => {
          if (!controller.signal.aborted) {
            store.updateProgress(jobId, progress)
          }
        },
      })
      if (!controller.signal.aborted) {
        await store.succeedJob(jobId, result ?? undefined)
      }
    } catch (e) {
      if (controller.signal.aborted) {
        await store.finishCancel(jobId)
      } else {
        await store.failJob(jobId, e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      activeJobs.value.delete(jobId)
    }
  }

  function cancel(jobId: string): void {
    const active = activeJobs.value.get(jobId)
    if (active) {
      active.controller.abort('user_cancelled')
      log.info('job_cancel_requested', { jobId, kind: active.kind })
    }
    void store.cancelJob(jobId)
  }

  async function recoverInterruptedJobs(sessionId?: string): Promise<void> {
    if (typeof store.hydrateJobs === 'function') {
      await store.hydrateJobs(sessionId)
    }
    const storeActiveJobs = Array.isArray(store.activeJobs)
      ? store.activeJobs
      : Array.isArray((store.activeJobs as { value?: BackgroundJob[] }).value)
        ? (store.activeJobs as { value: BackgroundJob[] }).value
        : []
    const interrupted = storeActiveJobs.filter(job => !activeJobs.value.has(job.id))
    for (const job of interrupted) {
      await store.failJob(job.id, '应用已重启，任务执行器已中断，请重新提交。')
    }
    if (interrupted.length > 0) {
      log.warn('jobs_recovered_as_interrupted', { sessionId, count: interrupted.length })
    }
  }

  function isActive(jobId: string): boolean {
    return activeJobs.value.has(jobId)
  }

  function getActiveJobCount(): number {
    return activeJobs.value.size
  }

  return {
    registerExecutor,
    unregisterExecutor,
    dispatch,
    cancel,
    recoverInterruptedJobs,
    isActive,
    getActiveJobCount,
    activeJobs,
  }
}
