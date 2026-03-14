import { invokeCommand } from '@/api/base'

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
  return invokeCommand('save_query_history', record)
}

export function listQueryHistory(params: {
  connectionId?: string | null
  searchText?: string | null
  limit: number
  offset: number
}): Promise<QueryHistoryRecord[]> {
  return invokeCommand('list_query_history', params)
}

export function deleteQueryHistory(id: string): Promise<void> {
  return invokeCommand('delete_query_history', { id })
}

export function clearQueryHistory(connectionId?: string | null): Promise<void> {
  return invokeCommand('clear_query_history', { connectionId: connectionId ?? null })
}
