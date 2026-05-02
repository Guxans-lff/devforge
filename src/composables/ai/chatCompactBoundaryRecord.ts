import type { AiMessage, AiMessageRecord } from '@/types/ai'

export const COMPACT_BOUNDARY_CONTENT_TYPE = 'compact_boundary'

interface PersistedCompactBoundaryPayload {
  trigger?: 'manual' | 'auto' | 'recovery'
  preTokens?: number
  summarizedMessages?: number
  summaryMessageId?: string
  source?: 'ai' | 'local'
  createdAt?: number
}

function parseBoundaryPayload(content: string): PersistedCompactBoundaryPayload {
  if (!content) return {}
  try {
    const parsed = JSON.parse(content) as unknown
    return parsed && typeof parsed === 'object'
      ? parsed as PersistedCompactBoundaryPayload
      : {}
  } catch {
    return {}
  }
}

export function serializeCompactBoundaryPayload(boundary: AiMessage): string {
  const metadata = boundary.compactMetadata
  return JSON.stringify({
    trigger: metadata?.trigger,
    preTokens: metadata?.preTokens,
    summarizedMessages: metadata?.summarizedMessages,
    summaryMessageId: metadata?.summaryMessageId,
    source: metadata?.source,
    createdAt: metadata?.createdAt ?? boundary.timestamp,
  })
}

export function restoreCompactBoundaryRecord(record: AiMessageRecord): AiMessage | null {
  if (record.role !== 'system' || record.contentType !== COMPACT_BOUNDARY_CONTENT_TYPE) return null

  const payload = parseBoundaryPayload(record.content)
  return {
    id: record.id,
    role: 'system',
    type: 'compact-boundary',
    content: '',
    timestamp: payload.createdAt ?? record.createdAt,
    tokens: payload.preTokens ?? record.tokens,
    totalTokens: payload.preTokens ?? record.tokens,
    compactMetadata: {
      trigger: payload.trigger ?? 'auto',
      preTokens: payload.preTokens ?? record.tokens,
      summarizedMessages: payload.summarizedMessages ?? 0,
      createdAt: payload.createdAt ?? record.createdAt,
      summaryMessageId: payload.summaryMessageId ?? `${record.id}-summary`,
      source: payload.source ?? 'ai',
    },
  }
}
