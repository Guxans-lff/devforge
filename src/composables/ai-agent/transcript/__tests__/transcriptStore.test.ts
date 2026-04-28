import { describe, it, expect, beforeEach } from 'vitest'
import { createTranscriptStore, TRANSCRIPT_STORE_STORAGE_KEY } from '../transcriptStore'
import type { AiTranscriptEvent } from '../transcriptTypes'

function makeEvent(partial: Omit<AiTranscriptEvent, 'id'>): Omit<AiTranscriptEvent, 'id'> {
  return partial
}

function createMemoryStorage(): Storage {
  const storage = new Map<string, string>()
  return {
    get length() {
      return storage.size
    },
    clear: () => { storage.clear() },
    getItem: key => storage.get(key) ?? null,
    key: index => Array.from(storage.keys())[index] ?? null,
    removeItem: key => { storage.delete(key) },
    setItem: (key, value) => { storage.set(key, value) },
  }
}

describe('transcriptStore', () => {
  let store: ReturnType<typeof createTranscriptStore>

  beforeEach(() => {
    store = createTranscriptStore()
  })

  it('appends and retrieves events', () => {
    const event = store.appendEvent(makeEvent({
      sessionId: 's1',
      turnId: 't1',
      type: 'turn_start',
      timestamp: 1000,
      payload: { type: 'turn_start', data: { turnId: 't1' } },
    }))

    expect(event.id).toMatch(/^evt-/)
    expect(store.getEventCount('s1')).toBe(1)
    expect(store.getEvents('s1')).toHaveLength(1)
    expect(store.getEvents('s1')[0]!.id).toBe(event.id)
  })

  it('isolates sessions', () => {
    store.appendEvent(makeEvent({
      sessionId: 's1',
      type: 'user_message',
      timestamp: 1000,
      payload: { type: 'user_message', data: { contentPreview: 'hello', attachmentCount: 0 } },
    }))
    store.appendEvent(makeEvent({
      sessionId: 's2',
      type: 'user_message',
      timestamp: 2000,
      payload: { type: 'user_message', data: { contentPreview: 'world', attachmentCount: 0 } },
    }))

    expect(store.getEventCount('s1')).toBe(1)
    expect(store.getEventCount('s2')).toBe(1)
    expect(store.getSessionIds()).toContain('s1')
    expect(store.getSessionIds()).toContain('s2')
  })

  it('filters by type', () => {
    store.appendEvent(makeEvent({ sessionId: 's1', type: 'turn_start', timestamp: 1000, payload: { type: 'turn_start', data: { turnId: 't1' } } }))
    store.appendEvent(makeEvent({ sessionId: 's1', type: 'tool_call', timestamp: 2000, payload: { type: 'tool_call', data: { toolCallId: 'tc1', toolName: 'read_file', argumentsPreview: '{}' } } }))
    store.appendEvent(makeEvent({ sessionId: 's1', type: 'turn_end', timestamp: 3000, payload: { type: 'turn_end', data: { turnId: 't1', status: 'done', durationMs: 100 } } }))

    const toolEvents = store.getEventsByType('s1', ['tool_call'])
    expect(toolEvents).toHaveLength(1)
    expect(toolEvents[0]!.type).toBe('tool_call')

    const startAndEnd = store.getEventsByType('s1', ['turn_start', 'turn_end'])
    expect(startAndEnd).toHaveLength(2)
  })

  it('filters by turnId', () => {
    store.appendEvent(makeEvent({ sessionId: 's1', turnId: 't1', type: 'turn_start', timestamp: 1000, payload: { type: 'turn_start', data: { turnId: 't1' } } }))
    store.appendEvent(makeEvent({ sessionId: 's1', turnId: 't1', type: 'tool_call', timestamp: 2000, payload: { type: 'tool_call', data: { toolCallId: 'tc1', toolName: 'read_file', argumentsPreview: '{}' } } }))
    store.appendEvent(makeEvent({ sessionId: 's1', turnId: 't2', type: 'turn_start', timestamp: 3000, payload: { type: 'turn_start', data: { turnId: 't2' } } }))

    expect(store.getEventsByTurn('s1', 't1')).toHaveLength(2)
    expect(store.getEventsByTurn('s1', 't2')).toHaveLength(1)
  })

  it('supports limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      store.appendEvent(makeEvent({
        sessionId: 's1',
        type: 'user_message',
        timestamp: 1000 + i,
        payload: { type: 'user_message', data: { contentPreview: `msg ${i}`, attachmentCount: 0 } },
      }))
    }

    const all = store.getEvents('s1')
    expect(all).toHaveLength(5)

    const limited = store.getEvents('s1', { limit: 2 })
    expect(limited).toHaveLength(2)
    expect(limited[0]!.timestamp).toBe(1000)

    const offset = store.getEvents('s1', { offset: 2, limit: 2 })
    expect(offset).toHaveLength(2)
    expect(offset[0]!.timestamp).toBe(1002)
  })

  it('returns latest event by type', () => {
    store.appendEvent(makeEvent({ sessionId: 's1', type: 'turn_start', timestamp: 1000, payload: { type: 'turn_start', data: { turnId: 't1' } } }))
    store.appendEvent(makeEvent({ sessionId: 's1', type: 'turn_start', timestamp: 3000, payload: { type: 'turn_start', data: { turnId: 't2' } } }))
    store.appendEvent(makeEvent({ sessionId: 's1', type: 'tool_call', timestamp: 2000, payload: { type: 'tool_call', data: { toolCallId: 'tc1', toolName: 'read_file', argumentsPreview: '{}' } } }))

    const latestTurnStart = store.getLatestEvent('s1', 'turn_start')
    expect(latestTurnStart?.timestamp).toBe(3000)

    const latestAny = store.getLatestEvent('s1')
    expect(latestAny?.timestamp).toBe(2000)
  })

  it('returns recent events', () => {
    for (let i = 0; i < 10; i++) {
      store.appendEvent(makeEvent({
        sessionId: 's1',
        type: 'user_message',
        timestamp: 1000 + i,
        payload: { type: 'user_message', data: { contentPreview: `msg ${i}`, attachmentCount: 0 } },
      }))
    }

    const recent = store.getRecentEvents('s1', 3)
    expect(recent).toHaveLength(3)
    expect(recent[0]!.timestamp).toBe(1007)
    expect(recent[2]!.timestamp).toBe(1009)
  })

  it('clears session', () => {
    store.appendEvent(makeEvent({ sessionId: 's1', type: 'turn_start', timestamp: 1000, payload: { type: 'turn_start', data: { turnId: 't1' } } }))
    store.clearSession('s1')
    expect(store.getEventCount('s1')).toBe(0)
    expect(store.getSessionIds()).not.toContain('s1')
  })

  it('prunes old events when limit exceeded', () => {
    // Inject many events quickly to trigger pruning
    for (let i = 0; i < 2100; i++) {
      store.appendEvent(makeEvent({
        sessionId: 's1',
        type: 'user_message',
        timestamp: 1000 + i,
        payload: { type: 'user_message', data: { contentPreview: `msg ${i}`, attachmentCount: 0 } },
      }))
    }

    // Should be under limit after pruning
    expect(store.getEventCount('s1')).toBeLessThanOrEqual(2000)
    // Should have discarded oldest 20%
    expect(store.getEventCount('s1')).toBeGreaterThan(1600)
  })

  it('saves and restores transcript events', () => {
    const storage = createMemoryStorage()
    store.appendEvent(makeEvent({
      sessionId: 's1',
      type: 'user_message',
      timestamp: 1000,
      payload: { type: 'user_message', data: { contentPreview: 'hello', attachmentCount: 0 } },
    }))
    store.save(storage)

    const restored = createTranscriptStore()
    expect(restored.load(storage)).toBe(true)

    expect(restored.getEventCount('s1')).toBe(1)
    expect(restored.getLatestEvent('s1', 'user_message')?.payload.data.contentPreview).toBe('hello')
  })

  it('removes persisted snapshot when transcript is empty', () => {
    const storage = createMemoryStorage()
    store.appendEvent(makeEvent({
      sessionId: 's1',
      type: 'user_message',
      timestamp: 1000,
      payload: { type: 'user_message', data: { contentPreview: 'hello', attachmentCount: 0 } },
    }))
    store.save(storage)
    expect(storage.getItem(TRANSCRIPT_STORE_STORAGE_KEY)).toBeTruthy()

    store.clearSession('s1')

    expect(storage.getItem(TRANSCRIPT_STORE_STORAGE_KEY)).toBeTruthy()
    store.save(storage)
    expect(storage.getItem(TRANSCRIPT_STORE_STORAGE_KEY)).toBeNull()
  })

  it('ignores invalid persisted transcript data', () => {
    const storage = createMemoryStorage()
    storage.setItem(TRANSCRIPT_STORE_STORAGE_KEY, JSON.stringify({
      version: 1,
      sessions: [
        {
          sessionId: 's1',
          events: [
            { id: 'evt-1', sessionId: 'other', type: 'user_message', timestamp: 1, payload: { type: 'user_message', data: {} } },
            { id: 'evt-2', sessionId: 's1', type: 'missing', timestamp: 2, payload: { type: 'missing', data: {} } },
          ],
        },
      ],
    }))

    expect(store.load(storage)).toBe(true)
    expect(store.getEventCount('s1')).toBe(0)
  })
})
