/**
 * EXPLAIN 执行计划结果类型定义
 *
 * MySQL 和 PostgreSQL 的 EXPLAIN 返回完全不同的 JSON 结构，
 * 通过联合类型替代 as any 进行类型安全的访问。
 */

// ---- MySQL EXPLAIN JSON 结构 ----

/** MySQL 表成本信息 */
export interface MysqlCostInfo {
  query_cost?: string
  read_cost?: string
  eval_cost?: string
  prefix_cost?: string
}

/** MySQL EXPLAIN 表描述 */
export interface MysqlTableDesc {
  table_name?: string
  access_type?: string
  rows_examined_per_scan?: number
  filtered?: string | number
  cost_info?: MysqlCostInfo
  key?: string
  possible_keys?: string | string[]
  key_length?: number | string
  ref?: string | string[]
}

/** MySQL EXPLAIN query_block 节点 */
export interface MysqlQueryBlock {
  select_id?: number
  select_type?: string
  cost_info?: MysqlCostInfo
  table?: MysqlTableDesc
  table_name?: string
  access_type?: string
  rows_examined_per_scan?: number
  key?: string
  possible_keys?: string | string[]
  message?: string
  nested_loop?: MysqlQueryBlock[]
  ordering_operation?: MysqlQueryBlock
  grouping_operation?: MysqlQueryBlock
  duplicates_removal?: MysqlQueryBlock
  subqueries?: MysqlQueryBlock[]
}

/** MySQL EXPLAIN 顶层结果 */
export interface MysqlExplainResult {
  query_block: MysqlQueryBlock
}

// ---- PostgreSQL EXPLAIN JSON 结构 ----

/** PostgreSQL EXPLAIN 节点 */
export interface PgPlanNode {
  'Node Type'?: string
  'Relation Name'?: string
  'Actual Rows'?: number
  'Plan Rows'?: number
  'Total Cost'?: number
  'Startup Cost'?: number
  'Index Name'?: string
  'Rows Removed by Filter'?: number
  'Filter'?: string
  Plans?: PgPlanNode[]
  [key: string]: unknown
}

/** PostgreSQL EXPLAIN 顶层结果 */
export interface PgExplainResult {
  Plan: PgPlanNode
  'Planning Time'?: number
  'Execution Time'?: number
}

// ---- 错误和原始文本 ----

/** EXPLAIN 执行出错 */
export interface ExplainError {
  error: string
}

/** EXPLAIN 返回原始文本（非 JSON 格式） */
export interface ExplainRaw {
  raw: string
}

// ---- 联合类型 ----

/** EXPLAIN 结果可能的所有类型 */
export type ExplainResult =
  | MysqlExplainResult
  | PgExplainResult[]
  | ExplainError
  | ExplainRaw
  | Record<string, unknown>

// ---- 类型守卫 ----

export function isMysqlExplain(data: unknown): data is MysqlExplainResult {
  return data !== null && typeof data === 'object' && 'query_block' in (data as Record<string, unknown>)
}

export function isPgExplain(data: unknown): data is PgExplainResult[] {
  return Array.isArray(data)
}

export function isExplainError(data: unknown): data is ExplainError {
  return data !== null && typeof data === 'object' && 'error' in (data as Record<string, unknown>)
}

export function isExplainRaw(data: unknown): data is ExplainRaw {
  return data !== null && typeof data === 'object' && 'raw' in (data as Record<string, unknown>)
}
