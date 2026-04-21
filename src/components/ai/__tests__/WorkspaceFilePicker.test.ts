import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import WorkspaceFilePicker from '@/components/ai/WorkspaceFilePicker.vue'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'

const { openMock } = vi.hoisted(() => ({
  openMock: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: openMock,
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

describe('WorkspaceFilePicker', () => {
  it('shows localized empty state when no workspace roots exist', () => {
    setActivePinia(createPinia())
    const store = useWorkspaceFilesStore()
    store.roots = []
    store.flatNodes = []

    const wrapper = mount(WorkspaceFilePicker, {
      global: {
        stubs: {
          Dialog: DialogStub,
          DialogContent: PassThroughStub,
          DialogHeader: PassThroughStub,
          DialogTitle: PassThroughStub,
          DialogDescription: PassThroughStub,
          DialogFooter: PassThroughStub,
          Button: PassThroughStub,
          File: true,
          Folder: true,
          FolderOpen: true,
          ChevronRight: true,
          Search: true,
          ExternalLink: true,
        },
      },
    })

    expect(wrapper.text()).toContain('ai.workspaceFilePicker.title')
    expect(wrapper.text()).toContain('ai.workspaceFilePicker.noRoots')
  })
})
