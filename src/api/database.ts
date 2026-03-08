import { invoke, Channel } from '@tauri-apps/api/core'
import type { ColumnInfo, ConnectResult, DatabaseInfo, QueryChunk, QueryResult, RoutineInfo, TableInfo, TriggerInfo, ViewInfo, RowChange, ApplyChangesResult, ServerStatus, ProcessInfo, ServerVariable, MysqlUser, CreateUserRequest } from '@/types/database'
import type { PoolStatus, ReconnectParams, ReconnectResult } from '@/types/connection'
import type { ExportFormat } from '@/types/export'

export function dbConnect(connectionId: string): Promise<ConnectResult> {
  return invoke('db_connect', { connectionId })
}

export function dbDisconnect(connectionId: string): Promise<boolean> {
  return invoke('db_disconnect', { connectionId })
}

export function dbIsConnected(connectionId: string): Promise<boolean> {
  return invoke('db_is_connected', { connectionId })
}

/** 执行 SQL 查询，支持可选的超时时间（秒） */
export function dbExecuteQuery(connectionId: string, sql: string, timeoutSecs?: number): Promise<QueryResult> {
  return invoke('db_execute_query', { connectionId, sql, timeoutSecs: timeoutSecs ?? null })
}

/** 在指定数据库上下文中执行 SQL 查询（同一连接上先 USE <database> 再执行） */
export function dbExecuteQueryInDatabase(connectionId: string, database: string, sql: string, timeoutSecs?: number): Promise<QueryResult> {
  return invoke('db_execute_query_in_database', { connectionId, database, sql, timeoutSecs: timeoutSecs ?? null })
}

/**
 * 流式执行 SQL 查询，通过 Tauri Channel 逐批接收 QueryChunk
 *
 * 每 100 行数据推送一个 chunk，前端可收到首批数据即开始渲染，
 * 适用于大数据量 SELECT 查询的首屏加速。
 *
 * @param connectionId 连接 ID
 * @param sql SQL 语句
 * @param onChunk 每批数据到达时的回调
 * @param timeoutSecs 可选超时时间（秒）
 */
export function dbExecuteQueryStream(
  connectionId: string,
  sql: string,
  onChunk: (chunk: QueryChunk) => void,
  timeoutSecs?: number,
): Promise<void> {
  const channel = new Channel<QueryChunk>()
  channel.onmessage = onChunk
  return invoke('db_execute_query_stream', {
    connectionId,
    sql,
    timeoutSecs: timeoutSecs ?? null,
    onChunk: channel,
  })
}

/**
 * 在指定数据库上下文中流式执行 SQL 查询
 *
 * 后端在同一连接上先执行 USE <database>，再流式执行用户 SQL，
 * 确保查询在正确的数据库上下文中执行。
 */
export function dbExecuteQueryStreamInDatabase(
  connectionId: string,
  database: string,
  sql: string,
  onChunk: (chunk: QueryChunk) => void,
  timeoutSecs?: number,
): Promise<void> {
  const channel = new Channel<QueryChunk>()
  channel.onmessage = onChunk
  return invoke('db_execute_query_stream_in_database', {
    connectionId,
    database,
    sql,
    timeoutSecs: timeoutSecs ?? null,
    onChunk: channel,
  })
}

export function dbGetDatabases(connectionId: string): Promise<DatabaseInfo[]> {
  return invoke('db_get_databases', { connectionId })
}

export function dbGetTables(connectionId: string, database: string): Promise<TableInfo[]> {
  return invoke('db_get_tables', { connectionId, database })
}

export function dbGetColumns(
  connectionId: string,
  database: string,
  table: string,
): Promise<ColumnInfo[]> {
  return invoke('db_get_columns', { connectionId, database, table })
}

export function dbGetTableData(
  connectionId: string,
  database: string,
  table: string,
  page: number,
  pageSize: number,
  whereClause?: string | null,
  orderBy?: string | null,
): Promise<QueryResult> {
  return invoke('db_get_table_data', {
    connectionId, database, table, page, pageSize,
    whereClause: whereClause ?? null,
    orderBy: orderBy ?? null,
  })
}

export function dbGetCreateTable(
  connectionId: string,
  database: string,
  table: string,
): Promise<string> {
  return invoke('db_get_create_table', { connectionId, database, table })
}

export function dbCancelQuery(connectionId: string): Promise<boolean> {
  return invoke('db_cancel_query', { connectionId })
}

export function dbGetViews(connectionId: string, database: string): Promise<ViewInfo[]> {
  return invoke('db_get_views', { connectionId, database })
}

export function dbGetProcedures(connectionId: string, database: string): Promise<RoutineInfo[]> {
  return invoke('db_get_procedures', { connectionId, database })
}

export function dbGetFunctions(connectionId: string, database: string): Promise<RoutineInfo[]> {
  return invoke('db_get_functions', { connectionId, database })
}

export function dbGetTriggers(connectionId: string, database: string): Promise<TriggerInfo[]> {
  return invoke('db_get_triggers', { connectionId, database })
}

export function dbGetObjectDefinition(
  connectionId: string,
  database: string,
  name: string,
  objectType: string,
): Promise<string> {
  return invoke('db_get_object_definition', { connectionId, database, name, objectType })
}

export function writeTextFile(path: string, content: string): Promise<void> {
  return invoke('write_text_file', { path, content })
}

/** 获取连接池运行状态（活跃/空闲连接数） */
export function dbGetPoolStatus(connectionId: string): Promise<PoolStatus> {
  return invoke('db_get_pool_status', { connectionId })
}

/** 检查连接是否存活，断开则自动重连（最多 3 次，间隔 5 秒） */
export function dbCheckAndReconnect(connectionId: string, reconnectParams: ReconnectParams): Promise<ReconnectResult> {
  return invoke('db_check_and_reconnect', { connectionId, reconnectParams })
}

/** 开始事务 */
export function dbBeginTransaction(connectionId: string): Promise<boolean> {
  return invoke('db_begin_transaction', { connectionId })
}

/** 提交事务 */
export function dbCommit(connectionId: string): Promise<boolean> {
  return invoke('db_commit', { connectionId })
}

/** 回滚事务 */
export function dbRollback(connectionId: string): Promise<boolean> {
  return invoke('db_rollback', { connectionId })
}

/** 获取 SQL 执行计划（支持 table 和 json 两种格式） */
export function dbExplain(connectionId: string, sql: string, format: string): Promise<QueryResult> {
  return invoke('db_explain', { connectionId, sql, format })
}

/** 批量应用行数据变更（在事务中执行，任一失败全部回滚） */
export function dbApplyRowChanges(connectionId: string, changes: RowChange[]): Promise<ApplyChangesResult> {
  return invoke('db_apply_row_changes', { connectionId, changes })
}


// ===== 性能监控 API =====

/** 获取服务器状态指标（QPS、TPS、连接数等） */
export function dbGetServerStatus(connectionId: string): Promise<ServerStatus> {
  return invoke('db_get_server_status', { connectionId })
}

/** 获取进程列表 */
export function dbGetProcessList(connectionId: string): Promise<ProcessInfo[]> {
  return invoke('db_get_process_list', { connectionId })
}

/** 终止指定进程 */
export function dbKillProcess(connectionId: string, processId: number): Promise<boolean> {
  return invoke('db_kill_process', { connectionId, processId })
}

/** 获取服务器变量 */
export function dbGetServerVariables(connectionId: string): Promise<ServerVariable[]> {
  return invoke('db_get_server_variables', { connectionId })
}

// ===== 用户权限管理 API =====

/** 获取所有 MySQL 用户 */
export function dbGetUsers(connectionId: string): Promise<MysqlUser[]> {
  return invoke('db_get_users', { connectionId })
}

/** 创建新用户 */
export function dbCreateUser(connectionId: string, request: CreateUserRequest): Promise<boolean> {
  return invoke('db_create_user', { connectionId, request })
}

/** 删除用户 */
export function dbDropUser(connectionId: string, username: string, host: string): Promise<boolean> {
  return invoke('db_drop_user', { connectionId, username, host })
}

/** 获取用户权限 */
export function dbGetUserGrants(connectionId: string, username: string, host: string): Promise<string[]> {
  return invoke('db_get_user_grants', { connectionId, username, host })
}

/** 批量执行 GRANT/REVOKE 语句 */
export function dbApplyGrants(connectionId: string, statements: string[]): Promise<boolean> {
  return invoke('db_apply_grants', { connectionId, statements })
}


// ===== 数据导出 API =====

/** 格式名映射：前端小写 → 后端 PascalCase 枚举变体 */
const FORMAT_MAP: Record<ExportFormat, string> = {
  csv: 'Csv',
  json: 'Json',
  sql: 'Sql',
  excel: 'Excel',
  markdown: 'Markdown',
}

/**
 * 调用后端多格式数据导出
 *
 * @param connectionId 连接 ID
 * @param request 导出请求参数（数据来源、格式、文件路径、选项）
 * @returns 导出结果（成功状态、行数、文件大小）
 */
export async function dbExportData(connectionId: string, request: {
  source: { Query: { sql: string; database: string } } | { Table: { database: string; table: string } }
  format: ExportFormat
  filePath: string
  options: {
    csvDelimiter?: string
    csvQuoteChar?: string
    csvIncludeHeader?: boolean
    sqlTableName?: string
    sqlIncludeCreate?: boolean
    sqlBatchSize?: number
    encoding?: string
  }
}): Promise<{ success: boolean; rowCount: number; fileSize: number; error?: string }> {
  return invoke('db_export_data', {
    connectionId,
    request: {
      source: request.source,
      format: FORMAT_MAP[request.format],
      filePath: request.filePath,
      options: {
        csvDelimiter: request.options.csvDelimiter ?? null,
        csvQuoteChar: request.options.csvQuoteChar ?? null,
        csvIncludeHeader: request.options.csvIncludeHeader ?? null,
        sqlTableName: request.options.sqlTableName ?? null,
        sqlIncludeCreate: request.options.sqlIncludeCreate ?? null,
        sqlBatchSize: request.options.sqlBatchSize ?? null,
        encoding: request.options.encoding ?? null,
      },
    },
  })
}


// ===== DDL 脚本生成 API =====

/** 脚本生成选项 */
export interface ScriptOptions {
  /** 是否在 CREATE 语句中包含 IF NOT EXISTS */
  includeIfNotExists: boolean
  /** 是否在 DROP 语句中包含 IF EXISTS */
  includeIfExists: boolean
}

/**
 * 生成数据库对象的 DDL 脚本
 *
 * @param connectionId 连接 ID
 * @param database 数据库名
 * @param objectName 对象名（表名等）
 * @param scriptType 脚本类型：create / drop / insert-template / select-template
 * @param options 脚本生成选项
 * @returns 生成的 SQL 脚本字符串
 */
export function dbGenerateScript(
  connectionId: string,
  database: string,
  objectName: string,
  scriptType: string,
  options: ScriptOptions,
): Promise<string> {
  return invoke('db_generate_script', { connectionId, database, objectName, scriptType, options })
}

/**
 * 导出整个数据库的 DDL 结构脚本
 *
 * @param connectionId 连接 ID
 * @param database 数据库名
 * @param options 脚本生成选项
 * @returns 完整的数据库 DDL 脚本字符串
 */
export function dbExportDatabaseDdl(
  connectionId: string,
  database: string,
  options: ScriptOptions,
): Promise<string> {
  return invoke('db_export_database_ddl', { connectionId, database, options })
}
