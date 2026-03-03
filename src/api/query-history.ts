import { invoke } from '@tauri-apps/api/core'

export interface QueryHistoryRecord {
  id: string
  connectionId: string
  connectionName: string | null
  databaseName: string | null
  sqlText: string
  executionTimeMs: number
  isError: boolean
  errorMessage: string | null
  affectedRows: number
  rowCount: number | null
  executedAt: number
}

export function saveQueryHistory(record: {
  id: string
  connectionId: string
  connectionName?: string | null
  databaseName?: string | null
  sqlText: string
  executionTimeMs: number
  isError: boolean
  errorMessage?: string | null
  affectedRows: number
  rowCount?: number | null
  executedAt: number
}): Promise<void> {
  return invoke('save_query_history', record)
}

export function listQueryHistory(params: {
  connectionId?: string | null
  searchText?: string | null
  limit: number
  offset: number
}): Promise<QueryHistoryRecord[]> {
  return invoke('list_query_history', params)
}

export function deleteQueryHistory(id: string): Promise<void> {
  return invoke('delete_query_history', { id })
}

export function clearQueryHistory(connectionId?: string | null): Promise<void> {
  return invoke('clear_query_history', { connectionId: connectionId ?? null })
}
