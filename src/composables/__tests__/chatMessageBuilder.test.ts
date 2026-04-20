import { describe, expect, it } from 'vitest'
import { buildChatMessages } from '@/composables/ai/chatMessageBuilder'
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
})
