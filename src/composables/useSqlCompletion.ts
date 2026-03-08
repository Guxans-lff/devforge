import { onBeforeUnmount, type Ref } from 'vue'
import * as monaco from 'monaco-editor'
import type { SchemaCache } from '@/types/database'
import { getSnippetTemplates, getExtraFunctions } from '@/utils/sqlSnippets'

// SQL keywords for completion
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE',
  'IS', 'NULL', 'AS', 'ON', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
  'FULL', 'CROSS', 'UNION', 'ALL', 'DISTINCT', 'GROUP', 'BY', 'HAVING',
  'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'INSERT', 'INTO', 'VALUES',
  'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'ALTER', 'DROP', 'INDEX',
  'VIEW', 'DATABASE', 'IF', 'EXISTS', 'PRIMARY', 'KEY', 'FOREIGN',
  'REFERENCES', 'CONSTRAINT', 'DEFAULT', 'AUTO_INCREMENT', 'NOT', 'NULL',
  'UNIQUE', 'CHECK', 'CASCADE', 'TRUNCATE', 'EXPLAIN', 'SHOW', 'DESCRIBE',
  'USE', 'GRANT', 'REVOKE', 'COMMIT', 'ROLLBACK', 'BEGIN', 'TRANSACTION',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'COALESCE', 'CAST', 'CONVERT',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'HAVING', 'WITH', 'RECURSIVE',
]

const SQL_FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'IFNULL', 'NULLIF',
  'CAST', 'CONVERT', 'CONCAT', 'SUBSTRING', 'LENGTH', 'TRIM', 'UPPER',
  'LOWER', 'REPLACE', 'LEFT', 'RIGHT', 'LPAD', 'RPAD', 'REVERSE',
  'NOW', 'CURDATE', 'CURTIME', 'DATE', 'TIME', 'YEAR', 'MONTH', 'DAY',
  'HOUR', 'MINUTE', 'SECOND', 'DATE_FORMAT', 'DATE_ADD', 'DATE_SUB',
  'DATEDIFF', 'TIMESTAMPDIFF', 'ABS', 'CEIL', 'FLOOR', 'ROUND',
  'MOD', 'POWER', 'SQRT', 'RAND', 'IF', 'CASE', 'GROUP_CONCAT',
  'JSON_EXTRACT', 'JSON_OBJECT', 'JSON_ARRAY', 'ROW_NUMBER', 'RANK',
  'DENSE_RANK', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE',
]

// 模块级缓存：预构建静态建议项（不含 range，运行时合并）
type PartialSuggestion = Omit<monaco.languages.CompletionItem, 'range'>

const cachedKeywordSuggestions: PartialSuggestion[] = SQL_KEYWORDS.map(kw => ({
  label: kw,
  kind: monaco.languages.CompletionItemKind.Keyword,
  insertText: kw,
  sortText: '5_' + kw,
}))

const cachedFunctionSuggestions: PartialSuggestion[] = SQL_FUNCTIONS.map(fn => ({
  label: fn,
  kind: monaco.languages.CompletionItemKind.Function,
  insertText: fn + '($0)',
  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  detail: 'Function',
  sortText: '4_' + fn,
}))

// 按 driver 缓存 snippet/extraFn 建议项
const snippetCache = new Map<string, PartialSuggestion[]>()
const extraFnCache = new Map<string, PartialSuggestion[]>()

function getCachedSnippets(driverKey: string): PartialSuggestion[] {
  let cached = snippetCache.get(driverKey)
  if (!cached) {
    cached = getSnippetTemplates(driverKey).map(s => ({
      label: s.label,
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText: s.insertText,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: s.detail,
      documentation: s.documentation,
      sortText: '6_' + s.label,
    }))
    snippetCache.set(driverKey, cached)
  }
  return cached
}

function getCachedExtraFns(driverKey: string): PartialSuggestion[] {
  let cached = extraFnCache.get(driverKey)
  if (!cached) {
    cached = getExtraFunctions(driverKey).map(fn => ({
      label: fn.label,
      kind: monaco.languages.CompletionItemKind.Function,
      insertText: fn.insertText,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: fn.detail,
      documentation: fn.documentation,
      sortText: '4_' + fn.label,
    }))
    extraFnCache.set(driverKey, cached)
  }
  return cached
}

// Context detection: what kind of token precedes the cursor
function getContextKeyword(textBeforeCursor: string): string | null {
  // Remove string literals and comments
  const cleaned = textBeforeCursor
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  // Find the last significant SQL keyword before cursor
  const tokens = cleaned.toUpperCase().split(/\s+/).filter(Boolean)

  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i]
    if (!token) continue
    if (['FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE'].includes(token)) {
      return 'table'
    }
    if (['SELECT', 'WHERE', 'ON', 'SET', 'HAVING', 'BY'].includes(token)) {
      return 'column'
    }
    if (['DATABASE', 'USE', 'SCHEMA'].includes(token)) {
      return 'database'
    }
  }
  return null
}

// Extract table alias mappings from SQL text
// Handles: FROM users u, FROM users AS u, JOIN orders o, JOIN orders AS o
function extractTableAliases(text: string): Map<string, string> {
  const aliasMap = new Map<string, string>()
  // Clean string literals and comments
  const cleaned = text
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  const pattern = /(?:FROM|JOIN)\s+(?:`?(\w+)`?\.)?`?(\w+)`?\s+(?:AS\s+)?(\w+)/gi
  let match
  while ((match = pattern.exec(cleaned)) !== null) {
    const tableName = match[2]
    const alias = match[3]
    if (alias) {
      const upper = alias.toUpperCase()
      // Skip SQL keywords that look like aliases
      if (['ON', 'WHERE', 'SET', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS',
        'FULL', 'JOIN', 'AND', 'OR', 'ORDER', 'GROUP', 'HAVING', 'LIMIT',
        'UNION', 'INTO', 'VALUES', 'AS'].includes(upper)) continue
      aliasMap.set(alias, tableName!)
    }
  }
  return aliasMap
}

// Detect table names referenced in the query
function extractTableContext(textBeforeCursor: string): string[] {
  const tablePattern = /(?:FROM|JOIN|UPDATE|INTO)\s+(?:`?(\w+)`?\.)?`?(\w+)`?/gi
  const tables: string[] = []
  let match
  while ((match = tablePattern.exec(textBeforeCursor)) !== null) {
    if (match[2]) {
      tables.push(match[2])
    }
  }
  return tables
}

export function useSqlCompletion(
  schema: Ref<SchemaCache | null>,
  driver?: Ref<string | undefined>,
  isLoadingSchema?: Ref<boolean>,
) {
  let disposable: monaco.IDisposable | null = null

  function register() {
    disposable?.dispose()

    disposable = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.', ' ', '`'],
      provideCompletionItems(model, position) {
        const textUntilPosition = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        })

        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        }

        const suggestions: monaco.languages.CompletionItem[] = []
        const currentSchema = schema.value
        const currentDriver = driver?.value

        // Schema 缓存加载中时，显示加载提示项
        if (isLoadingSchema?.value) {
          suggestions.push({
            label: '正在加载 Schema...',
            kind: monaco.languages.CompletionItemKind.Text,
            insertText: '',
            range,
            sortText: '0_loading',
            detail: '请稍候，正在加载数据库元数据',
            command: undefined,
          })
        }

        // Check if we're after a dot (e.g., "database." or "table." or "alias.")
        const lineContent = model.getLineContent(position.lineNumber)
        const charBeforeWord = lineContent.charAt(word.startColumn - 2)

        if (charBeforeWord === '.') {
          const beforeDot = model.getWordAtPosition({
            lineNumber: position.lineNumber,
            column: word.startColumn - 1,
          })

          if (beforeDot && currentSchema) {
            const prefix = beforeDot.word

            // Try as database name first → suggest tables
            const db = currentSchema.databases.get(prefix)
            if (db) {
              for (const [tableName, tableSchema] of db.tables) {
                // 表补全项：显示表类型和表注释
                const tableDetail = tableSchema.comment
                  ? `${tableSchema.tableType} - ${tableSchema.comment}`
                  : tableSchema.tableType
                suggestions.push({
                  label: tableName,
                  kind: tableSchema.tableType === 'VIEW'
                    ? monaco.languages.CompletionItemKind.Interface
                    : monaco.languages.CompletionItemKind.Struct,
                  insertText: tableName,
                  range,
                  detail: tableDetail,
                })
              }
              return { suggestions }
            }

            // Try as table alias → resolve to actual table name
            const aliasMap = extractTableAliases(textUntilPosition)
            const resolvedName = aliasMap.get(prefix) || prefix

            // Try as table name → suggest columns
            for (const [, dbSchema] of currentSchema.databases) {
              const table = dbSchema.tables.get(resolvedName)
              if (table) {
                for (const col of table.columns) {
                  // 列补全项：格式 "列名 - 数据类型 - 注释"
                  const detailParts = [col.dataType]
                  if (col.comment) detailParts.push(col.comment)
                  const colDetail = col.isPrimaryKey
                    ? `🔑 ${detailParts.join(' - ')}`
                    : detailParts.join(' - ')
                  suggestions.push({
                    label: col.name,
                    kind: col.isPrimaryKey
                      ? monaco.languages.CompletionItemKind.Field
                      : monaco.languages.CompletionItemKind.Property,
                    insertText: col.name,
                    range,
                    detail: colDetail,
                    documentation: col.comment ?? undefined,
                  })
                }
                return { suggestions }
              }
            }
          }
          return { suggestions }
        }

        // Context-aware suggestions
        const context = getContextKeyword(textUntilPosition)

        if (currentSchema) {
          // Database names
          if (!context || context === 'database') {
            for (const [dbName] of currentSchema.databases) {
              suggestions.push({
                label: dbName,
                kind: monaco.languages.CompletionItemKind.Module,
                insertText: dbName,
                range,
                detail: 'Database',
                sortText: '1_' + dbName,
              })
            }
          }

          // Table names
          if (!context || context === 'table' || context === 'column') {
            for (const [, db] of currentSchema.databases) {
              for (const [tableName, tableSchema] of db.tables) {
                // 表补全项：显示表类型和表注释
                const tableDetail = tableSchema.comment
                  ? `${tableSchema.tableType} - ${tableSchema.comment}`
                  : tableSchema.tableType
                suggestions.push({
                  label: tableName,
                  kind: tableSchema.tableType === 'VIEW'
                    ? monaco.languages.CompletionItemKind.Interface
                    : monaco.languages.CompletionItemKind.Struct,
                  insertText: tableName,
                  range,
                  detail: tableDetail,
                  sortText: context === 'table' ? '0_' + tableName : '2_' + tableName,
                })
              }
            }
          }

          // Column names - prioritize columns from referenced tables and aliases
          if (!context || context === 'column') {
            const referencedTables = extractTableContext(textUntilPosition)
            const aliasMap = extractTableAliases(textUntilPosition)
            // Also include alias-resolved table names
            for (const [, tbl] of aliasMap) {
              if (!referencedTables.includes(tbl)) {
                referencedTables.push(tbl)
              }
            }
            const addedColumns = new Set<string>()

            for (const [, db] of currentSchema.databases) {
              for (const tblName of referencedTables) {
                const table = db.tables.get(tblName)
                if (table) {
                  for (const col of table.columns) {
                    if (!addedColumns.has(col.name)) {
                      addedColumns.add(col.name)
                      // 列补全项：格式 "表名.数据类型 - 注释"
                      const detailParts = [`${tblName}.${col.dataType}`]
                      if (col.comment) detailParts.push(col.comment)
                      const colDetail = col.isPrimaryKey
                        ? `🔑 ${detailParts.join(' - ')}`
                        : detailParts.join(' - ')
                      suggestions.push({
                        label: col.name,
                        kind: col.isPrimaryKey
                          ? monaco.languages.CompletionItemKind.Field
                          : monaco.languages.CompletionItemKind.Property,
                        insertText: col.name,
                        range,
                        detail: colDetail,
                        documentation: col.comment ?? undefined,
                        sortText: context === 'column' ? '0_' + col.name : '3_' + col.name,
                      })
                    }
                  }
                }
              }
            }
          }
        }

        // SQL code snippet templates（模块级缓存）
        const driverKey = currentDriver ?? ''
        for (const s of getCachedSnippets(driverKey)) {
          suggestions.push({ ...s, range })
        }

        // MySQL/PG extra functions with signatures（模块级缓存）
        for (const fn of getCachedExtraFns(driverKey)) {
          suggestions.push({ ...fn, range })
        }

        // SQL keywords（模块级缓存）
        for (const kw of cachedKeywordSuggestions) {
          suggestions.push({ ...kw, range })
        }

        // SQL built-in functions（模块级缓存）
        for (const fn of cachedFunctionSuggestions) {
          suggestions.push({ ...fn, range })
        }

        return { suggestions }
      },
    })
  }

  // Register once — the provider reads schema.value reactively at call time
  register()

  onBeforeUnmount(() => {
    disposable?.dispose()
    disposable = null
  })

  return { register }
}
