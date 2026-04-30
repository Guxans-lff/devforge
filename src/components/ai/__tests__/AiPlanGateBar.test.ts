import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AiPlanGateBar from '@/components/ai/AiPlanGateBar.vue'

const iconStubs = {
  CheckCircle2: true,
  ClipboardList: true,
  RotateCcw: true,
  ShieldCheck: true,
}

describe('AiPlanGateBar', () => {
  it('渲染正式执行计划审批卡片', () => {
    const wrapper = mount(AiPlanGateBar, {
      props: {
        plan: '# 修复对话滚动\n1. 定位滚动容器\n2. 修复自动滚动',
      },
      global: {
        stubs: iconStubs,
      },
    })

    expect(wrapper.text()).toContain('PLAN GATE')
    expect(wrapper.text()).toContain('修复对话滚动')
    expect(wrapper.text()).toContain('2 个步骤等待确认')
    expect(wrapper.text()).toContain('计划正文')
  })

  it('点击确认执行时发出 approve', async () => {
    const wrapper = mount(AiPlanGateBar, {
      props: {
        plan: '1. 执行任务',
      },
      global: {
        stubs: iconStubs,
      },
    })

    await wrapper.get('.is-approve').trigger('click')

    expect(wrapper.emitted('approve')).toHaveLength(1)
  })

  it('点击重新规划时发出 reject', async () => {
    const wrapper = mount(AiPlanGateBar, {
      props: {
        plan: '1. 重新分析',
      },
      global: {
        stubs: iconStubs,
      },
    })

    await wrapper.get('.is-replan').trigger('click')

    expect(wrapper.emitted('reject')).toHaveLength(1)
  })
})
