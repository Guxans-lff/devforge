import { invoke } from '@tauri-apps/api/core'
import type { ColumnInfo, DatabaseInfo, QueryResult, TableInfo } from '@/types/database'

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
): Promise<QueryResult> {
  return invoke('db_get_table_data', { connectionId, database, table, page, pageSize })
}

export function dbGetCreateTable(
  connectionId: string,
  database: string,
  table: string,
): Promise<string> {
  return invoke('db_get_create_table', { connectionId, database, table })
}

export function writeTextFile(path: string, content: string): Promise<void> {
  return invoke('write_text_file', { path, content })
}
