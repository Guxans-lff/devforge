import type { SpawnedTask } from '@/composables/ai/chatSideEffects'
import { checkWorkspaceIsolationBoundary, type WorkspaceIsolationBoundary } from './workspaceIsolation'

export type MultiAgentRole = 'planner' | 'implementer' | 'reviewer' | 'verifier'

export interface MultiAgentAssignment {
  taskId: string
  agentId: string
  role: MultiAgentRole
  allowedPaths: string[]
  dependsOn: string[]
  reason: string
}

export interface MultiAgentPlan {
  assignments: MultiAgentAssignment[]
  blocked: Array<{ taskId: string; reason: string }>
  warnings: string[]
}

function inferRole(task: SpawnedTask): MultiAgentRole {
  const text = task.description.toLowerCase()
  if (/test|verify|验证|测试/.test(text)) return 'verifier'
  if (/review|检查|审查/.test(text)) return 'reviewer'
  if (/plan|设计|方案/.test(text)) return 'planner'
  return 'implementer'
}

function inferAllowedPaths(task: SpawnedTask): string[] {
  const matches = task.description.match(/(?:src|docs|src-tauri|tests|packages|apps)\/[A-Za-z0-9_./*-]+/g) ?? []
  if (matches.length > 0) return [...new Set(matches.map(item => item.replace(/\\/g, '/')))]
  const role = inferRole(task)
  if (role === 'verifier' || role === 'reviewer') return ['src/**', 'src-tauri/**', 'docs/**']
  return ['src/**']
}

function hasDependencyCycle(tasks: SpawnedTask[]): string[] {
  const graph = new Map(tasks.map(task => [task.id, task.dependsOn ?? []]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const cycle: string[] = []

  function visit(id: string): boolean {
    if (visiting.has(id)) {
      cycle.push(id)
      return true
    }
    if (visited.has(id)) return false
    visiting.add(id)
    for (const next of graph.get(id) ?? []) {
      if (graph.has(next) && visit(next)) {
        cycle.push(id)
        return true
      }
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }

  for (const task of tasks) {
    if (visit(task.id)) break
  }
  return [...new Set(cycle)].reverse()
}

export function buildMultiAgentPlan(tasks: SpawnedTask[], options?: {
  sessionId?: string
  maxAgents?: number
}): MultiAgentPlan {
  const maxAgents = Math.max(1, options?.maxAgents ?? 3)
  const sessionId = options?.sessionId ?? 'session'
  const warnings: string[] = []
  const blocked: MultiAgentPlan['blocked'] = []
  const cycle = hasDependencyCycle(tasks)
  if (cycle.length > 0) {
    warnings.push(`检测到任务依赖环：${cycle.join(' -> ')}`)
  }

  const assignments: MultiAgentAssignment[] = []
  for (const [index, task] of tasks.entries()) {
    if (cycle.includes(task.id)) {
      blocked.push({ taskId: task.id, reason: 'dependency cycle' })
      continue
    }

    const role = inferRole(task)
    const allowedPaths = inferAllowedPaths(task)
    const agentId = `${role}-${(index % maxAgents) + 1}`
    const boundary: WorkspaceIsolationBoundary = {
      sessionId,
      agentId,
      allowedPaths,
      strength: role === 'implementer' ? 'agent' : 'session',
    }
    const unsafePath = allowedPaths.find(path => !checkWorkspaceIsolationBoundary(path.replace(/\*\*?$/, 'probe.ts'), boundary).allowed)
    if (unsafePath) {
      blocked.push({ taskId: task.id, reason: `invalid boundary: ${unsafePath}` })
      continue
    }

    assignments.push({
      taskId: task.id,
      agentId,
      role,
      allowedPaths,
      dependsOn: task.dependsOn ?? [],
      reason: role === 'implementer'
        ? '实现任务需要 agent 级写入边界。'
        : '非写入任务使用 session 级读取边界。',
    })
  }

  return { assignments, blocked, warnings }
}
