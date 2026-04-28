import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import AiMcpStatusPanel from '@/components/ai/AiMcpStatusPanel.vue'
import type { ModelConfig } from '@/types/ai'

const { aiGetToolsMock, aiGetMcpStatusMock } = vi.hoisted(() => ({
  aiGetToolsMock: vi.fn(),
  aiGetMcpStatusMock: vi.fn(),
}))

vi.mock('@/api/ai', () => ({
  aiGetTools: aiGetToolsMock,
  aiGetMcpStatus: aiGetMcpStatusMock,
}))

const IconStub = defineComponent({
  name: 'IconStub',
  setup() {
    return () => h('span')
  },
})

function model(toolUse = true): ModelConfig {
  return {
    id: 'm1',
    name: 'Model 1',
    capabilities: {
      streaming: true,
      vision: false,
      thinking: false,
      toolUse,
      maxContext: 32000,
      maxOutput: 4096,
    },
  }
}

describe('AiMcpStatusPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiGetMcpStatusMock.mockResolvedValue({
      configPath: null,
      configExists: false,
      parseError: null,
      servers: [],
    })
  })

  function mountComponent(toolUse = true) {
    return mount(AiMcpStatusPanel, {
      props: {
        model: model(toolUse),
        workDir: 'D:/Project/devforge',
      },
      global: {
        stubs: {
          Activity: IconStub,
          AlertTriangle: IconStub,
          CheckCircle2: IconStub,
          RefreshCw: IconStub,
          Server: IconStub,
          Wrench: IconStub,
          XCircle: IconStub,
        },
      },
    })
  }

  it('loads tools and renders ready status when mcp config is missing', async () => {
    aiGetToolsMock.mockResolvedValue([
      { type: 'function', function: { name: 'read_file', description: '', parameters: {} } },
      { type: 'function', function: { name: 'bash', description: '', parameters: {} } },
    ])

    const wrapper = mountComponent(true)
    await flushPromises()

    expect(aiGetToolsMock).toHaveBeenCalledTimes(1)
    expect(aiGetMcpStatusMock).toHaveBeenCalledWith('D:/Project/devforge')
    expect(wrapper.text()).toContain('工具就绪')
    expect(wrapper.text()).toContain('2 tools')
    expect(wrapper.text()).toContain('未发现 .mcp.json')
  })

  it('renders mcp server cards from backend status', async () => {
    aiGetToolsMock.mockResolvedValue([
      { type: 'function', function: { name: 'read_file', description: '', parameters: {} } },
    ])
    aiGetMcpStatusMock.mockResolvedValue({
      configPath: 'D:/Project/devforge/.mcp.json',
      configExists: true,
      parseError: null,
      servers: [
        { name: 'context7', transport: 'stdio', command: 'npx', disabled: false, status: 'configured' },
        { name: 'docs', transport: 'sse', url: 'https://example.com/sse', disabled: false, status: 'configured' },
      ],
    })

    const wrapper = mountComponent(true)
    await flushPromises()

    expect(wrapper.text()).toContain('工具与 MCP 就绪')
    expect(wrapper.text()).toContain('2/2 MCP servers')
    expect(wrapper.text()).toContain('configured')
    expect(wrapper.text()).toContain('context7')
    expect(wrapper.text()).toContain('docs')
  })

  it('shows disabled when model has no toolUse', async () => {
    aiGetToolsMock.mockResolvedValue([
      { type: 'function', function: { name: 'read_file', description: '', parameters: {} } },
    ])

    const wrapper = mountComponent(false)
    await flushPromises()

    expect(wrapper.text()).toContain('工具已禁用')
    expect(wrapper.text()).toContain('toolUse')
  })

  it('shows error when loading tools failed', async () => {
    aiGetToolsMock.mockRejectedValue(new Error('boom'))

    const wrapper = mountComponent(true)
    await flushPromises()

    expect(wrapper.text()).toContain('工具状态异常')
    expect(wrapper.text()).toContain('boom')
  })
})
