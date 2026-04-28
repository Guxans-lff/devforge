import { describe, expect, it } from 'vitest'
import { analyzeCodeText } from '@/ai-gui/codeIntelligence'

describe('analyzeCodeText', () => {
  it('extracts TypeScript symbols and diagnostics', () => {
    const report = analyzeCodeText('src/example.ts', [
      "import { ref } from 'vue'",
      'export interface User { id: string }',
      'export function createUser(input: any) {',
      '  console.log(input)',
      '}',
    ].join('\n'))

    expect(report.language).toBe('typescript')
    expect(report.symbols.map(symbol => symbol.name)).toContain('User')
    expect(report.symbols.map(symbol => symbol.name)).toContain('createUser')
    expect(report.diagnostics.some(item => item.includes('console.log'))).toBe(true)
    expect(report.diagnostics.some(item => item.includes('any'))).toBe(true)
  })

  it('extracts Vue component signal', () => {
    const report = analyzeCodeText('src/components/DemoPanel.vue', '<script setup lang="ts">\nconst count = 1\n</script>')

    expect(report.language).toBe('vue')
    expect(report.symbols.some(symbol => symbol.kind === 'component' && symbol.name === 'DemoPanel')).toBe(true)
  })
})
