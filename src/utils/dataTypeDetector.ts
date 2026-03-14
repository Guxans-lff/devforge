/** 预览模式类型 */
export type PreviewMode = 'text' | 'json' | 'xml' | 'hex' | 'datetime' | 'url'

/** 自动检测数据内容的预览模式 */
export function detectPreviewMode(value: unknown, columnType?: string): PreviewMode {
  if (value === null || value === undefined) return 'text'

  // 二进制数据检测
  if (isBinaryData(value)) return 'hex'

  const str = typeof value === 'object' ? JSON.stringify(value) : String(value)

  // 列类型辅助判断
  if (columnType) {
    const ct = columnType.toLowerCase()
    if (ct.includes('json')) return 'json'
    if (ct.includes('xml')) return 'xml'
    if (ct.includes('blob') || ct.includes('binary') || ct.includes('varbinary')) return 'hex'
    if (ct.includes('date') || ct.includes('time') || ct.includes('timestamp')) return 'datetime'
  }

  // 内容检测（按优先级）
  if (isValidJson(str)) return 'json'
  if (isValidXml(str)) return 'xml'
  if (isValidUrl(str)) return 'url'
  if (isDatetime(str)) return 'datetime'

  return 'text'
}

/** 判断字符串是否为有效 JSON */
export function isValidJson(str: string): boolean {
  if (!str) return false
  const trimmed = str.trim()
  // 必须以 { 或 [ 开头
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

/** 判断字符串是否为 XML */
export function isValidXml(str: string): boolean {
  if (!str) return false
  const trimmed = str.trim()
  // 简单判断：以 < 开头且以 > 结尾，且包含闭合标签
  if (!trimmed.startsWith('<') || !trimmed.endsWith('>')) return false
  // 排除 HTML 片段：检测是否有 XML 声明或根元素
  return /^<\?xml|^<[a-zA-Z][\w.-]*[\s>]/.test(trimmed) && /<\/[a-zA-Z][\w.-]*>\s*$/.test(trimmed)
}

/** 判断字符串是否为 URL */
export function isValidUrl(str: string): boolean {
  if (!str) return false
  const trimmed = str.trim()
  return /^https?:\/\/[^\s]+$/.test(trimmed)
}

/** 判断字符串是否为日期时间 */
export function isDatetime(str: string, columnType?: string): boolean {
  if (!str) return false
  if (columnType) {
    const ct = columnType.toLowerCase()
    if (ct.includes('date') || ct.includes('time') || ct.includes('timestamp')) return true
  }
  // ISO 8601 格式
  if (/^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/.test(str)) return true
  // 纯日期
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return true
  return false
}

/** 判断是否为二进制数据 */
export function isBinaryData(value: unknown): boolean {
  if (value instanceof ArrayBuffer || value instanceof Uint8Array) return true
  if (typeof value === 'string') {
    // 检测是否包含大量不可打印字符
    const nonPrintable = value.split('').filter(c => {
      const code = c.charCodeAt(0)
      return code < 32 && code !== 9 && code !== 10 && code !== 13
    }).length
    return nonPrintable > value.length * 0.1
  }
  return false
}

/** 预览模式的中文名称 */
export const PREVIEW_MODE_LABELS: Record<PreviewMode, string> = {
  text: '文本',
  json: 'JSON',
  xml: 'XML',
  hex: '十六进制',
  datetime: '日期时间',
  url: 'URL',
}
