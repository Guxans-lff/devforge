export type CodeSymbolKind = 'function' | 'class' | 'interface' | 'type' | 'const' | 'component'

export interface CodeSymbolItem {
  name: string
  kind: CodeSymbolKind
  line: number
  signature: string
}

export interface CodeIntelligenceSummary {
  language: string
  symbols: CodeSymbolItem[]
  imports: string[]
  exports: string[]
  diagnostics: string[]
}

function inferLanguage(path: string): string {
  if (/\.vue$/i.test(path)) return 'vue'
  if (/\.tsx?$/i.test(path)) return 'typescript'
  if (/\.jsx?$/i.test(path)) return 'javascript'
  if (/\.rs$/i.test(path)) return 'rust'
  return 'text'
}

function pushSymbol(symbols: CodeSymbolItem[], line: number, kind: CodeSymbolKind, name: string, signature: string): void {
  symbols.push({ name, kind, line, signature: signature.trim().slice(0, 180) })
}

export function analyzeCodeText(path: string, content: string): CodeIntelligenceSummary {
  const language = inferLanguage(path)
  const lines = content.split(/\r?\n/)
  const symbols: CodeSymbolItem[] = []
  const imports: string[] = []
  const exports: string[] = []
  const diagnostics: string[] = []

  lines.forEach((rawLine, index) => {
    const lineNo = index + 1
    const line = rawLine.trim()
    if (!line) return

    if (/^import\s/.test(line) || /^use\s/.test(line)) imports.push(line.slice(0, 180))
    if (/^export\s/.test(line) || /^pub\s/.test(line)) exports.push(line.slice(0, 180))

    const patterns: Array<[CodeSymbolKind, RegExp]> = [
      ['function', /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/],
      ['class', /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/],
      ['interface', /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/],
      ['type', /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/],
      ['const', /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/],
      ['function', /^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/],
      ['class', /^(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/],
      ['interface', /^(?:pub\s+)?trait\s+([A-Za-z_][\w]*)/],
    ]
    for (const [kind, pattern] of patterns) {
      const match = line.match(pattern)
      if (match?.[1]) {
        pushSymbol(symbols, lineNo, kind, match[1], line)
        break
      }
    }

    if (line.includes('TODO') || line.includes('FIXME')) diagnostics.push(`L${lineNo}: 存在 TODO/FIXME`)
    if (/console\.log\(/.test(line)) diagnostics.push(`L${lineNo}: 存在 console.log`)
    if (/\bany\b/.test(line) && language === 'typescript') diagnostics.push(`L${lineNo}: 使用 any，建议收窄类型`)
  })

  if (language === 'vue' && /<script setup/.test(content)) {
    const componentName = path.split(/[\\/]/).pop()?.replace(/\.vue$/i, '')
    if (componentName) pushSymbol(symbols, 1, 'component', componentName, `<script setup> ${componentName}`)
  }

  return {
    language,
    symbols,
    imports: imports.slice(0, 40),
    exports: exports.slice(0, 40),
    diagnostics: diagnostics.slice(0, 40),
  }
}
