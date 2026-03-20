import { ref, readonly, onMounted, onBeforeUnmount } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  listScheduledTasks,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  toggleScheduledTask,
  listTaskExecutions,
  runTaskNow,
} from '@/api/scheduler'
import type { ScheduledTask, TaskExecution } from '@/types/scheduler'

/** 调度器事件载荷（由后端通过 Tauri 事件推送） */
interface TaskEventPayload {
  type: 'started' | 'completed' | 'failed'
  taskId: string
  executionId?: string
  error?: string
}

/**
 * 调度管理逻辑 composable
 *
 * 管理任务列表、执行历史、CRUD 操作、实时事件监听。
 */
export function useScheduler() {
  /** 任务列表 */
  const tasks = ref<ScheduledTask[]>([])
  /** 是否正在加载任务列表 */
  const loading = ref(false)
  /** 加载错误 */
  const loadError = ref<string | null>(null)

  /** 执行历史（按 taskId 索引） */
  const executions = ref<Map<string, TaskExecution[]>>(new Map())
  /** 正在加载执行历史的任务 ID */
  const loadingExecutions = ref<Set<string>>(new Set())

  /** 事件监听取消函数 */
  let unlisten: UnlistenFn | null = null

  /**
   * 加载所有调度任务
   */
  async function loadTasks(): Promise<void> {
    loading.value = true
    loadError.value = null
    try {
      tasks.value = await listScheduledTasks()
    } catch (e: unknown) {
      loadError.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  /**
   * 创建新任务
   */
  async function createTask(
    name: string,
    taskType: string,
    cronExpr: string,
    configJson: string,
    enabled?: boolean,
  ): Promise<ScheduledTask> {
    const task = await createScheduledTask(name, taskType, cronExpr, configJson, enabled)
    // 重新加载列表确保一致性
    await loadTasks()
    return task
  }

  /**
   * 更新任务
   */
  async function updateTask(
    id: string,
    updates: {
      name?: string
      cronExpr?: string
      configJson?: string
      enabled?: boolean
    },
  ): Promise<ScheduledTask> {
    const task = await updateScheduledTask(id, updates)
    await loadTasks()
    return task
  }

  /**
   * 删除任务
   */
  async function deleteTask(id: string): Promise<void> {
    await deleteScheduledTask(id)
    // 同时清理执行历史缓存
    const newMap = new Map(executions.value)
    newMap.delete(id)
    executions.value = newMap
    await loadTasks()
  }

  /**
   * 启用/禁用任务
   */
  async function toggleTask(id: string, enabled: boolean): Promise<ScheduledTask> {
    const task = await toggleScheduledTask(id, enabled)
    await loadTasks()
    return task
  }

  /**
   * 加载指定任务的执行历史
   */
  async function loadExecutions(taskId: string): Promise<TaskExecution[]> {
    const newLoading = new Set(loadingExecutions.value)
    newLoading.add(taskId)
    loadingExecutions.value = newLoading

    try {
      const list = await listTaskExecutions(taskId)
      executions.value = new Map(executions.value).set(taskId, list)
      return list
    } finally {
      const newSet = new Set(loadingExecutions.value)
      newSet.delete(taskId)
      loadingExecutions.value = newSet
    }
  }

  /**
   * 立即执行任务
   */
  async function runNow(id: string): Promise<string> {
    const result = await runTaskNow(id)
    // 执行后刷新任务列表和执行历史
    await loadTasks()
    await loadExecutions(id)
    return result
  }

  /**
   * 获取指定任务的执行历史
   */
  function getExecutions(taskId: string): TaskExecution[] {
    return executions.value.get(taskId) ?? []
  }

  /**
   * 启动实时事件监听
   */
  async function startListening(): Promise<void> {
    if (unlisten) return
    try {
      unlisten = await listen<TaskEventPayload>('scheduler://task-event', (event) => {
        const payload = event.payload
        // 收到事件后刷新任务列表
        loadTasks()
        // 如果有关联的执行记录，也刷新执行历史
        if (payload.taskId) {
          loadExecutions(payload.taskId)
        }
      })
    } catch {
      // 事件监听失败不影响主流程
    }
  }

  /**
   * 停止事件监听
   */
  function stopListening(): void {
    if (unlisten) {
      unlisten()
      unlisten = null
    }
  }

  // 生命周期自动管理
  onMounted(() => {
    loadTasks()
    startListening()
  })

  onBeforeUnmount(() => {
    stopListening()
  })

  return {
    tasks: readonly(tasks),
    loading: readonly(loading),
    loadError: readonly(loadError),
    executions: readonly(executions),
    loadingExecutions: readonly(loadingExecutions),
    loadTasks,
    createTask,
    updateTask,
    deleteTask,
    toggleTask,
    loadExecutions,
    runNow,
    getExecutions,
  }
}
