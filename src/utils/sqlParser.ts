/**
 * SQL 文本解析工具函数
 */

/**
 * 简单检测 SQL 文本是否包含多条语句
 * 检查非字符串、非注释内的分号数量
 */
export function isMultiStatement(sql: string): boolean {
  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false
  let inLineComment = false
  let inBlockComment = false
  let semicolonCount = 0

  const chars = sql.split('')
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!
    const next = chars[i + 1]

    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++ }
      continue
    }
    if (inSingleQuote) {
      if (ch === "'" && next === "'") { i++; continue }
      if (ch === "'") inSingleQuote = false
      continue
    }
    if (inDoubleQuote) {
      if (ch === '"') inDoubleQuote = false
      continue
    }
    if (inBacktick) {
      if (ch === '`') inBacktick = false
      continue
    }

    if (ch === '-' && next === '-') { inLineComment = true; continue }
    if (ch === '#') { inLineComment = true; continue }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue }
    if (ch === "'") { inSingleQuote = true; continue }
    if (ch === '"') { inDoubleQuote = true; continue }
    if (ch === '`') { inBacktick = true; continue }

    if (ch === ';') {
      semicolonCount++
      if (semicolonCount >= 2) return true
      const rest = sql.slice(i + 1).trim()
      if (rest.length > 0 && !rest.startsWith('--') && !rest.startsWith('#')) {
        return true
      }
    }
  }
  return false
}
