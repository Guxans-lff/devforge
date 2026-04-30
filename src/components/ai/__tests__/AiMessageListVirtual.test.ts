import { mount } from '@vue/test-utils'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import AiMessageListVirtual from '@/components/ai/AiMessageListVirtual.vue'
import type { AiMessage } from '@/types/ai'

const scrollToIndexMock = vi.fn()

vi.mock('@tanstack/vue-virtual', () => ({
  useVirtualizer: (optionsRef: { value: { count: number } }) => ({
    value: {
      getVirtualItems: () =>
        Array.from({ length: optionsRef.value.count }, (_, index) => ({
          index,
          key: index,
          start: index * 100,
        })),
      getTotalSize: () => optionsRef.value.count * 100,
      measureElement: vi.fn(),
      scrollToIndex: scrollToIndexMock,
    },
  }),
}))

vi.mock('@/components/ai/AiMessageBubble.vue', () => ({
  default: defineComponent({
    name: 'AiMessageBubbleStub',
    props: {
      message: { type: Object, required: true },
    },
    emits: ['continue', 'bumpMaxOutput'],
    setup(props, { emit }) {
      return () =>
        h('div', { class: 'bubble-stub' }, [
          h('span', { class: 'message-id' }, (props.message as AiMessage).id),
          h('button', { class: 'continue-btn', onClick: () => emit('continue') }, 'continue'),
          h('button', { class: 'bump-btn', onClick: () => emit('bumpMaxOutput', 2048) }, 'bump'),
        ])
    },
  }),
}))

function makeMessage(id: string, role: AiMessage['role'], extra: Partial<AiMessage> = {}): AiMessage {
  return {
    id,
    role,
    content: `${role}-${id}`,
    timestamp: Date.now(),
    ...extra,
  }
}

describe('AiMessageListVirtual', () => {
  beforeEach(() => {
    scrollToIndexMock.mockClear()
  })

  it('renders messages and forwards bubble events', async () => {
    const wrapper = mount(AiMessageListVirtual, {
      props: {
        items: [
          { key: 'user-1', message: makeMessage('user-1', 'user') },
          { key: 'assistant-1', message: makeMessage('assistant-1', 'assistant') },
        ],
        sessionId: 'session-1',
      },
    })

    expect(wrapper.findAll('.bubble-stub')).toHaveLength(2)
    expect(wrapper.findAll('.message-id').map(node => node.text())).toEqual(['user-1', 'assistant-1'])

    await wrapper.find('.continue-btn').trigger('click')
    await wrapper.find('.bump-btn').trigger('click')

    expect(wrapper.emitted('continue')).toHaveLength(1)
    expect(wrapper.emitted('bumpMaxOutput')?.[0]).toEqual([2048])
  })

  it('shows history load button for divider windows and emits loadMoreHistory', async () => {
    const wrapper = mount(AiMessageListVirtual, {
      props: {
        items: [
          {
            key: 'divider-1',
            message: makeMessage('history-window-1', 'assistant', {
              type: 'divider',
              dividerMeta: {
                kind: 'history-window',
                loadedRecords: 300,
                totalRecords: 700,
                remainingRecords: 400,
              },
            }),
          },
        ],
        canLoadMoreHistory: true,
        historyRemainingRecords: 400,
      },
    })

    expect(wrapper.text()).toContain('ai.history.windowLoaded')
    expect(wrapper.text()).toContain('ai.history.loadMore')

    const button = wrapper.find('button')
    expect(button.exists()).toBe(true)

    await button.trigger('click')
    expect(wrapper.emitted('loadMoreHistory')).toHaveLength(1)
  })

  it('disables the history load button while loading more records', () => {
    const wrapper = mount(AiMessageListVirtual, {
      props: {
        items: [
          {
            key: 'divider-1',
            message: makeMessage('history-window-1', 'assistant', {
              type: 'divider',
              dividerMeta: {
                kind: 'history-window',
                loadedRecords: 300,
                totalRecords: 700,
                remainingRecords: 400,
              },
            }),
          },
        ],
        canLoadMoreHistory: true,
        historyRemainingRecords: 400,
        historyLoadMorePending: true,
      },
    })

    const button = wrapper.find('button')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.text()).toContain('ai.history.loadingMore')
  })

  it('shows a localized error hint when loading earlier history fails', () => {
    const wrapper = mount(AiMessageListVirtual, {
      props: {
        items: [
          {
            key: 'divider-1',
            message: makeMessage('history-window-1', 'assistant', {
              type: 'divider',
              dividerMeta: {
                kind: 'history-window',
                loadedRecords: 300,
                totalRecords: 700,
                remainingRecords: 400,
              },
            }),
          },
        ],
        canLoadMoreHistory: true,
        historyRemainingRecords: 400,
        historyLoadMoreError: 'load more failed',
      },
    })

    expect(wrapper.text()).toContain('ai.history.loadMoreFailed')
  })

  it('does not render the sticky compact bubble while the latest user item is still visible', () => {
    const wrapper = mount(AiMessageListVirtual, {
      props: {
        items: [
          { key: 'user-1', message: makeMessage('user-1', 'user'), stickyCompact: true },
          { key: 'assistant-1', message: makeMessage('assistant-1', 'assistant') },
        ],
      },
    })

    expect(wrapper.findAll('.bubble-stub')).toHaveLength(2)
    expect(wrapper.findAll('.message-id').map(node => node.text())).toContain('user-1')
  })

  it('renders the sticky compact bubble after scrolling past the latest user item', async () => {
    const wrapper = mount(AiMessageListVirtual, {
      attachTo: document.body,
      props: {
        items: [
          { key: 'user-1', message: makeMessage('user-1', 'user'), stickyCompact: true },
          { key: 'assistant-1', message: makeMessage('assistant-1', 'assistant') },
        ],
      },
    })

    const container = wrapper.find('.min-h-0.flex-1.overflow-y-auto').element as HTMLDivElement
    container.scrollTop = 120
    await wrapper.find('.min-h-0.flex-1.overflow-y-auto').trigger('scroll')
    await nextTick()

    expect(wrapper.findAll('.bubble-stub')).toHaveLength(3)
  })

  it('exposes scrollToBottom and scrollContainer', async () => {
    const wrapper = mount(AiMessageListVirtual, {
      attachTo: document.body,
      props: {
        items: [
          { key: 'assistant-1', message: makeMessage('assistant-1', 'assistant') },
        ],
      },
    })

    const exposed = wrapper.vm as InstanceType<typeof AiMessageListVirtual>
    const container = exposed.scrollContainer as HTMLElement | null
    expect(container).not.toBeNull()

    if (!container) return

    Object.defineProperty(container, 'scrollHeight', {
      value: 640,
      configurable: true,
    })
    container.scrollTop = 0

    exposed.scrollToBottom()
    await nextTick()
    await new Promise(resolve => requestAnimationFrame(resolve))

    expect(scrollToIndexMock).toHaveBeenCalledWith(0, { align: 'end' })
    expect(scrollToIndexMock).toHaveBeenCalledTimes(2)
  })
})
