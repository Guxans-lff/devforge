/**
 * Transcript Event Search
 *
 * Search and filter transcript events by various criteria.
 */

import type { AiTranscriptEvent, AiTranscriptEventOf, AiTranscriptEventType } from './transcriptTypes'
import type { TranscriptStore } from './transcriptStore'

export interface TranscriptSearchOptions {
  sessionId: string
  /** Free text search (matches user/assistant content previews, error messages, tool names) */
  query?: string
  /** Filter by event types */
  types?: AiTranscriptEventType[]
  /** Filter by tool names (applies to tool_call and tool_result events) */
  toolNames?: string[]
  /** Filter by error kinds (applies to tool_result and stream_error events) */
  errorKinds?: string[]
  /** Filter by specific turn */
  turnId?: string
  /** Start time (inclusive) */
  startTime?: number
  /** End time (inclusive) */
  endTime?: number
  /** Maximum results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

function isTranscriptEvent<T extends AiTranscriptEventType>(
  event: AiTranscriptEvent,
  type: T,
): event is AiTranscriptEventOf<T> {
  return event.type === type && event.payload.type === type
}

function matchesQuery(event: AiTranscriptEvent, query: string): boolean {
  const lowerQuery = query.toLowerCase()
  const { payload } = event

  switch (payload.type) {
    case 'user_message':
      return payload.data.contentPreview.toLowerCase().includes(lowerQuery)
    case 'assistant_message':
      return payload.data.contentPreview.toLowerCase().includes(lowerQuery)
    case 'tool_call':
      return (
        payload.data.toolName.toLowerCase().includes(lowerQuery)
        || (payload.data.path?.toLowerCase().includes(lowerQuery) ?? false)
        || payload.data.argumentsPreview.toLowerCase().includes(lowerQuery)
      )
    case 'tool_result':
      return (
        payload.data.toolName.toLowerCase().includes(lowerQuery)
        || payload.data.contentPreview.toLowerCase().includes(lowerQuery)
        || (payload.data.errorKind?.toLowerCase().includes(lowerQuery) ?? false)
      )
    case 'stream_error':
      return payload.data.error.toLowerCase().includes(lowerQuery)
    case 'recovery':
      return payload.data.reason.toLowerCase().includes(lowerQuery)
    case 'plan_status':
      return (
        payload.data.status.toLowerCase().includes(lowerQuery)
        || (payload.data.stepTitle?.toLowerCase().includes(lowerQuery) ?? false)
      )
    case 'compact':
      return payload.data.trigger.toLowerCase().includes(lowerQuery)
    case 'routing':
      return payload.data.reason.toLowerCase().includes(lowerQuery)
    default:
      return false
  }
}

function matchesToolNames(event: AiTranscriptEvent, toolNames: string[]): boolean {
  if (event.type !== 'tool_call' && event.type !== 'tool_result') return false
  const name = event.payload.type === 'tool_call'
    ? event.payload.data.toolName
    : event.payload.type === 'tool_result'
      ? event.payload.data.toolName
      : ''
  return toolNames.includes(name)
}

function matchesErrorKinds(event: AiTranscriptEvent, errorKinds: string[]): boolean {
  if (event.type === 'stream_error') return errorKinds.includes('stream_error')
  if (isTranscriptEvent(event, 'tool_result')) {
    const kind = event.payload.data.errorKind
    return kind ? errorKinds.includes(kind) : false
  }
  if (isTranscriptEvent(event, 'turn_end') && event.payload.data.status === 'error') {
    return errorKinds.includes('turn_error')
  }
  return false
}

/**
 * Search transcript events with multiple filter criteria.
 */
export function searchTranscriptEvents(
  store: TranscriptStore,
  options: TranscriptSearchOptions,
): AiTranscriptEvent[] {
  const { sessionId, query, types, toolNames, errorKinds, turnId, startTime, endTime, limit, offset } = options

  let events = store.getEvents(sessionId, { types, turnId })

  if (startTime !== undefined) {
    events = events.filter(e => e.timestamp >= startTime)
  }
  if (endTime !== undefined) {
    events = events.filter(e => e.timestamp <= endTime)
  }

  if (query && query.trim()) {
    events = events.filter(e => matchesQuery(e, query.trim()))
  }

  if (toolNames && toolNames.length > 0) {
    events = events.filter(e => matchesToolNames(e, toolNames))
  }

  if (errorKinds && errorKinds.length > 0) {
    events = events.filter(e => matchesErrorKinds(e, errorKinds))
  }

  const off = offset ?? 0
  const lim = limit

  if (off > 0 || lim !== undefined) {
    events = events.slice(off, lim !== undefined ? off + lim : undefined)
  }

  return events
}

/**
 * Find all tool call/result events related to a file path.
 */
export function findToolCallsForPath(
  store: TranscriptStore,
  sessionId: string,
  path: string,
): AiTranscriptEvent[] {
  const events = store.getEventsByType(sessionId, ['tool_call', 'tool_result'])
  const lowerPath = path.toLowerCase()
  return events.filter(e => {
    if (e.payload.type === 'tool_call') {
      return e.payload.data.path?.toLowerCase() === lowerPath
    }
    if (e.payload.type === 'tool_result') {
      // tool_result payload doesn't have path, but we can match by toolCallId
      // with a preceding tool_call event
      return false
    }
    return false
  })
}

/**
 * Find all error events in a session.
 */
export function findErrors(store: TranscriptStore, sessionId: string): AiTranscriptEvent[] {
  const events = store.getEvents(sessionId)
  return events.filter(e =>
    e.type === 'stream_error'
    || e.type === 'recovery'
    || (isTranscriptEvent(e, 'turn_end') && e.payload.data.status === 'error')
    || (isTranscriptEvent(e, 'tool_result') && !e.payload.data.success),
  )
}

/**
 * Find the last user message event.
 */
export function findLastUserMessage(store: TranscriptStore, sessionId: string): AiTranscriptEvent | undefined {
  const events = store.getEventsByType(sessionId, ['user_message'])
  return events.length > 0 ? events[events.length - 1] : undefined
}

/**
 * Find the last assistant message event.
 */
export function findLastAssistantMessage(store: TranscriptStore, sessionId: string): AiTranscriptEvent | undefined {
  const events = store.getEventsByType(sessionId, ['assistant_message'])
  return events.length > 0 ? events[events.length - 1] : undefined
}

/**
 * Get a summary of event counts by type for a session.
 */
export function getEventTypeSummary(
  store: TranscriptStore,
  sessionId: string,
): Record<AiTranscriptEventType, number> {
  const events = store.getEvents(sessionId)
  const summary = {} as Record<AiTranscriptEventType, number>
  for (const event of events) {
    summary[event.type] = (summary[event.type] ?? 0) + 1
  }
  return summary
}
