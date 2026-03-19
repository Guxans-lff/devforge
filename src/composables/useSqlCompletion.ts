import { onBeforeUnmount, type Ref } from 'vue'
import * as monaco from 'monaco-editor'
import type { SchemaCache, ColumnInfo } from '@/types/database'
import { getSnippetTemplates, getExtraFunctions } from '@/utils/sqlSnippets'
import { getCompletionScore, recordCompletionUsage } from '@/utils/completionFrequency'

// ── 全局命令：记录补全项选择频率（仅注册一次）──
let recordCommandRegistered = false
const RECORD_COMMAND_ID = 'devforge.recordCompletion'

function ensureRecordCommandRegistered() {
  if (recordCommandRegistered) return
  recordCommandRegistered = true
  monaco.editor.registerCommand(RECORD_COMMAND_ID, (_accessor, label: string) => {
    if (label) recordCompletionUsage(label)
  })
}

/** 构建补全项的 command 字段，用于在用户确认选择时记录频率 */
function makeRecordCommand(label: string): monaco.languages.Command {
  return {
    id: RECORD_COMMAND_ID,
    title: '记录补全选择',
    arguments: [label],
  }
}

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

// ── 模块级缓存：预构建静态建议项（不含 range，运行时合并）──

type PartialSuggestion = Omit<monaco.languages.CompletionItem, 'range'>

const cachedKeywordSuggestions: PartialSuggestion[] = SQL_KEYWORDS.map(kw => ({
  label: kw,
  kind: monaco.languages.CompletionItemKind.Keyword,
  insertText: kw,
  sortText: buildSortText(5, kw),
}))

const cachedFunctionSuggestions: PartialSuggestion[] = SQL_FUNCTIONS.map(fn => ({
  label: fn,
  kind: monaco.languages.CompletionItemKind.Function,
  insertText: fn + '($0)',
  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  detail: 'Function',
  sortText: buildSortText(4, fn),
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
      sortText: buildSortText(6, String(s.label)),
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
      sortText: buildSortText(4, String(fn.label)),
    }))
    extraFnCache.set(driverKey, cached)
  }
  return cached
}

// ── 频率排序 ──

/**
 * 构建 Monaco sortText：优先级分组 + 频率分数 + 标签名
 * Monaco 按字典序排列 sortText，值越小越靠前。
 * 频率分数 0.0-1.0 映射为 z(低频)-a(高频)。
 */
function buildSortText(priority: number, label: string): string {
  const score = getCompletionScore(label)
  // 分数越高 → 字符越小 → 排越前
  const scoreChar = String.fromCharCode(122 - Math.floor(score * 25))
  return `${priority}_${scoreChar}_${label}`
}

// ── 上下文检测 ──

/** 检测光标前的 SQL 上下文类型 */
function getContextKeyword(textBeforeCursor: string): string | null {
  const cleaned = textBeforeCursor
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

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

/** 提取 SQL 中的表别名映射 */
function extractTableAliases(text: string): Map<string, string> {
  const aliasMap = new Map<string, string>()
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
      if (['ON', 'WHERE', 'SET', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS',
        'FULL', 'JOIN', 'AND', 'OR', 'ORDER', 'GROUP', 'HAVING', 'LIMIT',
        'UNION', 'INTO', 'VALUES', 'AS'].includes(upper)) continue
      aliasMap.set(alias, tableName!)
    }
  }
  return aliasMap
}

/** 提取 SQL 中引用的表名列表 */
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

// ── CTE 解析 ──

/**
 * 解析 SQL 中的 CTE 定义名称
 * 匹配 WITH name AS (...), name2 AS (...) 格式
 */
function extractCteNames(text: string): string[] {
  const cleaned = text
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  const names: string[] = []
  const withPattern = /\bWITH\s+(?:RECURSIVE\s+)?/gi
  const match = withPattern.exec(cleaned)
  if (!match) return names

  const afterWith = cleaned.substring(match.index + match[0].length)
  const ctePattern = /(\w+)\s+AS\s*\(/gi
  let cteMatch
  while ((cteMatch = ctePattern.exec(afterWith)) !== null) {
    names.push(cteMatch[1]!)
  }

  return names
}

// ── JOIN ON 智能推荐 ──

/** 简单英语单数化（users → user, categories → category） */
function singularize(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('ies')) return lower.slice(0, -3) + 'y'
  if (lower.endsWith('ses') || lower.endsWith('xes') || lower.endsWith('zes')) return lower.slice(0, -2)
  if (lower.endsWith('s') && !lower.endsWith('ss')) return lower.slice(0, -1)
  return lower
}

/** 从别名映射中反查表名对应的别名 */
function findAlias(aliasMap: Map<string, string>, tableName: string): string {
  for (const [alias, tbl] of aliasMap) {
    if (tbl === tableName) return alias
  }
  return tableName
}

/**
 * 基于命名模式推测 JOIN 条件
 * 规则：tableA 有 "tableB_id" 列且 tableB 有 "id" 列 → tableA.tableB_id = tableB.id
 */
function guessJoinCondition(
  tableA: string, colsA: ColumnInfo[],
  tableB: string, colsB: ColumnInfo[],
): Array<{ leftCol: string; rightCol: string }> {
  const results: Array<{ leftCol: string; rightCol: string }> = []
  const singularB = singularize(tableB)
  const singularA = singularize(tableA)

  // A 中有 B_id 样式的列
  for (const col of colsA) {
    const lower = col.name.toLowerCase()
    if (lower === `${singularB}_id` || lower === `${tableB.toLowerCase()}_id`) {
      const pkCol = colsB.find(c => c.isPrimaryKey) || colsB.find(c => c.name.toLowerCase() === 'id')
      if (pkCol) {
        results.push({ leftCol: col.name, rightCol: pkCol.name })
      }
    }
  }

  // B 中有 A_id 样式的列（反向）
  for (const col of colsB) {
    const lower = col.name.toLowerCase()
    if (lower === `${singularA}_id` || lower === `${tableA.toLowerCase()}_id`) {
      const pkCol = colsA.find(c => c.isPrimaryKey) || colsA.find(c => c.name.toLowerCase() === 'id')
      if (pkCol) {
        results.push({ leftCol: pkCol.name, rightCol: col.name })
      }
    }
  }

  return results
}

/**
 * 检测 JOIN tableName 上下文，生成 ON 条件补全建议
 * 策略 1：基于外键关系精确推荐
 * 策略 2：基于命名模式推测
 */
function buildJoinOnSuggestions(
  textBeforeCursor: string,
  schema: SchemaCache | null,
  range: monaco.IRange,
): monaco.languages.CompletionItem[] {
  if (!schema) return []

  // 检测模式: ... JOIN tableName [AS alias] ⌃（空格结尾，尚未输入 ON）
  const joinPattern = /(?:JOIN)\s+(?:`?(\w+)`?\.)?`?(\w+)`?(?:\s+(?:AS\s+)?(\w+))?\s+$/i
  const match = joinPattern.exec(textBeforeCursor)
  if (!match) return []

  const joinedTable = match[2]!
  const joinedAlias = match[3] || joinedTable

  const aliasMap = extractTableAliases(textBeforeCursor)
  const mainTables = extractTableContext(textBeforeCursor)
    .filter(t => t !== joinedTable)

  const suggestions: monaco.languages.CompletionItem[] = []

  // 策略 1：基于外键关系
  for (const [, dbSchema] of schema.databases) {
    if (!dbSchema.foreignKeys) continue
    for (const fk of dbSchema.foreignKeys) {
      // joinedTable 有外键指向某个已出现的表
      if (fk.tableName === joinedTable && mainTables.includes(fk.referencedTableName)) {
        const mainAlias = findAlias(aliasMap, fk.referencedTableName)
        const text = `ON ${joinedAlias}.${fk.columnName} = ${mainAlias}.${fk.referencedColumnName}`
        suggestions.push({
          label: text,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: text,
          range,
          detail: '🔗 外键关系',
          sortText: '0_join_a_' + fk.columnName,
          preselect: true,
        })
      }
      // 某个已出现的表有外键指向 joinedTable
      if (fk.referencedTableName === joinedTable && mainTables.includes(fk.tableName)) {
        const mainAlias = findAlias(aliasMap, fk.tableName)
        const text = `ON ${mainAlias}.${fk.columnName} = ${joinedAlias}.${fk.referencedColumnName}`
        suggestions.push({
          label: text,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: text,
          range,
          detail: '🔗 外键关系',
          sortText: '0_join_a_' + fk.columnName,
          preselect: true,
        })
      }
    }
  }

  // 策略 2：命名模式推测（仅在外键无结果时）
  if (suggestions.length === 0) {
    for (const [, dbSchema] of schema.databases) {
      const joinedTableSchema = dbSchema.tables.get(joinedTable)
      if (!joinedTableSchema) continue
      for (const mainTable of mainTables) {
        const mainSchema = dbSchema.tables.get(mainTable)
        if (!mainSchema) continue
        const guesses = guessJoinCondition(
          joinedTable, joinedTableSchema.columns,
          mainTable, mainSchema.columns,
        )
        const mainAlias = findAlias(aliasMap, mainTable)
        for (const g of guesses) {
          const text = `ON ${joinedAlias}.${g.leftCol} = ${mainAlias}.${g.rightCol}`
          suggestions.push({
            label: text,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: text,
            range,
            detail: '💡 命名推测',
            sortText: '0_join_b_' + g.leftCol,
          })
        }
      }
    }
  }

  return suggestions
}

// ── 模块级单例：确保全局仅注册一个 SQL CompletionItemProvider ──
// 多个 useSqlCompletion 实例共享同一个 provider，通过闭包引用各自的 schema/driver/isLoadingSchema
let globalDisposable: monaco.IDisposable | null = null
let activeSchema: Ref<SchemaCache | null> | null = null
let activeDriver: Ref<string | undefined> | undefined
let activeIsLoadingSchema: Ref<boolean> | undefined
let activeInstanceCount = 0

// ── 主函数 ──

export function useSqlCompletion(
  schema: Ref<SchemaCache | null>,
  driver?: Ref<string | undefined>,
  isLoadingSchema?: Ref<boolean>,
) {
  // 更新活跃引用（最新挂载的实例优先）
  activeSchema = schema
  activeDriver = driver
  activeIsLoadingSchema = isLoadingSchema
  activeInstanceCount++

  function register() {
    // 如果全局 provider 已存在，只需更新引用即可，不重复注册
    activeSchema = schema
    activeDriver = driver
    activeIsLoadingSchema = isLoadingSchema
    if (globalDisposable) return

    globalDisposable = monaco.languages.registerCompletionItemProvider('sql', {
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
        // 使用全局活跃引用，确保始终读取最新挂载实例的数据
        const currentSchema = activeSchema?.value ?? null
        const currentDriver = activeDriver?.value

        /** 返回前统一附加频率记录命令 */
        function finalize(): { suggestions: monaco.languages.CompletionItem[] } {
          for (const s of suggestions) {
            if (!s.command && s.insertText) {
              s.command = makeRecordCommand(String(s.label))
            }
          }
          return { suggestions }
        }

        // Schema 缓存加载中时，显示加载提示项
        if (activeIsLoadingSchema?.value) {
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

        // ── JOIN ON 条件智能推荐（优先级最高）──
        const joinOnSuggestions = buildJoinOnSuggestions(textUntilPosition, currentSchema, range)
        if (joinOnSuggestions.length > 0) {
          suggestions.push(...joinOnSuggestions)
          // 同时保留 ON 关键字补全
          suggestions.push({
            label: 'ON',
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: 'ON ',
            range,
            sortText: '0_ON',
          })
          return finalize()
        }

        // ── 点号补全（database.table 或 table.column）──
        const lineContent = model.getLineContent(position.lineNumber)
        const charBeforeWord = lineContent.charAt(word.startColumn - 2)

        if (charBeforeWord === '.') {
          const beforeDot = model.getWordAtPosition({
            lineNumber: position.lineNumber,
            column: word.startColumn - 1,
          })

          if (beforeDot && currentSchema) {
            const prefix = beforeDot.word

            // 尝试作为数据库名 → 建议表名
            const db = currentSchema.databases.get(prefix)
            if (db) {
              for (const [tableName, tableSchema] of db.tables) {
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
              return finalize()
            }

            // 尝试作为表别名 → 解析为实际表名 → 建议列名
            const aliasMap = extractTableAliases(textUntilPosition)
            const resolvedName = aliasMap.get(prefix) || prefix

            for (const [, dbSchema] of currentSchema.databases) {
              const table = dbSchema.tables.get(resolvedName)
              if (table) {
                for (const col of table.columns) {
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
                return finalize()
              }
            }
          }
          return finalize()
        }

        // ── 上下文感知补全 ──
        const context = getContextKeyword(textUntilPosition)

        if (currentSchema) {
          // 数据库名
          if (!context || context === 'database') {
            for (const [dbName] of currentSchema.databases) {
              suggestions.push({
                label: dbName,
                kind: monaco.languages.CompletionItemKind.Module,
                insertText: dbName,
                range,
                detail: 'Database',
                sortText: buildSortText(1, dbName),
              })
            }
          }

          // 表名 + CTE 名称
          if (!context || context === 'table' || context === 'column') {
            for (const [, db] of currentSchema.databases) {
              for (const [tableName, tableSchema] of db.tables) {
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
                  sortText: context === 'table'
                    ? buildSortText(0, tableName)
                    : buildSortText(2, tableName),
                })
              }
            }

            // CTE 名称作为虚拟表补全
            const cteNames = extractCteNames(model.getValue())
            for (const cteName of cteNames) {
              suggestions.push({
                label: cteName,
                kind: monaco.languages.CompletionItemKind.Variable,
                insertText: cteName,
                range,
                detail: 'CTE',
                sortText: context === 'table'
                  ? buildSortText(0, cteName)
                  : buildSortText(2, cteName),
              })
            }
          }

          // 列名 - 优先展示已引用表的列
          if (!context || context === 'column') {
            const referencedTables = extractTableContext(textUntilPosition)
            const aliasMap = extractTableAliases(textUntilPosition)
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
                        sortText: context === 'column'
                          ? buildSortText(0, col.name)
                          : buildSortText(3, col.name),
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

        return finalize()
      },
    })
  }

  // 确保频率记录全局命令已注册
  ensureRecordCommandRegistered()

  // 注册一次 — provider 在运行时读取全局活跃引用
  register()

  onBeforeUnmount(() => {
    activeInstanceCount--
    // 仅当所有实例都销毁时才释放全局 provider
    if (activeInstanceCount <= 0) {
      globalDisposable?.dispose()
      globalDisposable = null
      activeSchema = null
      activeDriver = undefined
      activeIsLoadingSchema = undefined
      activeInstanceCount = 0
    }
  })

  return { register }
}
