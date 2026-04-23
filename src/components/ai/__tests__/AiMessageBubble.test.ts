import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { AiMessage } from '@/types/ai'
import AiMessageBubble from '@/components/ai/AiMessageBubble.vue'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
}))

vi.mock('@/api/database', () => ({
  writeTextFile: vi.fn(),
}))

const ToolCallBlockStub = defineComponent({
  name: 'AiToolCallBlock',
  props: {
    toolCall: { type: Object, required: true },
  },
  setup(props) {
    return () => {
      const toolCall = props.toolCall as {
        status?: string
        approvalState?: string
        error?: string
        result?: string
      }
      return h(
        'div',
        { class: 'tool-call-stub' },
        `${toolCall.status ?? ''}|${toolCall.approvalState ?? ''}|${toolCall.error ?? toolCall.result ?? ''}`,
      )
    }
  },
})

function makeAssistantMessage(extra: Partial<AiMessage> = {}): AiMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    ...extra,
  }
}

describe('AiMessageBubble', () => {
  it('re-renders tool call state changes even when tool count stays the same', async () => {
    const wrapper = mount(AiMessageBubble, {
      props: {
        message: makeAssistantMessage({
          toolCalls: [
            {
              id: 'tool-1',
              name: 'edit_file',
              arguments: '{"path":"src/locales/zh-CN.ts"}',
              parsedArgs: { path: 'src/locales/zh-CN.ts' },
              status: 'pending',
              approvalState: 'awaiting',
            },
          ],
        }),
        sessionId: 'session-1',
      },
      global: {
        stubs: {
          AiCodeBlock: true,
          AiFileCard: true,
          AiFileOpsGroup: true,
          AiContextPill: true,
          AiToolCallBlock: ToolCallBlockStub,
          Download: true,
          Copy: true,
          Check: true,
          AlertCircle: true,
          AlertTriangle: true,
          Info: true,
          RotateCw: true,
          ChevronRight: true,
        },
      },
    })

    expect(wrapper.text()).toContain('pending|awaiting')

    await wrapper.setProps({
      message: makeAssistantMessage({
        toolCalls: [
          {
            id: 'tool-1',
            name: 'edit_file',
            arguments: '{"path":"src/locales/zh-CN.ts"}',
            parsedArgs: { path: 'src/locales/zh-CN.ts' },
            status: 'error',
            approvalState: 'denied',
            error: '[user_rejected] User rejected edit_file.',
          },
        ],
        toolResults: [
          {
            toolCallId: 'tool-1',
            toolName: 'edit_file',
            success: false,
            content: '[user_rejected] User rejected edit_file.',
          },
        ],
      }),
    })

    expect(wrapper.text()).toContain('error|denied|[user_rejected] User rejected edit_file.')
  })

  it('hides leaked DSML tool protocol from the thinking panel', () => {
    const wrapper = mount(AiMessageBubble, {
      props: {
        message: makeAssistantMessage({
          content: '正常回复内容',
          thinking: [
            '需要先看文件。',
            '<|DSML|tool_calls>',
            '<|DSML|invoke name="read_file">',
            '<|DSML|parameter name="path" string="true">src/main.ts</|DSML|parameter>',
            '</|DSML|invoke>',
            '<|DSML|tool_calls>',
            '然后总结。',
          ].join('\n'),
        }),
        sessionId: 'session-1',
      },
      global: {
        stubs: {
          AiCodeBlock: true,
          AiFileCard: true,
          AiFileOpsGroup: true,
          AiContextPill: true,
          AiToolCallBlock: ToolCallBlockStub,
          Download: true,
          Copy: true,
          Check: true,
          AlertCircle: true,
          AlertTriangle: true,
          Info: true,
          RotateCw: true,
          ChevronRight: true,
        },
      },
    })

    expect(wrapper.text()).toContain('需要先看文件。')
    expect(wrapper.text()).toContain('然后总结。')
    expect(wrapper.text()).not.toContain('DSML')
    expect(wrapper.text()).not.toContain('read_file')
  })
})
