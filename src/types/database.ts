export interface QueryResult {
  columns: ColumnDef[]
  rows: unknown[][]
  affectedRows: number
  executionTimeMs: number
  isError: boolean
  error: string | null
  totalCount: number | null
  truncated: boolean
  /** 多语句执行汇总（仅多语句模式下存在） */
  multiStatementSummary?: {
    total: number
    success: number
    fail: number
  }
  tableName?: string
}

export interface ColumnDef {
  name: string
  dataType: string
  nullable: boolean
}

export interface TableInfo {
  name: string
  tableType: string
  rowCount: number | null
  comment: string | null
}

export interface ColumnInfo {
  name: string
  dataType: string
  nullable: boolean
  defaultValue: string | null
  isPrimaryKey: boolean
  comment: string | null
}

export interface SchemaBundle {
  tables: TableInfo[]
  foreignKeys: ForeignKeyRelation[]
  allColumns: Record<string, ColumnInfo[]>
}

export interface DatabaseInfo {
  name: string
  characterSet: string | null
  collation: string | null
}

/** 连接结果：包含连接状态和预加载的数据库列表 */
export interface ConnectResult {
  success: boolean
  databases: DatabaseInfo[]
}

/** 流式查询数据块（通过 Tauri Channel 逐批推送） */
export interface QueryChunk {
  /** 批次序号（从 0 开始） */
  chunkIndex: number
  /** 列定义（仅首批包含） */
  columns: ColumnDef[]
  /** 本批数据行 */
  rows: unknown[][]
  /** 是否为最后一批 */
  isLast: boolean
  /** 总耗时（ms），仅最后一批包含 */
  totalTimeMs: number | null
  /** 错误信息 */
  error: string | null
}

export interface ViewInfo {
  name: string
  definer: string | null
  checkOption: string | null
  isUpdatable: string | null
}

export interface RoutineInfo {
  name: string
  routineType: string
  definer: string | null
  created: string | null
  modified: string | null
  comment: string | null
}

export interface TriggerInfo {
  name: string
  event: string
  timing: string
  tableName: string
  statement: string | null
}

/** 存储过程/函数的参数信息 */
export interface RoutineParameter {
  name: string
  dataType: string
  dtdIdentifier: string
  mode: string      // IN / OUT / INOUT
  position: number
}

export interface DatabaseTreeNode {
  id: string
  label: string
  type: 'database' | 'table' | 'view' | 'column' | 'folder' | 'procedure' | 'function' | 'trigger'
  icon?: string
  children?: DatabaseTreeNode[]
  isLoading?: boolean
  isExpanded?: boolean
  folderType?: 'tables' | 'views' | 'procedures' | 'functions' | 'triggers'
  meta?: {
    database?: string
    table?: string
    dataType?: string
    isPrimaryKey?: boolean
    nullable?: boolean
    comment?: string
    objectType?: string
    routineType?: string
    definer?: string
    created?: string
    event?: string
    timing?: string
  }
}

export interface SchemaCache {
  databases: Map<string, DatabaseSchema>
}

export interface DatabaseSchema {
  tables: Map<string, TableSchema>
  /** 外键关系列表（用于 JOIN 补全推荐） */
  foreignKeys?: ForeignKeyRelation[]
}

/** 外键关系信息（用于 SQL 补全 JOIN 推荐） */
export interface ForeignKeyRelation {
  tableName: string
  columnName: string
  referencedTableName: string
  referencedColumnName: string
}

export interface TableSchema {
  columns: ColumnInfo[]
  tableType: string
  /** 表注释 */
  comment?: string | null
}

// ===== 性能监控相关类型 =====

/** 服务器状态指标 */
export interface ServerStatus {
  qps: number
  tps: number
  activeConnections: number
  totalConnections: number
  bufferPoolUsage: number
  slowQueries: number
  uptime: number
  bytesSent: number
  bytesReceived: number
  rawStatus: ServerVariable[]
}

/** 进程信息 */
export interface ProcessInfo {
  id: number
  user: string
  host: string
  db: string | null
  command: string
  time: number
  state: string | null
  info: string | null
}

/** 服务器变量 */
export interface ServerVariable {
  name: string
  value: string
}

// ===== 用户权限管理相关类型 =====

/** MySQL 用户信息 */
export interface MysqlUser {
  user: string
  host: string
  authenticationString: string | null
  plugin: string | null
  accountLocked: string | null
  passwordExpired: string | null
}

/** 创建用户请求 */
export interface CreateUserRequest {
  username: string
  host: string
  password: string
  plugin: string | null
  /** 密码过期天数，null 表示不设置过期策略 */
  passwordExpireDays: number | null
}


// ===== 多语句执行相关类型 =====

/** 单条语句的执行结果 */
export interface StatementResult {
  /** 语句序号（从 1 开始） */
  index: number
  /** 原始 SQL 文本 */
  sql: string
  /** 语句类型（SELECT / INSERT / UPDATE 等） */
  statementType: string
  /** 执行结果（复用 QueryResult） */
  result: QueryResult
}

export interface BatchDatabaseExecutionResult {
  database: string
  success: boolean
  result: QueryResult
  executionTimeMs: number
  stoppedByStrategy?: boolean
}

export interface BatchExecutionSummary {
  targetDatabases: string[]
  skippedDatabases?: string[]
  stoppedByStrategy?: boolean
}

/** 多语句执行的错误策略 */
export type ErrorStrategy = 'stopOnError' | 'continueOnError'

// ===== 索引分析相关类型 =====

/** 索引分析综合结果 */
export interface IndexAnalysisResult {
  /** 冗余索引列表 */
  redundantIndexes: RedundantIndex[]
  /** 未使用索引列表 */
  unusedIndexes: UnusedIndex[]
  /** 索引建议 */
  suggestions: IndexSuggestion[]
}

/** 冗余索引信息 */
export interface RedundantIndex {
  tableName: string
  indexName: string
  indexColumns: string[]
  coveredBy: string
  coveredByColumns: string[]
  dropSql: string
}

/** 未使用索引信息 */
export interface UnusedIndex {
  tableName: string
  indexName: string
  indexColumns: string[]
  sizeEstimate: string
  dropSql: string
}

/** 索引建议 */
export interface IndexSuggestion {
  tableName: string
  columns: string[]
  reason: string
  estimatedImprovement: string
  createSql: string
}

// ===== 性能诊断相关类型 =====

/** 慢查询摘要（来自 performance_schema） */
export interface SlowQueryDigest {
  digestText: string
  execCount: number
  avgTimeMs: number
  maxTimeMs: number
  totalTimeMs: number
  rowsExamined: number
  rowsSent: number
  firstSeen: string | null
  lastSeen: string | null
}

/** InnoDB 引擎状态 */
export interface InnoDbStatus {
  bufferPoolPagesTotal: number
  bufferPoolPagesFree: number
  bufferPoolPagesDirty: number
  bufferPoolHitRate: number
  rowLockCurrentWaits: number
  rowLockTimeAvgMs: number
  deadlocks: number
  logBytesWritten: number
  logPendingFsyncs: number
  rowsRead: number
  rowsInserted: number
  rowsUpdated: number
  rowsDeleted: number
}

/** 审计日志条目 */
export interface AuditLogEntry {
  id: string
  connectionId: string
  connectionName: string | null
  databaseName: string | null
  operationType: string
  sqlText: string
  affectedRows: number
  executionTimeMs: number
  isError: boolean
  errorMessage: string | null
  createdAt: number
}

/** 审计日志统计 */
export interface AuditStats {
  total: number
  errorCount: number
  earliest: number | null
  latest: number | null
}
