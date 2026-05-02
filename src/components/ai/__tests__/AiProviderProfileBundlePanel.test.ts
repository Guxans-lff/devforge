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

function makeWeakFallbackProvider(): ProviderConfig {
  return {
    ...makeProvider(),
    id: 'provider-weak',
    name: 'Weak Fallback',
    isDefault: false,
    models: [{
      id: 'weak-model',
      name: 'Weak Model',
      capabilities: {
        streaming: false,
        vision: false,
        thinking: false,
        toolUse: false,
        maxContext: 4096,
        maxOutput: 1024,
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

  it('asks confirmation before applying risky profile and can cancel', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
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

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('应用该 Profile 会带来以下风险'))
    expect(wrapper.emitted('apply')).toBeUndefined()
    expect(wrapper.text()).toContain('已取消应用 Profile')
  })

  it('applies risky profile after confirmation', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
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

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('当前只有一个 Provider'))
    expect(wrapper.emitted('apply')).toHaveLength(1)
  })

  it('warns before applying when form has unsaved changes', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const wrapper = mount(AiProviderProfileBundlePanel, {
      props: {
        providers: [makeProvider(), makeFallbackProvider()],
        currentProviderId: 'provider-1',
        currentModelId: 'gpt-5.4',
      },
      global: { stubs },
    })

    await wrapper.findAll('label').find(label => label.text().includes('provider-2'))!.find('input[type="checkbox"]').setValue(true)
    await wrapper.findAll('button').find(button => button.text().includes('保存 Profile'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('清空，改为自动选择'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('应用'))!.trigger('click')

    expect(wrapper.text()).toContain('有未保存改动，应用前请先保存')
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('当前表单存在未保存改动'))
    expect(wrapper.emitted('apply')).toBeUndefined()
  })

  it('asks confirmation before creating new profile with unsaved changes', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const wrapper = mount(AiProviderProfileBundlePanel, {
      props: {
        providers: [makeProvider(), makeFallbackProvider()],
        currentProviderId: 'provider-1',
        currentModelId: 'gpt-5.4',
      },
      global: { stubs },
    })

    await wrapper.findAll('label').find(label => label.text().includes('provider-2'))!.find('input[type="checkbox"]').setValue(true)
    await wrapper.findAll('button').find(button => button.text().includes('保存 Profile'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('清空，改为自动选择'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('新建'))!.trigger('click')

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('新建 Profile会丢弃这些改动'))
    expect(wrapper.text()).toContain('已取消新建 Profile')
  })

  it('asks confirmation before switching profile with unsaved changes', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const wrapper = mount(AiProviderProfileBundlePanel, {
      props: {
        providers: [makeProvider(), makeFallbackProvider()],
        currentProviderId: 'provider-1',
        currentModelId: 'gpt-5.4',
      },
      global: { stubs },
    })

    await wrapper.findAll('label').find(label => label.text().includes('provider-2'))!.find('input[type="checkbox"]').setValue(true)
    await wrapper.findAll('button').find(button => button.text().includes('保存 Profile'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('新建'))!.trigger('click')
    await wrapper.findAll('input').find(input => input.attributes('placeholder')?.includes('例如：主力编码配置'))!.setValue('第二个 Profile')
    await wrapper.findAll('button').find(button => button.text().includes('保存 Profile'))!.trigger('click')
    await wrapper.findAll('label').find(label => label.text().includes('provider-2'))!.find('input[type="checkbox"]').setValue(true)
    await wrapper.findAll('button').find(button => button.text().includes('OpenAI / GPT-5.4') && button.text().includes('provider-1 / gpt-5.4'))!.trigger('click')

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('切换 Profile会丢弃这些改动'))
    expect(wrapper.text()).toContain('已取消切换 Profile')
  })

  it('keeps preview dialog open when preview apply is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const wrapper = mount(AiProviderProfileBundlePanel, {
      props: {
        providers: [makeProvider()],
        currentProviderId: 'provider-1',
        currentModelId: 'gpt-5.4',
      },
      global: { stubs },
    })

    await wrapper.findAll('button').find(button => button.text().includes('保存 Profile'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('预览'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('应用 Profile'))!.trigger('click')

    expect(wrapper.text()).toContain('Profile 应用预览')
    expect(wrapper.text()).toContain('已取消应用 Profile')
    expect(wrapper.emitted('apply')).toBeUndefined()
  })

  it('closes preview dialog after confirmed preview apply', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const wrapper = mount(AiProviderProfileBundlePanel, {
      props: {
        providers: [makeProvider()],
        currentProviderId: 'provider-1',
        currentModelId: 'gpt-5.4',
      },
      global: { stubs },
    })

    await wrapper.findAll('button').find(button => button.text().includes('保存 Profile'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('预览'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('应用 Profile'))!.trigger('click')

    expect(wrapper.text()).not.toContain('Profile 应用预览')
    expect(wrapper.emitted('apply')).toHaveLength(1)
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

  it('shows gateway policy risks before saving profile', async () => {
    const wrapper = mount(AiProviderProfileBundlePanel, {
      props: {
        providers: [makeProvider(), makeWeakFallbackProvider()],
        currentProviderId: 'provider-1',
        currentModelId: 'gpt-5.4',
      },
      global: { stubs },
    })

    const advancedInput = wrapper.findAll('input')
      .find(input => input.attributes('placeholder')?.includes('高级：手动填写 Provider ID'))!
    await advancedInput.setValue('provider-1, provider-weak, provider-missing')
    await wrapper.findAll('label').find(label => label.text().includes('启用 Profile 限流覆盖'))!.find('input[type="checkbox"]').setValue(true)
    const refreshedInputs = wrapper.findAll('input')
    await refreshedInputs.find(input => input.attributes('min') === '1000')!.setValue('5000')
    await refreshedInputs.find(input => input.attributes('min') === '1' && input.attributes('type') === 'number')!.setValue('100')

    expect(wrapper.text()).toContain('Fallback Provider 不存在：provider-missing')
    expect(wrapper.text()).toContain('Fallback 列表包含当前主 Provider')
    expect(wrapper.text()).toContain('Fallback Provider 模型能力可能不足：Weak Fallback')
    expect(wrapper.text()).toContain('Profile 限流窗口较短且请求数偏高')
  })

  it('asks confirmation before deleting profile', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const wrapper = mount(AiProviderProfileBundlePanel, {
      props: {
        providers: [makeProvider()],
        currentProviderId: 'provider-1',
        currentModelId: 'gpt-5.4',
      },
      global: { stubs },
    })

    await wrapper.findAll('button').find(button => button.text().includes('保存 Profile'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('删除'))!.trigger('click')

    const store = useProviderProfileBundleStore()
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('确认删除 Profile'))
    expect(store.profiles).toHaveLength(1)
    expect(wrapper.text()).toContain('已取消删除 Profile')
  })

  it('deletes profile after confirmation', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const wrapper = mount(AiProviderProfileBundlePanel, {
      props: {
        providers: [makeProvider()],
        currentProviderId: 'provider-1',
        currentModelId: 'gpt-5.4',
      },
      global: { stubs },
    })

    await wrapper.findAll('button').find(button => button.text().includes('保存 Profile'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('删除'))!.trigger('click')

    const store = useProviderProfileBundleStore()
    expect(store.profiles).toHaveLength(0)
    expect(wrapper.text()).toContain('Profile 已删除')
  })

  it('asks confirmation before rolling back profile', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const wrapper = mount(AiProviderProfileBundlePanel, {
      props: {
        providers: [makeProvider()],
        currentProviderId: 'provider-1',
        currentModelId: 'gpt-5.4',
      },
      global: { stubs },
    })

    await wrapper.findAll('button').find(button => button.text().includes('保存 Profile'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('备份'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('回滚'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('manual'))!.trigger('click')

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('确认回滚 Profile'))
    expect(wrapper.text()).toContain('已取消回滚 Profile')
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
