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

/**
 * 从 SELECT 语句中尝试提取表名
 * 支持语法: SELECT ... FROM [db.]table ...
 * 支持反引号转义
 */
export function extractTableName(sql: string): string | null {
  if (!sql) return null
  
  // 移除多行注释
  const cleanSql = sql.replace(/\/\*[\s\S]*?\*\//g, '')
    // 移除单行注释
    .replace(/(--|#).*$/gm, '')
    .trim()

  // 匹配 SELECT ... FROM [db.]table
  // 考虑到可能的反引号和数据库前缀
  // 1: 匹配 SELECT ... FROM
  // 2: 匹配可能的 [database].
  // 3: 匹配 table
  const selectRegex = /SELECT\s+[\s\S]*?\s+FROM\s+(?:[`"']?([\w-]+)[`"']?\s*\.\s*)?[`"']?([\w-]+)[`"']?/i
  const match = cleanSql.match(selectRegex)
  
  if (match) {
    // match[2] 是表名，match[1] 是数据库名（如果有）
    return match[2] || null
  }
  
  return null
}
