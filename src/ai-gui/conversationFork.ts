import { aiGetSession, aiSaveMessage } from '@/api/ai'
import type { AiMessageRecord, AiSession } from '@/types/ai'

export interface ForkConversationParams {
  sourceSessionId: string
  forkFromMessageId: string
  title?: string
  saveSession: (session: AiSession) => Promise<void>
}

export interface ForkConversationResult {
  session: AiSession
  copiedMessages: number
}

function genForkId(): string {
  return `fork-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildForkTitle(sourceTitle: string, customTitle?: string): string {
  const title = customTitle?.trim() || sourceTitle || 'AI 会话'
  return `${title} · 分支`
}

function cloneMessageRecord(record: AiMessageRecord, targetSessionId: string): AiMessageRecord {
  return {
    ...record,
    id: `${targetSessionId}-${record.id}`,
    sessionId: targetSessionId,
    parentId: record.parentId ? `${targetSessionId}-${record.parentId}` : undefined,
  }
}

export async function forkConversationFromMessage(params: ForkConversationParams): Promise<ForkConversationResult> {
  const detail = await aiGetSession(params.sourceSessionId)
  if (!detail) {
    throw new Error('源会话不存在，无法创建分支。')
  }

  const forkIndex = detail.messages.findIndex(message => message.id === params.forkFromMessageId)
  if (forkIndex === -1) {
    throw new Error('未找到要分叉的消息。')
  }

  const forkId = genForkId()
  const now = Date.now()
  const sourceSession = detail.session
  const copied = detail.messages.slice(0, forkIndex + 1).map(record => cloneMessageRecord(record, forkId))
  const session: AiSession = {
    ...sourceSession,
    id: forkId,
    title: buildForkTitle(sourceSession.title, params.title),
    messageCount: copied.filter(message => message.role !== 'tool').length,
    totalTokens: copied.reduce((sum, message) => sum + (message.tokens ?? 0), 0),
    estimatedCost: 0,
    createdAt: now,
    updatedAt: now,
  }

  await params.saveSession(session)
  for (const message of copied) {
    await aiSaveMessage(message)
  }

  return {
    session,
    copiedMessages: copied.length,
  }
}
