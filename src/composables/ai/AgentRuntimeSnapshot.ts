import type { AiTurnState } from './AiTurnRuntime'
import type { AgentRuntimeTransition } from './AgentRuntime'

export type AgentRuntimeHealth = 'idle' | 'healthy' | 'watch' | 'critical'

export interface AgentRuntimeSnapshot {
  turnId: string
  phase: AiTurnState['phase']
  health: AgentRuntimeHealth
  isBusy: boolean
  canAbort: boolean
  durationMs: number | null
  activeToolCount: number
  pendingToolCount: number
  textDeltaLength: number
  thinkingDeltaLength: number
  lastFinishReason?: string
  error?: string
  retryable?: boolean
  recoveryAttempt?: number
  transitionCount: number
  lastTransitionReason?: AgentRuntimeTransition['reason']
  lastTransitionAt?: number
}

const busyPhases = new Set<AiTurnState['phase']>([
  'preparing',
  'routing',
  'streaming',
  'tool_executing',
  'compacting',
  'recovering',
])

function runtimeHealth(state: AiTurnState): AgentRuntimeHealth {
  if (state.phase === 'idle') return 'idle'
  if (state.phase === 'failed') return 'critical'
  if (state.phase === 'recovering' || state.phase === 'aborted') return 'watch'
  return 'healthy'
}

function runtimeDurationMs(state: AiTurnState, now: number): number | null {
  if (!state.startedAt) return null
  return Math.max(0, (state.finishedAt ?? now) - state.startedAt)
}

export function buildAgentRuntimeSnapshot(
  state: AiTurnState,
  transitions: AgentRuntimeTransition[] = [],
  now = Date.now(),
): AgentRuntimeSnapshot {
  const lastTransition = transitions.length > 0 ? transitions[transitions.length - 1] : undefined
  const pendingToolCount = state.pendingToolCalls?.length ?? 0
  const activeToolCount = Math.max(state.executingToolIds?.length ?? 0, pendingToolCount)

  return {
    turnId: state.turnId,
    phase: state.phase,
    health: runtimeHealth(state),
    isBusy: busyPhases.has(state.phase),
    canAbort: busyPhases.has(state.phase),
    durationMs: runtimeDurationMs(state, now),
    activeToolCount,
    pendingToolCount,
    textDeltaLength: state.pendingTextDelta?.length ?? 0,
    thinkingDeltaLength: state.pendingThinkingDelta?.length ?? 0,
    lastFinishReason: state.lastFinishReason,
    error: state.error,
    retryable: state.retryable,
    recoveryAttempt: state.recoveryAttempt,
    transitionCount: transitions.length,
    lastTransitionReason: lastTransition?.reason,
    lastTransitionAt: lastTransition?.timestamp,
  }
}
