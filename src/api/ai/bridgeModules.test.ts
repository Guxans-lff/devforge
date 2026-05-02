import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from '@tauri-apps/api/core'
import {
  aiAbortStream,
  aiChatStream,
  aiCreateCompletion,
  aiExecuteTool,
  aiExportTranscriptEvents,
  aiGetMcpStatus,
  aiGetSession,
  aiQueryTranscriptEvents,
  aiListProviderModels,
  aiListProviders,
  aiReadContextFile,
  aiSaveMessage,
  AiBridgeError,
  type ChatStreamParams,
} from '@/api/ai'
import type { AiMessageRecord } from '@/types/ai'

const { invokeCommandMock } = vi.hoisted(() => ({
  invokeCommandMock: vi.fn(),
}))

vi.mock('@/api/base', () => ({
  invokeCommand: invokeCommandMock,
}))

vi.mock('@tauri-apps/api/core', () => ({
  Channel: vi.fn().mockImplementation(() => ({ onmessage: undefined })),
}))

describe('ai bridge modules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeCommandMock.mockResolvedValue(undefined)
  })

  it('keeps streaming params and channel callback compatible', async () => {
    const onEvent = vi.fn()
    const params: ChatStreamParams = {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hello' }],
      providerType: 'openai_compat',
      model: 'm1',
      apiKey: 'key',
      endpoint: 'https://api.example.com',
    }

    await aiChatStream(params, onEvent)

    expect(Channel).toHaveBeenCalledTimes(1)
    expect(invokeCommandMock).toHaveBeenCalledWith('ai_chat_stream', expect.objectContaining({
      sessionId: 's1',
      messages: params.messages,
      providerType: 'openai_compat',
      model: 'm1',
      apiKey: 'key',
      endpoint: 'https://api.example.com',
      maxTokens: null,
      temperature: null,
      systemPrompt: null,
      enableTools: null,
      thinkingBudget: null,
      responseFormat: null,
      prefixCompletion: null,
      prefixContent: null,
      onEvent: expect.any(Object),
    }), { source: 'AI' })
  })

  it('routes provider and session commands through stable exports', async () => {
    await aiListProviders()
    await aiListProviderModels('https://api.deepseek.com', 'sk-test')
    await aiGetSession('s1', 300)
    await aiAbortStream('s1')
    await aiGetMcpStatus('D:/repo')

    expect(invokeCommandMock).toHaveBeenNthCalledWith(1, 'ai_list_providers', undefined, { source: 'AI' })
    expect(invokeCommandMock).toHaveBeenNthCalledWith(2, 'ai_list_provider_models', {
      endpoint: 'https://api.deepseek.com',
      apiKey: 'sk-test',
    }, { source: 'AI' })
    expect(invokeCommandMock).toHaveBeenNthCalledWith(3, 'ai_get_session', { id: 's1', messageLimit: 300 }, { source: 'AI' })
    expect(invokeCommandMock).toHaveBeenNthCalledWith(4, 'ai_abort_stream', { sessionId: 's1' }, { source: 'AI' })
    expect(invokeCommandMock).toHaveBeenNthCalledWith(5, 'ai_get_mcp_status', { workDir: 'D:/repo' }, { source: 'AI' })
  })

  it('passes DeepSeek JSON, prefix and FIM completion params', async () => {
    await aiChatStream({
      sessionId: 's2',
      messages: [{ role: 'user', content: 'json' }],
      providerType: 'openai_compat',
      model: 'deepseek-v4-pro',
      apiKey: 'key',
      endpoint: 'https://api.deepseek.com',
      responseFormat: 'json_object',
      prefixCompletion: true,
      prefixContent: '{"ok":',
    }, vi.fn())

    await aiCreateCompletion({
      providerType: 'openai_compat',
      model: 'deepseek-v4-flash',
      apiKey: 'key',
      endpoint: 'https://api.deepseek.com',
      prompt: 'const a = ',
      suffix: ';',
      maxTokens: 128,
      temperature: 0.2,
      useBeta: true,
    })

    expect(invokeCommandMock).toHaveBeenNthCalledWith(1, 'ai_chat_stream', expect.objectContaining({
      responseFormat: 'json_object',
      prefixCompletion: true,
      prefixContent: '{"ok":',
    }), { source: 'AI' })
    expect(invokeCommandMock).toHaveBeenNthCalledWith(2, 'ai_create_completion', {
      providerType: 'openai_compat',
      model: 'deepseek-v4-flash',
      apiKey: 'key',
      endpoint: 'https://api.deepseek.com',
      prompt: 'const a = ',
      suffix: ';',
      maxTokens: 128,
      temperature: 0.2,
      useBeta: true,
    }, { source: 'AI' })
  })

  it('normalizes optional tool and workspace parameters', async () => {
    await aiExecuteTool('read_file', '{"path":"a.ts"}', 'D:/repo', 's1', 'tc1')
    await aiReadContextFile('D:/repo', 'src/main.ts')

    expect(invokeCommandMock).toHaveBeenNthCalledWith(1, 'ai_execute_tool', {
      name: 'read_file',
      arguments: '{"path":"a.ts"}',
      workDir: 'D:/repo',
      sessionId: 's1',
      toolCallId: 'tc1',
      timeoutMs: null,
    }, { source: 'AI' })
    expect(invokeCommandMock).toHaveBeenNthCalledWith(2, 'ai_read_context_file', {
      root: 'D:/repo',
      path: 'src/main.ts',
      maxLines: null,
    }, { source: 'AI' })
  })

  it('saves message through session bridge', async () => {
    const message: AiMessageRecord = {
      id: 'm1',
      sessionId: 's1',
      role: 'user',
      content: 'hello',
      contentType: 'text',
      tokens: 1,
      cost: 0,
      createdAt: 1,
    }

    await aiSaveMessage(message)

    expect(invokeCommandMock).toHaveBeenCalledWith('ai_save_message', { message }, { source: 'AI' })
  })

  it('queries and exports transcript events through stable bridge params', async () => {
    await aiQueryTranscriptEvents({
      sessionId: 's1',
      limit: 20,
      offset: 40,
      eventTypes: ['tool_call'],
      turnId: 't1',
      startTime: 1000,
      endTime: 2000,
    })
    await aiExportTranscriptEvents('s1')

    expect(invokeCommandMock).toHaveBeenNthCalledWith(1, 'ai_query_transcript_events', {
      query: {
        sessionId: 's1',
        limit: 20,
        offset: 40,
        eventTypes: ['tool_call'],
        turnId: 't1',
        startTime: 1000,
        endTime: 2000,
      },
    }, { source: 'AI', silent: true })
    expect(invokeCommandMock).toHaveBeenNthCalledWith(2, 'ai_export_transcript_events', {
      sessionId: 's1',
    }, { source: 'AI', silent: true })
  })

  it('wraps AI bridge failures with command metadata', async () => {
    invokeCommandMock.mockRejectedValueOnce({
      kind: 'TIMEOUT',
      message: '请求超时',
      retryable: true,
    })

    const error = await aiGetMcpStatus('D:/repo').catch(error => error)

    expect(error).toBeInstanceOf(AiBridgeError)
    expect(error).toMatchObject({
      name: 'AiBridgeError',
      command: 'ai_get_mcp_status',
      kind: 'TIMEOUT',
      message: '请求超时',
      retryable: true,
    })
  })
})

