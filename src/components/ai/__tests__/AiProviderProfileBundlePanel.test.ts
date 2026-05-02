import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AiProviderProfileBundlePanel from '@/components/ai/AiProviderProfileBundlePanel.vue'
import { useProviderProfileBundleStore } from '@/stores/provider-profile-bundle'
import type { ProviderConfig } from '@/types/ai'

vi.mock('@/api/provider-profile-bundle', () => ({
  createProviderProfileBundleSnapshot: (profiles: unknown[], backups: unknown[]) => ({
    profiles,
    backups,
    exportedAt: 1000,
    schemaVersion: 1,
  }),
  exportProviderProfileBundleSnapshot: (snapshot: unknown) => JSON.stringify(snapshot, null, 2),
  importProviderProfileBundleSnapshot: (raw: string) => JSON.parse(raw),
  loadProviderProfileBundleSnapshot: vi.fn(async () => null),
  saveProviderProfileBundleSnapshot: vi.fn(async () => undefined),
}))

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>()
  get length(): number { return this.data.size }
  clear(): void { this.data.clear() }
  getItem(key: string): string | null { return this.data.get(key) ?? null }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null }
  removeItem(key: string): void { this.data.delete(key) }
  setItem(key: string, value: string): void { this.data.set(key, value) }
}

function makeProvider(): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'OpenAI',
    providerType: 'openai_compat',
    endpoint: 'https://api.openai.com/v1',
    isDefault: true,
    createdAt: 1,
    models: [{
      id: 'gpt-5.4',
      name: 'GPT-5.4',
      capabilities: {
        streaming: true,
        vision: true,
        thinking: true,
        toolUse: true,
        maxContext: 1000000,
        maxOutput: 128000,
      },
    }],
  }
}

function makeFallbackProvider(): ProviderConfig {
  return {
    ...makeProvider(),
    id: 'provider-2',
    name: 'Fallback',
    isDefault: false,
    models: [{
      id: 'fallback-model',
      name: 'Fallback Model',
      capabilities: {
        streaming: true,
        vision: false,
        thinking: false,
        toolUse: true,
        maxContext: 128000,
        maxOutput: 8192,
      },
    }],
  }
}

const stubs = {
  Button: { template: '<button><slot /></button>' },
  Input: { props: ['modelValue'], emits: ['update:modelValue'], template: '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  Label: { template: '<label><slot /></label>' },
  Select: { template: '<div><slot /></div>' },
  SelectTrigger: { template: '<button><slot /></button>' },
  SelectValue: { template: '<span><slot /></span>' },
  SelectContent: { template: '<div><slot /></div>' },
  SelectItem: { template: '<button><slot /></button>' },
  Dialog: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
  DialogContent: { template: '<div><slot /></div>' },
  DialogHeader: { template: '<div><slot /></div>' },
  DialogTitle: { template: '<h2><slot /></h2>' },
  DialogFooter: { template: '<div><slot /></div>' },
  DialogDescription: { template: '<p><slot /></p>' },
}

describe('AiProviderProfileBundlePanel', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => undefined) } })
    vi.stubGlobal('confirm', vi.fn(() => true))
    setActivePinia(createPinia())
  })

  it('renders profile bundle controls and saves a profile', async () => {
    const wrapper = mount(AiProviderProfileBundlePanel, {
      props: {
        providers: [makeProvider()],
        currentProviderId: 'provider-1',
        currentModelId: 'gpt-5.4',
      },
      global: { stubs },
    })

    await wrapper.findAll('button').find(button => button.text().includes('保存 Profile'))!.trigger('click')

    const store = useProviderProfileBundleStore()
    expect(wrapper.text()).toContain('Provider Profile Bundle')
    expect(store.profiles).toHaveLength(1)
    expect(store.profiles[0]).toMatchObject({
      providerId: 'provider-1',
      modelId: 'gpt-5.4',
      gatewayPolicy: {
        fallbackEnabled: true,
        routingStrategy: 'default',
      },
    })
  })

  it('emits apply payload for a saved profile', async () => {
    const wrapper = mount(AiProviderProfileBundlePanel, {
      props: {
        providers: [makeProvider()],
        currentProviderId: 'provider-1',
        currentModelId: 'gpt-5.4',
      },
      global: { stubs },
    })

    await wrapper.findAll('button').find(button => button.text().includes('保存 Profile'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('应用'))!.trigger('click')

    expect(wrapper.emitted('apply')?.[0]?.[0]).toMatchObject({
      selectedProviderId: 'provider-1',
      selectedModelId: 'gpt-5.4',
      workspaceConfig: {
        preferredModel: 'gpt-5.4',
        gatewayPolicy: {
          fallbackEnabled: true,
          routingStrategy: 'default',
        },
      },
    })
  })

  it('shows gateway policy controls and includes policy in saved profile', async () => {
    const wrapper = mount(AiProviderProfileBundlePanel, {
      props: {
        providers: [makeProvider(), makeFallbackProvider()],
        currentProviderId: 'provider-1',
        currentModelId: 'gpt-5.4',
      },
      global: { stubs },
    })

    await wrapper.findAll('label').find(label => label.text().includes('provider-2'))!.find('input[type="checkbox"]').setValue(true)
    await wrapper.findAll('label').find(label => label.text().includes('启用 Profile 限流覆盖'))!.find('input[type="checkbox"]').setValue(true)
    const refreshedInputs = wrapper.findAll('input')
    await refreshedInputs.find(input => input.attributes('min') === '1000')!.setValue('30000')
    await refreshedInputs.find(input => input.attributes('min') === '1' && input.attributes('type') === 'number')!.setValue('5')
    await wrapper.findAll('button').find(button => button.text().includes('保存 Profile'))!.trigger('click')

    const store = useProviderProfileBundleStore()
    expect(wrapper.text()).toContain('Gateway 策略')
    expect(store.profiles[0]?.gatewayPolicy).toMatchObject({
      fallbackProviderIds: ['provider-2'],
      rateLimit: { windowMs: 30000, maxRequests: 5 },
    })
  })

  it('exports and imports profile json from the panel', async () => {
    const wrapper = mount(AiProviderProfileBundlePanel, {
      props: {
        providers: [makeProvider()],
        currentProviderId: 'provider-1',
        currentModelId: 'gpt-5.4',
      },
      global: { stubs },
    })

    await wrapper.findAll('button').find(button => button.text().includes('保存 Profile'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('导出'))!.trigger('click')

    expect(navigator.clipboard.writeText).toHaveBeenCalled()

    await wrapper.findAll('button').find(button => button.text().includes('导入'))!.trigger('click')
    const exported = String(vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0] ?? '')
    await wrapper.findAll('textarea').at(-1)!.setValue(exported)
    await wrapper.findAll('button').find(button => button.text().includes('确认导入'))!.trigger('click')

    expect(wrapper.text()).toContain('Profile JSON 已导入')
  })
})
