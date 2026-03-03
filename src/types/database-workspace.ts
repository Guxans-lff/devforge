import type { QueryResult } from './database'

export type InnerTabType = 'query' | 'table-editor' | 'import' | 'table-data' | 'schema-compare'

export interface InnerTab {
  id: string
  type: InnerTabType
  title: string
  closable: boolean
  dirty?: boolean
  context: QueryTabContext | TableEditorTabContext | ImportTabContext | TableDataTabContext | SchemaCompareTabContext
}

export interface QueryTabContext {
  type: 'query'
  sql: string
  result: QueryResult | null
  isExecuting: boolean
  currentDatabase?: string
  // 表浏览模式（点击表名触发）
  tableBrowse?: {
    database: string
    table: string
    currentPage: number
    pageSize: number
    whereClause?: string
    orderBy?: string
  }
}

export interface TableEditorTabContext {
  type: 'table-editor'
  database: string
  table?: string // undefined = 新建表
}

export interface ImportTabContext {
  type: 'import'
  database: string
  table?: string
  columns: string[]
}

export interface TableDataTabContext {
  type: 'table-data'
  database: string
  table: string
  page: number
  pageSize: number
}

export interface SchemaCompareTabContext {
  type: 'schema-compare'
}

export interface ConnectionWorkspace {
  tabs: InnerTab[]
  activeTabId: string
}
