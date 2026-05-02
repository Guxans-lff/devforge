import { describe, expect, it } from 'vitest'
import {
  buildCompactBoundaryProjection,
  getEventsAfterLatestCompactBoundary,
  validateToolPairInvariant,
} from '../compactBoundary'
import type { AiTranscriptEvent } from '@/composables/ai-agent/transcript/transcriptTypes'

function event(partial: AiTranscriptEvent): AiTranscriptEvent {
  return partial
}

describe('compactBoundary', () => {
  it('projects events after latest compact boundary', () => {
    const events = [
      event({
        id: 'u-old',
        sessionId: 's1',
        type: 'user_message',
        timestamp: 1000,
        payload: { type: 'user_message', data: { contentPreview: 'old', attachmentCount: 0 } },
      }),
      event({
        id: 'c1',
        sessionId: 's1',
        turnId: 't1',
        type: 'compact',
        timestamp: 2000,
        payload: {
          type: 'compact',
          data: {
            trigger: 'auto',
            originalMessageCount: 12,
            originalTokens: 32000,
            summaryLength: 800,
            source: 'ai',
          },
        },
      }),
      event({
        id: 'u-new',
        sessionId: 's1',
        turnId: 't2',
        type: 'user_message',
        timestamp: 3000,
        payload: { type: 'user_message', data: { contentPreview: 'new', attachmentCount: 0 } },
      }),
    ]

    const projected = getEventsAfterLatestCompactBoundary(events)
    const projection = buildCompactBoundaryProjection(events)

    expect(projected.map(item => item.id)).toEqual(['u-new'])
    expect(projection).toMatchObject({
      hasBoundary: true,
      boundaryEventId: 'c1',
      trigger: 'auto',
      source: 'ai',
      originalMessageCount: 12,
      originalTokens: 32000,
      summaryLength: 800,
      eventsBeforeBoundary: 1,
      projectedEventCount: 1,
      projectedTurnCount: 1,
    })
  })

  it('keeps full projection when no compact boundary exists', () => {
    const events = [
      event({
        id: 't1-start',
        sessionId: 's1',
        turnId: 't1',
        type: 'turn_start',
        timestamp: 1000,
        payload: { type: 'turn_start', data: { turnId: 't1' } },
      }),
      event({
        id: 'u1',
        sessionId: 's1',
        turnId: 't1',
        type: 'user_message',
        timestamp: 1100,
        payload: { type: 'user_message', data: { contentPreview: 'hello', attachmentCount: 0 } },
      }),
    ]

    expect(buildCompactBoundaryProjection(events)).toMatchObject({
      hasBoundary: false,
      eventsBeforeBoundary: 0,
      projectedEventCount: 2,
      projectedTurnCount: 1,
    })
  })

  it('reports unpaired tool calls and orphan tool results without dropping events', () => {
    const events = [
      event({
        id: 'call-1',
        sessionId: 's1',
        turnId: 't1',
        type: 'tool_call',
        timestamp: 1000,
        payload: {
          type: 'tool_call',
          data: { toolCallId: 'tc-1', toolName: 'read_file', argumentsPreview: '{}' },
        },
      }),
      event({
        id: 'result-2',
        sessionId: 's1',
        turnId: 't1',
        type: 'tool_result',
        timestamp: 2000,
        payload: {
          type: 'tool_result',
          data: { toolCallId: 'tc-2', toolName: 'write_file', success: true, contentPreview: 'ok' },
        },
      }),
    ]

    const invariant = validateToolPairInvariant(events)
    const projection = buildCompactBoundaryProjection(events)

    expect(invariant.unpairedToolCallIds).toEqual(['tc-1'])
    expect(invariant.orphanToolResultIds).toEqual(['tc-2'])
    expect(projection.projectedEventCount).toBe(2)
    expect(projection.warnings).toEqual([
      '存在 1 个 tool_call 没有对应 tool_result',
      '存在 1 个 tool_result 找不到对应 tool_call',
    ])
  })
})
