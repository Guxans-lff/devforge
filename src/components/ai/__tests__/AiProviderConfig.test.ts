import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import AiProviderConfig from '@/components/ai/AiProviderConfig.vue'
import { useAiChatStore } from '@/stores/ai-chat'
import { getCredential } from '@/api/connection'
import { aiListProviderModels } from '@/api/ai'

vi.mock('@/api/ai', () => ({
  aiListProviderModels: vi.fn(),
}))

vi.mock('@/api/connection', () => ({
  getCredential: vi.fn(),
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
          RefreshCw: true,
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
    expect(wrapper.text()).toContain('Kimi Code')
    expect(wrapper.text()).toContain('Kimi 编程专用模型')
    expect(wrapper.text()).toContain('Xiaomi MiMo')
    expect(wrapper.text()).not.toContain('Moonshot')
    expect(wrapper.text()).not.toContain('api.moonshot.cn')
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

  it('loads full API key and upgrades DeepSeek models when editing provider', async () => {
    setActivePinia(createPinia())
    vi.mocked(getCredential).mockResolvedValue('sk-full-secret')

    const store = useAiChatStore()
    store.providers = [{
      id: 'deepseek-provider',
      name: 'DeepSeek',
      providerType: 'openai_compat',
      endpoint: 'https://api.deepseek.com',
      isDefault: true,
      createdAt: 1,
      models: [{
        id: 'deepseek-chat',
        name: 'DeepSeek V3',
        capabilities: {
          streaming: true,
          vision: false,
          thinking: false,
          toolUse: true,
          maxContext: 65536,
          maxOutput: 8192,
        },
      }],
    }]

    const wrapper = mountComponent()
    await wrapper.get('button[title="common.edit"]').trigger('click')
    await vi.dynamicImportSettled()

    expect(getCredential).toHaveBeenCalledWith('ai-provider-deepseek-provider')
    expect(wrapper.html()).toContain('sk-full-secret')
    const dialog = wrapper.findAll('div').find(node =>
      node.text().includes('ai.providerConfig.sections.models (2)'),
    )
    expect(dialog?.text()).toContain('DeepSeek V4 Flash')
    expect(dialog?.text()).toContain('DeepSeek V4 Pro')
    expect(dialog?.text()).toContain('1000K')
  })

  it('syncs remote DeepSeek models with full key and local capability mapping', async () => {
    setActivePinia(createPinia())
    vi.mocked(getCredential).mockResolvedValue('sk-full-secret')
    vi.mocked(aiListProviderModels).mockResolvedValue({
      models: [
        { id: 'deepseek-v4-flash' },
        { id: 'deepseek-v4-pro' },
      ],
    })

    const store = useAiChatStore()
    store.providers = [{
      id: 'deepseek-provider',
      name: 'DeepSeek',
      providerType: 'anthropic',
      endpoint: 'https://api.deepseek.com/anthropic',
      isDefault: true,
      createdAt: 1,
      models: [],
    }]

    const wrapper = mountComponent()
    await wrapper.get('button[title="common.edit"]').trigger('click')
    await vi.dynamicImportSettled()

    const syncButton = wrapper.findAll('button').find(button => button.text().includes('同步'))
    expect(syncButton).toBeTruthy()
    await syncButton?.trigger('click')
    await vi.dynamicImportSettled()

    expect(aiListProviderModels).toHaveBeenCalledWith('https://api.deepseek.com/anthropic', 'sk-full-secret')
    expect(wrapper.text()).toContain('DeepSeek V4 Flash')
    expect(wrapper.text()).toContain('DeepSeek V4 Flash')
    expect(wrapper.text()).toContain('DeepSeek V4 Pro')
    expect(wrapper.text()).toContain('1000K')
    expect(wrapper.text()).toContain('ai.providerConfig.capabilities.thinking')
    expect(wrapper.text()).toContain('ai.providerConfig.capabilities.tools')
  })

  it('syncs Xiaomi MiMo models with official capability mapping', async () => {
    setActivePinia(createPinia())
    vi.mocked(getCredential).mockResolvedValue('mimo-full-secret')
    vi.mocked(aiListProviderModels).mockResolvedValue({
      models: [
        { id: 'mimo-v2.5-pro' },
        { id: 'mimo-v2.5' },
        { id: 'mimo-v2-flash' },
      ],
    })

    const store = useAiChatStore()
    store.providers = [{
      id: 'mimo-provider',
      name: 'Xiaomi MiMo',
      providerType: 'openai_compat',
      endpoint: 'https://api.xiaomimimo.com/v1',
      isDefault: true,
      createdAt: 1,
      models: [],
    }]

    const wrapper = mountComponent()
    await wrapper.get('button[title="common.edit"]').trigger('click')
    await vi.dynamicImportSettled()

    const syncButton = wrapper.findAll('button').find(button => button.text().includes('同步'))
    expect(syncButton).toBeTruthy()
    await syncButton?.trigger('click')
    await vi.dynamicImportSettled()

    expect(aiListProviderModels).toHaveBeenCalledWith('https://api.xiaomimimo.com/v1', 'mimo-full-secret')
    expect(wrapper.text()).toContain('MiMo V2.5 Pro')
    expect(wrapper.text()).toContain('MiMo V2.5')
    expect(wrapper.text()).toContain('MiMo V2 Flash')
    expect(wrapper.text()).toContain('1000K')
    expect(wrapper.text()).toContain('256K')
  })

  it('renders structured model sync errors as readable messages', async () => {
    setActivePinia(createPinia())
    vi.mocked(getCredential).mockResolvedValue('mimo-full-secret')
    vi.mocked(aiListProviderModels).mockRejectedValue({
      kind: 'CONNECTION',
      message: '拉取模型列表失败: unauthorized (401)',
      retryable: true,
    })

    const store = useAiChatStore()
    store.providers = [{
      id: 'mimo-provider',
      name: 'Xiaomi MiMo',
      providerType: 'openai_compat',
      endpoint: 'https://token-plan-cn.xiaomimimo.com/v1',
      isDefault: true,
      createdAt: 1,
      models: [],
    }]

    const wrapper = mountComponent()
    await wrapper.get('button[title="common.edit"]').trigger('click')
    await vi.dynamicImportSettled()

    const syncButton = wrapper.findAll('button').find(button => button.text().includes('同步'))
    await syncButton?.trigger('click')
    await vi.dynamicImportSettled()

    expect(wrapper.text()).toContain('拉取模型列表失败: unauthorized (401)')
    expect(wrapper.text()).not.toContain('[object Object]')
  })

  it('uses full capability defaults for manually added models', async () => {
    setActivePinia(createPinia())
    const store = useAiChatStore()
    store.providers = []

    const wrapper = mountComponent()

    expect(wrapper.text()).toContain('ai.providerConfig.sections.modelCapabilities')
  })
})
