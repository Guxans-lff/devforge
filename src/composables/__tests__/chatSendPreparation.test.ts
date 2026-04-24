import { describe, expect, it, vi, beforeEach } from 'vitest'
import { prepareSendContext } from '@/composables/ai/chatSendPreparation'
import type { AiMessage } from '@/types/ai'

const { aiReadContextFileMock, aiSaveMessageMock } = vi.hoisted(() => ({
  aiReadContextFileMock: vi.fn(),
  aiSaveMessageMock: vi.fn(),
}))

vi.mock('@/api/ai', () => ({
  aiReadContextFile: (...args: unknown[]) => aiReadContextFileMock(...args),
  aiSaveMessage: (...args: unknown[]) => aiSaveMessageMock(...args),
}))

function createParams() {
  return {
    content: 'inspect this',
    provider: {
      id: 'provider-1',
      name: 'Provider',
      providerType: 'openai',
      endpoint: 'https://api.example.com',
      models: [],
      isDefault: true,
      createdAt: 1,
    },
    model: {
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
    },
    systemPrompt: 'base prompt',
    attachments: [],
    sessionId: 'session-1',
    messages: { value: [] as AiMessage[] },
    workDir: 'D:/workspace',
    planGateEnabled: false,
    planApproved: false,
    aiStore: {
      sessions: [],
      currentWorkspaceConfig: {
        systemPromptExtra: 'workspace prompt',
        contextFiles: [
          { path: 'a.txt', reason: 'first' },
          { path: 'b.txt', reason: 'second' },
        ],
      },
      saveSession: vi.fn().mockResolvedValue(undefined),
    },
    memoryStore: {
      currentWorkspaceId: 'workspace-1',
      recall: vi.fn().mockResolvedValue('memory recall'),
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as const
}

describe('chatSendPreparation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiSaveMessageMock.mockResolvedValue(undefined)
  })

  it('reads memory recall and context files without blocking message append, while preserving context file order', async () => {
    const params = createParams()
    let releaseFirst: (() => void) | null = null
    let releaseSecond: (() => void) | null = null

    aiReadContextFileMock.mockImplementation(async (_workDir: string, path: string) => {
      await new Promise<void>((resolve) => {
        if (path === 'a.txt') {
          releaseFirst = resolve
          return
        }
        releaseSecond = resolve
      })
      return path === 'a.txt' ? 'alpha content' : 'beta content'
    })

    const pending = prepareSendContext(params)

    expect(params.messages.value).toHaveLength(1)
    expect(params.messages.value[0]?.role).toBe('user')
    expect(aiSaveMessageMock).toHaveBeenCalledTimes(1)

    releaseSecond?.()
    await Promise.resolve()
    expect(params.messages.value).toHaveLength(1)

    releaseFirst?.()
    const prepared = await pending

    expect(params.memoryStore.recall).toHaveBeenCalledTimes(1)
    expect(aiReadContextFileMock).toHaveBeenCalledTimes(2)
    expect(prepared.enrichedSystemPrompt).toContain('base prompt')
    expect(prepared.enrichedSystemPrompt).toContain('memory recall')
    expect(prepared.enrichedSystemPrompt).toContain('workspace prompt')
    expect(prepared.enrichedSystemPrompt).toContain('# a.txt (first)')
    expect(prepared.enrichedSystemPrompt).toContain('# b.txt (second)')
    expect(prepared.enrichedSystemPrompt!.indexOf('# a.txt (first)')).toBeLessThan(
      prepared.enrichedSystemPrompt!.indexOf('# b.txt (second)'),
    )
  })

  it('falls back when memory recall fails instead of failing the whole send preparation', async () => {
    const params = createParams()
    params.memoryStore.recall.mockRejectedValueOnce(new Error('memory backend timeout'))
    aiReadContextFileMock.mockResolvedValue('context content')

    const prepared = await prepareSendContext(params)

    expect(prepared.enrichedSystemPrompt).toContain('base prompt')
    expect(prepared.enrichedSystemPrompt).not.toContain('memory backend timeout')
    expect(prepared.enrichedSystemPrompt).toContain('workspace prompt')
    expect(params.log.warn).toHaveBeenCalledWith(
      'memory_recall_failed',
      { sessionId: 'session-1' },
      expect.any(Error),
    )
  })
})
