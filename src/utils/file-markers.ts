/**
 * 文件标记协议 — 纯函数工具集
 *
 * 用 <file> 标签将文件内容内联拼接到消息文本中，
 * 兼容所有 OpenAI 兼容接口（纯文本字符串）。
 */

// ─────────────────────── 类型 ───────────────────────

export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'file'; name: string; path: string; size: number; lines: number; content: string; fileType?: 'text' | 'image' }

// ─────────────────────── 白名单 ───────────────────────

/** 允许附件的文本文件扩展名 */
const TEXT_EXTENSIONS = new Set([
  // 编程语言
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte', '.astro',
  '.rs', '.go', '.py', '.rb', '.java', '.kt', '.scala', '.cs', '.cpp', '.c', '.h', '.hpp',
  '.swift', '.dart', '.lua', '.zig', '.nim', '.ex', '.exs', '.erl', '.hs', '.ml', '.clj',
  '.php', '.pl', '.r', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  // 标记 / 文档
  '.md', '.mdx', '.txt', '.rst', '.adoc', '.tex', '.org',
  // 配置 / 数据
  '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env',
  '.xml', '.html', '.htm', '.css', '.scss', '.sass', '.less', '.styl',
  '.csv', '.tsv', '.graphql', '.gql', '.prisma', '.proto',
  // 开发相关
  '.sql', '.dockerfile', '.dockerignore', '.gitignore', '.editorconfig',
  '.eslintrc', '.prettierrc', '.babelrc', '.nvmrc',
  '.lock', '.log',
])

/** 允许附件的图片文件扩展名 */
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif'
])

/** 所有支持的文件扩展名（文本 + 图片） */
const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...IMAGE_EXTENSIONS])

/**
 * 检查文件扩展名是否为可接受的文件（文本或图片）
 */
export function isSupportedFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return SUPPORTED_EXTENSIONS.has(ext)
}

/**
 * 检查文件是否为文本文件
 */
export function isTextFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return TEXT_EXTENSIONS.has(ext)
}

/**
 * 检查文件是否为图片文件
 */
export function isImageFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

// ─────────────────────── 构建 <file> 标签 ───────────────────────

/**
 * 将文件内容用 <file> 标签包裹，拼接到用户消息中
 *
 * @param text 用户输入的文本
 * @param files 文件附件数组 { name, path, size, content, lines, type? }
 * @returns 拼接后的完整消息文本
 */
export function buildFileMarkedContent(
  text: string,
  files: Array<{ name: string; path: string; size: number; content: string; lines: number; type?: 'text' | 'image' }>,
): string {
  if (files.length === 0) return text

  const fileParts = files.map(f => {
    if (f.type === 'image') {
      // 图片文件：直接使用 base64 数据，不转义
      return `<file name="${escapeAttr(f.name)}" path="${escapeAttr(f.path)}" size="${f.size}" lines="${f.lines}" type="image">\n${f.content}\n</file>`
    } else {
      // 文本文件：转义文件内容中的 </file> 以避免解析截断
      const escapedContent = f.content.replace(/<\/file>/g, '<\\/file>')
      return `<file name="${escapeAttr(f.name)}" path="${escapeAttr(f.path)}" size="${f.size}" lines="${f.lines}">\n${escapedContent}\n</file>`
    }
  })

  return `${text}\n\n${fileParts.join('\n\n')}`
}

/** 转义 XML 属性值中的特殊字符 */
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ─────────────────────── 解析 <file> 标签 ───────────────────────

/**
 * 解析消息文本中的 <file> 标签 + 代码块 + 普通文本
 *
 * @param text 完整消息文本
 * @returns 段落数组（text / code / file）
 */
export function parseFileMarkers(text: string): MessageSegment[] {
  if (!text) return []

  const segments: MessageSegment[] = []
  // 统一匹配 <file> 标签和代码块，支持可选的 type 属性
  const combinedRegex = /(?:<file\s+name="([^"]*?)"\s+path="([^"]*?)"\s+size="(\d+)"\s+lines="(\d+)"(?:\s+type="([^"]*?)")?>\n?([\s\S]*?)\n?<\/file>)|(?:```(\w*)\n([\s\S]*?)```)/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = combinedRegex.exec(text)) !== null) {
    // 前面的纯文本
    if (match.index > lastIndex) {
      const textPart = text.slice(lastIndex, match.index).trim()
      if (textPart) segments.push({ type: 'text', content: textPart })
    }

    if (match[1] !== undefined) {
      // <file> 标签匹配
      const fileType = match[5] as 'text' | 'image' | undefined
      const content = fileType === 'image'
        ? match[6]! // 图片不需要反转义
        : match[6]!.replace(/<\\\/file>/g, '</file>') // 文本文件反转义

      segments.push({
        type: 'file',
        name: unescapeAttr(match[1]),
        path: unescapeAttr(match[2]!),
        size: parseInt(match[3]!, 10),
        lines: parseInt(match[4]!, 10),
        content,
        fileType,
      })
    } else {
      // 代码块匹配
      segments.push({
        type: 'code',
        language: match[7] || 'text',
        content: match[8]?.trimEnd() ?? '',
      })
    }

    lastIndex = match.index + match[0].length
  }

  // 尾部文本
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim()
    if (remaining) segments.push({ type: 'text', content: remaining })
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: text }]
}

/** 反转义 XML 属性值 */
function unescapeAttr(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

// ─────────────────────── Token 估算 ───────────────────────

/**
 * 估算文本的 token 数量（粗略: 字符数 / 3.5）
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

/**
 * 检查是否接近上下文上限
 *
 * @param currentText 即将发送的文本
 * @param historyTokens 历史消息已用 token 数
 * @param maxContext 模型最大上下文 token 数
 * @param threshold 警告阈值（默认 0.8 = 80%）
 * @returns { warn: boolean, usage: number, limit: number }
 */
export function checkTokenLimit(
  currentText: string,
  historyTokens: number,
  maxContext: number,
  threshold = 0.8,
): { warn: boolean; usage: number; limit: number } {
  const estimated = estimateTokens(currentText) + historyTokens
  const limit = Math.floor(maxContext * threshold)
  return {
    warn: estimated > limit,
    usage: estimated,
    limit: maxContext,
  }
}

/** 单文件大小上限 10MB */
export const MAX_FILE_SIZE = 10 * 1024 * 1024

// ─────────────────────── 路径→语言推断 ───────────────────────

/** 文件扩展名 → 代码高亮语言标识符 */
const EXT_LANG: Record<string, string> = {
  '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.jsx': 'jsx',
  '.vue': 'vue', '.rs': 'rust', '.go': 'go', '.py': 'python',
  '.java': 'java', '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
  '.md': 'markdown', '.html': 'html', '.css': 'css', '.scss': 'scss',
  '.sql': 'sql', '.sh': 'bash', '.toml': 'toml', '.xml': 'xml',
}

/** 特殊文件名 → 语言标识符 */
const SPECIAL_FILES: Record<string, string> = {
  'Dockerfile': 'dockerfile',
  'Makefile': 'makefile',
}

/**
 * 从文件路径推断语言标识符
 * @param filePath 文件路径，如 "src/utils/helper.ts"
 * @returns 语言标识符，如 "ts"；未知返回 "text"
 */
export function inferLanguageFromPath(filePath: string): string {
  // 提取文件名
  const fileName = filePath.split(/[/\\]/).pop() ?? ''

  // 先检查特殊文件名
  if (SPECIAL_FILES[fileName]) return SPECIAL_FILES[fileName]

  // 按扩展名匹配
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  return EXT_LANG[ext] ?? 'text'
}
