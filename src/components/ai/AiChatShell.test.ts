import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AiChatShell from './AiChatShell.vue'

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: {
    name: 'DropdownMenu',
    template: '<div><slot /></div>',
  },
  DropdownMenuTrigger: {
    name: 'DropdownMenuTrigger',
    template: '<div><slot /></div>',
  },
  DropdownMenuContent: {
    name: 'DropdownMenuContent',
    template: '<div><slot /></div>',
  },
  DropdownMenuItem: {
    name: 'DropdownMenuItem',
    template: '<button><slot /></button>',
  },
  DropdownMenuLabel: {
    name: 'DropdownMenuLabel',
    template: '<div><slot /></div>',
  },
  DropdownMenuSeparator: {
    name: 'DropdownMenuSeparator',
    template: '<div />',
  },
}))

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

const shellStubs = {
  Teleport: true,
  AiMessageListVirtual: { template: '<div data-test="message-list" />' },
  AiInputArea: { template: '<div data-test="input-area" />' },
  AiUsageBadge: { template: '<div data-test="usage-badge" />' },
  AiCompactBanner: { template: '<div data-test="compact-banner" />' },
  AiSessionDrawer: { template: '<div data-test="session-drawer" />' },
  AiMemoryDrawer: { template: '<div data-test="memory-drawer" />' },
  WorkspaceFilePicker: { template: '<div data-test="file-picker" />' },
  TooltipProvider: { template: '<div><slot /></div>' },
  Tooltip: { template: '<div><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<div><slot /></div>' },
  Button: { template: '<button><slot /></button>' },
}

describe('AiChatShell', () => {
  it('配置页返回时发出 closeConfig 而不是重新打开配置页', async () => {
    const wrapper = mount(AiChatShell, {
      props: requiredProps,
      global: {
        stubs: shellStubs,
      },
    })

    await wrapper.get('[data-test="provider-back"]').trigger('click')

    expect(wrapper.emitted('closeConfig')).toHaveLength(1)
    expect(wrapper.emitted('openConfig')).toBeUndefined()
  })
  it('hides the duplicate history action when the session drawer is already open', () => {
    const closedWrapper = mount(AiChatShell, {
      props: {
        ...requiredProps,
        currentView: 'chat',
      },
      global: {
        stubs: shellStubs,
      },
    })

    expect(closedWrapper.text()).toContain('ai.messages.history')

    const openWrapper = mount(AiChatShell, {
      props: {
        ...requiredProps,
        currentView: 'chat',
        showSessionDrawer: true,
      },
      global: {
        stubs: shellStubs,
      },
    })

    expect(openWrapper.text()).not.toContain('ai.messages.history')
  })
})
