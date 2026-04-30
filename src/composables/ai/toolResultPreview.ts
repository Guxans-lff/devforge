export interface ToolResultPreviewOptions {
  maxChars?: number
  maxLines?: number
}

export interface ToolResultPreview {
  text: string
  originalChars: number
  shownChars: number
  shownLines: number
  truncatedByChars: boolean
  truncatedByLines: boolean
  truncated: boolean
}

const DEFAULT_MAX_CHARS = 3_200
const DEFAULT_MAX_LINES = 20

export function stripReadFileResultHeader(content: string): string {
  if (!content.startsWith('[文件:')) return content
  const firstNewline = content.indexOf('\n')
  return firstNewline > 0 ? content.slice(firstNewline + 1) : content
}

export function buildToolResultPreview(
  content: string,
  options: ToolResultPreviewOptions = {},
): ToolResultPreview {
  const maxChars = Math.max(1, options.maxChars ?? DEFAULT_MAX_CHARS)
  const maxLines = Math.max(1, options.maxLines ?? DEFAULT_MAX_LINES)
  const originalChars = content.length
  const truncatedByChars = originalChars > maxChars
  const charLimited = truncatedByChars ? content.slice(0, maxChars) : content

  let newlineCount = 0
  let lineCutIndex = charLimited.length
  for (let index = 0; index < charLimited.length; index += 1) {
    if (charLimited.charCodeAt(index) !== 10) continue
    newlineCount += 1
    if (newlineCount >= maxLines) {
      lineCutIndex = index
      break
    }
  }

  const truncatedByLines = lineCutIndex < charLimited.length
  const text = charLimited.slice(0, lineCutIndex)
  const shownLines = text ? text.split('\n').length : 0

  return {
    text,
    originalChars,
    shownChars: text.length,
    shownLines,
    truncatedByChars,
    truncatedByLines,
    truncated: truncatedByChars || truncatedByLines,
  }
}

export function formatToolPreviewNotice(preview: ToolResultPreview): string {
  if (!preview.truncated) return ''
  const parts: string[] = []
  if (preview.truncatedByLines) parts.push(`已显示前 ${preview.shownLines} 行`)
  if (preview.truncatedByChars) {
    parts.push(`已显示 ${preview.shownChars.toLocaleString()} / ${preview.originalChars.toLocaleString()} 字符`)
  }
  return `${parts.join('，')}，点击“查看完整”加载详情。`
}
