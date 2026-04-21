import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import AiPromptEnhancer from '@/components/ai/AiPromptEnhancer.vue'

const { aiChatStreamMock, getCredentialMock } = vi.hoisted(() => ({
  aiChatStreamMock: vi.fn(),
  getCredentialMock: vi.fn(),
}))

vi.mock('@/api/ai', () => ({
  aiChatStream: aiChatStreamMock,
}))

vi.mock('@/api/connection', () => ({
  getCredential: getCredentialMock,
}))

const DialogStub = defineComponent({
  name: 'Dialog',
  props: { open: { type: Boolean, default: false } },
  emits: ['update:open'],
  setup(_props, { slots }) {
    return () => h('div', { class: 'dialog-stub' }, slots.default?.())
  },
})

const PassThroughStub = defineComponent({
  name: 'PassThroughStub',
  setup(_props, { slots, attrs }) {
    return () => h('div', attrs, slots.default?.())
  },
})

describe('AiPromptEnhancer', () => {
  it('shows localized missing-model error before requesting enhancement', async () => {
    const wrapper = mount(AiPromptEnhancer, {
      props: {
        open: false,
        originalText: 'improve this prompt',
        provider: null,
        model: null,
      },
      global: {
        stubs: {
          Dialog: DialogStub,
          DialogContent: PassThroughStub,
          DialogHeader: PassThroughStub,
          DialogTitle: PassThroughStub,
          Button: PassThroughStub,
          Sparkles: true,
          Loader2: true,
          Check: true,
          X: true,
          RefreshCw: true,
        },
      },
    })

    await wrapper.setProps({ open: true })
    await Promise.resolve()

    expect(wrapper.text()).toContain('ai.promptEnhancer.selectModelFirst')
    expect(aiChatStreamMock).not.toHaveBeenCalled()
  })
})
