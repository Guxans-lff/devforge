import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AiChatShell from './AiChatShell.vue'

vi.mock('@/components/ai/AiProviderConfig.vue', () => ({
  default: {
    name: 'AiProviderConfig',
    emits: ['back'],
    template: '<button data-test="provider-back" @click="$emit(\'back\')">返回</button>',
  },
}))

const requiredProps = {
  currentView: 'provider-config' as const,
  showSessionDrawer: false,
  showMemoryDrawer: false,
  showFilePicker: false,
  messageItems: [],
  messagesCount: 0,
  hasProviders: true,
  providers: [],
  sessions: [],
  chatMode: 'ask' as const,
  attachments: [],
  primaryActionLabel: '新建',
  secondaryActionLabel: '窗口',
  emptyDescriptionReady: 'ready',
  emptyDescriptionMissingProvider: 'missing',
}

describe('AiChatShell', () => {
  it('配置页返回时发出 closeConfig 而不是重新打开配置页', async () => {
    const wrapper = mount(AiChatShell, {
      props: requiredProps,
      global: {
        stubs: {
          Teleport: true,
        },
      },
    })

    await wrapper.get('[data-test="provider-back"]').trigger('click')

    expect(wrapper.emitted('closeConfig')).toHaveLength(1)
    expect(wrapper.emitted('openConfig')).toBeUndefined()
  })
})
