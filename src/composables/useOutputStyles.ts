import { ref, computed } from 'vue'

export interface OutputStyle {
  id: string
  name: string
  description: string
  content: string
  source: 'builtin' | 'user' | 'workspace'
}

const BUILTIN_STYLE_MODULES = import.meta.glob<string>(
  '@/ai/output-styles/builtin/*.md',
  { query: '?raw', import: 'default', eager: true },
)

const FALLBACK_STYLE: OutputStyle = {
  id: 'default',
  name: '默认',
  description: '标准 DevForge AI 助手风格，平衡了详细程度和可读性。',
  content: '你是 DevForge 的 AI 助手。请根据用户的问题提供有帮助、准确的回答。',
  source: 'builtin',
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; content: string } {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const startMatch = normalized.match(/^\s*---\n/)
  if (!startMatch) return { meta: {}, content: normalized.trim() }

  const headerStart = startMatch[0].length
  const endIndex = normalized.indexOf('\n---', headerStart)
  if (endIndex < 0) return { meta: {}, content: normalized.trim() }

  const meta: Record<string, string> = {}
  const header = normalized.slice(headerStart, endIndex).trim()
  for (const line of header.split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (key) meta[key] = value
  }

  return {
    meta,
    content: normalized.slice(endIndex + '\n---'.length).replace(/^\n/, '').trim(),
  }
}

function pathToStyleId(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.md$/, '')
}

export function parseOutputStyleMarkdown(raw: string, fallbackId: string): OutputStyle {
  const { meta, content } = parseFrontmatter(raw)
  const id = meta.id || fallbackId
  return {
    id,
    name: meta.name || id,
    description: meta.description || '',
    content: content || FALLBACK_STYLE.content,
    source: 'builtin',
  }
}

export function loadBuiltinOutputStyles(): OutputStyle[] {
  const styles = Object.entries(BUILTIN_STYLE_MODULES).map(([path, raw]) =>
    parseOutputStyleMarkdown(raw, pathToStyleId(path)),
  )
  const uniqueStyles = new Map<string, OutputStyle>()
  for (const style of styles) {
    uniqueStyles.set(style.id, style)
  }
  if (!uniqueStyles.has('default')) {
    uniqueStyles.set('default', FALLBACK_STYLE)
  }
  return [...uniqueStyles.values()].sort((a, b) => {
    if (a.id === 'default') return -1
    if (b.id === 'default') return 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
}

const loadedStyles = ref<OutputStyle[]>(loadBuiltinOutputStyles())

export function useOutputStyles() {
  const allStyles = computed(() => loadedStyles.value)

  const builtinStyles = computed(() =>
    loadedStyles.value.filter(s => s.source === 'builtin'),
  )

  const customStyles = computed(() =>
    loadedStyles.value.filter(s => s.source !== 'builtin'),
  )

  function getStyleContent(id: string): string {
    const style = loadedStyles.value.find(s => s.id === id)
    return style?.content ?? getDefaultStyle().content
  }

  function getStyle(id: string): OutputStyle | undefined {
    return loadedStyles.value.find(s => s.id === id)
  }

  function getDefaultStyle(): OutputStyle {
    return loadedStyles.value.find(s => s.id === 'default') ?? FALLBACK_STYLE
  }

  /**
   * 注册一个自定义 output style（来自用户目录或 workspace）
   * 相同 id 会覆盖，workspace > user > builtin
   */
  function registerStyle(style: OutputStyle): void {
    const idx = loadedStyles.value.findIndex(s => s.id === style.id)
    if (idx >= 0) {
      // 高优先级 source 可以覆盖低优先级
      const existing = loadedStyles.value[idx]!
      if (priorityOf(style.source) >= priorityOf(existing.source)) {
        loadedStyles.value[idx] = style
      }
    } else {
      loadedStyles.value.push(style)
    }
  }

  function priorityOf(source: OutputStyle['source']): number {
    switch (source) {
      case 'workspace': return 3
      case 'user': return 2
      case 'builtin': return 1
    }
  }

  return {
    allStyles,
    builtinStyles,
    customStyles,
    getStyleContent,
    getStyle,
    getDefaultStyle,
    registerStyle,
  }
}
