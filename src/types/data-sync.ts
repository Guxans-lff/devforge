/** 数据同步配置 */
export interface SyncConfig {
  /** 源连接 ID */
  sourceConnectionId: string
  /** 源数据库名 */
  sourceDatabase: string
  /** 目标连接 ID */
  targetConnectionId: string
  /** 目标数据库名 */
  targetDatabase: string
  /** 要同步的表列表 */
  tables: string[]
  /** 同步模式：full（全量 TRUNCATE + INSERT）| upsert */
  syncMode: 'full' | 'upsert'
  /** 每页行数（默认 5000） */
  pageSize?: number
}

/** 同步进度事件（通过 Tauri Channel 推送给前端） */
export interface SyncProgress {
  /** 当前同步的表名 */
  table: string
  /** 当前表在列表中的索引（从 0 开始） */
  tableIndex: number
  /** 表总数 */
  tableCount: number
  /** 当前表已同步行数 */
  syncedRows: number
  /** 当前表总行数 */
  totalRows: number
  /** 当前阶段描述 */
  stage: string
  /** 是否已完成 */
  finished: boolean
  /** 错误信息（仅失败时包含） */
  error: string | null
}

/** 同步预览信息 */
export interface SyncPreview {
  /** 表名 */
  table: string
  /** 源表行数 */
  sourceRows: number
  /** 目标表行数 */
  targetRows: number
  /** 列定义列表 */
  columns: string[]
  /** 主键列（用于 upsert 模式） */
  primaryKeys: string[]
}
