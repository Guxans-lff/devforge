/** 导出文件格式（前端使用小写，后端使用 PascalCase） */
export type ExportFormat = 'csv' | 'json' | 'sql' | 'excel' | 'markdown'

/** 导出配置（前端表单状态） */
export interface ExportConfig {
  /** 导出格式 */
  format: ExportFormat
  /** 导出文件路径 */
  filePath: string
  /** CSV 分隔符 */
  csvDelimiter?: string
  /** CSV 文本限定符 */
  csvQuoteChar?: string
  /** CSV 是否包含列标题 */
  csvIncludeHeader?: boolean
  /** SQL 导出目标表名 */
  sqlTableName?: string
  /** SQL 是否包含 CREATE TABLE 语句 */
  sqlIncludeCreate?: boolean
  /** SQL 每批 INSERT 行数 */
  sqlBatchSize?: number
}

/** 导出进度（通过 Tauri 事件推送） */
export interface ExportProgress {
  /** 当前已导出行数 */
  current: number
  /** 总行数 */
  total: number
  /** 进度百分比 (0-100) */
  percentage: number
}
