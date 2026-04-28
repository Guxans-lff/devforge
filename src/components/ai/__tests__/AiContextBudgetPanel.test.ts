import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AiContextBudgetPanel from '@/components/ai/AiContextBudgetPanel.vue'
import type { ContextBudgetReport } from '@/composables/ai-agent/diagnostics/contextBudgetAnalyzer'

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

    // vue-i18n is mocked to return the key string
    expect(wrapper.text()).toContain('ai.contextBudget.title')
    expect(wrapper.text()).toContain('ai.contextBudget.usage')
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
    expect(wrapper.text()).toContain('ai.contextBudget.total')
    expect(wrapper.text()).toContain('ai.contextBudget.systemPrompt')
    expect(wrapper.text()).toContain('ai.contextBudget.messages')
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
    expect(wrapper.text()).toContain('ai.contextBudget.recommendations')
    expect(wrapper.text()).toContain('建议压缩历史消息')
  })

  it('shows healthy message when no recommendations', async () => {
    const report = makeReport({ recommendations: [] })
    const wrapper = mount(AiContextBudgetPanel, {
      props: { report },
    })

    await wrapper.find('button').trigger('click')
    expect(wrapper.text()).toContain('ai.contextBudget.noRecommendations')
  })

  it('emits compact event', async () => {
    const report = makeReport()
    const wrapper = mount(AiContextBudgetPanel, {
      props: { report },
    })

    await wrapper.find('button').trigger('click')
    const compactBtn = wrapper.findAll('button').find(b => b.text().includes('ai.contextBudget.compactHistory'))
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
    const btn = wrapper.findAll('button').find(b => b.text().includes('ai.contextBudget.clearAttachments'))
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

    const detailBtn = wrapper.findAll('button').find(b => b.text().includes('ai.contextBudget.showDetails'))
    expect(detailBtn).toBeDefined()
    await detailBtn!.trigger('click')
    expect(wrapper.text()).toContain('Rule 1')
    expect(wrapper.text()).toContain('knowledge')
  })
})
