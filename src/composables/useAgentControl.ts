/**
 * Agent 远程控制面板
 *
 * 整合 JobWorker、BackgroundJob、ProactiveTick 和 AI Chat 的控制能力，
 * 提供统一的 pause/resume/cancel/status 接口。
 *
 * 适用于：
 * - 紧急 Kill Switch（一键停止所有 AI 活动）
 * - 后台任务批量管理
 * - 外部命令/CLI 联动入口
 */

import { computed } from 'vue'
import { useBackgroundJobStore } from '@/stores/background-job'
import { useProactiveTickStore } from '@/stores/proactive-tick'
import { useJobWorker } from '@/composables/useJobWorker'
import { createLogger } from '@/utils/logger'

const log = createLogger('ai.agent-control')

export interface AgentControlStatus {
  isStreaming: boolean
  activeJobs: number
  activeProactiveTasks: number
  activeWorkerJobs: number
  isPausedGlobally: boolean
}

export function useAgentControl() {
  const bgStore = useBackgroundJobStore()
  const tickStore = useProactiveTickStore()
  const worker = useJobWorker()

  const status = computed<AgentControlStatus>(() => ({
    isStreaming: false, // 由调用方传入或从外部获取
    activeJobs: bgStore.activeJobs.length,
    activeProactiveTasks: tickStore.activeTasks.length,
    activeWorkerJobs: worker.getActiveJobCount(),
    isPausedGlobally: tickStore.isPausedGlobally,
  }))

  function pauseAll(): void {
    log.info('agent_control_pause_all')
    tickStore.pauseAll()
    // Worker 层面的 job 不直接 pause，而是通过 cancel + 重新 dispatch 实现
    // MVP 阶段：pause 只影响 proactive tick
  }

  function resumeAll(): void {
    log.info('agent_control_resume_all')
    tickStore.resumeAll()
  }

  function cancelAll(): void {
    log.info('agent_control_cancel_all')
    // 取消所有后台 job
    for (const job of bgStore.activeJobs) {
      bgStore.cancelJob(job.id)
    }
    // 取消所有 worker 中的活跃 job
    for (const [jobId] of worker.activeJobs.value) {
      worker.cancel(jobId)
    }
    // 停止所有 proactive tick
    for (const task of tickStore.activeTasks) {
      tickStore.stopTask(task.id)
    }
  }

  function killSwitch(): void {
    log.warn('agent_control_kill_switch')
    cancelAll()
    // 同时触发流式中断（由调用方处理，因为 useAgentControl 不直接持有 chat 实例）
  }

  return {
    status,
    pauseAll,
    resumeAll,
    cancelAll,
    killSwitch,
  }
}
