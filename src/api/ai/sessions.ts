import { invokeAiCommand } from './errors'
import type { AiMessageRecord, AiSession, AiSessionDetail, DailyUsage } from '@/types/ai'

export function aiSaveSession(session: AiSession): Promise<void> {
  return invokeAiCommand('ai_save_session', { session }, { source: 'AI' })
}

export function aiListSessions(): Promise<AiSession[]> {
  return invokeAiCommand('ai_list_sessions', undefined, { source: 'AI' })
}

export function aiGetSession(id: string, messageLimit?: number): Promise<AiSessionDetail | null> {
  return invokeAiCommand('ai_get_session', { id, messageLimit: messageLimit ?? null }, { source: 'AI' })
}

export function aiDeleteSession(id: string): Promise<void> {
  return invokeAiCommand('ai_delete_session', { id }, { source: 'AI' })
}

export function aiSaveMessage(message: AiMessageRecord): Promise<void> {
  return invokeAiCommand('ai_save_message', { message }, { source: 'AI' })
}

export function aiGetUsageStats(startDate: string, endDate: string): Promise<DailyUsage[]> {
  return invokeAiCommand('ai_get_usage_stats', { startDate, endDate }, { source: 'AI' })
}

