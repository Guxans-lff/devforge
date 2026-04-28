import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import AiSessionDrawer from '@/components/ai/AiSessionDrawer.vue'

const SheetStub = defineComponent({
  name: 'Sheet',
  props: {
    open: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:open'],
  setup(_props, { slots }) {
    return () => h('div', { class: 'sheet-stub' }, slots.default?.())
  },
})

const PassThroughStub = defineComponent({
  name: 'PassThroughStub',
  setup(_props, { slots, attrs }) {
    return () => h('div', attrs, slots.default?.())
  },
})

const InputStub = defineComponent({
  name: 'Input',
  props: {
    modelValue: {
      type: String,
      default: '',
    },
    placeholder: {
      type: String,
      default: '',
    },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('input', {
      class: 'input-stub',
      value: props.modelValue,
      placeholder: props.placeholder,
      onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value),
    })
  },
})

describe('AiSessionDrawer', () => {
  it('does not preload sessions when the drawer opens', async () => {
    vi.setSystemTime(new Date('2026-04-21T10:00:00Z'))

    const wrapper = mount(AiSessionDrawer, {
      props: {
        open: false,
        activeSessionId: 'session-1',
        sessions: [
          {
            id: 'session-1',
            title: 'Active task',
            providerId: 'provider-1',
            model: 'gpt-5',
            messageCount: 1,
            totalTokens: 0,
            estimatedCost: 0,
            createdAt: Date.now() - 30_000,
            updatedAt: Date.now() - 30_000,
          },
          {
            id: 'session-2',
            title: 'Newest other task',
            providerId: 'provider-1',
            model: 'gpt-5',
            messageCount: 1,
            totalTokens: 0,
            estimatedCost: 0,
            createdAt: Date.now() - 60_000,
            updatedAt: Date.now() - 60_000,
          },
          {
            id: 'session-3',
            title: 'Second recent task',
            providerId: 'provider-1',
            model: 'gpt-5',
            messageCount: 1,
            totalTokens: 0,
            estimatedCost: 0,
            createdAt: Date.now() - 120_000,
            updatedAt: Date.now() - 120_000,
          },
          {
            id: 'session-4',
            title: 'Third recent task',
            providerId: 'provider-1',
            model: 'gpt-5',
            messageCount: 1,
            totalTokens: 0,
            estimatedCost: 0,
            createdAt: Date.now() - 180_000,
            updatedAt: Date.now() - 180_000,
          },
          {
            id: 'session-5',
            title: 'Older task',
            providerId: 'provider-1',
            model: 'gpt-5',
            messageCount: 1,
            totalTokens: 0,
            estimatedCost: 0,
            createdAt: Date.now() - 240_000,
            updatedAt: Date.now() - 240_000,
          },
        ],
      },
      global: {
        stubs: {
          Sheet: SheetStub,
          SheetContent: PassThroughStub,
          SheetHeader: PassThroughStub,
          SheetTitle: PassThroughStub,
          SheetDescription: PassThroughStub,
          Input: InputStub,
          Button: PassThroughStub,
          ScrollArea: PassThroughStub,
          MessageSquare: true,
          Trash2: true,
          Search: true,
          Plus: true,
        },
      },
    })

    await wrapper.setProps({ open: true })

    expect(wrapper.emitted('preload')).toBeUndefined()
  })

  it('filters sessions and emits select/delete actions', async () => {
    vi.setSystemTime(new Date('2026-04-21T10:00:00Z'))

    const wrapper = mount(AiSessionDrawer, {
      props: {
        open: true,
        activeSessionId: 'session-1',
        sessions: [
          {
            id: 'session-1',
            title: 'Alpha task',
            providerId: 'provider-1',
            model: 'gpt-5',
            messageCount: 1,
            totalTokens: 0,
            estimatedCost: 0,
            createdAt: Date.now() - 60_000,
            updatedAt: Date.now() - 60_000,
          },
          {
            id: 'session-2',
            title: 'Beta task',
            providerId: 'provider-1',
            model: 'gpt-5',
            messageCount: 1,
            totalTokens: 0,
            estimatedCost: 0,
            createdAt: Date.now() - 3_600_000,
            updatedAt: Date.now() - 3_600_000,
          },
        ],
      },
      global: {
        stubs: {
          Sheet: SheetStub,
          SheetContent: PassThroughStub,
          SheetHeader: PassThroughStub,
          SheetTitle: PassThroughStub,
          SheetDescription: PassThroughStub,
          Input: InputStub,
          Button: PassThroughStub,
          ScrollArea: PassThroughStub,
          MessageSquare: true,
          Trash2: true,
          Search: true,
          Plus: true,
        },
      },
    })

    const sessionButtons = wrapper.findAll('button').filter(button => button.text().includes('task'))
    await sessionButtons[0]!.trigger('mouseenter')
    expect(wrapper.emitted('preload')).toBeUndefined()

    await sessionButtons[0]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['session-1']])

    const deleteButtons = wrapper.findAll('button').filter(button => button.attributes('title') === 'ai.sessions.deleteSession')
    await deleteButtons[1]!.trigger('click')

    expect(wrapper.text()).toContain('ai.sessions.confirmDelete')

    const confirmButton = wrapper.findAll('button').filter(button => button.text().includes('ai.sessions.confirmDelete')).at(-1)
    await confirmButton!.trigger('click')
    expect(wrapper.emitted('delete')).toEqual([['session-2']])

    await wrapper.find('.input-stub').setValue('missing')
    expect(wrapper.text()).toContain('ai.sessions.emptySearch')
  })
})
