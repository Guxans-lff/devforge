import { describe, expect, it } from 'vitest'
import {
  loadBuiltinOutputStyles,
  parseOutputStyleMarkdown,
  useOutputStyles,
} from '@/composables/useOutputStyles'

describe('useOutputStyles', () => {
  it('loads builtin styles from markdown files', () => {
    const styles = loadBuiltinOutputStyles()

    expect(styles.map(style => style.id)).toEqual(expect.arrayContaining(['default', 'concise', 'teacher']))
    expect(styles[0]?.id).toBe('default')
    expect(styles.find(style => style.id === 'concise')?.content).toContain('简洁工程助手')
  })

  it('parses markdown frontmatter and body', () => {
    const style = parseOutputStyleMarkdown(`---
name: 测试风格
id: test-style
description: 用于测试
---

请保持简洁。`, 'fallback')

    expect(style).toMatchObject({
      id: 'test-style',
      name: '测试风格',
      description: '用于测试',
      source: 'builtin',
    })
    expect(style.content).toBe('请保持简洁。')
  })

  it('falls back to default content for unknown style ids', () => {
    const outputStyles = useOutputStyles()

    expect(outputStyles.getStyleContent('missing-style')).toBe(outputStyles.getDefaultStyle().content)
  })
})
