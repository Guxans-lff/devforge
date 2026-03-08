import type { QueryResult } from '@/types/database'

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function toCSV(result: QueryResult): string {
  const header = result.columns.map((c) => escapeCSV(c.name)).join(',')
  const rows = result.rows.map((row) => row.map((v) => escapeCSV(v)).join(','))
  return [header, ...rows].join('\n')
}

export function toJSON(result: QueryResult): string {
  const data = result.rows.map((row) => {
    const obj: Record<string, unknown> = {}
    result.columns.forEach((col, i) => {
      obj[col.name] = row[i]
    })
    return obj
  })
  return JSON.stringify(data, null, 2)
}

function escapeSQLValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}

export function toSQL(result: QueryResult, tableName: string = 'exported_table'): string {
  if (result.rows.length === 0) return '-- No data to export'
  const colNames = result.columns.map((c) => `\`${c.name}\``).join(', ')
  const inserts = result.rows.map((row) => {
    const values = row.map((v) => escapeSQLValue(v)).join(', ')
    return `INSERT INTO \`${tableName}\` (${colNames}) VALUES (${values});`
  })
  return inserts.join('\n')
}

/** 将查询结果转换为 Markdown 表格格式 */
export function toMarkdown(result: QueryResult): string {
  if (result.columns.length === 0) return ''
  // 表头
  const header = '| ' + result.columns.map(c => c.name).join(' | ') + ' |'
  // 分隔行
  const separator = '| ' + result.columns.map(() => '---').join(' | ') + ' |'
  // 数据行（将管道符转义，避免破坏表格结构）
  const rows = result.rows.map(row =>
    '| ' + row.map(v => {
      const str = v === null || v === undefined ? 'NULL' : String(v)
      return str.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    }).join(' | ') + ' |'
  )
  return [header, separator, ...rows].join('\n')
}

export type ExportFormat = 'csv' | 'json' | 'sql' | 'markdown'

/** 根据导出格式返回文件扩展名 */
export function getFileExtension(format: ExportFormat): string {
  switch (format) {
    case 'csv': return 'csv'
    case 'json': return 'json'
    case 'sql': return 'sql'
    case 'markdown': return 'md'
  }
}

/** 根据导出格式返回文件对话框过滤器 */
export function getFilters(format: ExportFormat): { name: string; extensions: string[] }[] {
  switch (format) {
    case 'csv': return [{ name: 'CSV Files', extensions: ['csv'] }]
    case 'json': return [{ name: 'JSON Files', extensions: ['json'] }]
    case 'sql': return [{ name: 'SQL Files', extensions: ['sql'] }]
    case 'markdown': return [{ name: 'Markdown Files', extensions: ['md'] }]
  }
}

/** 将查询结果格式化为指定格式的字符串（客户端导出） */
export function formatData(result: QueryResult, format: ExportFormat, tableName?: string): string {
  switch (format) {
    case 'csv': return toCSV(result)
    case 'json': return toJSON(result)
    case 'sql': return toSQL(result, tableName)
    case 'markdown': return toMarkdown(result)
  }
}
