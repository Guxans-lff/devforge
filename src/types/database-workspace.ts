import type { QueryResult } from './database'

export type InnerTabType = 'query' | 'table-editor' | 'import' | 'table-data' | 'schema-compare' | 'performance' | 'user-management'

/** 查询结果标签页 */
export interface ResultTab {
  id: string
  /** 标签标题：SQL 前 30 字符 + 执行时间 */
  title: string
  /** 查询结果 */
  result: QueryResult
  /** 执行的 SQL */
  sql: string
  /** 是否固定（固定的标签不会被自动关闭） */
  isPinned: boolean
  /** 创建时间戳 */
  createdAt: number
}

export interface InnerTab {
  id: string
  type: InnerTabType
  title: string
  closable: boolean
  dirty?: boolean
  context: QueryTabContext | TableEditorTabContext | ImportTabContext | TableDataTabContext | SchemaCompareTabContext | PerformanceTabContext | UserManagementTabContext
}

export interface QueryTabContext {
  type: 'query'
  sql: string
  result: QueryResult | null
  isExecuting: boolean
  isInTransaction?: boolean    // 事务状态
  queryTimeout?: number        // 查询超时（秒）
  currentDatabase?: string
  /** 结果标签页列表 */
  resultTabs?: ResultTab[]
  /** 当前激活的结果标签页 ID */
  activeResultTabId?: string
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

/** 性能监控标签页上下文 */
export interface PerformanceTabContext {
  type: 'performance'
  /** 当前激活的子标签页 */
  activeSubTab: 'dashboard' | 'processes' | 'variables'
}

/** 用户管理标签页上下文 */
export interface UserManagementTabContext {
  type: 'user-management'
}

export interface ConnectionWorkspace {
  tabs: InnerTab[]
  activeTabId: string
}
