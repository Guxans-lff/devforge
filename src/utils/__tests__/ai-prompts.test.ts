import { describe, it, expect } from 'vitest'
import { isChineseModel, buildToolGuide } from '@/utils/ai-prompts'

describe('ai-prompts.isChineseModel', () => {
  it('识别常见中文模型', () => {
    expect(isChineseModel('deepseek-chat')).toBe(true)
    expect(isChineseModel('qwen2.5-72b')).toBe(true)
    expect(isChineseModel('glm-4-plus')).toBe(true)
    expect(isChineseModel('moonshot-v1-8k')).toBe(true)
    expect(isChineseModel('doubao-pro')).toBe(true)
  })

  it('识别外文模型返回 false', () => {
    expect(isChineseModel('claude-3-5-sonnet')).toBe(false)
    expect(isChineseModel('gpt-4o')).toBe(false)
    expect(isChineseModel('gemini-1.5-pro')).toBe(false)
  })

  it('空值容错', () => {
    expect(isChineseModel('')).toBe(false)
    expect(isChineseModel(null)).toBe(false)
    expect(isChineseModel(undefined)).toBe(false)
  })
})

describe('ai-prompts.buildToolGuide', () => {
  it('中文模型返回中文指引', () => {
    const guide = buildToolGuide({
      workDir: '/tmp/ws',
      chatMode: 'plan',
      modelId: 'deepseek-chat',
    })
    expect(guide).toContain('工具使用规则')
    expect(guide).toContain('/tmp/ws')
    expect(guide).toContain('write_file')
  })

  it('外文模型返回英文指引', () => {
    const guide = buildToolGuide({
      workDir: '/tmp/ws',
      chatMode: 'plan',
      modelId: 'claude-3-5-sonnet',
    })
    expect(guide).toContain('Tool usage')
    expect(guide).not.toContain('工具使用规则')
  })

  it('auto 模式追加全自动段落', () => {
    const cn = buildToolGuide({
      workDir: '/ws',
      chatMode: 'auto',
      modelId: 'qwen',
    })
    expect(cn).toContain('全自动模式')

    const en = buildToolGuide({
      workDir: '/ws',
      chatMode: 'auto',
      modelId: 'gpt-4o',
    })
    expect(en).toContain('Auto mode')
  })

  it('ideContext 注入 <ide_context> 块', () => {
    const guide = buildToolGuide({
      workDir: '/ws',
      chatMode: 'plan',
      modelId: 'gpt-4o',
      ideContext: {
        path: '/ws/a.ts',
        language: 'ts',
        cursorLine: 42,
        selectedText: 'const x = 1',
      },
    })
    expect(guide).toContain('<ide_context>')
    expect(guide).toContain('active_file: /ws/a.ts')
    expect(guide).toContain('cursor_line: 42')
    expect(guide).toContain('const x = 1')
  })

  it('无 ideContext 时不注入块', () => {
    const guide = buildToolGuide({
      workDir: '/ws',
      chatMode: 'plan',
      modelId: 'gpt-4o',
    })
    expect(guide).not.toContain('<ide_context>')
  })
})
