import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import AiProviderConfig from '@/components/ai/AiProviderConfig.vue'
import { useAiChatStore } from '@/stores/ai-chat'

vi.mock('@/api/connection', () => ({
  saveCredential: vi.fn(),
}))

const ButtonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  setup(_props, { slots, attrs, emit }) {
    return () => h('button', {
      ...attrs,
      onClick: (event: MouseEvent) => emit('click', event),
    }, slots.default?.())
  },
})

const PassThroughStub = defineComponent({
  name: 'PassThroughStub',
  setup(_props, { slots, attrs }) {
    return () => h('div', attrs, slots.default?.())
  },
})

describe('AiProviderConfig', () => {
  function mountComponent() {
    return mount(AiProviderConfig, {
      global: {
        stubs: {
          Button: ButtonStub,
          Input: PassThroughStub,
          Label: PassThroughStub,
          Switch: PassThroughStub,
          ScrollArea: PassThroughStub,
          Badge: PassThroughStub,
          Select: PassThroughStub,
          SelectContent: PassThroughStub,
          SelectItem: PassThroughStub,
          SelectTrigger: PassThroughStub,
          SelectValue: PassThroughStub,
          Dialog: PassThroughStub,
          DialogContent: PassThroughStub,
          DialogHeader: PassThroughStub,
          DialogTitle: PassThroughStub,
          DialogFooter: PassThroughStub,
          DialogDescription: PassThroughStub,
          ArrowLeft: true,
          Plus: true,
          Pencil: true,
          Trash2: true,
          Star: true,
          Eye: true,
          EyeOff: true,
          X: true,
          Check: true,
          Cpu: true,
          Zap: true,
          Globe: true,
          Wrench: true,
          Brain: true,
          ImageIcon: true,
          Shield: true,
        },
      },
    })
  }

  it('renders localized provider config labels', () => {
    setActivePinia(createPinia())
    const store = useAiChatStore()
    store.providers = []

    const wrapper = mountComponent()

    expect(wrapper.text()).toContain('ai.providerConfig.title')
    expect(wrapper.text()).toContain('ai.providerConfig.subtitle')
    expect(wrapper.text()).toContain('ai.providerConfig.addTitle')
    expect(wrapper.text()).toContain('ai.providerConfig.workspaceDispatcher.title')
    expect(wrapper.text()).toContain('ai.providerConfig.workspaceDispatcher.fields.maxParallel')
    expect(wrapper.text()).toContain('ai.providerConfig.workspaceDispatcher.fields.defaultMode')
    expect(wrapper.text()).toContain('ai.providerConfig.presets.custom.name')
    expect(wrapper.text()).toContain('ai.providerConfig.presets.custom.description')
  })

  it('saves dispatcher defaults to the current workspace config', async () => {
    setActivePinia(createPinia())
    const store = useAiChatStore()
    store.providers = []
    store.currentWorkDir = 'D:/Project/devforge'
    const saveWorkspaceConfig = vi.spyOn(store, 'saveWorkspaceConfig').mockResolvedValue(undefined)

    const wrapper = mountComponent()
    const saveButton = wrapper.findAll('button').find(button =>
      button.text().includes('ai.providerConfig.workspaceDispatcher.save'),
    )

    expect(saveButton).toBeTruthy()
    await saveButton?.trigger('click')

    expect(saveWorkspaceConfig).toHaveBeenCalledWith('D:/Project/devforge', {
      dispatcherMaxParallel: 3,
      dispatcherAutoRetryCount: 1,
      dispatcherDefaultMode: 'headless',
    })
  })
})
