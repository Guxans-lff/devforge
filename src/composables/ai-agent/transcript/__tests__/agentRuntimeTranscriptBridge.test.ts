import { describe, expect, it, vi } from 'vitest'
import { createAgentRuntime } from '@/composables/ai/AgentRuntime'
import { createAgentRuntimeTranscriptBridge } from '../agentRuntimeTranscriptBridge'
import { createTranscriptStore } from '../transcriptStore'

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

describe('agentRuntimeTranscriptBridge', () => {
  it('records turn lifecycle from AgentRuntime transitions', () => {
    const store = createTranscriptStore()
    const bridge = createAgentRuntimeTranscriptBridge({
      sessionId: 's1',
      transcriptStore: store,
      log,
    })
    const runtime = createAgentRuntime({
      log,
      onTransition: transition => bridge.appendTransition(transition),
    })

    runtime.startTurn({ sessionId: 's1' })
    runtime.markPrepareComplete({ messageCount: 2 })
    runtime.transitionToStreaming('msg-1')
    runtime.transitionToCompleted('done')

    const events = store.getEvents('s1')
    expect(events.map(event => event.type)).toEqual([
      'turn_start',
      'routing',
      'routing',
      'turn_end',
    ])
    expect(events[0]!.payload.type).toBe('turn_start')
    expect(events.at(-1)!.payload.type).toBe('turn_end')
    expect(events.at(-1)!.payload.data.status).toBe('done')
  })

  it('records tool calls and recovery transitions', () => {
    const store = createTranscriptStore()
    const bridge = createAgentRuntimeTranscriptBridge({
      sessionId: 's1',
      transcriptStore: store,
      log,
    })
    const runtime = createAgentRuntime({
      log,
      onTransition: transition => bridge.appendTransition(transition),
    })

    runtime.startTurn()
    runtime.transitionToStreaming('msg-1')
    runtime.handleStreamEvent({
      type: 'ToolCall',
      id: 'tool-1',
      name: 'read_file',
      arguments: '{"path":"src/a.ts"}',
    })
    runtime.transitionToRecovering('context too long', 1)
    runtime.transitionToFailed('context too long', false)

    const toolEvent = store.getLatestEvent('s1', 'tool_call')
    const recoveryEvent = store.getLatestEvent('s1', 'recovery')
    const endEvent = store.getLatestEvent('s1', 'turn_end')

    expect(toolEvent?.payload.data.toolName).toBe('read_file')
    expect(recoveryEvent?.payload.data.reason).toBe('context too long')
    expect(endEvent?.payload.data.status).toBe('error')
  })

  it('deduplicates terminal turn_end events', () => {
    const store = createTranscriptStore()
    const bridge = createAgentRuntimeTranscriptBridge({
      sessionId: 's1',
      transcriptStore: store,
      log,
    })
    const runtime = createAgentRuntime({
      log,
      onTransition: transition => bridge.appendTransition(transition),
    })

    runtime.startTurn()
    runtime.transitionToFailed('network timeout', true)
    runtime.transitionToAborted()

    const endEvents = store.getEventsByType('s1', ['turn_end'])
    expect(endEvents).toHaveLength(1)
    expect(endEvents[0]!.payload.data.status).toBe('error')
  })
})
