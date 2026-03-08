export interface QueryResult {
  columns: ColumnDef[]
  rows: unknown[][]
  affectedRows: number
  executionTimeMs: number
  isError: boolean
  error: string | null
  totalCount: number | null
  truncated: boolean
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
}

export interface TableSchema {
  columns: ColumnInfo[]
  tableType: string
  /** 表注释 */
  comment?: string | null
}

/** 行变更类型 */
export type ChangeType = 'update' | 'insert' | 'delete'

/** 主键列名-值对 */
export interface KeyValue {
  column: string
  value: unknown
}

/** 列名-新值对 */
export interface ColumnValue {
  column: string
  value: unknown
}

/** 单行数据变更（发送给后端） */
export interface RowChange {
  changeType: ChangeType
  database: string
  table: string
  primaryKeys: KeyValue[]
  values: ColumnValue[]
}

/** 批量变更执行结果 */
export interface ApplyChangesResult {
  success: boolean
  affectedRows: number
  generatedSql: string[]
  error: string | null
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
