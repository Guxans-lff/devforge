import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import AiFeatureGateSettings from '@/components/ai/AiFeatureGateSettings.vue'
import { useAiFeatureGateStore } from '@/stores/ai-feature-gate'

vi.mock('@/api/feature-gate', () => ({
  readFeatureGates: vi.fn().mockResolvedValue([]),
  writeFeatureGate: vi.fn().mockResolvedValue(undefined),
  deleteFeatureGate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/api/ai', () => ({
  aiReadWorkspaceConfig: vi.fn().mockResolvedValue('{}'),
  aiWriteWorkspaceConfig: vi.fn().mockResolvedValue(undefined),
}))

const IconStub = defineComponent({
  name: 'IconStub',
  setup() {
    return () => h('span')
  },
})

describe('AiFeatureGateSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function mountComponent(props: { scope?: 'local' | 'workspace'; workDir?: string } = {}) {
    return mount(AiFeatureGateSettings, {
      props,
      global: {
        stubs: {
          ToggleLeft: IconStub,
          ToggleRight: IconStub,
          Info: IconStub,
          RotateCcw: IconStub,
        },
      },
    })
  }

  it('renders gates with source labels', () => {
    const wrapper = mountComponent({ scope: 'workspace', workDir: 'D:/Project/devforge' })

    expect(wrapper.text()).toContain('Strict Permission Mode')
    expect(wrapper.text()).toContain('项目覆盖')
    expect(wrapper.text()).toContain('默认')
  })

  it('sets workspace override when toggled', async () => {
    const store = useAiFeatureGateStore()
    const setWorkspace = vi.spyOn(store, 'setWorkspace').mockResolvedValue(undefined)
    const wrapper = mountComponent({ scope: 'workspace', workDir: 'D:/Project/devforge' })

    await wrapper.findAll('button')[0]?.trigger('click')

    expect(setWorkspace).toHaveBeenCalledWith('ai.compact.v2', false, 'D:/Project/devforge')
  })

  it('sets local override when scope is local', async () => {
    const store = useAiFeatureGateStore()
    const setLocal = vi.spyOn(store, 'setLocal').mockResolvedValue(undefined)
    const wrapper = mountComponent({ scope: 'local' })

    await wrapper.findAll('button')[0]?.trigger('click')

    expect(setLocal).toHaveBeenCalledWith('ai.compact.v2', false)
  })

  it('disables workspace editing without workDir', async () => {
    const store = useAiFeatureGateStore()
    const setWorkspace = vi.spyOn(store, 'setWorkspace').mockResolvedValue(undefined)
    const wrapper = mountComponent({ scope: 'workspace', workDir: '' })

    expect(wrapper.text()).toContain('未选择工作目录')
    await wrapper.findAll('button')[0]?.trigger('click')

    expect(setWorkspace).not.toHaveBeenCalled()
  })
})
