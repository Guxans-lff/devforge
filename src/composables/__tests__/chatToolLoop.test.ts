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
    lastErrorRetryable: undefined,
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

  it('switches to silent synthesis instead of warning when tool loop limit is exceeded', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      if (aiChatStreamMock.mock.calls.length >= 3) {
        onEvent({ type: 'TextDelta', delta: '已经基于已有结果完成总结。' })
        onEvent({ type: 'Done', finish_reason: 'stop' })
        return
      }
      onEvent({ type: 'ToolCall', id: `tool-${aiChatStreamMock.mock.calls.length}`, name: 'read_file', arguments: '{"path":"a.ts"}' })
      onEvent({ type: 'Done', finish_reason: 'tool_calls' })
    })

    const params = makeParams({ maxToolLoops: 1 })

    await streamWithToolLoop(params)

    expect(aiChatStreamMock).toHaveBeenCalledTimes(3)
    expect(params.executeToolCalls).toHaveBeenCalledTimes(1)
    expect(aiChatStreamMock.mock.calls[2]?.[0]).toMatchObject({ enableTools: false })
    expect(params.messages.value.some(message => message.notice?.code === 'tool_loop_limit')).toBe(false)
    expect(params.messages.value.at(-2)?.content).toBe('正在基于已获取的信息整理当前结论。')
    expect(params.messages.value.at(-1)?.content).toContain('完成总结')
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

  it('caps request max tokens instead of sending the model hard limit upstream', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'Done', finish_reason: 'stop' })
    })

    const params = makeParams({
      model: {
        ...makeModel(),
        capabilities: {
          ...makeModel().capabilities,
          thinking: true,
          maxOutput: 128000,
        },
      },
    })

    await streamWithToolLoop(params)

    expect(aiChatStreamMock).toHaveBeenCalledTimes(1)
    expect(aiChatStreamMock.mock.calls[0]?.[0]).toMatchObject({
      maxTokens: 8192,
      enableTools: true,
    })
  })

  it('passes JSON mode and prefix completion options to gateway request', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'TextDelta', delta: '{"ok":true}' })
      onEvent({ type: 'Done', finish_reason: 'stop' })
    })

    const params = makeParams({
      requestOptions: {
        responseFormat: 'json_object',
        prefixCompletion: true,
        prefixContent: '{"ok":',
      },
    })

    await streamWithToolLoop(params)

    expect(aiChatStreamMock).toHaveBeenCalledTimes(1)
    expect(aiChatStreamMock.mock.calls[0]?.[0]).toMatchObject({
      responseFormat: 'json_object',
      prefixCompletion: true,
      prefixContent: '{"ok":',
    })
  })

  it('emits request start for each upstream stream attempt', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'ToolCall', id: `tool-${aiChatStreamMock.mock.calls.length}`, name: 'read_file', arguments: '{"path":"a.ts"}' })
      onEvent({ type: 'Done', finish_reason: 'tool_calls' })
    })

    const onRequestStart = vi.fn()
    const params = makeParams({
      maxToolLoops: 1,
      onRequestStart,
    })

    await streamWithToolLoop(params)

    expect(aiChatStreamMock).toHaveBeenCalledTimes(3)
    expect(onRequestStart).toHaveBeenCalledTimes(3)
    expect(aiChatStreamMock.mock.calls[2]?.[0]).toMatchObject({ enableTools: false })
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

  it('marks empty thinking stop as recoverable guidance instead of provider-only failure', async () => {
    const params = makeParams()
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      const message = params.messages.value.find(item => item.id === params.streamState.streamingMessageId)
      if (message) message.thinking = '已经分析完工具结果'
      onEvent({ type: 'Done', finish_reason: 'stop' })
    })

    await streamWithToolLoop(params)

    expect(params.messages.value[0]?.role).toBe('error')
    expect(params.messages.value[0]?.content).toContain('可点击“继续生成”恢复')
    expect(params.messages.value[0]?.content).not.toContain('关闭该模型的 thinking 能力标志')
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

  it('does not execute any tool calls when valid and invalid streamed tool calls are mixed together', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'ToolCallDelta', index: 0, id: 'tool-1', name: 'read_file', arguments_delta: '{"path":"src/a.ts"}' })
      onEvent({ type: 'ToolCallDelta', index: 1, id: 'tool-2', name: 'search_files', arguments_delta: '{"query":"todo"' })
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
            try {
              tool.parsedArgs = JSON.parse(tool.arguments) as Record<string, unknown>
            } catch {
              tool.parsedArgs = undefined
            }
          }
        }
        if (event.type === 'Done') {
          params.streamState.lastFinishReason = event.finish_reason
        }
      }),
    })

    await streamWithToolLoop(params)

    expect(params.executeToolCalls).not.toHaveBeenCalled()
    expect(params.messages.value).toHaveLength(1)
    expect(params.messages.value[0]?.role).toBe('error')
    expect(params.messages.value[0]?.content).toContain('工具调用参数不完整')
    expect(params.parseAndWriteJournalSections).not.toHaveBeenCalled()
    expect(params.parseSpawnedTasks).not.toHaveBeenCalled()
  })

  it('stops the tool loop when tool execution returns no results for pending tool calls', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'ToolCall', id: 'tool-1', name: 'read_file', arguments: '{"path":"src/a.ts"}' })
      onEvent({ type: 'Done', finish_reason: 'tool_calls' })
    })

    const params = makeParams({
      executeToolCalls: vi.fn(async () => []),
    })

    await streamWithToolLoop(params)

    expect(aiChatStreamMock).toHaveBeenCalledTimes(1)
    expect(params.executeToolCalls).toHaveBeenCalledTimes(1)
    expect(params.messages.value).toHaveLength(1)
    expect(params.messages.value[0]?.role).toBe('error')
    expect(params.messages.value[0]?.content).toContain('工具执行结果缺失')
  })

  it('breaks early when the model repeats the same tool call batch after identical tool results', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'ToolCall', id: `tool-${aiChatStreamMock.mock.calls.length}`, name: 'read_file', arguments: '{"path":"src/a.ts"}' })
      onEvent({ type: 'Done', finish_reason: 'tool_calls' })
    })

    const params = makeParams({
      maxToolLoops: 5,
      executeToolCalls: vi.fn(async () => [{
        toolCallId: 'tool-fixed',
        toolName: 'read_file',
        success: true,
        content: 'same-result',
      }]),
    })

    await streamWithToolLoop(params)

    expect(aiChatStreamMock).toHaveBeenCalledTimes(3)
    expect(params.executeToolCalls).toHaveBeenCalledTimes(2)
    expect(params.messages.value.at(-1)?.role).toBe('error')
    expect(params.messages.value.at(-1)?.content).toContain('工具循环疑似卡住')
  })

  it('still detects repeated tool loops when tool results are very large', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'ToolCall', id: `tool-${aiChatStreamMock.mock.calls.length}`, name: 'read_file', arguments: '{"path":"src/huge.ts"}' })
      onEvent({ type: 'Done', finish_reason: 'tool_calls' })
    })

    const hugeResult = 'x'.repeat(50_000)
    const params = makeParams({
      maxToolLoops: 5,
      executeToolCalls: vi.fn(async () => [{
        toolCallId: 'tool-fixed',
        toolName: 'read_file',
        success: true,
        content: hugeResult,
      }]),
    })

    await streamWithToolLoop(params)

    expect(aiChatStreamMock).toHaveBeenCalledTimes(3)
    expect(params.executeToolCalls).toHaveBeenCalledTimes(2)
    expect(params.messages.value.at(-1)?.role).toBe('error')
    expect(params.messages.value.at(-1)?.content).toContain('工具循环疑似卡住')
  })

  it('switches to silent synthesis when the model keeps exploring without assistant text', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      const callIndex = aiChatStreamMock.mock.calls.length
      if (callIndex >= 6) {
        onEvent({ type: 'TextDelta', delta: '基于已有结果，当前结论是可以开始拆分实现。' })
        onEvent({ type: 'Done', finish_reason: 'stop' })
        return
      }
      const toolName = callIndex % 2 === 0 ? 'search_files' : 'read_file'
      const args = toolName === 'search_files'
        ? `{"query":"case-${callIndex}"}`
        : `{"path":"src/case-${callIndex}.ts"}`
      onEvent({ type: 'ToolCall', id: `tool-${callIndex}`, name: toolName, arguments: args })
      onEvent({ type: 'Done', finish_reason: 'tool_calls' })
    })

    const params = makeParams({
      maxToolLoops: 10,
      executeToolCalls: vi.fn(async (toolCalls: ToolCallInfo[]): Promise<ToolResultInfo[]> =>
        toolCalls.map(tool => ({
          toolCallId: tool.id,
          toolName: tool.name,
          success: true,
          content: `unique-result:${tool.id}`,
        })),
      ),
    })

    await streamWithToolLoop(params)

    expect(aiChatStreamMock).toHaveBeenCalledTimes(6)
    expect(params.executeToolCalls).toHaveBeenCalledTimes(5)
    expect(aiChatStreamMock.mock.calls[5]?.[0]).toMatchObject({ enableTools: false })
    expect(aiChatStreamMock.mock.calls[5]?.[0].messages.at(-1)?.content).toContain('[已有工具结果摘要]')
    expect(aiChatStreamMock.mock.calls[5]?.[0].messages.at(-1)?.content).toContain('unique-result:tool-4')
    expect(params.messages.value.at(-2)?.notice).toBeUndefined()
    expect(params.messages.value.at(-2)?.content).toBe('正在基于已读取的信息整理结论。')
    expect(params.messages.value.at(-1)?.role).toBe('assistant')
    expect(params.messages.value.at(-1)?.content).toContain('当前结论')
  })

  it('uses silent synthesis instead of exposing the hard tool loop limit to users', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      const callIndex = aiChatStreamMock.mock.calls.length
      if (callIndex >= 4) {
        onEvent({ type: 'TextDelta', delta: '已经整理出当前结论。' })
        onEvent({ type: 'Done', finish_reason: 'stop' })
        return
      }
      onEvent({
        type: 'ToolCall',
        id: `tool-${callIndex}`,
        name: 'search_files',
        arguments: `{"query":"case-${callIndex}"}`,
      })
      onEvent({ type: 'Done', finish_reason: 'tool_calls' })
    })

    const params = makeParams({
      maxToolLoops: 2,
      executeToolCalls: vi.fn(async (toolCalls: ToolCallInfo[]): Promise<ToolResultInfo[]> =>
        toolCalls.map(tool => ({
          toolCallId: tool.id,
          toolName: tool.name,
          success: true,
          content: `loop-limit-result:${tool.id}`,
        })),
      ),
    })

    await streamWithToolLoop(params)

    expect(aiChatStreamMock).toHaveBeenCalledTimes(4)
    expect(params.executeToolCalls).toHaveBeenCalledTimes(2)
    expect(aiChatStreamMock.mock.calls[3]?.[0]).toMatchObject({ enableTools: false })
    expect(aiChatStreamMock.mock.calls[3]?.[0].messages.at(-1)?.content).toContain('[已有工具结果摘要]')
    expect(params.messages.value.some(message => message.notice?.code === 'tool_loop_limit')).toBe(false)
    expect(params.messages.value.at(-2)?.content).toBe('正在基于已获取的信息整理当前结论。')
    expect(params.messages.value.at(-1)?.content).toContain('当前结论')
  })
})

