import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AiProviderProfileBundlePanel from '@/components/ai/AiProviderProfileBundlePanel.vue'
import { useProviderProfileBundleStore } from '@/stores/provider-profile-bundle'
import type { ProviderConfig } from '@/types/ai'

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

const stubs = {
  Button: { template: '<button><slot /></button>' },
  Input: { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
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
      },
    })
  })
})
