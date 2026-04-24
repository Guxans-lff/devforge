import { describe, expect, it, vi, beforeEach } from 'vitest'
import { reactive, ref } from 'vue'
import { runAiChatSessionTurn } from '@/composables/ai/chatSessionRunner'
import { handleStreamEvent, type AiChatStreamState } from '@/composables/ai/chatStreamEvents'
import type { AiMessage, AiStreamEvent, ModelConfig, ProviderConfig } from '@/types/ai'

const { aiChatStreamMock, aiAbortStreamMock, aiSaveMessageMock } = vi.hoisted(() => ({
  aiChatStreamMock: vi.fn(),
  aiAbortStreamMock: vi.fn(),
  aiSaveMessageMock: vi.fn(),
}))

vi.mock('@/api/ai', () => ({
  aiChatStream: aiChatStreamMock,
  aiAbortStream: aiAbortStreamMock,
  aiSaveMessage: aiSaveMessageMock,
}))

function makeProvider(): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider 1',
    providerType: 'openai',
    endpoint: 'https://api.example.com',
    models: [makeModel()],
    isDefault: true,
    createdAt: 1,
  }
}

function makeModel(): ModelConfig {
  return {
    id: 'model-1',
    name: 'Model 1',
    capabilities: {
      stream: true,
      toolUse: false,
      vision: false,
      maxContext: 32000,
      maxOutput: 4096,
    },
  }
}

function createHarness(options?: { signal?: AbortSignal; summaryMode?: 'brief' | 'normal' }) {
  const messages = ref<AiMessage[]>([])
  const isStreaming = ref(false)
  const error = ref<string | null>(null)
  const workDir = ref('')
  const streamState = reactive<AiChatStreamState>({
    pendingTextDelta: '',
    pendingThinkingDelta: '',
    pendingToolCalls: [],
    lastFinishReason: '',
    lastErrorRetryable: undefined,
    streamingMessageId: '',
    inToolExec: false,
  })
  const currentPhase = ref(null)
  const planGateEnabled = ref(false)
  const planApproved = ref(false)
  const pendingPlan = ref('')
  const awaitingPlanApproval = ref(false)

  const updateStreamingMessage = (updater: (msg: AiMessage) => AiMessage) => {
    const index = messages.value.findIndex(message => message.id === streamState.streamingMessageId)
    if (index !== -1) messages.value[index] = updater(messages.value[index]!)
  }
  const flushPendingDelta = () => {
    const text = streamState.pendingTextDelta
    const thinking = streamState.pendingThinkingDelta
    streamState.pendingTextDelta = ''
    streamState.pendingThinkingDelta = ''
    if (!text && !thinking) return
    updateStreamingMessage(message => ({
      ...message,
      content: message.content + text,
      thinking: (message.thinking ?? '') + thinking,
    }))
  }

  const onFirstToken = vi.fn()
  const onPendingToolQueueLength = vi.fn()
  const onResponseComplete = vi.fn()
  const onPrepareComplete = vi.fn()
  const onRequestStart = vi.fn()
  const onRecovery = vi.fn()
  const forceCompact = vi.fn().mockResolvedValue(null)

  return {
    messages,
    isStreaming,
    error,
    streamState,
    onFirstToken,
    onPendingToolQueueLength,
    onResponseComplete,
    onPrepareComplete,
    onRequestStart,
    onRecovery,
    forceCompact,
    run: () => runAiChatSessionTurn({
      sessionId: 'session-runner-1',
      content: 'please inspect',
      provider: makeProvider(),
      model: makeModel(),
      apiKey: 'key',
      workDir,
      aiStore: {
        sessions: [],
        currentWorkspaceConfig: null,
        saveSession: vi.fn().mockResolvedValue(undefined),
      } as any,
      memoryStore: {
        currentWorkspaceId: '_global',
        recall: vi.fn().mockResolvedValue(''),
      } as any,
      messages,
      isStreaming,
      streamState,
      error,
      planGateEnabled,
      planApproved,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as any,
      maxToolLoops: 3,
      totalTokens: () => 0,
      forceCompact,
      checkAndCompact: vi.fn().mockResolvedValue(null),
      clearWatchdog: vi.fn(),
      resetWatchdog: vi.fn(),
      flushPendingDelta,
      updateStreamingMessage,
      executeToolCalls: vi.fn().mockResolvedValue([]),
      parseAndWriteJournalSections: vi.fn(),
      parseSpawnedTasks: vi.fn(),
      onStreamEvent: (event: AiStreamEvent) => handleStreamEvent({
        event,
        sessionId: 'session-runner-1',
        log: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        } as any,
        streamState,
        messages,
        error,
        currentPhase,
        planGateEnabled,
        planApproved,
        pendingPlan,
        awaitingPlanApproval,
        resetWatchdog: vi.fn(),
        flushPendingDelta,
        scheduleFlush: flushPendingDelta,
        updateStreamingMessage,
      }),
      onFirstToken,
      onPendingToolQueueLength,
      onResponseComplete,
      onPrepareComplete,
      onRequestStart,
      onRecovery,
      signal: options?.signal,
      summaryMode: options?.summaryMode,
    }),
  }
}

describe('runAiChatSessionTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiSaveMessageMock.mockResolvedValue(undefined)
    aiAbortStreamMock.mockResolvedValue(true)
  })

  it('returns done with the real session id and assistant summary', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'TextDelta', delta: 'Completed child task.' })
      onEvent({ type: 'Done', finish_reason: 'stop' })
      return {}
    })

    const harness = createHarness()
    const result = await harness.run()

    expect(result).toMatchObject({
      status: 'done',
      sessionId: 'session-runner-1',
      summary: 'Completed child task.',
      retryable: false,
    })
    expect(harness.onPrepareComplete).toHaveBeenCalledTimes(1)
    expect(harness.onRequestStart).toHaveBeenCalledTimes(1)
    expect(harness.onRecovery).not.toHaveBeenCalled()
    expect(harness.messages.value.some(message => message.role === 'user')).toBe(true)
  })

  it('returns cancelled when aborted while running', async () => {
    const controller = new AbortController()
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'TextDelta', delta: 'Partial work' })
      controller.abort()
      onEvent({ type: 'Done', finish_reason: 'stop' })
      return {}
    })

    const harness = createHarness({ signal: controller.signal })
    const result = await harness.run()

    expect(result.status).toBe('cancelled')
    expect(result.sessionId).toBe('session-runner-1')
    expect(result.retryable).toBe(false)
    expect(aiAbortStreamMock).toHaveBeenCalledWith('session-runner-1')
  })

  it('marks transient failures retryable', async () => {
    aiChatStreamMock.mockRejectedValue(new Error('network timeout while streaming'))

    const harness = createHarness()
    const result = await harness.run()

    expect(result).toMatchObject({
      status: 'error',
      retryable: true,
    })
    expect(result.error).toContain('network timeout')
  })

  it('does not mark non-transient failures retryable', async () => {
    aiChatStreamMock.mockRejectedValue(new Error('user_rejected tool approval'))

    const harness = createHarness()
    const result = await harness.run()

    expect(result).toMatchObject({
      status: 'error',
      retryable: false,
    })
    expect(result.error).toContain('user_rejected')
  })

  it('preserves retryable stream errors even when the message text is not pattern matched', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'Error', message: 'provider overloaded now', retryable: true })
      throw new Error('provider overloaded now')
    })

    const harness = createHarness()
    const result = await harness.run()

    expect(result).toMatchObject({
      status: 'error',
      retryable: true,
    })
  })

  it('preserves structured backend retryable errors', async () => {
    aiChatStreamMock.mockRejectedValue({
      kind: 'CONNECTION',
      message: 'temporary upstream failure',
      retryable: true,
    })

    const harness = createHarness()
    const result = await harness.run()

    expect(result).toMatchObject({
      status: 'error',
      retryable: true,
    })
    expect(result.error).toContain('temporary upstream failure')
  })

  it('preserves observability callbacks when overflow recovery retries the stream', async () => {
    aiChatStreamMock
      .mockRejectedValueOnce(new Error('maximum context length exceeded'))
      .mockImplementationOnce(async (_request, onEvent: (event: AiStreamEvent) => void) => {
        onEvent({ type: 'TextDelta', delta: 'Recovered answer.' })
        onEvent({ type: 'Done', finish_reason: 'stop' })
        return {}
      })

    const harness = createHarness()
    harness.forceCompact.mockImplementation(async (messages: AiMessage[]) => messages)

    const result = await harness.run()

    expect(result.status).toBe('done')
    expect(harness.onFirstToken).toHaveBeenCalledTimes(1)
    expect(harness.onPrepareComplete).toHaveBeenCalledTimes(1)
    expect(harness.onRequestStart).toHaveBeenCalledTimes(2)
    expect(harness.onRecovery).toHaveBeenCalledTimes(1)
    expect(harness.onResponseComplete).toHaveBeenCalledTimes(1)
  })

  it('emits pending tool queue callbacks during overflow recovery retries', async () => {
    aiChatStreamMock
      .mockRejectedValueOnce(new Error('maximum context length exceeded'))
      .mockImplementationOnce(async (_request, onEvent: (event: AiStreamEvent) => void) => {
        onEvent({ type: 'ToolCall', id: 'tool-1', name: 'read_file', arguments: '{"path":"src/a.ts"}' })
        onEvent({ type: 'Done', finish_reason: 'tool_calls' })
        return {}
      })

    const harness = createHarness()
    harness.forceCompact.mockImplementation(async (messages: AiMessage[]) => messages)
    await harness.run()

    expect(harness.onPendingToolQueueLength).toHaveBeenCalledWith(1)
  })

  it('does not mark response complete for failed turns', async () => {
    aiChatStreamMock.mockRejectedValue(new Error('network timeout while streaming'))

    const harness = createHarness()
    const result = await harness.run()

    expect(result.status).toBe('error')
    expect(harness.onResponseComplete).not.toHaveBeenCalled()
  })
})
