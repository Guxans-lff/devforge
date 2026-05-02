import { describe, expect, it } from 'vitest'
import { buildAgentRuntimeSnapshot } from '../AgentRuntimeSnapshot'
import type { AiTurnState } from '../AiTurnRuntime'
import type { AgentRuntimeTransition } from '../AgentRuntime'

function turnState(partial: Partial<AiTurnState>): AiTurnState {
  return {
    phase: 'idle',
    turnId: '',
    ...partial,
  }
}

function transition(partial: Partial<AgentRuntimeTransition>): AgentRuntimeTransition {
  return {
    id: 'transition-1',
    turnId: 'turn-1',
    from: 'idle',
    to: 'preparing',
    reason: 'send_start',
    timestamp: 1000,
    ...partial,
  }
}

describe('AgentRuntimeSnapshot', () => {
  it('projects idle runtime state', () => {
    const snapshot = buildAgentRuntimeSnapshot(turnState({ phase: 'idle' }), [], 2000)

    expect(snapshot.health).toBe('idle')
    expect(snapshot.isBusy).toBe(false)
    expect(snapshot.canAbort).toBe(false)
    expect(snapshot.durationMs).toBeNull()
  })

  it('projects busy streaming state with pending deltas', () => {
    const snapshot = buildAgentRuntimeSnapshot(
      turnState({
        phase: 'streaming',
        turnId: 'turn-1',
        startedAt: 1000,
        pendingTextDelta: 'hello',
        pendingThinkingDelta: 'thinking',
      }),
      [transition({ reason: 'request_start', timestamp: 1200 })],
      1800,
    )

    expect(snapshot.health).toBe('healthy')
    expect(snapshot.isBusy).toBe(true)
    expect(snapshot.canAbort).toBe(true)
    expect(snapshot.durationMs).toBe(800)
    expect(snapshot.textDeltaLength).toBe(5)
    expect(snapshot.thinkingDeltaLength).toBe(8)
    expect(snapshot.lastTransitionReason).toBe('request_start')
  })

  it('projects tool and error state', () => {
    const snapshot = buildAgentRuntimeSnapshot(
      turnState({
        phase: 'failed',
        turnId: 'turn-1',
        startedAt: 1000,
        finishedAt: 1600,
        executingToolIds: ['tool-1', 'tool-2'],
        pendingToolCalls: [{ id: 'tool-3', name: 'read_file', arguments: '{}', status: 'pending' }],
        error: 'network timeout',
        retryable: true,
      }),
      [
        transition({ reason: 'send_start', timestamp: 1000 }),
        transition({ reason: 'failed', timestamp: 1600 }),
      ],
      2000,
    )

    expect(snapshot.health).toBe('critical')
    expect(snapshot.durationMs).toBe(600)
    expect(snapshot.activeToolCount).toBe(2)
    expect(snapshot.pendingToolCount).toBe(1)
    expect(snapshot.error).toBe('network timeout')
    expect(snapshot.retryable).toBe(true)
    expect(snapshot.transitionCount).toBe(2)
  })
})
