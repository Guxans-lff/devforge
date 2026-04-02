/** 支持的任务类型 */
export type TaskType = 'data_sync' | 'db_backup'

/** 数据库备份配置 */
export interface BackupConfig {
  /** 连接 ID */
  connectionId: string
  /** 数据库名 */
  database: string
  /** 要备份的表列表（空数组 = 全部表） */
  tables: string[]
  /** 是否包含表结构 */
  includeStructure: boolean
  /** 是否包含数据 */
  includeData: boolean
  /** 输出目录（文件名自动生成带时间戳） */
  outputDir: string
}

/** 调度任务 */
export interface ScheduledTask {
  /** 任务唯一标识（UUID） */
  id: string
  /** 任务名称 */
  name: string
  /** 任务类型（如 "data_sync"） */
  taskType: string
  /** cron 表达式（分 时 日 月 周） */
  cronExpr: string
  /** 任务配置 JSON（根据 taskType 解析为具体配置） */
  configJson: string
  /** 是否启用 */
  enabled: boolean
  /** 上次执行时间（Unix 时间戳毫秒） */
  lastRun: number | null
  /** 下次执行时间（Unix 时间戳毫秒） */
  nextRun: number | null
  /** 创建时间（Unix 时间戳毫秒） */
  createdAt: number
  /** 更新时间（Unix 时间戳毫秒） */
  updatedAt: number
}

/** 任务执行记录 */
export interface TaskExecution {
  /** 记录唯一标识（UUID） */
  id: string
  /** 关联的任务 ID */
  taskId: string
  /** 执行状态 */
  status: 'running' | 'success' | 'failed' | 'cancelled'
  /** 开始时间（Unix 时间戳毫秒） */
  startedAt: number
  /** 结束时间（Unix 时间戳毫秒） */
  finishedAt: number | null
  /** 执行结果摘要 */
  resultSummary: string | null
  /** 错误信息 */
  error: string | null
}
