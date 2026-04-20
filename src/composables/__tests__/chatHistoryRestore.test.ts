import { describe, expect, it } from 'vitest'
import { restoreMessagesFromRecords } from '@/composables/ai/chatHistoryRestore'
import type { AiMessageRecord } from '@/types/ai'

function createRecord(overrides: Partial<AiMessageRecord>): AiMessageRecord {
  return {
    id: overrides.id ?? 'record-id',
    sessionId: overrides.sessionId ?? 'session-1',
    role: overrides.role ?? 'assistant',
    content: overrides.content ?? '',
    contentType: overrides.contentType ?? 'text',
    tokens: overrides.tokens ?? 0,
    cost: overrides.cost ?? 0,
    parentId: overrides.parentId,
    success: overrides.success,
    toolName: overrides.toolName,
    createdAt: overrides.createdAt ?? 1,
  }
}

describe('restoreMessagesFromRecords', () => {
  it('restores structured tool results onto the matching assistant tool call', () => {
    const records: AiMessageRecord[] = [
      createRecord({
        id: 'assistant-1',
        role: 'assistant',
        contentType: 'tool_calls',
        content: JSON.stringify([
          { id: 'tool-1', name: 'read_file', arguments: '{"path":"README.md"}' },
        ]),
      }),
      createRecord({
        id: 'tool-result-1',
        role: 'tool',
        contentType: 'tool_result',
        parentId: 'tool-1',
        toolName: 'read_file',
        success: false,
        content: 'file not found',
        createdAt: 2,
      }),
    ]

    const restored = restoreMessagesFromRecords(records)

    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({
      id: 'assistant-1',
      role: 'assistant',
      toolResults: [
        {
          toolCallId: 'tool-1',
          toolName: 'read_file',
          success: false,
          content: 'file not found',
        },
      ],
    })
    expect(restored[0]?.toolCalls).toHaveLength(1)
    expect(restored[0]?.toolCalls?.[0]).toMatchObject({
      id: 'tool-1',
      name: 'read_file',
      status: 'error',
      result: 'file not found',
      error: 'file not found',
      parsedArgs: { path: 'README.md' },
    })
  })

  it('falls back to matched tool call metadata for legacy tool results', () => {
    const records: AiMessageRecord[] = [
      createRecord({
        id: 'assistant-1',
        role: 'assistant',
        contentType: 'tool_calls',
        content: JSON.stringify([
          { id: 'tool-1', name: 'list_files', arguments: '{"dir":"src"}' },
        ]),
      }),
      createRecord({
        id: 'tool-result-1',
        role: 'tool',
        contentType: 'tool_result',
        parentId: 'tool-1',
        content: '["a.ts","b.ts"]',
        createdAt: 2,
      }),
    ]

    const restored = restoreMessagesFromRecords(records)

    expect(restored).toHaveLength(1)
    expect(restored[0]?.toolResults).toEqual([
      {
        toolCallId: 'tool-1',
        toolName: 'list_files',
        success: true,
        content: '["a.ts","b.ts"]',
      },
    ])
    expect(restored[0]?.toolCalls?.[0]).toMatchObject({
      id: 'tool-1',
      name: 'list_files',
      status: 'success',
      result: '["a.ts","b.ts"]',
      error: undefined,
    })
  })

  it('attaches multiple sequential tool results to the same assistant frame', () => {
    const records: AiMessageRecord[] = [
      createRecord({
        id: 'assistant-1',
        role: 'assistant',
        contentType: 'tool_calls',
        content: JSON.stringify([
          { id: 'tool-1', name: 'read_file', arguments: '{"path":"a.txt"}' },
          { id: 'tool-2', name: 'read_file', arguments: '{"path":"b.txt"}' },
        ]),
      }),
      createRecord({
        id: 'tool-result-1',
        role: 'tool',
        contentType: 'tool_result',
        content: 'content a',
        createdAt: 2,
      }),
      createRecord({
        id: 'tool-result-2',
        role: 'tool',
        contentType: 'tool_result',
        content: 'content b',
        createdAt: 3,
      }),
    ]

    const restored = restoreMessagesFromRecords(records)

    expect(restored).toHaveLength(1)
    expect(restored[0]?.toolResults).toEqual([
      {
        toolCallId: 'tool-1',
        toolName: 'read_file',
        success: true,
        content: 'content a',
      },
      {
        toolCallId: 'tool-2',
        toolName: 'read_file',
        success: true,
        content: 'content b',
      },
    ])
    expect(restored[0]?.toolCalls?.map(toolCall => toolCall.status)).toEqual(['success', 'success'])
  })

  it('keeps later assistant messages instead of marking valid tool-call frames as broken', () => {
    const records: AiMessageRecord[] = [
      createRecord({
        id: 'assistant-1',
        role: 'assistant',
        contentType: 'tool_calls',
        content: JSON.stringify([
          { id: 'tool-1', name: 'run_shell', arguments: '{"command":"pwd"}' },
        ]),
      }),
      createRecord({
        id: 'tool-result-1',
        role: 'tool',
        contentType: 'tool_result',
        parentId: 'tool-1',
        toolName: 'run_shell',
        success: true,
        content: '/workspace',
        createdAt: 2,
      }),
      createRecord({
        id: 'assistant-2',
        role: 'assistant',
        content: '处理完成',
        contentType: 'text',
        createdAt: 3,
      }),
    ]

    const restored = restoreMessagesFromRecords(records)

    expect(restored).toHaveLength(2)
    expect(restored[0]).toMatchObject({
      id: 'assistant-1',
      role: 'assistant',
    })
    expect(restored[1]).toMatchObject({
      id: 'assistant-2',
      role: 'assistant',
      content: '处理完成',
    })
  })
})
