import { invokeCommand } from '@/api/base'
import type { ScheduledTask, TaskExecution } from '@/types/scheduler'

/**
 * 列出所有调度任务
 */
export function listScheduledTasks(): Promise<ScheduledTask[]> {
  return invokeCommand('list_scheduled_tasks')
}

/**
 * 创建调度任务
 *
 * @param name 任务名称
 * @param taskType 任务类型（如 "data_sync"）
 * @param cronExpr cron 表达式
 * @param configJson 任务配置 JSON
 * @param enabled 是否启用（默认 true）
 */
export function createScheduledTask(
  name: string,
  taskType: string,
  cronExpr: string,
  configJson: string,
  enabled?: boolean,
): Promise<ScheduledTask> {
  return invokeCommand('create_scheduled_task', {
    name,
    taskType,
    cronExpr,
    configJson,
    enabled: enabled ?? null,
  })
}

/**
 * 更新调度任务（仅传入需要修改的字段）
 *
 * @param id 任务 ID
 * @param updates 需要更新的字段
 */
export function updateScheduledTask(
  id: string,
  updates: {
    name?: string
    cronExpr?: string
    configJson?: string
    enabled?: boolean
  },
): Promise<ScheduledTask> {
  return invokeCommand('update_scheduled_task', {
    id,
    name: updates.name ?? null,
    cronExpr: updates.cronExpr ?? null,
    configJson: updates.configJson ?? null,
    enabled: updates.enabled ?? null,
  })
}

/**
 * 删除调度任务
 */
export function deleteScheduledTask(id: string): Promise<void> {
  return invokeCommand('delete_scheduled_task', { id })
}

/**
 * 启用/禁用调度任务
 */
export function toggleScheduledTask(id: string, enabled: boolean): Promise<ScheduledTask> {
  return invokeCommand('toggle_scheduled_task', { id, enabled })
}

/**
 * 列出指定任务的执行历史
 */
export function listTaskExecutions(taskId: string): Promise<TaskExecution[]> {
  return invokeCommand('list_task_executions', { taskId })
}

/**
 * 立即执行指定任务
 */
export function runTaskNow(id: string): Promise<string> {
  return invokeCommand('run_task_now', { id })
}
