import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTranscriptStore } from '../transcriptStore'
import { createTranscriptHookIntegration } from '../transcriptHookIntegration'
import type { TurnStartContext, TurnEndContext, PreToolUseContext, PostToolUseContext, PostCompactContext } from '@/composables/ai/AiHookManager'
import type { ToolCallInfo, ToolResultInfo } from '@/types/ai'
import type { AiPlan } from '@/types/plan'

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as import('@/utils/logger').Logger

describe('transcriptHookIntegration', () => {
  let store: ReturnType<typeof createTranscriptStore>
  let integration: ReturnType<typeof createTranscriptHookIntegration>

  beforeEach(() => {
    store = createTranscriptStore()
    integration = createTranscriptHookIntegration({
      sessionId: 's1',
      transcriptStore: store,
      log: mockLog,
    })
  })

  it('records turn_start and turn_end', () => {
    integration.onTurnStart({ sessionId: 's1', turnId: 't1' })
    integration.onTurnEnd({ sessionId: 's1', turnId: 't1', status: 'done', duration: 500 })

    const events = store.getEvents('s1')
    expect(events).toHaveLength(2)
    expect(events[0]!.type).toBe('turn_start')
    expect(events[1]!.type).toBe('turn_end')
    expect(events[1]!.payload.type).toBe('turn_end')
    expect(events[1]!.payload.data.status).toBe('done')
  })

  it('records tool_call and tool_result', () => {
    integration.onTurnStart({ sessionId: 's1', turnId: 't1' })

    const toolCall: ToolCallInfo = {
      id: 'tc1',
      name: 'read_file',
      arguments: '{"path":"src/main.ts"}',
      parsedArgs: { path: 'src/main.ts' },
      status: 'pending',
    }
    integration.onPreToolUse({ sessionId: 's1', turnId: 't1', toolCall })

    const result: ToolResultInfo = {
      toolCallId: 'tc1',
      toolName: 'read_file',
      success: true,
      content: 'export const foo = 1',
    }
    integration.onPostToolUse({ sessionId: 's1', turnId: 't1', toolCall, result })

    const events = store.getEventsByType('s1', ['tool_call', 'tool_result'])
    expect(events).toHaveLength(2)
    expect(events[0]!.payload.type).toBe('tool_call')
    expect(events[0]!.payload.data.path).toBe('src/main.ts')
    expect(events[1]!.payload.type).toBe('tool_result')
    expect(events[1]!.payload.data.success).toBe(true)
  })

  it('records compact event', () => {
    integration.onPostCompact({
      sessionId: 's1',
      originalCount: 50,
      compressedTokens: 12000,
      summaryLength: 800,
      source: 'ai',
    })

    const events = store.getEventsByType('s1', ['compact'])
    expect(events).toHaveLength(1)
    expect(events[0]!.payload.type).toBe('compact')
    expect(events[0]!.payload.data.originalMessageCount).toBe(50)
  })

  it('records user and assistant messages', () => {
    integration.recordUserMessage('Hello AI', ['file1.ts'])
    integration.recordAssistantMessage('Hello user', 42, 'stop')

    const userEvents = store.getEventsByType('s1', ['user_message'])
    expect(userEvents).toHaveLength(1)
    expect(userEvents[0]!.payload.data.contentPreview).toBe('Hello AI')
    expect(userEvents[0]!.payload.data.attachmentCount).toBe(1)

    const assistantEvents = store.getEventsByType('s1', ['assistant_message'])
    expect(assistantEvents).toHaveLength(1)
    expect(assistantEvents[0]!.payload.data.tokens).toBe(42)
  })

  it('truncates long content previews', () => {
    const longContent = 'a'.repeat(500)
    integration.recordUserMessage(longContent)
    integration.recordAssistantMessage(longContent)

    const userEvent = store.getLatestEvent('s1', 'user_message')
    expect(userEvent!.payload.data.contentPreview.length).toBeLessThan(300)
    expect(userEvent!.payload.data.contentPreview.endsWith('...')).toBe(true)
  })

  it('records stream error', () => {
    integration.recordStreamError('Connection reset', true)
    const event = store.getLatestEvent('s1', 'stream_error')
    expect(event).toBeDefined()
    expect(event!.payload.data.error).toBe('Connection reset')
    expect(event!.payload.data.retryable).toBe(true)
  })

  it('records usage', () => {
    integration.recordUsage({ prompt: 100, completion: 50, cacheRead: 20 })
    const event = store.getLatestEvent('s1', 'usage')
    expect(event).toBeDefined()
    expect(event!.payload.data.totalTokens).toBe(150)
  })

  it('records routing', () => {
    integration.recordRouting('downgrade_model', 'p1', 'p2', 'gpt-4', 'gpt-3.5')
    const event = store.getLatestEvent('s1', 'routing')
    expect(event).toBeDefined()
    expect(event!.payload.data.reason).toBe('downgrade_model')
  })

  it('records plan status', () => {
    const plan: AiPlan = {
      id: 'plan-1',
      sessionId: 's1',
      title: 'Test Plan',
      status: 'in_progress',
      steps: [],
      relatedFiles: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    integration.recordPlanStatus(plan)
    const event = store.getLatestEvent('s1', 'plan_status')
    expect(event).toBeDefined()
    expect(event!.payload.data.planId).toBe('plan-1')
    expect(event!.payload.data.status).toBe('in_progress')
  })

  it('associates manual records with current turnId', () => {
    integration.onTurnStart({ sessionId: 's1', turnId: 't1' })
    integration.recordUserMessage('Hello')

    const event = store.getLatestEvent('s1', 'user_message')
    expect(event!.turnId).toBe('t1')
  })

  it('resolves dynamic session id for later records', () => {
    let currentSessionId = 's1'
    integration = createTranscriptHookIntegration({
      sessionId: () => currentSessionId,
      transcriptStore: store,
      log: mockLog,
    })

    integration.recordUserMessage('first')
    currentSessionId = 's2'
    integration.recordAssistantMessage('second')

    expect(store.getLatestEvent('s1', 'user_message')?.payload.data.contentPreview).toBe('first')
    expect(store.getLatestEvent('s2', 'assistant_message')?.payload.data.contentPreview).toBe('second')
  })
})
