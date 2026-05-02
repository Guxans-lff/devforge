import type { SpawnedTask } from '@/composables/ai/chatSideEffects'
import {
  buildMultiAgentPlan,
  type MultiAgentAssignment,
  type MultiAgentPlan,
} from './multiAgentOrchestrator'
import {
  summarizeWorkspaceIsolationBoundary,
  type WorkspaceIsolationBoundary,
  type WorkspaceIsolationBoundarySummary,
  type WorkspaceIsolationStrength,
} from './workspaceIsolation'
import {
  buildWorkspaceIsolationExecutionPlan,
  type WorkspaceIsolationExecutionPlan,
  type WorkspaceIsolationExecutionPlanItem,
} from './workspaceIsolationPlan'

export interface SpawnedTaskIsolationContext {
  multiAgentPlan: MultiAgentPlan
  isolationBoundaries: WorkspaceIsolationBoundarySummary[]
  isolationExecutionPlan: WorkspaceIsolationExecutionPlan
  assignmentByTaskId: Map<string, MultiAgentAssignment>
  isolationPlanByTaskId: Map<string, WorkspaceIsolationExecutionPlanItem>
}

export interface SpawnedTaskIsolationContextOptions {
  sessionId?: string
  maxAgents?: number
  strengthForAssignment?: (assignment: MultiAgentAssignment) => WorkspaceIsolationStrength
  boundaryForAssignment?: (assignment: MultiAgentAssignment) => Partial<WorkspaceIsolationBoundary>
}

function defaultStrengthForAssignment(assignment: MultiAgentAssignment): WorkspaceIsolationStrength {
  return assignment.role === 'implementer' ? 'agent' : 'session'
}

export function buildSpawnedTaskIsolationContext(
  tasks: SpawnedTask[],
  options: SpawnedTaskIsolationContextOptions = {},
): SpawnedTaskIsolationContext {
  const sessionId = options.sessionId ?? 'dispatcher-panel'
  const multiAgentPlan = buildMultiAgentPlan(tasks, {
    sessionId,
    maxAgents: options.maxAgents ?? Math.min(4, Math.max(1, tasks.length)),
  })
  const strengthForAssignment = options.strengthForAssignment ?? defaultStrengthForAssignment
  const isolationBoundaries = multiAgentPlan.assignments.map(assignment =>
    summarizeWorkspaceIsolationBoundary({
      sessionId,
      agentId: assignment.agentId,
      allowedPaths: assignment.allowedPaths,
      strength: strengthForAssignment(assignment),
      ...options.boundaryForAssignment?.(assignment),
    }),
  )
  const isolationExecutionPlan = buildWorkspaceIsolationExecutionPlan({
    sessionId,
    assignments: multiAgentPlan.assignments,
    boundaries: isolationBoundaries,
  })

  return {
    multiAgentPlan,
    isolationBoundaries,
    isolationExecutionPlan,
    assignmentByTaskId: new Map(multiAgentPlan.assignments.map(assignment => [assignment.taskId, assignment])),
    isolationPlanByTaskId: new Map(isolationExecutionPlan.items.map(item => [item.taskId, item])),
  }
}

export function getWorkspaceIsolationPlanForTask(
  context: SpawnedTaskIsolationContext,
  taskId: string,
): WorkspaceIsolationExecutionPlanItem | null {
  return context.isolationPlanByTaskId.get(taskId) ?? null
}
