import { invokeAiCommand } from './errors'
import type { AiTranscriptEvent } from '@/composables/ai-agent/transcript/transcriptTypes'

export interface AiTranscriptEventRecord {
  id: string
  sessionId: string
  turnId?: string | null
  eventType: string
  timestamp: number
  payloadJson: string
}

export function toTranscriptEventRecord(event: AiTranscriptEvent): AiTranscriptEventRecord {
  return {
    id: event.id,
    sessionId: event.sessionId,
    turnId: event.turnId ?? null,
    eventType: event.type,
    timestamp: event.timestamp,
    payloadJson: JSON.stringify(event.payload),
  }
}

export function toTranscriptEvent(record: AiTranscriptEventRecord): AiTranscriptEvent | null {
  try {
    return {
      id: record.id,
      sessionId: record.sessionId,
      turnId: record.turnId ?? undefined,
      type: record.eventType,
      timestamp: record.timestamp,
      payload: JSON.parse(record.payloadJson),
    } as AiTranscriptEvent
  } catch {
    return null
  }
}

export function aiAppendTranscriptEvent(event: AiTranscriptEvent): Promise<void> {
  return invokeAiCommand('ai_append_transcript_event', {
    event: toTranscriptEventRecord(event),
  }, { source: 'AI', silent: true })
}

export async function aiListTranscriptEvents(sessionId: string, limit?: number): Promise<AiTranscriptEvent[]> {
  const records = await invokeAiCommand<AiTranscriptEventRecord[]>('ai_list_transcript_events', {
    sessionId,
    limit: limit ?? null,
  }, { source: 'AI', silent: true })

  return records
    .map(toTranscriptEvent)
    .filter((event): event is AiTranscriptEvent => Boolean(event))
}

export function aiCountTranscriptEvents(sessionId: string): Promise<number> {
  return invokeAiCommand('ai_count_transcript_events', { sessionId }, { source: 'AI', silent: true })
}
