import type { ColumnInfo } from './database'

/** SQL Builder 画布中的表 */
export interface SqlBuilderTable {
  /** vue-flow 节点 id */
  id: string
  /** 表名 */
  tableName: string
  /** 别名（自动生成 t1, t2...） */
  alias: string
  /** 列信息 */
  columns: ColumnInfo[]
  /** 已勾选的列名列表 */
  selectedColumns: string[]
}

/** JOIN 类型 */
export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'

/** SQL Builder 中的 JOIN 连接 */
export interface SqlJoin {
  /** vue-flow 边 id */
  id: string
  /** 源表节点 id */
  sourceTable: string
  /** 源列名 */
  sourceColumn: string
  /** 目标表节点 id */
  targetTable: string
  /** 目标列名 */
  targetColumn: string
  /** JOIN 类型 */
  joinType: JoinType
}

/** WHERE 条件操作符 */
export type SqlOperator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL'

/** WHERE 条件 */
export interface SqlCondition {
  id: string
  /** 表别名 */
  tableAlias: string
  /** 列名 */
  column: string
  /** 操作符 */
  operator: SqlOperator
  /** 值（IS NULL / IS NOT NULL 时为空） */
  value: string
  /** 逻辑连接 */
  logic: 'AND' | 'OR'
}

/** ORDER BY 项 */
export interface SqlOrderBy {
  id: string
  /** 表别名 */
  tableAlias: string
  /** 列名 */
  column: string
  /** 排序方向 */
  direction: 'ASC' | 'DESC'
}

/** SQL Builder 完整状态 */
export interface SqlBuilderState {
  tables: SqlBuilderTable[]
  joins: SqlJoin[]
  conditions: SqlCondition[]
  orderBy: SqlOrderBy[]
  limit: number | null
  distinct: boolean
}

/** SqlBuilderTableNode 的 data 类型 */
export interface SqlBuilderNodeData {
  tableName: string
  alias: string
  columns: ColumnInfo[]
  selectedColumns: string[]
}

/** SqlBuilderJoinEdge 的 data 类型 */
export interface SqlBuilderEdgeData {
  sourceColumn: string
  targetColumn: string
  joinType: JoinType
}
