import { describe, expect, it, vi } from 'vitest'
import { abortChat } from '@/composables/ai/chatAbort'
import type { AiChatStreamState } from '@/composables/ai/chatStreamEvents'
import type { AiMessage } from '@/types/ai'

const { aiAbortStreamMock, aiSaveMessageMock } = vi.hoisted(() => ({
  aiAbortStreamMock: vi.fn(),
  aiSaveMessageMock: vi.fn(),
}))

vi.mock('@/api/ai', () => ({
  aiAbortStream: aiAbortStreamMock,
  aiSaveMessage: aiSaveMessageMock,
}))

function makeStreamState(): AiChatStreamState {
  return {
    pendingTextDelta: 'partial',
    pendingThinkingDelta: 'thinking',
    pendingToolCalls: [
      {
        id: 'tool-1',
        name: 'read_file',
        arguments: '{"path":"a.ts"}',
        parsedArgs: { path: 'a.ts' },
        status: 'pending',
      },
    ],
    lastFinishReason: 'tool_calls',
    streamingMessageId: 'assistant-1',
    inToolExec: true,
  }
}

describe('chatAbort', () => {
  it('patches missing tool results and clears stream state for safe re-entry', async () => {
    aiAbortStreamMock.mockResolvedValue(undefined)
    aiSaveMessageMock.mockResolvedValue(undefined)

    const streamState = makeStreamState()
    const messages = {
      value: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'working',
          timestamp: 1,
          isStreaming: true,
          toolCalls: [...streamState.pendingToolCalls],
        } satisfies AiMessage,
      ],
    }
    const isStreaming = { value: true }

    await abortChat({
      sessionId: 'session-1',
      messages,
      isStreaming,
      streamState,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      clearWatchdog: vi.fn(),
      flushPendingDelta: vi.fn(),
      updateStreamingMessage: vi.fn((updater: (msg: AiMessage) => AiMessage) => {
        messages.value = messages.value.map(message =>
          message.id === 'assistant-1' ? updater(message) : message,
        )
      }),
    })

    expect(aiAbortStreamMock).toHaveBeenCalledWith('session-1')
    expect(messages.value[0]?.isStreaming).toBe(false)
    expect(messages.value[0]?.content).toContain('[已中断]')
    expect(messages.value[0]?.toolResults?.[0]).toMatchObject({
      toolCallId: 'tool-1',
      success: false,
    })
    expect(isStreaming.value).toBe(false)
    expect(streamState.streamingMessageId).toBe('')
    expect(streamState.pendingTextDelta).toBe('')
    expect(streamState.pendingThinkingDelta).toBe('')
    expect(streamState.pendingToolCalls).toEqual([])
    expect(streamState.lastFinishReason).toBe('')
    expect(streamState.inToolExec).toBe(false)
  })
})
