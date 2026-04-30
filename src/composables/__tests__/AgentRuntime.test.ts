import { describe, expect, it, vi } from 'vitest'
import { createAgentRuntime } from '@/composables/ai/AgentRuntime'
import type { ToolCallInfo } from '@/types/ai'

function makeRuntime() {
  const transitions: Array<{ from: string; to: string; reason: string; data?: Record<string, unknown> }> = []
  const runtime = createAgentRuntime({
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    onTransition: transition => transitions.push(transition),
  })
  return { runtime, transitions }
}

describe('AgentRuntime', () => {
  it('tracks a successful turn through explicit transitions', () => {
    const { runtime, transitions } = makeRuntime()

    const turnId = runtime.startTurn({ sessionId: 's1' })
    runtime.markPrepareComplete({ messageCount: 2 })
    runtime.transitionToStreaming('msg-1')
    runtime.handleStreamEvent({ type: 'TextDelta', delta: 'hello' })
    runtime.transitionToCompleted('hello')

    expect(turnId).toBeTruthy()
    expect(runtime.state.value.phase).toBe('completed')
    expect(runtime.state.value.summary).toBe('hello')
    expect(transitions.map(item => item.reason)).toEqual([
      'send_start',
      'prepare_complete',
      'request_start',
      'first_token',
      'response_complete',
    ])
  })

  it('tracks tool execution and returns to streaming after tool results', () => {
    const { runtime, transitions } = makeRuntime()
    const toolCalls: ToolCallInfo[] = [{
      id: 'tool-1',
      name: 'read_file',
      arguments: '{"path":"src/a.ts"}',
      parsedArgs: { path: 'src/a.ts' },
      status: 'pending',
    }]

    runtime.startTurn()
    runtime.transitionToStreaming('msg-1')
    runtime.handleStreamEvent({ type: 'ToolCall', id: 'tool-1', name: 'read_file', arguments: '{"path":"src/a.ts"}' })
    runtime.transitionToToolExecuting(toolCalls)
    runtime.markToolDone({ resultCount: 1 })

    expect(runtime.state.value.phase).toBe('routing')
    expect(runtime.state.value.executingToolIds).toEqual(['tool-1'])
    expect(transitions.map(item => item.reason)).toContain('tool_queue')
    expect(transitions.map(item => item.reason)).toContain('tool_start')
    expect(transitions.map(item => item.reason)).toContain('tool_done')
  })

  it('tracks failed turns with retryable metadata', () => {
    const { runtime, transitions } = makeRuntime()

    runtime.startTurn()
    runtime.transitionToFailed('network timeout', true)

    expect(runtime.state.value.phase).toBe('failed')
    expect(runtime.state.value.error).toBe('network timeout')
    expect(runtime.state.value.retryable).toBe(true)
    expect(transitions.at(-1)).toMatchObject({
      to: 'failed',
      reason: 'failed',
    })
  })
})
