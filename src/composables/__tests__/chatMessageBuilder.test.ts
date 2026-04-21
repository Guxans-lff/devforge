import { describe, expect, it } from 'vitest'
import { buildChatMessages, sanitizeLoadedMessages } from '@/composables/ai/chatMessageBuilder'
import type { AiMessage } from '@/types/ai'

function makeAssistantMessage(extra: Partial<AiMessage> = {}): AiMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    ...extra,
  }
}

describe('chatMessageBuilder', () => {
  it('skips aborted tool calls with incomplete JSON arguments', () => {
    const messages = buildChatMessages([
      makeAssistantMessage({
        toolCalls: [
          {
            id: 'tool-1',
            name: 'edit_file',
            arguments: '{"path":"src/locales/zh-CN.ts","old_string":"a"',
            status: 'error',
            error: '[cancelled] Tool execution was cancelled before it started.',
          },
        ],
        toolResults: [
          {
            toolCallId: 'tool-1',
            toolName: 'edit_file',
            success: false,
            content: '[cancelled] Tool execution was cancelled before it started.',
          },
        ],
      }),
    ])

    expect(messages).toEqual([])
  })

  it('keeps completed tool calls with valid JSON arguments and matching results', () => {
    const messages = buildChatMessages([
      makeAssistantMessage({
        toolCalls: [
          {
            id: 'tool-1',
            name: 'edit_file',
            arguments: '{"path":"src/locales/zh-CN.ts","old_string":"a","new_string":"b"}',
            status: 'error',
            error: '[user_rejected] User rejected edit_file.',
          },
        ],
        toolResults: [
          {
            toolCallId: 'tool-1',
            toolName: 'edit_file',
            success: false,
            content: '[user_rejected] User rejected edit_file.',
          },
        ],
      }),
    ])

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: null,
        toolCalls: [
          {
            id: 'tool-1',
            type: 'function',
            function: {
              name: 'edit_file',
              arguments: '{"path":"src/locales/zh-CN.ts","old_string":"a","new_string":"b"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        content: '[user_rejected] User rejected edit_file.',
        toolCallId: 'tool-1',
        name: 'edit_file',
      },
    ])
  })

  it('replays interrupted assistant content together with completed tool calls for recovery', () => {
    const messages = buildChatMessages([
      makeAssistantMessage({
        content: 'Drafting the summary before the stream was interrupted.',
        thinking: 'Need to inspect the workspace first.',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'read_file',
            arguments: '{"path":"src/main.ts"}',
            status: 'success',
            result: 'file content',
          },
        ],
        toolResults: [
          {
            toolCallId: 'tool-1',
            toolName: 'read_file',
            success: true,
            content: 'file content',
          },
        ],
      }),
    ])

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: 'Drafting the summary before the stream was interrupted.',
        reasoningContent: 'Need to inspect the workspace first.',
        toolCalls: [
          {
            id: 'tool-1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{"path":"src/main.ts"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        content: 'file content',
        toolCallId: 'tool-1',
        name: 'read_file',
      },
    ])
  })

  it('marks a dangling streaming assistant as interrupted during history restore', () => {
    const restored = sanitizeLoadedMessages([
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 1,
        isStreaming: true,
      },
    ])

    expect(restored).toEqual([
      {
        id: 'assistant-1',
        role: 'error',
        content: '[previous response was interrupted or incomplete]',
        timestamp: 1,
        isStreaming: false,
      },
    ])
  })
})
