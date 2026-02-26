import { watch, onBeforeUnmount, type Ref } from 'vue'
import * as monaco from 'monaco-editor'
import type { SchemaCache } from '@/types/database'

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

// Detect table alias or name from text like "FROM users u" or "JOIN orders o ON"
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

export function useSqlCompletion(schema: Ref<SchemaCache | null>) {
  let disposable: monaco.IDisposable | null = null

  function register() {
    // Dispose previous registration
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

        // Check if we're after a dot (e.g., "database." or "table.")
        const lineContent = model.getLineContent(position.lineNumber)
        const charBeforeWord = lineContent.charAt(word.startColumn - 2)

        if (charBeforeWord === '.') {
          // Get the word before the dot
          const beforeDot = model.getWordAtPosition({
            lineNumber: position.lineNumber,
            column: word.startColumn - 1,
          })

          if (beforeDot && currentSchema) {
            const prefix = beforeDot.word

            // Could be database.table or table.column
            // Try as database name first
            const db = currentSchema.databases.get(prefix)
            if (db) {
              for (const [tableName, tableSchema] of db.tables) {
                suggestions.push({
                  label: tableName,
                  kind: tableSchema.tableType === 'VIEW'
                    ? monaco.languages.CompletionItemKind.Interface
                    : monaco.languages.CompletionItemKind.Struct,
                  insertText: tableName,
                  range,
                  detail: tableSchema.tableType,
                })
              }
              return { suggestions }
            }

            // Try as table name - find columns
            for (const [, db] of currentSchema.databases) {
              const table = db.tables.get(prefix)
              if (table) {
                for (const col of table.columns) {
                  suggestions.push({
                    label: col.name,
                    kind: col.isPrimaryKey
                      ? monaco.languages.CompletionItemKind.Field
                      : monaco.languages.CompletionItemKind.Property,
                    insertText: col.name,
                    range,
                    detail: col.dataType,
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
                suggestions.push({
                  label: tableName,
                  kind: tableSchema.tableType === 'VIEW'
                    ? monaco.languages.CompletionItemKind.Interface
                    : monaco.languages.CompletionItemKind.Struct,
                  insertText: tableName,
                  range,
                  detail: tableSchema.tableType,
                  sortText: context === 'table' ? '0_' + tableName : '2_' + tableName,
                })
              }
            }
          }

          // Column names - prioritize columns from tables referenced in the query
          if (!context || context === 'column') {
            const referencedTables = extractTableContext(textUntilPosition)
            const addedColumns = new Set<string>()

            // First add columns from referenced tables (higher priority)
            for (const [, db] of currentSchema.databases) {
              for (const tblName of referencedTables) {
                const table = db.tables.get(tblName)
                if (table) {
                  for (const col of table.columns) {
                    if (!addedColumns.has(col.name)) {
                      addedColumns.add(col.name)
                      suggestions.push({
                        label: col.name,
                        kind: col.isPrimaryKey
                          ? monaco.languages.CompletionItemKind.Field
                          : monaco.languages.CompletionItemKind.Property,
                        insertText: col.name,
                        range,
                        detail: `${tblName}.${col.dataType}`,
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

        // SQL keywords (lower priority when context suggests tables/columns)
        for (const kw of SQL_KEYWORDS) {
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
            sortText: '5_' + kw,
          })
        }

        // SQL functions
        for (const fn of SQL_FUNCTIONS) {
          suggestions.push({
            label: fn,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: fn + '($0)',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            detail: 'Function',
            sortText: '4_' + fn,
          })
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
