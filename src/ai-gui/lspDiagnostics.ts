import { analyzeCodeText } from './codeIntelligence'

export type LspDiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint'

export interface LspDiagnostic {
  path: string
  line: number
  column: number
  severity: LspDiagnosticSeverity
  message: string
  source: 'lsp' | 'heuristic'
  code?: string
}

export interface LspDiagnosticProvider {
  diagnostics(path: string, content: string): Promise<LspDiagnostic[]>
}

function parseHeuristicDiagnostic(path: string, diagnostic: string): LspDiagnostic {
  const match = diagnostic.match(/^L(\d+):\s*(.+)$/)
  const message = match?.[2] ?? diagnostic
  const severity: LspDiagnosticSeverity = /any|TODO|FIXME/.test(message) ? 'warning' : 'information'
  return {
    path,
    line: match?.[1] ? Number(match[1]) : 1,
    column: 1,
    severity,
    message,
    source: 'heuristic',
  }
}

export function createHeuristicLspDiagnosticProvider(): LspDiagnosticProvider {
  return {
    async diagnostics(path: string, content: string): Promise<LspDiagnostic[]> {
      return analyzeCodeText(path, content).diagnostics.map(item => parseHeuristicDiagnostic(path, item))
    },
  }
}

export async function collectLspDiagnostics(
  files: Array<{ path: string; content: string }>,
  provider: LspDiagnosticProvider = createHeuristicLspDiagnosticProvider(),
): Promise<LspDiagnostic[]> {
  const results: LspDiagnostic[] = []
  for (const file of files) {
    const diagnostics = await provider.diagnostics(file.path, file.content)
    results.push(...diagnostics)
  }
  return results.sort((left, right) =>
    left.path.localeCompare(right.path)
    || left.line - right.line
    || left.column - right.column,
  )
}

export function summarizeLspDiagnostics(diagnostics: LspDiagnostic[]): string {
  if (diagnostics.length === 0) return '未发现诊断问题。'
  const errorCount = diagnostics.filter(item => item.severity === 'error').length
  const warningCount = diagnostics.filter(item => item.severity === 'warning').length
  const infoCount = diagnostics.length - errorCount - warningCount
  return `诊断 ${diagnostics.length} 条：error ${errorCount}，warning ${warningCount}，info/hint ${infoCount}。`
}
