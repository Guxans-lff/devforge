import { describe, expect, it } from 'vitest'
import { getPromptOptimizerTemplate, renderTemplate } from '@/composables/ai/promptOptimizerTemplates'

describe('promptOptimizerTemplates', () => {
  it('renders variables in template text', () => {
    expect(renderTemplate('优化：{{prompt}}', { prompt: '写日报' })).toBe('优化：写日报')
  })

  it('renders missing variables as empty strings', () => {
    expect(renderTemplate('优化：{{prompt}}｜{{extraInstruction}}', { prompt: '写日报' })).toBe('优化：写日报｜')
  })

  it('replaces repeated variables', () => {
    expect(renderTemplate('{{prompt}}\n---\n{{prompt}}', { prompt: '写日报' })).toBe('写日报\n---\n写日报')
  })

  it('converts non-string variables to strings', () => {
    expect(renderTemplate('限制 {{count}} 条', { count: 3 })).toBe('限制 3 条')
  })

  it('preserves markdown and code blocks in variable values', () => {
    const prompt = '请优化：\n```ts\nconst name = "{{user}}"\n```'

    expect(renderTemplate('原文：\n{{prompt}}', { prompt })).toBe(`原文：\n${prompt}`)
  })

  it('provides the general optimize template', () => {
    const template = getPromptOptimizerTemplate('general-optimize')

    expect(template.id).toBe('general-optimize')
    expect(template.systemTemplate).toContain('只输出优化后的提示词')
    expect(template.systemTemplate).toContain('语言与原文保持一致')
    expect(template.userTemplate).toContain('{{prompt}}')
  })
})
