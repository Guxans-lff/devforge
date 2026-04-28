import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import AiWorkspaceConfigSummary from '@/components/ai/AiWorkspaceConfigSummary.vue'

const IconStub = defineComponent({
  name: 'IconStub',
  setup() {
    return () => h('span')
  },
})

describe('AiWorkspaceConfigSummary', () => {
  it('renders source cards and conflict warnings', () => {
    const wrapper = mount(AiWorkspaceConfigSummary, {
      props: {
        workDir: 'D:/Project/devforge',
        config: {
          systemPromptExtra: '项目提示词',
          dispatcherDefaultMode: 'headless',
          dispatcherAutoRetryCount: 2,
          planGateEnabled: true,
          features: { 'ai.permission.strict': true },
          skills: [{ id: 'frontend', name: 'Frontend', enabled: true }],
        },
      },
      global: {
        stubs: {
          Badge: { template: '<span><slot /></span>' },
          AlertTriangle: IconStub,
          Info: IconStub,
        },
      },
    })

    expect(wrapper.text()).toContain('项目配置来源')
    expect(wrapper.text()).toContain('严格权限与自动重试同时启用')
    expect(wrapper.text()).toContain('项目 Prompt 与 Skill 会同时注入')
    expect(wrapper.text()).toContain('存在缺少路径的启用 Skill')
    expect(wrapper.text()).toContain('1/1 个启用')
  })
})
