import { describe, expect, it } from 'vitest'
import {
  buildSpawnedTaskAutoRunBlockedNotice,
  buildSpawnedTaskIsolationPrepareDecision,
  buildSpawnedTaskRuntimeConfirmMessage,
  evaluateSpawnedTaskRuntimeGate,
  filterUnconfirmedSpawnedTasks,
} from '@/ai-gui/spawnedTaskRuntimeGate'
import type { SpawnedTask } from '@/composables/ai/chatSideEffects'
import type { WorkspaceIsolationExecutionPlanItem } from '@/ai-gui/workspaceIsolationPlan'

function task(input: Partial<SpawnedTask> & { id: string; description: string }): SpawnedTask {
  return {
    status: 'pending',
    createdAt: 1,
    retryCount: 0,
    ...input,
  }
}

function temporaryPlan(input: Partial<WorkspaceIsolationExecutionPlanItem> = {}): WorkspaceIsolationExecutionPlanItem {
  return {
    agentId: 'implementer-1',
    taskId: 'task-1',
    mode: 'temporary',
    allowedPaths: ['src/**'],
    blockedPaths: [],
    reason: 'test',
    mergeRequired: true,
    requiresReview: false,
    cleanupPolicy: 'delete_on_success',
    workspace: {
      slug: 'session-1-implementer-1-task-1',
      workspacePath: '.devforge/tmp/agents/session-1-implementer-1-task-1',
    },
    actions: [],
    ...input,
  }
}

describe('spawnedTaskRuntimeGate', () => {
  it('allows tasks when workspace isolation is disabled', async () => {
    const decision = await evaluateSpawnedTaskRuntimeGate({
      sessionId: 'session-1',
      tasks: [task({ id: 'task-1', description: 'implement src/runtime.ts' })],
      workspaceIsolation: { strength: 'off' },
      resolveReferencedPaths: text => [text],
    })

    expect(decision).toEqual({
      allowed: true,
      requiresConfirmation: false,
      message: '',
    })
  })

  it('requires confirmation for temporary implementer tasks', async () => {
    const decision = await evaluateSpawnedTaskRuntimeGate({
      sessionId: 'session-1',
      tasks: [task({ id: 'task-1', description: 'implement src/runtime.ts' })],
      workspaceIsolation: { strength: 'agent' },
      resolveReferencedPaths: () => ['src/runtime.ts'],
    })

    expect(decision.allowed).toBe(true)
    expect(decision.requiresConfirmation).toBe(true)
    expect(decision.message).toContain('执行动作需要人工确认')
    expect(decision.context?.isolationExecutionPlan.items[0]).toMatchObject({
      mode: 'temporary',
      taskId: 'task-1',
    })
  })

  it('blocks strict isolation without explicit allowed paths', async () => {
    const decision = await evaluateSpawnedTaskRuntimeGate({
      sessionId: 'session-1',
      tasks: [task({ id: 'task-1', description: 'implement src/runtime.ts' })],
      workspaceIsolation: { strength: 'strict', allowedPaths: [] },
      resolveReferencedPaths: () => ['src/runtime.ts'],
    })

    expect(decision.allowed).toBe(false)
    expect(decision.requiresConfirmation).toBe(true)
    expect(decision.message).toContain('阻塞状态')
  })

  it('builds stable confirmation and auto-run notice messages', () => {
    const tasks = Array.from({ length: 6 }, (_, index) =>
      task({ id: `task-${index + 1}`, description: `task ${index + 1}` }),
    )

    expect(filterUnconfirmedSpawnedTasks(tasks, new Set(['task-1', 'task-3'])).map(item => item.id)).toEqual([
      'task-2',
      'task-4',
      'task-5',
      'task-6',
    ])
    expect(buildSpawnedTaskRuntimeConfirmMessage(tasks, '需要确认')).toContain('另外 1 个任务')
    expect(buildSpawnedTaskAutoRunBlockedNotice('需要确认')).toBe([
      '子任务已准备好，但隔离门禁未自动放行：',
      '需要确认',
      '请在任务面板手动确认后运行。',
    ].join('\n'))
  })

  it('decides whether a task needs isolation workspace preparation before running', () => {
    expect(buildSpawnedTaskIsolationPrepareDecision({
      task: task({
        id: 'task-1',
        description: 'implement src/runtime.ts',
        isolationWorkDir: 'D:/repo/.devforge/tmp/agents/task-1',
      }),
      plan: temporaryPlan(),
      repoPath: 'D:/repo',
    })).toEqual({ required: false, reason: 'already_prepared' })

    expect(buildSpawnedTaskIsolationPrepareDecision({
      task: task({ id: 'task-1', description: 'review src/runtime.ts' }),
      plan: null,
      repoPath: 'D:/repo',
    })).toEqual({ required: false, reason: 'no_workspace_plan' })

    const decision = buildSpawnedTaskIsolationPrepareDecision({
      task: task({ id: 'task-1', description: 'implement src/runtime.ts' }),
      plan: temporaryPlan(),
      repoPath: 'D:/repo',
    })

    expect(decision).toMatchObject({
      required: true,
      mode: 'temporary',
      workspacePath: 'D:/repo/.devforge/tmp/agents/session-1-implementer-1-task-1',
    })
    expect(decision.required && decision.plan.taskId).toBe('task-1')
    expect(decision.required && decision.confirmMessage).toContain('该子任务需要先准备隔离执行空间')
    expect(decision.required && decision.confirmMessage).toContain('D:/repo/.devforge/tmp/agents/session-1-implementer-1-task-1')
  })
})
