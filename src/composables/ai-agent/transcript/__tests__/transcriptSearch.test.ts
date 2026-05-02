import { describe, it, expect, beforeEach } from 'vitest'
import { createTranscriptStore } from '../transcriptStore'
import {
  searchTranscriptEvents,
  findErrors,
  findLatestAgentRuntimeContext,
  findLastUserMessage,
  findLastAssistantMessage,
  getEventTypeSummary,
} from '../transcriptSearch'
import type { AiTranscriptEvent } from '../transcriptTypes'

function makeEvent(partial: Omit<AiTranscriptEvent, 'id'>) {
  return partial
}

describe('transcriptSearch', () => {
  let store: ReturnType<typeof createTranscriptStore>

  beforeEach(() => {
    store = createTranscriptStore()
  })

  function seedEvents() {
    store.appendEvent(makeEvent({
      sessionId: 's1', turnId: 't1', type: 'turn_start', timestamp: 1000,
      payload: { type: 'turn_start', data: { turnId: 't1' } },
    }))
    store.appendEvent(makeEvent({
      sessionId: 's1', turnId: 't1', type: 'user_message', timestamp: 1100,
      payload: { type: 'user_message', data: { contentPreview: 'Hello world', attachmentCount: 0 } },
    }))
    store.appendEvent(makeEvent({
      sessionId: 's1', turnId: 't1', type: 'tool_call', timestamp: 1200,
      payload: { type: 'tool_call', data: { toolCallId: 'tc1', toolName: 'read_file', argumentsPreview: '{"path":"src/main.ts"}', path: 'src/main.ts' } },
    }))
    store.appendEvent(makeEvent({
      sessionId: 's1', turnId: 't1', type: 'tool_result', timestamp: 1300,
      payload: { type: 'tool_result', data: { toolCallId: 'tc1', toolName: 'read_file', success: true, contentPreview: 'export const foo = 1' } },
    }))
    store.appendEvent(makeEvent({
      sessionId: 's1', turnId: 't1', type: 'assistant_message', timestamp: 1400,
      payload: { type: 'assistant_message', data: { contentPreview: 'Here is the file content', tokens: 50 } },
    }))
    store.appendEvent(makeEvent({
      sessionId: 's1', turnId: 't1', type: 'turn_end', timestamp: 1500,
      payload: { type: 'turn_end', data: { turnId: 't1', status: 'done', durationMs: 500 } },
    }))
    store.appendEvent(makeEvent({
      sessionId: 's1', turnId: 't2', type: 'turn_start', timestamp: 2000,
      payload: { type: 'turn_start', data: { turnId: 't2' } },
    }))
    store.appendEvent(makeEvent({
      sessionId: 's1', turnId: 't2', type: 'stream_error', timestamp: 2100,
      payload: { type: 'stream_error', data: { error: 'Connection reset', retryable: true } },
    }))
    store.appendEvent(makeEvent({
      sessionId: 's1', turnId: 't2', type: 'recovery', timestamp: 2200,
      payload: { type: 'recovery', data: { reason: 'Stream stalled, attempting recovery', attempt: 1 } },
    }))
    store.appendEvent(makeEvent({
      sessionId: 's1', turnId: 't2', type: 'turn_end', timestamp: 2500,
      payload: { type: 'turn_end', data: { turnId: 't2', status: 'error', durationMs: 500 } },
    }))
    store.appendEvent(makeEvent({
      sessionId: 's1',
      turnId: 't2',
      type: 'agent_runtime_context',
      timestamp: 2600,
      payload: {
        type: 'agent_runtime_context',
        data: {
          assignmentCount: 2,
          blockedCount: 1,
          warningCount: 1,
          verificationRisk: 'high',
          verificationCommandCount: 3,
          isolationBoundaryCount: 2,
          isolationMergeRequiredCount: 1,
          isolationBlockedCount: 1,
          isolationWorktreeCount: 1,
          isolationTemporaryWorkspaceCount: 1,
          isolationReviewRequiredCount: 1,
          isolationConfirmationRequiredCount: 7,
          isolationGateStatus: 'confirm_required',
          isolationSafeToAutoRun: false,
          lspDiagnosticCount: 4,
          lspSummary: '诊断 4 条：error 0，warning 4，info/hint 0。',
          warnings: ['检测到任务依赖环：a -> b'],
        },
      },
    }))
  }

  it('searches by query text', () => {
    seedEvents()
    const results = searchTranscriptEvents(store, { sessionId: 's1', query: 'Hello' })
    expect(results).toHaveLength(1)
    expect(results[0]!.type).toBe('user_message')
  })

  it('searches by tool name', () => {
    seedEvents()
    const results = searchTranscriptEvents(store, { sessionId: 's1', query: 'read_file' })
    expect(results.filter(r => r.type === 'tool_call' || r.type === 'tool_result')).toHaveLength(2)
  })

  it('filters by event type', () => {
    seedEvents()
    const results = searchTranscriptEvents(store, { sessionId: 's1', types: ['tool_call', 'tool_result'] })
    expect(results).toHaveLength(2)
  })

  it('filters by turnId', () => {
    seedEvents()
    const t1 = searchTranscriptEvents(store, { sessionId: 's1', turnId: 't1' })
    expect(t1).toHaveLength(6)
    const t2 = searchTranscriptEvents(store, { sessionId: 's1', turnId: 't2' })
    expect(t2).toHaveLength(5)
  })

  it('filters by time range', () => {
    seedEvents()
    const results = searchTranscriptEvents(store, { sessionId: 's1', startTime: 1500, endTime: 2200 })
    expect(results).toHaveLength(4)
    expect(results[0]!.timestamp).toBeGreaterThanOrEqual(1500)
    expect(results[results.length - 1]!.timestamp).toBeLessThanOrEqual(2200)
  })

  it('finds errors', () => {
    seedEvents()
    const errors = findErrors(store, 's1')
    expect(errors).toHaveLength(3) // stream_error + recovery + turn_end(error)
    expect(errors.some(e => e.type === 'stream_error')).toBe(true)
    expect(errors.some(e => e.type === 'recovery')).toBe(true)
  })

  it('finds last user message', () => {
    seedEvents()
    const last = findLastUserMessage(store, 's1')
    expect(last).toBeDefined()
    expect(last!.type).toBe('user_message')
  })

  it('finds last assistant message', () => {
    seedEvents()
    const last = findLastAssistantMessage(store, 's1')
    expect(last).toBeDefined()
    expect(last!.type).toBe('assistant_message')
  })

  it('returns event type summary', () => {
    seedEvents()
    const summary = getEventTypeSummary(store, 's1')
    expect(summary.turn_start).toBe(2)
    expect(summary.user_message).toBe(1)
    expect(summary.tool_call).toBe(1)
    expect(summary.tool_result).toBe(1)
    expect(summary.assistant_message).toBe(1)
    expect(summary.turn_end).toBe(2)
    expect(summary.stream_error).toBe(1)
    expect(summary.recovery).toBe(1)
    expect(summary.agent_runtime_context).toBe(1)
  })

  it('supports pagination', () => {
    seedEvents()
    const page1 = searchTranscriptEvents(store, { sessionId: 's1', limit: 3, offset: 0 })
    expect(page1).toHaveLength(3)
    expect(page1[0]!.timestamp).toBe(1000)

    const page2 = searchTranscriptEvents(store, { sessionId: 's1', limit: 3, offset: 3 })
    expect(page2).toHaveLength(3)
    expect(page2[0]!.timestamp).toBe(1300)
  })

  it('searches and finds latest P2 Agent Runtime context', () => {
    seedEvents()

    const results = searchTranscriptEvents(store, { sessionId: 's1', query: '依赖环' })
    expect(results).toHaveLength(1)
    expect(results[0]!.type).toBe('agent_runtime_context')

    const latest = findLatestAgentRuntimeContext(store, 's1')
    expect(latest?.payload.data.verificationRisk).toBe('high')
    expect(latest?.payload.data.blockedCount).toBe(1)
    expect(latest?.payload.data.isolationWorktreeCount).toBe(1)
    expect(latest?.payload.data.isolationConfirmationRequiredCount).toBe(7)
    expect(latest?.payload.data.isolationGateStatus).toBe('confirm_required')
  })
})
