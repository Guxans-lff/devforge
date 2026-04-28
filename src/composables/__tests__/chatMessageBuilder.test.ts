import { describe, expect, it } from 'vitest'
import { buildChatMessages, buildChatMessagesWithOptions, sanitizeLoadedMessages } from '@/composables/ai/chatMessageBuilder'
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

  it('omits tool call replay when the current model has tools disabled', () => {
    const messages = buildChatMessagesWithOptions([
      {
        id: 'user-1',
        role: 'user',
        content: 'Inspect the file.',
        timestamp: 1,
      },
      makeAssistantMessage({
        content: 'I checked the file.',
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
    ], { replayToolContext: false })

    expect(messages).toEqual([
      {
        role: 'user',
        content: 'Inspect the file.',
      },
      {
        role: 'assistant',
        content: 'I checked the file.',
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

  it('includes summary message after compact-boundary in model context', () => {
    const messages = buildChatMessagesWithOptions([
      {
        id: 'user-old',
        role: 'user',
        content: 'old message',
        timestamp: 1,
      },
      {
        id: 'boundary-1',
        role: 'system',
        type: 'compact-boundary',
        content: '',
        timestamp: 2,
        compactMetadata: {
          trigger: 'auto',
          preTokens: 1000,
          summarizedMessages: 1,
          createdAt: 2,
          summaryMessageId: 'summary-1',
          source: 'ai',
        },
      },
      {
        id: 'summary-1',
        role: 'system',
        content: 'This is a summary of old conversation.',
        timestamp: 3,
      },
      {
        id: 'user-new',
        role: 'user',
        content: 'new message',
        timestamp: 4,
      },
    ])

    // boundary 之前的老消息应被裁掉，summary 和后面的消息应保留
    expect(messages).toEqual([
      {
        role: 'system',
        content: 'This is a summary of old conversation.',
      },
      {
        role: 'user',
        content: 'new message',
      },
    ])
  })

  it('excludes compact-boundary itself from model context', () => {
    const messages = buildChatMessagesWithOptions([
      {
        id: 'boundary-1',
        role: 'system',
        type: 'compact-boundary',
        content: '',
        timestamp: 1,
        compactMetadata: {
          trigger: 'auto',
          preTokens: 1000,
          summarizedMessages: 1,
          createdAt: 1,
          summaryMessageId: 'summary-1',
          source: 'ai',
        },
      },
      {
        id: 'user-1',
        role: 'user',
        content: 'hello',
        timestamp: 2,
      },
    ])

    expect(messages).toEqual([
      {
        role: 'user',
        content: 'hello',
      },
    ])
  })

  it('starts model context after the latest rewind-boundary', () => {
    const messages = buildChatMessagesWithOptions([
      {
        id: 'user-old',
        role: 'user',
        content: 'old message',
        timestamp: 1,
      },
      {
        id: 'rewind-1',
        role: 'system',
        type: 'rewind-boundary',
        content: '已回退到 user-old',
        timestamp: 2,
        rewindMetadata: {
          targetMessageId: 'user-old',
          targetMessageRole: 'user',
          hiddenMessages: 2,
          createdAt: 2,
        },
      },
      {
        id: 'user-new',
        role: 'user',
        content: 'new branch message',
        timestamp: 3,
      },
    ])

    expect(messages).toEqual([
      {
        role: 'user',
        content: 'new branch message',
      },
    ])
  })
})
