import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import AiPromptEnhancer from '@/components/ai/AiPromptEnhancer.vue'

const { optimizePromptMock, iteratePromptMock, getCredentialMock } = vi.hoisted(() => ({
  optimizePromptMock: vi.fn(),
  iteratePromptMock: vi.fn(),
  getCredentialMock: vi.fn(),
}))

const localePrefix = ref('')

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => `${localePrefix.value}${key}`,
  }),
}))

vi.mock('@/composables/ai/promptOptimizer', () => ({
  optimizePrompt: optimizePromptMock,
  iteratePrompt: iteratePromptMock,
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

const ButtonStub = defineComponent({
  name: 'ButtonStub',
  emits: ['click'],
  setup(_props, { slots, attrs, emit }) {
    return () => h('button', { ...attrs, onClick: () => emit('click') }, slots.default?.())
  },
})

const PassThroughStub = defineComponent({
  name: 'PassThroughStub',
  setup(_props, { slots, attrs }) {
    return () => h('div', attrs, slots.default?.())
  },
})

const TextareaStub = defineComponent({
  name: 'Textarea',
  props: {
    modelValue: { type: String, default: '' },
  },
  emits: ['update:modelValue'],
  setup(props, { attrs, emit }) {
    return () => h('textarea', {
      ...attrs,
      value: props.modelValue,
      onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLTextAreaElement).value),
    })
  },
})

function makeProvider() {
  return {
    id: 'provider-1',
    name: 'Provider 1',
    providerType: 'openai_compat',
    endpoint: 'https://api.example.com',
    models: [],
    isDefault: true,
    createdAt: 1,
  } as const
}

function makeModel() {
  return {
    id: 'model-1',
    name: 'Model 1',
    capabilities: {
      streaming: true,
      vision: false,
      thinking: false,
      toolUse: false,
      maxContext: 32000,
      maxOutput: 4096,
    },
  }
}

function mountEnhancer(props?: Partial<InstanceType<typeof AiPromptEnhancer>['$props']>) {
  return mount(AiPromptEnhancer, {
    props: {
      open: false,
      originalText: 'improve this prompt',
      provider: makeProvider(),
      model: makeModel(),
      ...props,
    },
    global: {
      stubs: {
        Dialog: DialogStub,
        DialogContent: PassThroughStub,
        DialogHeader: PassThroughStub,
        DialogTitle: PassThroughStub,
        Button: ButtonStub,
        Textarea: TextareaStub,
        Sparkles: true,
        Loader2: true,
        Check: true,
        X: true,
        RefreshCw: true,
      },
    },
  })
}

describe('AiPromptEnhancer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localePrefix.value = ''
    getCredentialMock.mockResolvedValue('secret')
    optimizePromptMock.mockImplementation(async (_input, options) => {
      options.onDelta?.('optimized prompt')
      return { text: 'optimized prompt', sessionId: 'session-1' }
    })
    iteratePromptMock.mockImplementation(async (_input, options) => {
      options.onDelta?.('iterated prompt')
      return { text: 'iterated prompt', sessionId: 'session-2' }
    })
  })

  it('shows localized missing-model error before requesting enhancement', async () => {
    const wrapper = mountEnhancer({ provider: null, model: null })

    await wrapper.setProps({ open: true })
    await Promise.resolve()

    expect(wrapper.text()).toContain('ai.promptEnhancer.selectModelFirst')
    expect(optimizePromptMock).not.toHaveBeenCalled()
  })

  it('starts one optimization request when opened with valid inputs', async () => {
    const wrapper = mountEnhancer()

    await wrapper.setProps({ open: true })
    await Promise.resolve()
    await Promise.resolve()

    expect(getCredentialMock).toHaveBeenCalledWith('ai-provider-provider-1')
    expect(optimizePromptMock).toHaveBeenCalledTimes(1)
    expect(optimizePromptMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'improve this prompt',
      providerType: 'openai_compat',
      model: 'model-1',
      apiKey: 'secret',
      endpoint: 'https://api.example.com',
      sessionId: expect.stringMatching(/^prompt-enhance-/),
      signal: expect.any(AbortSignal),
      templateId: 'general-optimize',
    }), expect.any(Object))
    expect(wrapper.text()).toContain('optimized prompt')
  })

  it('updates template labels when locale changes', async () => {
    const wrapper = mountEnhancer()

    await wrapper.setProps({ open: true })
    await Promise.resolve()
    await Promise.resolve()

    const select = wrapper.find('select')
    expect(select.text()).toContain('ai.promptEnhancer.templateGeneral')

    localePrefix.value = 'en:'
    await nextTick()

    expect(select.text()).toContain('en:ai.promptEnhancer.templateGeneral')
    expect(select.text()).toContain('en:ai.promptEnhancer.templateCode')
    expect(select.text()).toContain('en:ai.promptEnhancer.templateStructured')
    expect(select.text()).toContain('en:ai.promptEnhancer.templatePolish')
  })

  it('shows all supported template modes', async () => {
    const wrapper = mountEnhancer()

    await wrapper.setProps({ open: true })
    await Promise.resolve()
    await Promise.resolve()

    const select = wrapper.find('select')
    expect(select.exists()).toBe(true)
    expect(select.text()).toContain('ai.promptEnhancer.templateGeneral')
    expect(select.text()).toContain('ai.promptEnhancer.templateCode')
    expect(select.text()).toContain('ai.promptEnhancer.templateStructured')
    expect(select.text()).toContain('ai.promptEnhancer.templatePolish')
  })

  it('uses the selected template mode for first optimization', async () => {
    const wrapper = mountEnhancer()

    await wrapper.setProps({ open: true })
    await Promise.resolve()
    await Promise.resolve()

    const select = wrapper.find('select')
    expect(select.exists()).toBe(true)
    await select.setValue('code-optimize')
    const buttons = wrapper.findAll('button')
    await buttons[0]!.trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(optimizePromptMock).toHaveBeenLastCalledWith(expect.objectContaining({
      templateId: 'code-optimize',
    }), expect.any(Object))
  })

  it('does not request optimization when api key is missing', async () => {
    getCredentialMock.mockResolvedValue('')
    const wrapper = mountEnhancer()

    await wrapper.setProps({ open: true })
    await Promise.resolve()

    expect(wrapper.text()).toContain('ai.promptEnhancer.apiKeyMissing')
    expect(optimizePromptMock).not.toHaveBeenCalled()
  })

  it('aborts the active request when closed', async () => {
    let signal: AbortSignal | undefined
    optimizePromptMock.mockImplementation(async (input) => {
      signal = input.signal
      return new Promise(() => {})
    })
    const wrapper = mountEnhancer()

    await wrapper.setProps({ open: true })
    await Promise.resolve()
    await wrapper.setProps({ open: false })

    expect(signal?.aborted).toBe(true)
  })

  it('aborts previous request before a second runEnhance call', async () => {
    const signals: AbortSignal[] = []
    let resolveFirst: (() => void) | undefined
    optimizePromptMock.mockImplementation((input, options) => {
      signals.push(input.signal)
      const index = signals.length
      if (index === 1) {
        return new Promise((resolve) => {
          resolveFirst = () => resolve({ text: 'result-1', sessionId: input.sessionId })
        })
      }
      options.onDelta?.('result-2')
      return Promise.resolve({ text: 'result-2', sessionId: input.sessionId })
    })
    const wrapper = mountEnhancer()

    await wrapper.setProps({ open: true })
    await Promise.resolve()
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await Promise.resolve()
    resolveFirst?.()
    await Promise.resolve()

    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
    expect(optimizePromptMock).toHaveBeenCalledTimes(2)
  })

  it('ignores stale deltas from old requests', async () => {
    const deltaHandlers: Array<(delta: string) => void> = []
    optimizePromptMock.mockImplementation(async (_input, options) => {
      deltaHandlers.push(options.onDelta)
      return new Promise(() => {})
    })
    const wrapper = mountEnhancer()

    await wrapper.setProps({ open: true })
    await Promise.resolve()
    deltaHandlers[0]?.('old')
    await nextTick()
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await Promise.resolve()
    deltaHandlers[0]?.('-stale')
    deltaHandlers[1]?.('new')
    await nextTick()

    expect(wrapper.text()).toContain('new')
    expect(wrapper.text()).not.toContain('old-stale')
  })

  it('emits accept with enhanced text', async () => {
    const wrapper = mountEnhancer()

    await wrapper.setProps({ open: true })
    await Promise.resolve()
    await Promise.resolve()
    const buttons = wrapper.findAll('button')
    await buttons[buttons.length - 1]!.trigger('click')

    expect(wrapper.emitted('accept')?.[0]).toEqual(['optimized prompt'])
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('keeps current optimized text when iterate fails', async () => {
    iteratePromptMock.mockRejectedValue(new Error('iterate failed'))
    const wrapper = mountEnhancer()

    await wrapper.setProps({ open: true })
    await Promise.resolve()
    await Promise.resolve()
    await wrapper.find('textarea').setValue('make it shorter')
    const buttons = wrapper.findAll('button')
    await buttons[buttons.length - 2]!.trigger('click')
    await Promise.resolve()
    await Promise.resolve()
    await nextTick()

    expect(wrapper.text()).toContain('optimized prompt')
    expect(wrapper.text()).toContain('iterate failed')
  })
})
