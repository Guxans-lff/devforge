import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AiContextBudgetPanel from '@/components/ai/AiContextBudgetPanel.vue'
import type { ContextBudgetReport } from '@/composables/ai-agent/diagnostics/contextBudgetAnalyzer'


vi.mock('vue-i18n', async () => {
  const messages = (await import('@/locales/zh-CN')).default as Record<string, any>
  const resolveMessage = (key: string, params?: Record<string, unknown>) => {
    const value = key.split('.').reduce<unknown>(
      (current, part) => current && typeof current === 'object'
        ? (current as Record<string, unknown>)[part]
        : undefined,
      messages,
    )
    if (typeof value !== 'string') return key
    return Object.entries(params ?? {}).reduce(
      (text, [name, param]) => text.replaceAll(`{${name}}`, String(param)),
      value,
    )
  }
  return {
    useI18n: () => ({
      t: resolveMessage,
      locale: { value: 'zh-CN' },
    }),
  }
})

function makeReport(overrides: Partial<ContextBudgetReport> = {}): ContextBudgetReport {
  return {
    categories: [
      { key: 'systemPrompt', label: 'System Prompt', tokens: 100, itemCount: 1, description: 'sys desc' },
      { key: 'memory', label: 'Memory', tokens: 50, itemCount: 0, description: 'mem desc' },
      { key: 'messages', label: 'Messages', tokens: 500, itemCount: 2, description: 'msg desc' },
      { key: 'toolResults', label: 'Tool Results', tokens: 200, itemCount: 1, description: 'tool desc' },
      { key: 'attachments', label: 'Attachments', tokens: 0, itemCount: 0, description: 'att desc' },
      { key: 'compactSummary', label: 'Compact Summary', tokens: 50, itemCount: 1, description: 'compact desc' },
      { key: 'safetyContext', label: 'Safety Context', tokens: 0, itemCount: 0, description: 'safety desc' },
    ],
    totalTokens: 900,
    maxContextTokens: 4000,
    usagePercent: 23,
    largestCategoryKey: 'messages',
    recommendations: [],
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('AiContextBudgetPanel', () => {
  it('renders collapsed summary by default', () => {
    const report = makeReport()
    const wrapper = mount(AiContextBudgetPanel, {
      props: { report },
    })

    expect(wrapper.text()).toContain('上下文预算')
    expect(wrapper.text()).toContain('已用 23%')
    expect(wrapper.text()).toContain('900 / 4,000 tokens')
    expect(wrapper.find('[class*="rotate-90"]').exists()).toBe(false)
  })

  it('expands when header is clicked', async () => {
    const report = makeReport()
    const wrapper = mount(AiContextBudgetPanel, {
      props: { report },
    })

    await wrapper.find('button').trigger('click')
    expect(wrapper.find('[class*="rotate-90"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('总量')
    expect(wrapper.text()).toContain('系统提示')
    expect(wrapper.text()).toContain('项目记忆')
    expect(wrapper.text()).toContain('消息')
    expect(wrapper.text()).toContain('压缩摘要')
    expect(wrapper.text()).toContain('安全上下文')
    expect(wrapper.text()).not.toContain('ai.contextBudget.')
  })

  it('shows danger tone when usage >= 90%', () => {
    const report = makeReport({ usagePercent: 95, largestCategoryKey: 'messages' })
    const wrapper = mount(AiContextBudgetPanel, {
      props: { report },
    })

    const root = wrapper.find('.my-2')
    expect(root.classes().join(' ')).toContain('border-rose-500')
  })

  it('shows warn tone when usage >= 75%', () => {
    const report = makeReport({ usagePercent: 80 })
    const wrapper = mount(AiContextBudgetPanel, {
      props: { report },
    })

    const root = wrapper.find('.my-2')
    expect(root.classes().join(' ')).toContain('border-amber-500')
  })

  it('shows ok tone when usage < 75%', () => {
    const report = makeReport({ usagePercent: 50 })
    const wrapper = mount(AiContextBudgetPanel, {
      props: { report },
    })

    const root = wrapper.find('.my-2')
    expect(root.classes().join(' ')).toContain('border-emerald-500')
  })

  it('shows recommendations when present', async () => {
    const report = makeReport({
      recommendations: ['建议压缩历史消息', '建议清理工具结果'],
    })
    const wrapper = mount(AiContextBudgetPanel, {
      props: { report },
    })

    await wrapper.find('button').trigger('click')
    expect(wrapper.text()).toContain('建议')
    expect(wrapper.text()).toContain('建议压缩历史消息')
  })

  it('shows healthy message when no recommendations', async () => {
    const report = makeReport({ recommendations: [] })
    const wrapper = mount(AiContextBudgetPanel, {
      props: { report },
    })

    await wrapper.find('button').trigger('click')
    expect(wrapper.text()).toContain('当前上下文占用正常。')
  })

  it('emits compact event', async () => {
    const report = makeReport()
    const wrapper = mount(AiContextBudgetPanel, {
      props: { report },
    })

    await wrapper.find('button').trigger('click')
    const compactBtn = wrapper.findAll('button').find(b => b.text().includes('压缩历史'))
    expect(compactBtn).toBeDefined()
    await compactBtn!.trigger('click')
    expect(wrapper.emitted('compact')).toHaveLength(1)
  })

  it('emits clearAttachments event', async () => {
    const report = makeReport({
      categories: [
        { key: 'systemPrompt', label: 'System Prompt', tokens: 0, itemCount: 0, description: '' },
        { key: 'memory', label: 'Memory', tokens: 0, itemCount: 0, description: '' },
        { key: 'messages', label: 'Messages', tokens: 0, itemCount: 0, description: '' },
        { key: 'toolResults', label: 'Tool Results', tokens: 0, itemCount: 0, description: '' },
        { key: 'attachments', label: 'Attachments', tokens: 100, itemCount: 1, description: '' },
        { key: 'compactSummary', label: 'Compact Summary', tokens: 0, itemCount: 0, description: '' },
        { key: 'safetyContext', label: 'Safety Context', tokens: 0, itemCount: 0, description: '' },
      ],
    })
    const wrapper = mount(AiContextBudgetPanel, {
      props: { report },
    })

    await wrapper.find('button').trigger('click')
    const btn = wrapper.findAll('button').find(b => b.text().includes('清空附件'))
    expect(btn).toBeDefined()
    await btn!.trigger('click')
    expect(wrapper.emitted('clearAttachments')).toHaveLength(1)
  })

  it('shows item details when toggled', async () => {
    const report = makeReport({
      categories: [
        {
          key: 'memory',
          label: 'Memory',
          tokens: 50,
          itemCount: 1,
          description: 'desc',
          items: [{ label: 'Rule 1', tokens: 50, detail: 'knowledge' }],
        },
        { key: 'systemPrompt', label: 'System Prompt', tokens: 0, itemCount: 0, description: '' },
        { key: 'messages', label: 'Messages', tokens: 0, itemCount: 0, description: '' },
        { key: 'toolResults', label: 'Tool Results', tokens: 0, itemCount: 0, description: '' },
        { key: 'attachments', label: 'Attachments', tokens: 0, itemCount: 0, description: '' },
        { key: 'compactSummary', label: 'Compact Summary', tokens: 0, itemCount: 0, description: '' },
        { key: 'safetyContext', label: 'Safety Context', tokens: 0, itemCount: 0, description: '' },
      ],
    })
    const wrapper = mount(AiContextBudgetPanel, {
      props: { report },
    })

    await wrapper.find('button').trigger('click')
    expect(wrapper.text()).not.toContain('Rule 1')

    const detailBtn = wrapper.findAll('button').find(b => b.text().includes('详情'))
    expect(detailBtn).toBeDefined()
    await detailBtn!.trigger('click')
    expect(wrapper.text()).toContain('Rule 1')
    expect(wrapper.text()).toContain('knowledge')
  })
})
