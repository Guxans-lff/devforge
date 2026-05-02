import type { TaskIsolationBackendState } from '@/api/workspace-isolation'
import type { WorkspaceIsolationExecutionPlanItem } from './workspaceIsolationPlan'
import {
  createWorkspaceIsolationRuntimeService,
  type WorkspaceIsolationRuntimeActionOptions,
  type WorkspaceIsolationRuntimeContext,
  type WorkspaceIsolationRuntimeDeps,
} from './workspaceIsolationRuntimeService'

export type WorkspaceIsolationRuntimeAction = 'prepare' | 'diff' | 'verify' | 'apply' | 'cleanup'

export interface WorkspaceIsolationRuntimeControllerDeps extends WorkspaceIsolationRuntimeDeps {
  getContext: () => WorkspaceIsolationRuntimeContext | null
}

export function createWorkspaceIsolationRuntimeController(
  deps: WorkspaceIsolationRuntimeControllerDeps,
) {
  const service = createWorkspaceIsolationRuntimeService(deps)

  function contextOrError(taskId: string): WorkspaceIsolationRuntimeContext | null {
    const context = deps.getContext()
    if (context) return context
    deps.setState(taskId, { status: 'error', message: '缺少 workspace root 或隔离执行计划。' })
    return null
  }

  async function prepare(
    taskId: string,
    plan: WorkspaceIsolationExecutionPlanItem,
    options?: WorkspaceIsolationRuntimeActionOptions,
  ): Promise<string | null> {
    const context = contextOrError(taskId)
    if (!context) return null
    return service.prepare(context, taskId, plan, options)
  }

  async function run(
    action: WorkspaceIsolationRuntimeAction,
    taskId: string,
    plan: WorkspaceIsolationExecutionPlanItem,
  ): Promise<void> {
    const context = contextOrError(taskId)
    if (!context) return
    await service[action](context, taskId, plan)
  }

  function setTaskError(taskId: string, state: TaskIsolationBackendState): void {
    deps.setState(taskId, state)
  }

  return {
    prepare,
    run,
    setTaskError,
  }
}
