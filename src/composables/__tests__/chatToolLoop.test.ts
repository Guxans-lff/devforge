import { beforeEach, describe, expect, it, vi } from 'vitest'
import { streamWithToolLoop } from '@/composables/ai/chatToolLoop'
import type { AiChatStreamState } from '@/composables/ai/chatStreamEvents'
import type { AiMessage, AiStreamEvent, ModelConfig, ProviderConfig, ToolCallInfo, ToolResultInfo } from '@/types/ai'

const { aiChatStreamMock, aiSaveMessageMock } = vi.hoisted(() => ({
  aiChatStreamMock: vi.fn(),
  aiSaveMessageMock: vi.fn(),
}))

vi.mock('@/api/ai', () => ({
  aiChatStream: aiChatStreamMock,
  aiSaveMessage: aiSaveMessageMock,
}))

function makeProvider(): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider',
    providerType: 'openai_compat',
    endpoint: 'https://api.example.com',
    models: [],
    isDefault: true,
    createdAt: 1,
  }
}

function makeModel(): ModelConfig {
  return {
    id: 'model-1',
    name: 'Model',
    capabilities: {
      streaming: true,
      vision: false,
      thinking: false,
      toolUse: true,
      maxContext: 32000,
      maxOutput: 4096,
    },
  }
}

function makeStreamState(): AiChatStreamState {
  return {
    pendingTextDelta: '',
    pendingThinkingDelta: '',
    pendingToolCalls: [],
    lastFinishReason: '',
    streamingMessageId: '',
    inToolExec: false,
  }
}

function makeParams(overrides?: Partial<Parameters<typeof streamWithToolLoop>[0]>) {
  const streamState = makeStreamState()
  const messages = { value: [] as AiMessage[] }
  const isStreaming = { value: true }

  const params: Parameters<typeof streamWithToolLoop>[0] = {
    sid: 'session-1',
    chatMessages: [{ role: 'user', content: 'hello' }],
    provider: makeProvider(),
    model: makeModel(),
    apiKey: 'api-key',
    systemPrompt: undefined,
    enableTools: true,
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    messages,
    isStreaming,
    workDir: { value: 'D:/workspace' },
    streamState,
    maxToolLoops: 1,
    resetWatchdog: vi.fn(),
    clearWatchdog: vi.fn(),
    flushPendingDelta: vi.fn(),
    updateStreamingMessage: vi.fn((updater: (msg: AiMessage) => AiMessage) => {
      const index = messages.value.findIndex(message => message.id === streamState.streamingMessageId)
      if (index !== -1) messages.value[index] = updater(messages.value[index]!)
    }),
    onStreamEvent: vi.fn((event: AiStreamEvent) => {
      if (event.type === 'TextDelta') {
        const index = messages.value.findIndex(message => message.id === streamState.streamingMessageId)
        if (index !== -1) {
          messages.value[index] = {
            ...messages.value[index]!,
            content: messages.value[index]!.content + event.delta,
          }
        }
      }
      if (event.type === 'ToolCall') {
        streamState.pendingToolCalls.push({
          id: event.id,
          name: event.name,
          arguments: event.arguments,
          parsedArgs: JSON.parse(event.arguments),
          status: 'pending',
        })
      }
      if (event.type === 'Done') {
        streamState.lastFinishReason = event.finish_reason
      }
    }),
    executeToolCalls: vi.fn(async (toolCalls: ToolCallInfo[]): Promise<ToolResultInfo[]> =>
      toolCalls.map(tool => ({
        toolCallId: tool.id,
        toolName: tool.name,
        success: true,
        content: `result:${tool.id}`,
      })),
    ),
    parseAndWriteJournalSections: vi.fn(),
    parseSpawnedTasks: vi.fn(),
  }

  return {
    ...params,
    ...overrides,
  }
}

describe('chatToolLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiSaveMessageMock.mockResolvedValue(undefined)
  })

  it('stops with a warning instead of looping forever when tool loop limit is exceeded', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'ToolCall', id: `tool-${aiChatStreamMock.mock.calls.length}`, name: 'read_file', arguments: '{"path":"a.ts"}' })
      onEvent({ type: 'Done', finish_reason: 'tool_calls' })
    })

    const params = makeParams({ maxToolLoops: 1 })

    await streamWithToolLoop(params)

    expect(aiChatStreamMock).toHaveBeenCalledTimes(2)
    expect(params.executeToolCalls).toHaveBeenCalledTimes(1)
    expect(params.updateStreamingMessage).toHaveBeenCalledWith(expect.any(Function))
    expect(params.messages.value.at(-1)?.notice?.kind).toBe('warn')
    expect(params.messages.value.at(-1)?.isStreaming).toBe(false)
  })

  it('does not execute tools after stream cancellation stops the loop', async () => {
    const params = makeParams()
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'ToolCall', id: 'tool-1', name: 'read_file', arguments: '{"path":"a.ts"}' })
      onEvent({ type: 'Done', finish_reason: 'tool_calls' })
      params.isStreaming.value = false
    })

    await streamWithToolLoop(params)

    expect(params.executeToolCalls).not.toHaveBeenCalled()
    expect(params.messages.value).toHaveLength(1)
    expect(params.messages.value[0]?.role).toBe('assistant')
  })

  it('converts empty assistant responses into an error without parsing side effects', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'Done', finish_reason: 'stop' })
    })

    const params = makeParams()

    await streamWithToolLoop(params)

    expect(params.messages.value).toHaveLength(1)
    expect(params.messages.value[0]?.role).toBe('error')
    expect(params.parseAndWriteJournalSections).not.toHaveBeenCalled()
    expect(params.parseSpawnedTasks).not.toHaveBeenCalled()
  })

  it('does not execute incomplete streamed tool calls with invalid JSON arguments', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'ToolCallDelta', index: 0, id: 'tool-1', name: 'read_file', arguments_delta: '{"path":"src/a.ts"' })
      onEvent({ type: 'Done', finish_reason: 'tool_calls' })
    })

    const params = makeParams({
      onStreamEvent: vi.fn((event: AiStreamEvent) => {
        if (event.type === 'ToolCallDelta') {
          let tool = params.streamState.pendingToolCalls.find(item => item.streamingIndex === event.index)
          if (!tool && event.id && event.name) {
            tool = {
              id: event.id,
              name: event.name,
              arguments: '',
              status: 'streaming',
              streamingChars: 0,
              streamingIndex: event.index,
            }
            params.streamState.pendingToolCalls.push(tool)
          }
          if (tool) {
            tool.arguments += event.arguments_delta
          }
        }
        if (event.type === 'Done') {
          params.streamState.lastFinishReason = event.finish_reason
        }
      }),
    })

    await streamWithToolLoop(params)

    expect(params.executeToolCalls).not.toHaveBeenCalled()
    expect(params.messages.value[0]?.role).toBe('error')
    expect(params.messages.value[0]?.content).toContain('工具调用参数不完整')
  })
})
