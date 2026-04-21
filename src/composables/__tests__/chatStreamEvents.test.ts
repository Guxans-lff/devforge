import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { handleStreamEvent, type AiChatStreamState } from '@/composables/ai/chatStreamEvents'
import type { AiMessage, AiStreamEvent } from '@/types/ai'

function makeState(): AiChatStreamState {
  return {
    pendingTextDelta: '',
    pendingThinkingDelta: '',
    pendingToolCalls: [],
    lastFinishReason: '',
    streamingMessageId: 'msg-1',
    inToolExec: false,
  }
}

function makeParams(event: AiStreamEvent, streamState = makeState()) {
  return {
    event,
    sessionId: 'session-1',
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    streamState,
    messages: ref<AiMessage[]>([{
      id: 'msg-1',
      role: 'assistant',
      content: '',
      timestamp: 1,
    }]),
    error: ref<string | null>(null),
    currentPhase: ref(null),
    planGateEnabled: ref(false),
    planApproved: ref(false),
    pendingPlan: ref(''),
    awaitingPlanApproval: ref(false),
    resetWatchdog: vi.fn(),
    flushPendingDelta: vi.fn(),
    scheduleFlush: vi.fn(),
    updateStreamingMessage: vi.fn(),
  }
}

describe('chatStreamEvents', () => {
  it('updates parsedArgs as ToolCallDelta JSON becomes complete', () => {
    const streamState = makeState()

    handleStreamEvent(makeParams({
      type: 'ToolCallDelta',
      index: 0,
      id: 'tool-1',
      name: 'read_file',
      arguments_delta: '{"path":"src/',
    }, streamState))

    expect(streamState.pendingToolCalls).toHaveLength(1)
    expect(streamState.pendingToolCalls[0]?.parsedArgs).toBeUndefined()

    handleStreamEvent(makeParams({
      type: 'ToolCallDelta',
      index: 0,
      arguments_delta: 'a.ts"}',
    }, streamState))

    expect(streamState.pendingToolCalls[0]?.parsedArgs).toEqual({ path: 'src/a.ts' })
  })
})
