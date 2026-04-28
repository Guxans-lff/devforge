import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import AiWorkspaceSkillManager from '@/components/ai/AiWorkspaceSkillManager.vue'

const IconStub = defineComponent({
  name: 'IconStub',
  setup() {
    return () => h('span')
  },
})

describe('AiWorkspaceSkillManager', () => {
  function mountComponent() {
    return mount(AiWorkspaceSkillManager, {
      props: {
        workDir: 'D:/Project/devforge',
        config: {
          skills: [
            { id: 'context7', name: 'Context7', path: '.agents/skills/context7/SKILL.md', permissions: ['read'], enabled: true },
            { id: 'disabled', name: 'Disabled', enabled: false },
          ],
        },
      },
      global: {
        stubs: {
          Plus: IconStub,
          RotateCcw: IconStub,
          Trash2: IconStub,
          Switch: {
            props: ['checked'],
            emits: ['update:checked'],
            template: '<button type="button" @click="$emit(\'update:checked\', !checked)">{{ checked ? \'on\' : \'off\' }}</button>',
          },
        },
      },
    })
  }

  it('renders summary and existing skills', () => {
    const wrapper = mountComponent()

    expect(wrapper.text()).toContain('共 2 个')
    expect(wrapper.text()).toContain('启用 1 个')
    expect((wrapper.findAll('input')[0]?.element as HTMLInputElement).value).toBe('Context7')
  })

  it('emits normalized skills when saved', async () => {
    const wrapper = mountComponent()
    await wrapper.findAll('input')[0]?.setValue(' Context Seven ')

    const saveButton = wrapper.findAll('button').find(button => button.text().includes('保存 Skill'))
    await saveButton?.trigger('click')

    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual([
      {
        id: 'context7',
        name: 'Context Seven',
        path: '.agents/skills/context7/SKILL.md',
        permissions: ['read'],
        enabled: true,
      },
      {
        id: 'disabled',
        name: 'Disabled',
        enabled: false,
      },
    ])
  })

  it('renders manifest risk summary for high risk permissions', () => {
    const wrapper = mount(AiWorkspaceSkillManager, {
      props: {
        workDir: 'D:/Project/devforge',
        config: {
          skills: [
            {
              id: 'deploy',
              name: 'Deploy',
              description: 'Deploy helper',
              path: '.agents/skills/deploy/SKILL.md',
              permissions: ['execute', 'network'],
              enabled: true,
            },
          ],
        },
      },
      global: {
        stubs: {
          Plus: IconStub,
          RotateCcw: IconStub,
          Trash2: IconStub,
          Switch: {
            props: ['checked'],
            emits: ['update:checked'],
            template: '<button type="button" @click="$emit(\'update:checked\', !checked)">{{ checked ? \'on\' : \'off\' }}</button>',
          },
        },
      },
    })

    expect(wrapper.text()).toContain('1 个高风险权限')
    expect(wrapper.text()).toContain('Skill Manifest 风险摘要')
    expect(wrapper.text()).toContain('声明了高风险权限')
  })
})
