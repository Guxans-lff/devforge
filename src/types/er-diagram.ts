import type { ColumnInfo } from '@/types/database'

/** ER 图表节点数据 */
export interface ErTableNodeData {
  /** 表名 */
  tableName: string
  /** 数据库名 */
  database: string
  /** 列信息列表 */
  columns: ColumnInfo[]
  /** 表注释 */
  comment?: string
  /** 是否高亮（搜索匹配时） */
  highlighted?: boolean
}

/** ER 图关系边数据 */
export interface ErEdgeData {
  /** 约束名 */
  constraintName?: string
  /** 源列 */
  sourceColumn: string
  /** 目标列 */
  targetColumn: string
  /** 关系标签 */
  relationLabel?: string
}

/** ER 图布局选项 */
export interface ErLayoutOptions {
  /** 布局方向 */
  direction: 'TB' | 'LR'
  /** 节点间距 */
  nodeSpacing: number
  /** 层级间距 */
  rankSpacing: number
}
