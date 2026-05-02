/**
 * Transcript Event Store
 *
 * In-memory event storage per session with automatic pruning.
 */

import type { AiTranscriptEvent, AiTranscriptEventOf, AiTranscriptEventType } from './transcriptTypes'

export const TRANSCRIPT_STORE_STORAGE_KEY = 'devforge.ai.transcript.events.v1'

const MAX_EVENTS_PER_SESSION = 2000
const MAX_PERSISTED_SESSIONS = 20
const MAX_PERSISTED_EVENTS_PER_SESSION = 500
const PRUNE_RATIO = 0.2 // Discard 20% (oldest) when limit reached

interface PersistedTranscriptSnapshot {
  version: 1
  savedAt: number
  sessions: Array<{
    sessionId: string
    events: AiTranscriptEvent[]
  }>
}

let eventCounter = 0

function generateEventId(): string {
  eventCounter += 1
  return `evt-${Date.now()}-${eventCounter.toString(36)}`
}

export interface TranscriptStore {
  /** Append a new event to the session */
  appendEvent<T extends AiTranscriptEventType>(event: Omit<AiTranscriptEventOf<T>, 'id'>): AiTranscriptEventOf<T>

  /** Merge an existing persisted event into memory without generating a new id */
  hydrateEvent(event: AiTranscriptEvent): void

  /** Get events for a session with optional filtering */
  getEvents(
    sessionId: string,
    options?: {
      types?: AiTranscriptEventType[]
      turnId?: string
      limit?: number
      offset?: number
    },
  ): AiTranscriptEvent[]

  /** Get all events for a specific turn */
  getEventsByTurn(sessionId: string, turnId: string): AiTranscriptEvent[]

  /** Get events of specific type(s) */
  getEventsByType<T extends AiTranscriptEventType>(sessionId: string, types: T[]): AiTranscriptEventOf<T>[]

  /** Get total event count for a session */
  getEventCount(sessionId: string): number

  /** Get the most recent event, optionally filtered by type */
  getLatestEvent(sessionId: string): AiTranscriptEvent | undefined
  getLatestEvent<T extends AiTranscriptEventType>(sessionId: string, type: T): AiTranscriptEventOf<T> | undefined

  /** Get the most recent N events */
  getRecentEvents(sessionId: string, limit: number): AiTranscriptEvent[]

  /** Clear all events for a session */
  clearSession(sessionId: string): void

  /** Get all tracked session IDs */
  getSessionIds(): string[]

  /** Persist current transcript snapshot */
  save(storage?: Storage): void

  /** Restore transcript snapshot */
  load(storage?: Storage): boolean

  /** Restore transcript events from backend event store */
  loadBackend?(sessionId: string, limit?: number): Promise<boolean>

  /** Restore transcript events from backend with pagination/filtering */
  queryBackend?(query: TranscriptStoreBackendQuery): Promise<AiTranscriptEvent[]>
}

export interface TranscriptStoreOptions {
  persist?: boolean
  storage?: Storage
  autoLoad?: boolean
  backend?: TranscriptStoreBackend
}

export interface TranscriptStoreBackend {
  appendEvent?: (event: AiTranscriptEvent) => Promise<void>
  listEvents?: (sessionId: string, limit: number) => Promise<AiTranscriptEvent[]>
  queryEvents?: (query: TranscriptStoreBackendQuery) => Promise<AiTranscriptEvent[]>
  onError?: (error: unknown, context: { operation: 'append' | 'load'; sessionId: string }) => void
}

export interface TranscriptStoreBackendQuery {
  sessionId: string
  limit?: number
  offset?: number
  types?: AiTranscriptEventType[]
  turnId?: string
  startTime?: number
  endTime?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isTranscriptType(value: unknown): value is AiTranscriptEventType {
  return isString(value) && [
    'turn_start',
    'turn_end',
    'user_message',
    'assistant_message',
    'tool_call',
    'tool_result',
    'stream_error',
    'compact',
    'recovery',
    'permission',
    'plan_status',
    'usage',
    'routing',
    'agent_runtime_context',
  ].includes(value)
}

function sanitizeEvent(value: unknown, sessionId: string): AiTranscriptEvent | null {
  if (!isRecord(value)) return null
  if (!isString(value.id) || !isString(value.sessionId) || !isNumber(value.timestamp)) return null
  if (value.sessionId !== sessionId) return null
  if (!isTranscriptType(value.type)) return null
  if (!isRecord(value.payload) || value.payload.type !== value.type || !isRecord(value.payload.data)) return null

  return {
    id: value.id,
    sessionId: value.sessionId,
    timestamp: value.timestamp,
    type: value.type,
    turnId: isString(value.turnId) ? value.turnId : undefined,
    payload: {
      type: value.type,
      data: { ...value.payload.data },
    },
  } as unknown as AiTranscriptEvent
}

function normalizeSnapshot(value: unknown): PersistedTranscriptSnapshot | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.sessions)) return null

  const sessions = value.sessions
    .map(session => {
      if (!isRecord(session) || !isString(session.sessionId) || !Array.isArray(session.events)) return null
      const sessionId = session.sessionId
      const events = session.events
        .map(event => sanitizeEvent(event, sessionId))
        .filter((event): event is AiTranscriptEvent => Boolean(event))
        .slice(-MAX_PERSISTED_EVENTS_PER_SESSION)
      return { sessionId, events }
    })
    .filter((session): session is PersistedTranscriptSnapshot['sessions'][number] => Boolean(session))
    .slice(-MAX_PERSISTED_SESSIONS)

  return {
    version: 1,
    savedAt: isNumber(value.savedAt) ? value.savedAt : Date.now(),
    sessions,
  }
}

export function createTranscriptStore(options: TranscriptStoreOptions = {}): TranscriptStore {
  const eventsBySession = new Map<string, AiTranscriptEvent[]>()
  const persistEnabled = options.persist ?? false
  const defaultStorage = options.storage
  const backend = options.backend

  function resolveStorage(storage?: Storage): Storage | undefined {
    if (storage) return storage
    if (defaultStorage) return defaultStorage
    try {
      return globalThis.localStorage
    } catch {
      return undefined
    }
  }

  function pruneIfNeeded(sessionId: string): void {
    const events = eventsBySession.get(sessionId)
    if (!events || events.length <= MAX_EVENTS_PER_SESSION) return

    const discardCount = Math.floor(MAX_EVENTS_PER_SESSION * PRUNE_RATIO)
    events.splice(0, discardCount)
  }

  function insertEvent(event: AiTranscriptEvent, options?: { sort?: boolean }): void {
    let list = eventsBySession.get(event.sessionId)
    if (!list) {
      list = []
      eventsBySession.set(event.sessionId, list)
    }

    if (list.some(item => item.id === event.id)) return
    list.push(event)
    if (options?.sort) {
      list.sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id))
    }
    pruneIfNeeded(event.sessionId)
  }

  function persistBackend(event: AiTranscriptEvent): void {
    if (!backend?.appendEvent) return
    void backend.appendEvent(event).catch(error => {
      backend.onError?.(error, { operation: 'append', sessionId: event.sessionId })
    })
  }

  function appendEvent<T extends AiTranscriptEventType>(event: Omit<AiTranscriptEventOf<T>, 'id'>): AiTranscriptEventOf<T> {
    const fullEvent = {
      ...event,
      id: generateEventId(),
    } as AiTranscriptEventOf<T>

    insertEvent(fullEvent as AiTranscriptEvent)
    if (persistEnabled) save()
    persistBackend(fullEvent as AiTranscriptEvent)
    return fullEvent
  }

  function hydrateEvent(event: AiTranscriptEvent): void {
    insertEvent(event)
    if (persistEnabled) save()
  }

  function getEvents(
    sessionId: string,
    options?: {
      types?: AiTranscriptEventType[]
      turnId?: string
      limit?: number
      offset?: number
    },
  ): AiTranscriptEvent[] {
    const list = eventsBySession.get(sessionId) ?? []
    let result = list

    if (options?.types && options.types.length > 0) {
      const typeSet = new Set(options.types)
      result = result.filter(e => typeSet.has(e.type))
    }

    if (options?.turnId !== undefined) {
      result = result.filter(e => e.turnId === options.turnId)
    }

    const offset = options?.offset ?? 0
    const limit = options?.limit

    if (offset > 0 || limit !== undefined) {
      result = result.slice(offset, limit !== undefined ? offset + limit : undefined)
    }

    return result
  }

  function getEventsByTurn(sessionId: string, turnId: string): AiTranscriptEvent[] {
    const list = eventsBySession.get(sessionId) ?? []
    return list.filter(e => e.turnId === turnId)
  }

  function getEventsByType<T extends AiTranscriptEventType>(sessionId: string, types: T[]): AiTranscriptEventOf<T>[] {
    const list = eventsBySession.get(sessionId) ?? []
    if (types.length === 0) return list as AiTranscriptEventOf<T>[]
    const typeSet = new Set(types)
    return list.filter((e): e is AiTranscriptEventOf<T> => typeSet.has(e.type as T))
  }

  function getEventCount(sessionId: string): number {
    return eventsBySession.get(sessionId)?.length ?? 0
  }

  function getLatestEvent(sessionId: string): AiTranscriptEvent | undefined
  function getLatestEvent<T extends AiTranscriptEventType>(sessionId: string, type: T): AiTranscriptEventOf<T> | undefined
  function getLatestEvent<T extends AiTranscriptEventType>(sessionId: string, type?: T): AiTranscriptEvent | AiTranscriptEventOf<T> | undefined {
    const list = eventsBySession.get(sessionId)
    if (!list || list.length === 0) return undefined
    if (!type) return list[list.length - 1]
    for (let i = list.length - 1; i >= 0; i--) {
      const event = list[i]!
      if (event.type === type) return event as AiTranscriptEventOf<T>
    }
    return undefined
  }

  function getRecentEvents(sessionId: string, limit: number): AiTranscriptEvent[] {
    const list = eventsBySession.get(sessionId) ?? []
    if (list.length === 0) return []
    return list.slice(-Math.max(1, limit))
  }

  function clearSession(sessionId: string): void {
    eventsBySession.delete(sessionId)
    if (persistEnabled) save()
  }

  function getSessionIds(): string[] {
    return Array.from(eventsBySession.keys())
  }

  function buildSnapshot(): PersistedTranscriptSnapshot {
    const sessions = Array.from(eventsBySession.entries())
      .map(([sessionId, events]) => ({
        sessionId,
        events: events.slice(-MAX_PERSISTED_EVENTS_PER_SESSION),
      }))
      .filter(session => session.events.length > 0)
      .slice(-MAX_PERSISTED_SESSIONS)

    return {
      version: 1,
      savedAt: Date.now(),
      sessions,
    }
  }

  function save(storage?: Storage): void {
    const targetStorage = resolveStorage(storage)
    if (!targetStorage) return
    try {
      const snapshot = buildSnapshot()
      if (snapshot.sessions.length === 0) {
        targetStorage.removeItem(TRANSCRIPT_STORE_STORAGE_KEY)
        return
      }
      targetStorage.setItem(TRANSCRIPT_STORE_STORAGE_KEY, JSON.stringify(snapshot))
    } catch {
      // localStorage 不可用时不阻塞主链路。
    }
  }

  function load(storage?: Storage): boolean {
    const targetStorage = resolveStorage(storage)
    if (!targetStorage) return false
    try {
      const raw = targetStorage.getItem(TRANSCRIPT_STORE_STORAGE_KEY)
      if (!raw) return false
      const snapshot = normalizeSnapshot(JSON.parse(raw))
      if (!snapshot) return false

      eventsBySession.clear()
      for (const session of snapshot.sessions) {
        eventsBySession.set(session.sessionId, [...session.events])
      }
      return true
    } catch {
      return false
    }
  }

  async function loadBackend(sessionId: string, limit = MAX_PERSISTED_EVENTS_PER_SESSION): Promise<boolean> {
    if (!backend?.listEvents) return false
    try {
      const events = await backend.listEvents(sessionId, limit)
      for (const event of events) {
        insertEvent(event, { sort: true })
      }
      if (events.length > 0 && persistEnabled) save()
      return events.length > 0
    } catch (error) {
      backend.onError?.(error, { operation: 'load', sessionId })
      return false
    }
  }

  async function queryBackend(query: TranscriptStoreBackendQuery): Promise<AiTranscriptEvent[]> {
    if (!backend?.queryEvents) return []
    try {
      const events = await backend.queryEvents(query)
      for (const event of events) {
        insertEvent(event, { sort: true })
      }
      if (events.length > 0 && persistEnabled) save()
      return events
    } catch (error) {
      backend.onError?.(error, { operation: 'load', sessionId: query.sessionId })
      return []
    }
  }

  if (options.autoLoad) {
    load()
  }

  return {
    appendEvent,
    hydrateEvent,
    getEvents,
    getEventsByTurn,
    getEventsByType,
    getEventCount,
    getLatestEvent,
    getRecentEvents,
    clearSession,
    getSessionIds,
    save,
    load,
    loadBackend,
    queryBackend,
  }
}
