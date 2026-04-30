import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

const defaultStubs = {
  AiCodeBlock: true,
  AiFileCard: true,
  AiFileOpsGroup: true,
  AiContextPill: true,
  AiTodoPanel: defineComponent({
    name: 'AiTodoPanel',
    props: {
      todos: { type: Array, required: true },
    },
    setup(props) {
      return () => h('div', { class: 'todo-panel-stub' }, `todos:${props.todos.length}`)
    },
  }),
  AiToolCallBlock: ToolCallBlockStub,
  Download: true,
  Copy: true,
  Check: true,
  AlertCircle: true,
  AlertTriangle: true,
  Info: true,
  RotateCw: true,
  ChevronRight: true,
}

function makeAssistantMessage(extra: Partial<AiMessage> = {}): AiMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    ...extra,
  }
}

function makeUserMessage(extra: Partial<AiMessage> = {}): AiMessage {
  return {
    id: 'user-1',
    role: 'user',
    content: '帮我修改这个功能',
    timestamp: Date.now(),
    ...extra,
  }
}

function mockConfirm(value: boolean) {
  const confirmMock = vi.fn(() => value)
  Object.defineProperty(window, 'confirm', {
    value: confirmMock,
    configurable: true,
    writable: true,
  })
  return confirmMock
}

afterEach(() => {
  vi.restoreAllMocks()
})

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
        stubs: defaultStubs,
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
        stubs: defaultStubs,
      },
    })

    expect(wrapper.text()).toContain('需要先看文件。')
    expect(wrapper.text()).toContain('然后总结。')
    expect(wrapper.text()).not.toContain('DSML')
    expect(wrapper.text()).not.toContain('read_file')
  })

  it('translates internal plan approval message when rendering old history', () => {
    const wrapper = mount(AiMessageBubble, {
      props: {
        message: makeUserMessage({
          content: '[The user approved the execution plan. Continue with the approved steps and use tools when needed.]',
        }),
        sessionId: 'session-1',
      },
      global: {
        stubs: defaultStubs,
      },
    })

    expect(wrapper.text()).toContain('用户已确认执行计划')
    expect(wrapper.text()).toContain('必要时可以调用工具')
    expect(wrapper.text()).not.toContain('The user approved the execution plan')
  })

  it('translates old user rejected protocol message when rendering history', () => {
    const wrapper = mount(AiMessageBubble, {
      props: {
        message: makeAssistantMessage({
          content: '[user_rejected] User rejected edit_file.',
        }),
        sessionId: 'session-1',
      },
      global: {
        stubs: defaultStubs,
      },
    })

    expect(wrapper.text()).toContain('用户已拒绝')
    expect(wrapper.text()).toContain('用户拒绝执行 edit_file')
    expect(wrapper.text()).not.toContain('User rejected edit_file')
  })

  it('allows continue action for empty thinking stop errors', async () => {
    const wrapper = mount(AiMessageBubble, {
      props: {
        message: makeAssistantMessage({
          role: 'error',
          content: '[模型 thinking 后 stop 空回] finish_reason=stop。本轮未产出正文，已安全停止。',
        }),
        sessionId: 'session-1',
      },
      global: {
        stubs: defaultStubs,
      },
    })

    const continueButton = wrapper.findAll('button').find(button => button.text().includes('继续生成'))
    expect(continueButton?.exists()).toBe(true)

    await continueButton?.trigger('click')

    expect(wrapper.emitted('continue')).toHaveLength(1)
  })

  it('does not emit fork or rewind when user cancels confirmation', async () => {
    const confirmSpy = mockConfirm(false)
    const wrapper = mount(AiMessageBubble, {
      props: {
        message: makeUserMessage(),
        sessionId: 'session-1',
        stickyCompact: true,
      },
      global: {
        stubs: defaultStubs,
      },
    })

    await wrapper.find('[title="从这里创建分支会话"]').trigger('click')
    await wrapper.find('[title="回退到这里继续"]').trigger('click')

    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('fork')).toBeUndefined()
    expect(wrapper.emitted('rewind')).toBeUndefined()
  })

  it('emits fork and rewind only after user confirms', async () => {
    const confirmSpy = mockConfirm(true)
    const wrapper = mount(AiMessageBubble, {
      props: {
        message: makeUserMessage(),
        sessionId: 'session-1',
        stickyCompact: true,
      },
      global: {
        stubs: defaultStubs,
      },
    })

    await wrapper.find('[title="从这里创建分支会话"]').trigger('click')
    await wrapper.find('[title="回退到这里继续"]').trigger('click')

    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('fork')).toEqual([['user-1']])
    expect(wrapper.emitted('rewind')).toEqual([['user-1']])
  })

  it('confirms before rewinding an assistant message', async () => {
    const confirmSpy = mockConfirm(true)
    const wrapper = mount(AiMessageBubble, {
      props: {
        message: makeAssistantMessage({
          content: '这是 AI 回复',
        }),
        sessionId: 'session-1',
      },
      global: {
        stubs: defaultStubs,
      },
    })

    await wrapper.find('[title="回退到这里继续"]').trigger('click')

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('rewind')).toEqual([['assistant-1']])
  })

  it('renders long assistant markdown as a lightweight preview first', async () => {
    const longContent = Array.from({ length: 2400 }, (_, index) => `- item ${index}`).join('\n')
    const wrapper = mount(AiMessageBubble, {
      props: {
        message: makeAssistantMessage({ content: longContent }),
        sessionId: 'session-1',
      },
      global: {
        stubs: defaultStubs,
      },
    })

    expect(wrapper.text()).toContain('长回复已预览')
    expect(wrapper.text()).toContain('渲染完整内容')

    await wrapper.findAll('button').find(button => button.text().includes('渲染完整内容'))?.trigger('click')

    expect(wrapper.text()).toContain('已渲染完整长回复')
  })

  it('renders long streaming assistant content through a plain text window', () => {
    const longContent = [
      '开始',
      '```ts',
      'const shouldNotMountCodeBlock = true',
      '```',
      Array.from({ length: 1200 }, (_, index) => `streaming line ${index}`).join('\n'),
      '结束',
    ].join('\n')
    const wrapper = mount(AiMessageBubble, {
      props: {
        message: makeAssistantMessage({
          content: longContent,
          isStreaming: true,
        }),
        sessionId: 'session-1',
      },
      global: {
        stubs: defaultStubs,
      },
    })

    expect(wrapper.find('.streaming-text-window').exists()).toBe(true)
    expect(wrapper.text()).toContain('流式回复较长')
    expect(wrapper.text()).toContain('开始')
    expect(wrapper.text()).toContain('结束')
    expect(wrapper.findComponent({ name: 'AiCodeBlock' }).exists()).toBe(false)
  })

  it('loads full tool call cards in batches instead of mounting all at once', async () => {
    const toolCalls = Array.from({ length: 16 }, (_, index) => ({
      id: `tool-${index}`,
      name: 'bash',
      arguments: `{"command":"echo ${index}"}`,
      parsedArgs: { command: `echo ${index}` },
      status: 'success' as const,
      result: `ok ${index}`,
    }))
    const wrapper = mount(AiMessageBubble, {
      props: {
        message: makeAssistantMessage({
          content: 'done',
          toolCalls,
        }),
        sessionId: 'session-1',
      },
      global: {
        stubs: defaultStubs,
      },
    })

    expect(wrapper.findAll('.tool-call-stub')).toHaveLength(6)
    expect(wrapper.text()).toContain('还有 10 个工具详情未挂载')

    await wrapper.findAll('button').find(button => button.text().includes('继续加载详情'))?.trigger('click')

    expect(wrapper.findAll('.tool-call-stub')).toHaveLength(12)
    expect(wrapper.text()).toContain('还有 4 个工具详情未挂载')
  })

  it('promotes todo_write into a task panel instead of a generic tool card', () => {
    const wrapper = mount(AiMessageBubble, {
      props: {
        message: makeAssistantMessage({
          content: '计划如下',
          toolCalls: [
            {
              id: 'todo-1',
              name: 'todo_write',
              arguments: '{"todos":[]}',
              parsedArgs: {
                todos: [
                  { id: '1', content: '定位问题', activeForm: '正在定位问题', status: 'completed' },
                  { id: '2', content: '修复问题', activeForm: '正在修复问题', status: 'in_progress' },
                ],
              },
              status: 'success',
            },
          ],
        }),
        sessionId: 'session-1',
      },
      global: {
        stubs: defaultStubs,
      },
    })

    expect(wrapper.find('.todo-panel-stub').text()).toBe('todos:2')
    expect(wrapper.findAll('.tool-call-stub')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('Todo')
  })

  it('renders restored history tool summary as a user-readable card', () => {
    const wrapper = mount(AiMessageBubble, {
      props: {
        message: makeAssistantMessage({
          historyToolSummary: {
            callCount: 6,
            resultCount: 1,
            successCount: 1,
            errorCount: 0,
            pendingCount: 0,
            toolNames: ['todo_write', 'edit_file', 'read_file', 'search_files'],
            buckets: [
              {
                category: 'todo',
                label: '任务',
                count: 1,
                successCount: 0,
                errorCount: 0,
                pendingCount: 0,
                toolNames: ['todo_write'],
              },
              {
                category: 'write',
                label: '修改',
                count: 1,
                successCount: 0,
                errorCount: 0,
                pendingCount: 0,
                toolNames: ['edit_file'],
              },
              {
                category: 'read',
                label: '读取',
                count: 1,
                successCount: 1,
                errorCount: 0,
                pendingCount: 0,
                toolNames: ['read_file'],
              },
              {
                category: 'search',
                label: '搜索',
                count: 1,
                successCount: 0,
                errorCount: 0,
                pendingCount: 0,
                toolNames: ['search_files'],
              },
            ],
            hasWrite: true,
            hasCommand: false,
            hasFailure: false,
          },
        }),
        sessionId: 'session-1',
      },
      global: {
        stubs: defaultStubs,
      },
    })

    expect(wrapper.text()).toContain('之前执行过 6 个操作')
    expect(wrapper.text()).toContain('1 个结果，1 个成功')
    expect(wrapper.text()).toContain('任务计划')
    expect(wrapper.text()).toContain('修改文件')
    expect(wrapper.text()).toContain('读取文件')
    expect(wrapper.text()).toContain('搜索文件')
    expect(wrapper.text()).toContain('任务 1')
    expect(wrapper.text()).toContain('修改 1')
    expect(wrapper.text()).toContain('读取 1')
    expect(wrapper.text()).toContain('搜索 1')
    expect(wrapper.text()).not.toContain('历史工具调用已折叠')
  })
})
