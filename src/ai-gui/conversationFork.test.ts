import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forkConversationFromMessage } from './conversationFork'
import type { AiMessageRecord, AiSession, AiSessionDetail } from '@/types/ai'

const { aiGetSessionMock, aiSaveMessageMock } = vi.hoisted(() => ({
  aiGetSessionMock: vi.fn(),
  aiSaveMessageMock: vi.fn(),
}))

vi.mock('@/api/ai', () => ({
  aiGetSession: aiGetSessionMock,
  aiSaveMessage: aiSaveMessageMock,
}))

function session(overrides: Partial<AiSession> = {}): AiSession {
  return {
    id: 'source-session',
    title: '原始会话',
    providerId: 'provider-1',
    model: 'model-1',
    messageCount: 3,
    totalTokens: 60,
    estimatedCost: 0.02,
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  }
}

function record(overrides: Partial<AiMessageRecord>): AiMessageRecord {
  return {
    id: overrides.id ?? `msg-${Math.random()}`,
    sessionId: overrides.sessionId ?? 'source-session',
    role: overrides.role ?? 'assistant',
    content: overrides.content ?? '',
    contentType: overrides.contentType ?? 'text',
    tokens: overrides.tokens ?? 0,
    cost: overrides.cost ?? 0,
    createdAt: overrides.createdAt ?? 1,
    ...overrides,
  }
}

function detail(messages: AiMessageRecord[]): AiSessionDetail {
  return {
    session: session(),
    messages,
    totalRecords: messages.length,
    loadedRecords: messages.length,
    truncated: false,
  }
}

describe('conversationFork', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiSaveMessageMock.mockResolvedValue(undefined)
  })

  it('throws when source session is missing', async () => {
    aiGetSessionMock.mockResolvedValue(null)

    await expect(forkConversationFromMessage({
      sourceSessionId: 'missing',
      forkFromMessageId: 'u1',
      saveSession: vi.fn(),
    })).rejects.toThrow('源会话不存在')
  })

  it('throws when fork message is missing', async () => {
    aiGetSessionMock.mockResolvedValue(detail([record({ id: 'u1', role: 'user' })]))

    await expect(forkConversationFromMessage({
      sourceSessionId: 'source-session',
      forkFromMessageId: 'missing',
      saveSession: vi.fn(),
    })).rejects.toThrow('未找到要分叉的消息')
  })

  it('copies messages up to selected message into a new branch session', async () => {
    const saveSession = vi.fn().mockResolvedValue(undefined)
    const messages = [
      record({ id: 'u1', role: 'user', content: '问题', tokens: 10 }),
      record({ id: 'a1', role: 'assistant', content: '回答', tokens: 20, parentId: 'u1' }),
      record({ id: 'u2', role: 'user', content: '继续', tokens: 30, parentId: 'a1' }),
      record({ id: 'a2', role: 'assistant', content: '后续不复制', tokens: 40, parentId: 'u2' }),
    ]
    aiGetSessionMock.mockResolvedValue(detail(messages))

    const result = await forkConversationFromMessage({
      sourceSessionId: 'source-session',
      forkFromMessageId: 'u2',
      saveSession,
    })

    expect(result.session.id).toMatch(/^fork-/)
    expect(result.session.title).toBe('原始会话 · 分支')
    expect(result.copiedMessages).toBe(3)
    expect(result.session.messageCount).toBe(3)
    expect(result.session.totalTokens).toBe(60)
    expect(saveSession).toHaveBeenCalledWith(result.session)
    expect(aiSaveMessageMock).toHaveBeenCalledTimes(3)

    const savedMessages = aiSaveMessageMock.mock.calls.map(call => call[0] as AiMessageRecord)
    expect(savedMessages.map(message => message.content)).toEqual(['问题', '回答', '继续'])
    expect(savedMessages.every(message => message.sessionId === result.session.id)).toBe(true)
    expect(savedMessages[1]!.parentId).toBe(`${result.session.id}-u1`)
  })

  it('uses custom title when provided', async () => {
    const saveSession = vi.fn().mockResolvedValue(undefined)
    aiGetSessionMock.mockResolvedValue(detail([record({ id: 'u1', role: 'user' })]))

    const result = await forkConversationFromMessage({
      sourceSessionId: 'source-session',
      forkFromMessageId: 'u1',
      title: '排查方案',
      saveSession,
    })

    expect(result.session.title).toBe('排查方案 · 分支')
  })
})
