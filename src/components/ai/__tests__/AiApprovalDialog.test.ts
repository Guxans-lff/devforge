import { mount } from '@vue/test-utils'
import { describe, expect, it, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'
import AiApprovalDialog from '@/components/ai/AiApprovalDialog.vue'
import { clearApprovalStateForTests, requestApproval, setActiveSessionId } from '@/composables/useToolApproval'

const IconStub = defineComponent({
  name: 'IconStub',
  setup() {
    return () => h('span')
  },
})

describe('AiApprovalDialog', () => {
  const sessionId = 'approval-ui-session'

  beforeEach(() => {
    clearApprovalStateForTests()
    setActiveSessionId(sessionId)
  })

  function mountComponent() {
    return mount(AiApprovalDialog, {
      props: { sessionId },
      global: {
        stubs: {
          AiDiffViewer: true,
          AiPermissionRiskSummary: {
            props: ['summary'],
            template: '<div>{{ summary.label }} {{ summary.description }}</div>',
          },
          ChevronDown: IconStub,
          ChevronUp: IconStub,
          FileSearch: IconStub,
          FileText: IconStub,
          Globe: IconStub,
          Pencil: IconStub,
          Shield: IconStub,
          ShieldCheck: IconStub,
          ShieldX: IconStub,
          Terminal: IconStub,
        },
      },
    })
  }

  it('renders read tool approval with read-specific labels', async () => {
    const pending = requestApproval({
      toolName: 'read_file',
      path: 'src/main.ts',
      newContent: '{"path":"src/main.ts"}',
      sessionId,
    })
    await Promise.resolve()

    const wrapper = mountComponent()

    expect(wrapper.text()).toContain('src/main.ts')
    expect(wrapper.text()).toContain('{"path":"src/main.ts"}')
    expect(wrapper.text()).toContain('允许一次')

    clearApprovalStateForTests()
    await pending.catch(() => undefined)
  })

  it('requires inline double confirm before allowing manual patch conflicts', async () => {
    const pending = requestApproval({
      toolName: 'write_file',
      path: 'src/main.ts',
      newContent: 'next',
      warning: 'Workspace Isolation conflict',
      requiresDoubleConfirm: true,
      sessionId,
    })
    await Promise.resolve()

    const wrapper = mountComponent()
    let settled = false
    pending.then(() => { settled = true })

    const allowButton = wrapper.findAll('button').at(-1)!
    await allowButton.trigger('click')
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(wrapper.text()).toContain('需要二次确认')

    await allowButton.trigger('click')
    await Promise.resolve()

    expect(settled).toBe(true)
  })
})
