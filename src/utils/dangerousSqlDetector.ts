import type { DangerousStatement } from '@/types/environment'

/**
 * 移除 SQL 中的注释和字符串字面量，避免误判
 * 将注释和字符串替换为空白占位，保持位置不变
 */
function stripCommentsAndStrings(sql: string): string {
  return sql
    // 移除块注释 /* ... */
    .replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length))
    // 移除行注释 -- ...
    .replace(/--[^\n]*/g, (match) => ' '.repeat(match.length))
    // 移除行注释 # ...（MySQL 风格）
    .replace(/#[^\n]*/g, (match) => ' '.repeat(match.length))
    // 移除单引号字符串
    .replace(/'(?:[^'\\]|\\.)*'/g, (match) => ' '.repeat(match.length))
    // 移除双引号字符串
    .replace(/"(?:[^"\\]|\\.)*"/g, (match) => ' '.repeat(match.length))
    // 移除反引号标识符
    .replace(/`[^`]*`/g, (match) => ' '.repeat(match.length))
}

/** 检测规则定义 */
interface DetectionRule {
  /** 规则名称 */
  type: string
  /** 匹配正则（在已清理的 SQL 上匹配） */
  pattern: RegExp
  /** 严重程度 */
  severity: 'warning' | 'critical'
  /** 描述 key（用于 i18n） */
  descriptionKey: string
}

const DETECTION_RULES: DetectionRule[] = [
  {
    type: 'DROP_TABLE',
    pattern: /\bDROP\s+TABLE\b/gi,
    severity: 'critical',
    descriptionKey: 'environment.dangerDropTable',
  },
  {
    type: 'DROP_DATABASE',
    pattern: /\bDROP\s+DATABASE\b/gi,
    severity: 'critical',
    descriptionKey: 'environment.dangerDropDatabase',
  },
  {
    type: 'TRUNCATE',
    pattern: /\bTRUNCATE\s+(?:TABLE\s+)?\w/gi,
    severity: 'critical',
    descriptionKey: 'environment.dangerTruncate',
  },
  {
    type: 'DELETE_NO_WHERE',
    pattern: /\bDELETE\s+FROM\s+\S+\s*(?:;|$)/gi,
    severity: 'critical',
    descriptionKey: 'environment.dangerDeleteNoWhere',
  },
  {
    type: 'UPDATE_NO_WHERE',
    pattern: /\bUPDATE\s+\S+\s+SET\s+[^;]*(?:;|$)/gi,
    severity: 'warning',
    descriptionKey: 'environment.dangerUpdateNoWhere',
  },
  {
    type: 'ALTER_DROP_COLUMN',
    pattern: /\bALTER\s+TABLE\s+\S+\s+DROP\s+(?:COLUMN\s+)?\w/gi,
    severity: 'warning',
    descriptionKey: 'environment.dangerAlterDropColumn',
  },
  {
    type: 'DROP_INDEX',
    pattern: /\bDROP\s+INDEX\b/gi,
    severity: 'warning',
    descriptionKey: 'environment.dangerDropIndex',
  },
]

/**
 * 检查 DELETE 语句是否真的没有 WHERE 子句
 * 需要对清理后的 SQL 做更精确的判断
 */
function isDeleteWithoutWhere(cleanedSql: string): boolean {
  // 找到所有 DELETE FROM ... 语句并逐个检查
  const deletePattern = /\bDELETE\s+FROM\s+\S+\s*(.*?)(?:;|$)/gi
  let match: RegExpExecArray | null
  while ((match = deletePattern.exec(cleanedSql)) !== null) {
    const afterTable = match[1]?.trim() ?? ''
    // 如果 DELETE FROM table 后面有 WHERE，则不算危险
    if (/\bWHERE\b/i.test(afterTable)) continue
    return true
  }
  return false
}

/**
 * 检查 UPDATE 语句是否真的没有 WHERE 子句
 */
function isUpdateWithoutWhere(cleanedSql: string): boolean {
  const updatePattern = /\bUPDATE\s+\S+\s+SET\s+(.*?)(?:;|$)/gi
  let match: RegExpExecArray | null
  while ((match = updatePattern.exec(cleanedSql)) !== null) {
    const afterSet = match[1]?.trim() ?? ''
    if (/\bWHERE\b/i.test(afterSet)) continue
    return true
  }
  return false
}

/**
 * 检测 SQL 中的危险语句
 * @param sql 原始 SQL 文本
 * @returns 检测到的危险语句列表
 */
export function detectDangerousStatements(sql: string): DangerousStatement[] {
  if (!sql?.trim()) return []

  const cleaned = stripCommentsAndStrings(sql)
  const results: DangerousStatement[] = []

  for (const rule of DETECTION_RULES) {
    // DELETE 和 UPDATE 需要特殊处理（检查是否有 WHERE）
    if (rule.type === 'DELETE_NO_WHERE') {
      if (isDeleteWithoutWhere(cleaned)) {
        results.push({
          type: rule.type,
          description: rule.descriptionKey,
          severity: rule.severity,
          sql: extractMatchContext(sql, /\bDELETE\s+FROM\b/i),
        })
      }
      continue
    }

    if (rule.type === 'UPDATE_NO_WHERE') {
      if (isUpdateWithoutWhere(cleaned)) {
        results.push({
          type: rule.type,
          description: rule.descriptionKey,
          severity: rule.severity,
          sql: extractMatchContext(sql, /\bUPDATE\s+\S+\s+SET\b/i),
        })
      }
      continue
    }

    // 其他规则直接正则匹配
    if (rule.pattern.test(cleaned)) {
      // 重置 lastIndex（因为用了 global flag）
      rule.pattern.lastIndex = 0
      results.push({
        type: rule.type,
        description: rule.descriptionKey,
        severity: rule.severity,
        sql: extractMatchContext(sql, rule.pattern),
      })
      rule.pattern.lastIndex = 0
    }
  }

  return results
}

/**
 * 从原始 SQL 中提取匹配上下文（前后各 30 个字符）
 */
function extractMatchContext(sql: string, pattern: RegExp): string {
  const match = pattern.exec(sql)
  if (!match) return sql.slice(0, 60)
  const start = Math.max(0, match.index)
  const end = Math.min(sql.length, match.index + match[0].length + 30)
  pattern.lastIndex = 0
  return sql.slice(start, end).trim()
}

/**
 * 检查 SQL 是否为只读语句（仅 SELECT / SHOW / DESCRIBE / EXPLAIN）
 */
export function isReadOnlyStatement(sql: string): boolean {
  const cleaned = stripCommentsAndStrings(sql).trim()
  // 按分号拆分多条语句
  const statements = cleaned.split(';').filter((s) => s.trim())
  const readOnlyPattern = /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|USE|SET)\b/i
  return statements.every((stmt) => readOnlyPattern.test(stmt.trim()))
}
