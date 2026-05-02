import { describe, expect, it } from 'vitest'
import { collectLspDiagnostics, createHeuristicLspDiagnosticProvider, summarizeLspDiagnostics } from '@/ai-gui/lspDiagnostics'

describe('lspDiagnostics', () => {
  it('collects heuristic diagnostics through the LSP-compatible provider shape', async () => {
    const diagnostics = await collectLspDiagnostics([
      {
        path: 'src/a.ts',
        content: [
          'const value: any = 1',
          'console.log(value)',
        ].join('\n'),
      },
    ], createHeuristicLspDiagnosticProvider())

    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[0]).toMatchObject({
      path: 'src/a.ts',
      line: 1,
      source: 'heuristic',
    })
    expect(summarizeLspDiagnostics(diagnostics)).toBe('诊断 2 条：error 0，warning 1，info/hint 1。')
  })
})
