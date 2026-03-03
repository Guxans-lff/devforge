import { invoke } from '@tauri-apps/api/core'
import type { ColumnInfo, DatabaseInfo, QueryResult, RoutineInfo, TableInfo, TriggerInfo, ViewInfo } from '@/types/database'

export function dbConnect(connectionId: string): Promise<boolean> {
  return invoke('db_connect', { connectionId })
}

export function dbDisconnect(connectionId: string): Promise<boolean> {
  return invoke('db_disconnect', { connectionId })
}

export function dbIsConnected(connectionId: string): Promise<boolean> {
  return invoke('db_is_connected', { connectionId })
}

export function dbExecuteQuery(connectionId: string, sql: string): Promise<QueryResult> {
  return invoke('db_execute_query', { connectionId, sql })
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
