import type { QueryResult } from './database'

export type InnerTabType = 'query' | 'table-editor' | 'import' | 'table-data' | 'schema-compare' | 'performance' | 'user-management' | 'er-diagram' | 'data-sync' | 'scheduler' | 'sql-builder'

/** 查询结果标签页 */
export interface ResultTab {
  id: string
  /** 标签标题 */
  title: string
  /** 查询结果 */
  result: QueryResult
  /** 执行的 SQL */
  sql: string
  /** 是否固定（固定的标签不会被自动关闭） */
  isPinned: boolean
  /** 创建时间戳 */
  createdAt: number
  /** 多语句执行的子结果列表（仅多语句模式） */
  subResults?: SubStatementResult[]
}

/** 多语句执行中每条语句的结果 */
export interface SubStatementResult {
  index: number
  sql: string
  statementType: string
  result: QueryResult
}

export interface InnerTab {
  id: string
  type: InnerTabType
  title: string
  closable: boolean
  dirty?: boolean
  context: QueryTabContext | TableEditorTabContext | ImportTabContext | TableDataTabContext | SchemaCompareTabContext | PerformanceTabContext | UserManagementTabContext | ErDiagramTabContext | DataSyncTabContext | SchedulerTabContext | SqlBuilderTabContext
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
    seekOrderBy?: string
    seekColumn?: string
    seekValue?: number
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
  whereClause?: string
  orderBy?: string
  seekOrderBy?: string
  seekColumn?: string
  seekValue?: number
}

export interface SchemaCompareTabContext {
  type: 'schema-compare'
}

/** 性能监控标签页上下文 */
export interface PerformanceTabContext {
  type: 'performance'
  /** 当前激活的子标签页 */
  activeSubTab: 'dashboard' | 'processes' | 'variables' | 'slow-queries' | 'innodb' | 'index-advisor' | 'explain-compare' | 'audit-log'
}

/** 用户管理标签页上下文 */
export interface UserManagementTabContext {
  type: 'user-management'
}

/** ER 图标签页上下文 */
export interface ErDiagramTabContext {
  type: 'er-diagram'
  /** 数据库名 */
  database: string
}

/** 数据同步标签页上下文 */
export interface DataSyncTabContext {
  type: 'data-sync'
}

/** 调度管理标签页上下文 */
export interface SchedulerTabContext {
  type: 'scheduler'
  /** 从 DataSyncPanel 等模块传递的预填数据 */
  prefill?: {
    taskType: string
    configJson: string
    name?: string
  }
}

/** SQL Builder 标签页上下文 */
export interface SqlBuilderTabContext {
  type: 'sql-builder'
  /** 数据库名 */
  database: string
}

export interface ConnectionWorkspace {
  tabs: InnerTab[]
  activeTabId: string
}
