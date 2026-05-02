import { describe, expect, it } from 'vitest'
import {
  buildSpawnedTaskIsolationContext,
  getWorkspaceIsolationPlanForTask,
} from '@/ai-gui/spawnedTaskIsolationPlan'
import type { SpawnedTask } from '@/composables/ai/chatSideEffects'

function task(input: Partial<SpawnedTask> & { id: string; description: string }): SpawnedTask {
  return {
    status: 'pending',
    createdAt: 1,
    retryCount: 0,
    ...input,
  }
}

describe('spawnedTaskIsolationPlan', () => {
  it('builds shared multi-agent and workspace isolation maps for spawned tasks', () => {
    const context = buildSpawnedTaskIsolationContext([
      task({ id: 'task-1', description: 'implement src/ai-gui/runtime.ts' }),
      task({ id: 'task-2', description: 'review src/ai-gui/runtime.ts' }),
      task({ id: 'task-3', description: 'verify pnpm test' }),
    ])

    expect(context.multiAgentPlan.assignments.map(item => item.role)).toEqual([
      'implementer',
      'reviewer',
      'verifier',
    ])
    expect(context.assignmentByTaskId.get('task-1')).toMatchObject({
      agentId: 'implementer-1',
      allowedPaths: ['src/ai-gui/runtime.ts'],
    })
    expect(context.isolationBoundaries.map(item => item.strength)).toEqual([
      'agent',
      'session',
      'session',
    ])
    expect(getWorkspaceIsolationPlanForTask(context, 'task-1')).toMatchObject({
      taskId: 'task-1',
      mode: 'temporary',
      mergeRequired: true,
      workspace: {
        workspacePath: '.devforge/tmp/agents/dispatcher-panel-implementer-1-task-1',
      },
    })
    expect(context.isolationPlanByTaskId.get('task-2')).toMatchObject({
      taskId: 'task-2',
      mode: 'readonly',
      mergeRequired: false,
      workspace: undefined,
    })
    expect(context.isolationPlanByTaskId.get('task-3')).toMatchObject({
      taskId: 'task-3',
      mode: 'readonly',
      mergeRequired: false,
      workspace: undefined,
    })
    expect(getWorkspaceIsolationPlanForTask(context, 'missing')).toBeNull()
  })

  it('allows callers to tighten implementer tasks into worktree execution', () => {
    const context = buildSpawnedTaskIsolationContext(
      [task({ id: 'task-1', description: 'implement src/runtime.ts' })],
      {
        sessionId: 'session-1',
        strengthForAssignment: assignment => assignment.role === 'implementer' ? 'strict' : 'session',
      },
    )

    expect(context.isolationPlanByTaskId.get('task-1')).toMatchObject({
      mode: 'worktree',
      requiresReview: true,
      cleanupPolicy: 'keep_for_review',
      workspace: {
        workspacePath: '.devforge/worktrees/session-1-implementer-1-task-1',
        branchName: 'devforge/agent/session-1-implementer-1-task-1',
      },
    })
  })

  it('supports caller supplied boundary overrides', () => {
    const context = buildSpawnedTaskIsolationContext(
      [task({ id: 'task-1', description: 'implement src/runtime.ts' })],
      {
        sessionId: 'session-1',
        boundaryForAssignment: () => ({
          allowedPaths: ['src/runtime.ts'],
          blockedPaths: ['src/secrets/**'],
          strength: 'strict',
        }),
      },
    )

    expect(context.isolationBoundaries[0]).toMatchObject({
      allowedPaths: ['src/runtime.ts'],
      blockedPaths: ['src/secrets/**'],
      strength: 'strict',
    })
    expect(context.isolationExecutionPlan.items[0]).toMatchObject({
      allowedPaths: ['src/runtime.ts'],
      blockedPaths: ['src/secrets/**'],
      mode: 'worktree',
    })
  })
})
