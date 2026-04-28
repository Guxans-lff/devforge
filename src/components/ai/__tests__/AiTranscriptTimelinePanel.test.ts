import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AiTranscriptTimelinePanel from '@/components/ai/AiTranscriptTimelinePanel.vue'
import type { AiTranscriptEvent } from '@/composables/ai-agent/transcript/transcriptTypes'

const iconStubs = {
  Activity: true,
  AlertTriangle: true,
  Bot: true,
  CheckCircle2: true,
  KeyRound: true,
  MessageSquare: true,
  Route: true,
  Wrench: true,
  ClipboardList: true,
}

function makeEvent(event: AiTranscriptEvent): AiTranscriptEvent {
  return event
}

describe('AiTranscriptTimelinePanel', () => {
  it('renders event counts and recent timeline in reverse order', () => {
    const events: AiTranscriptEvent[] = [
      makeEvent({
        id: 'evt-1',
        sessionId: 's1',
        turnId: 't1',
        type: 'user_message',
        timestamp: 1000,
        payload: { type: 'user_message', data: { contentPreview: 'hello', attachmentCount: 0 } },
      }),
      makeEvent({
        id: 'evt-2',
        sessionId: 's1',
        turnId: 't1',
        type: 'tool_call',
        timestamp: 2000,
        payload: { type: 'tool_call', data: { toolCallId: 'tc1', toolName: 'read_file', argumentsPreview: '{}', path: 'src/main.ts' } },
      }),
      makeEvent({
        id: 'evt-3',
        sessionId: 's1',
        turnId: 't1',
        type: 'stream_error',
        timestamp: 3000,
        payload: { type: 'stream_error', data: { error: 'timeout', retryable: true } },
      }),
    ]

    const wrapper = mount(AiTranscriptTimelinePanel, {
      props: { events, totalCount: 10 },
      global: { stubs: iconStubs },
    })

    expect(wrapper.text()).toContain('Transcript Timeline')
    expect(wrapper.text()).toContain('最近 3 条 / 共 10 条事件')
    expect(wrapper.text()).toContain('用户消息 1')
    expect(wrapper.text()).toContain('工具调用 1')
    expect(wrapper.text()).toContain('流错误 1')

    const rows = wrapper.findAll('[data-testid="transcript-timeline"] [data-event-type]')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.attributes('data-event-type')).toBe('stream_error')
    expect(rows[0]!.text()).toContain('timeout')
    expect(rows[1]!.text()).toContain('read_file')
    expect(rows[1]!.text()).toContain('src/main.ts')
    expect(rows[2]!.text()).toContain('hello')
  })

  it('renders empty state', () => {
    const wrapper = mount(AiTranscriptTimelinePanel, {
      props: { events: [], totalCount: 0 },
      global: { stubs: iconStubs },
    })

    expect(wrapper.text()).toContain('当前会话暂无 transcript 事件')
  })
})
