import { mount } from '@vue/test-utils'
import { computed, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ActivityBar from '@/components/layout/ActivityBar.vue'

const mocks = vi.hoisted(() => ({
  aiStore: null as any,
  connectionStore: null as any,
  workspaceStore: null as any,
  openDialog: vi.fn(),
  toggleTheme: vi.fn(),
}))

vi.mock('@/stores/ai-chat', () => ({
  useAiChatStore: () => mocks.aiStore,
}))

vi.mock('@/stores/workspace', () => ({
  useWorkspaceStore: () => mocks.workspaceStore,
}))

vi.mock('@/stores/connections', () => ({
  useConnectionStore: () => mocks.connectionStore,
}))

vi.mock('@/composables/useTheme', () => ({
  useTheme: () => ({
    themeMode: computed(() => 'dark'),
    toggleTheme: mocks.toggleTheme,
  }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: mocks.openDialog,
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/components/ai/AiPromptEnhancer.vue', () => ({
  default: {
    name: 'AiPromptEnhancer',
    props: {
      open: { type: Boolean, default: false },
      originalText: { type: String, default: '' },
      provider: { type: Object, default: null },
      model: { type: Object, default: null },
    },
    emits: ['update:open', 'accept'],
    template: `
      <div v-if="open" class="prompt-enhancer-stub">
        <span class="original-text">{{ originalText }}</span>
      </div>
    `,
  },
}))

vi.mock('@/components/ui/button', () => ({
  Button: {
    props: ['variant', 'size'],
    template: '<button v-bind="$attrs"><slot /></button>',
  },
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<div><slot /></div>' },
  TooltipProvider: { template: '<div><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: { template: '<div><slot /></div>' },
  DropdownMenuContent: { template: '<div><slot /></div>' },
  DropdownMenuItem: { template: '<button v-bind="$attrs"><slot /></button>' },
  DropdownMenuTrigger: { template: '<div><slot /></div>' },
}))

function makeProvider() {
  return {
    id: 'provider-1',
    name: 'DeepSeek',
    providerType: 'openai_compat',
    endpoint: 'https://api.example.com',
    isDefault: true,
    createdAt: 1,
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3', capabilities: { streaming: true, vision: false, thinking: false, toolUse: true, maxContext: 64000, maxOutput: 8192 } },
    ],
  }
}

function mountActivityBar(provider: ReturnType<typeof makeProvider> | null = makeProvider()) {
  const aiState = reactive({ provider })
  mocks.aiStore = {
    init: vi.fn().mockResolvedValue(undefined),
    defaultProvider: computed(() => aiState.provider),
  }
  mocks.connectionStore = {
    connections: new Map(),
  }
  mocks.workspaceStore = {
    panelState: reactive({ activeSidePanel: 'connections' }),
    tabs: [],
    addTab: vi.fn(),
    toggleSidePanel: vi.fn(),
    toggleSidebar: vi.fn(),
  }

  return mount(ActivityBar)
}

describe('ActivityBar prompt optimizer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens prompt enhancer from the left activity bar', async () => {
    const wrapper = mountActivityBar()

    await wrapper.find('[data-testid="activity-prompt-optimizer-open"]').trigger('click')

    expect(wrapper.find('.prompt-enhancer-stub').exists()).toBe(true)
  })
})
