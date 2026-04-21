import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import AiMemoryDrawer from '@/components/ai/AiMemoryDrawer.vue'
import { useAiMemoryStore } from '@/stores/ai-memory'

const ButtonStub = defineComponent({
  name: 'Button',
  setup(_props, { slots, attrs }) {
    return () => h('button', attrs, slots.default?.())
  },
})

describe('AiMemoryDrawer', () => {
  it('renders localized empty state and memory actions', () => {
    setActivePinia(createPinia())
    const store = useAiMemoryStore()
    store.memories = []
    store.currentWorkspaceId = 'workspace-1'
    store.deleteMemory = vi.fn()
    store.saveMemory = vi.fn()
    store.saveCompactRule = vi.fn()

    const wrapper = mount(AiMemoryDrawer, {
      props: { open: true },
      global: {
        stubs: {
          teleport: true,
          transition: false,
          AiMemoryEditor: true,
          Button: ButtonStub,
          Brain: true,
          Plus: true,
          Search: true,
          Pencil: true,
          Trash2: true,
          X: true,
          BookOpen: true,
          FileText: true,
          Settings2: true,
        },
      },
    })

    expect(wrapper.text()).toContain('ai.memoryDrawer.title')
    expect(wrapper.text()).toContain('ai.memoryDrawer.empty')
    expect(wrapper.text()).toContain('ai.memoryDrawer.emptyHint')
    expect(wrapper.text()).toContain('ai.memoryDrawer.editCompactRule')
    expect(wrapper.text()).toContain('ai.memoryDrawer.cleanOrphans')
  })
})
