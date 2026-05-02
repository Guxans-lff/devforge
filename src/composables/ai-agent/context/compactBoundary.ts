import type { AiTranscriptEvent, AiTranscriptEventOf } from '@/composables/ai-agent/transcript/transcriptTypes'

export interface CompactBoundaryProjection {
  hasBoundary: boolean
  boundaryEventId?: string
  boundaryTimestamp?: number
  trigger?: AiTranscriptEventOf<'compact'>['payload']['data']['trigger']
  source?: AiTranscriptEventOf<'compact'>['payload']['data']['source']
  originalMessageCount: number
  originalTokens: number
  summaryLength: number
  eventsBeforeBoundary: number
  projectedEventCount: number
  projectedTurnCount: number
  projectedToolCallCount: number
  projectedToolResultCount: number
  unpairedToolCallIds: string[]
  orphanToolResultIds: string[]
  warnings: string[]
}

export interface ToolPairInvariant {
  toolCallCount: number
  toolResultCount: number
  unpairedToolCallIds: string[]
  orphanToolResultIds: string[]
  warnings: string[]
}

function isCompactEvent(event: AiTranscriptEvent): event is AiTranscriptEventOf<'compact'> {
  return event.type === 'compact' && event.payload.type === 'compact'
}

function sortEvents(events: AiTranscriptEvent[]): AiTranscriptEvent[] {
  return events.slice().sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id))
}

export function findLatestCompactBoundaryEvent(
  events: AiTranscriptEvent[],
): AiTranscriptEventOf<'compact'> | undefined {
  const sorted = sortEvents(events)
  for (let index = sorted.length - 1; index >= 0; index--) {
    const event = sorted[index]!
    if (isCompactEvent(event)) return event
  }
  return undefined
}

export function getEventsAfterLatestCompactBoundary(events: AiTranscriptEvent[]): AiTranscriptEvent[] {
  const sorted = sortEvents(events)
  const boundary = findLatestCompactBoundaryEvent(sorted)
  if (!boundary) return sorted
  const boundaryIndex = sorted.findIndex(event => event.id === boundary.id)
  return boundaryIndex === -1 ? sorted : sorted.slice(boundaryIndex + 1)
}

export function validateToolPairInvariant(events: AiTranscriptEvent[]): ToolPairInvariant {
  const toolCalls = new Map<string, AiTranscriptEventOf<'tool_call'>>()
  const toolResults = new Set<string>()
  const orphanToolResultIds: string[] = []

  for (const event of sortEvents(events)) {
    if (event.type === 'tool_call' && event.payload.type === 'tool_call') {
      toolCalls.set(event.payload.data.toolCallId, event)
      continue
    }

    if (event.type === 'tool_result' && event.payload.type === 'tool_result') {
      const toolCallId = event.payload.data.toolCallId
      toolResults.add(toolCallId)
      if (!toolCalls.has(toolCallId)) {
        orphanToolResultIds.push(toolCallId)
      }
    }
  }

  const unpairedToolCallIds = Array.from(toolCalls.keys()).filter(toolCallId => !toolResults.has(toolCallId))
  const warnings: string[] = []
  if (unpairedToolCallIds.length > 0) {
    warnings.push(`存在 ${unpairedToolCallIds.length} 个 tool_call 没有对应 tool_result`)
  }
  if (orphanToolResultIds.length > 0) {
    warnings.push(`存在 ${orphanToolResultIds.length} 个 tool_result 找不到对应 tool_call`)
  }

  return {
    toolCallCount: toolCalls.size,
    toolResultCount: toolResults.size,
    unpairedToolCallIds,
    orphanToolResultIds,
    warnings,
  }
}

export function buildCompactBoundaryProjection(events: AiTranscriptEvent[]): CompactBoundaryProjection {
  const sorted = sortEvents(events)
  const boundary = findLatestCompactBoundaryEvent(sorted)
  const projectedEvents = getEventsAfterLatestCompactBoundary(sorted)
  const invariant = validateToolPairInvariant(projectedEvents)
  const projectedTurnIds = new Set(projectedEvents.map(event => event.turnId).filter((turnId): turnId is string => Boolean(turnId)))

  const warnings = [...invariant.warnings]
  if (boundary && projectedEvents.length === 0) {
    warnings.push('最新 compact boundary 后没有可投影事件')
  }

  return {
    hasBoundary: Boolean(boundary),
    boundaryEventId: boundary?.id,
    boundaryTimestamp: boundary?.timestamp,
    trigger: boundary?.payload.data.trigger,
    source: boundary?.payload.data.source,
    originalMessageCount: boundary?.payload.data.originalMessageCount ?? 0,
    originalTokens: boundary?.payload.data.originalTokens ?? 0,
    summaryLength: boundary?.payload.data.summaryLength ?? 0,
    eventsBeforeBoundary: boundary ? sorted.length - projectedEvents.length - 1 : 0,
    projectedEventCount: projectedEvents.length,
    projectedTurnCount: projectedTurnIds.size,
    projectedToolCallCount: invariant.toolCallCount,
    projectedToolResultCount: invariant.toolResultCount,
    unpairedToolCallIds: invariant.unpairedToolCallIds,
    orphanToolResultIds: invariant.orphanToolResultIds,
    warnings,
  }
}
