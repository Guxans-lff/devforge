import { describe, expect, it } from 'vitest'
import { buildMultiAgentPlan } from '@/ai-gui/multiAgentOrchestrator'
import type { SpawnedTask } from '@/composables/ai/chatSideEffects'

function task(input: Partial<SpawnedTask> & { id: string; description: string }): SpawnedTask {
  return {
    status: 'pending',
    createdAt: 1,
    retryCount: 0,
    ...input,
  }
}

describe('multiAgentOrchestrator', () => {
  it('assigns roles and workspace boundaries from task intent', () => {
    const plan = buildMultiAgentPlan([
      task({ id: 't1', description: '实现 src/ai-gui/foo.ts 的功能' }),
      task({ id: 't2', description: '验证 pnpm test 是否通过', dependsOn: ['t1'] }),
      task({ id: 't3', description: '审查 docs/guide.md 文档' }),
    ], { sessionId: 's1', maxAgents: 2 })

    expect(plan.blocked).toEqual([])
    expect(plan.assignments.map(item => item.role)).toEqual(['implementer', 'verifier', 'reviewer'])
    expect(plan.assignments[0]).toMatchObject({
      agentId: 'implementer-1',
      allowedPaths: ['src/ai-gui/foo.ts'],
    })
    expect(plan.assignments[1]?.dependsOn).toEqual(['t1'])
  })

  it('blocks tasks with dependency cycles', () => {
    const plan = buildMultiAgentPlan([
      task({ id: 'a', description: '实现 A', dependsOn: ['b'] }),
      task({ id: 'b', description: '实现 B', dependsOn: ['a'] }),
    ])

    expect(plan.warnings[0]).toContain('依赖环')
    expect(plan.blocked.map(item => item.taskId).sort()).toEqual(['a', 'b'])
  })
})
