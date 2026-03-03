import { invoke } from '@tauri-apps/api/core'

export interface SqlSnippetRecord {
  id: string
  title: string
  description: string | null
  sqlText: string
  category: string | null
  tags: string | null
  connectionId: string | null
  createdAt: number
  updatedAt: number
}

export function listSqlSnippets(params?: {
  category?: string | null
  search?: string | null
}): Promise<SqlSnippetRecord[]> {
  return invoke('list_sql_snippets', {
    category: params?.category ?? null,
    search: params?.search ?? null,
  })
}

export function createSqlSnippet(record: SqlSnippetRecord): Promise<void> {
  return invoke('create_sql_snippet', { record })
}

export function updateSqlSnippet(record: SqlSnippetRecord): Promise<void> {
  return invoke('update_sql_snippet', { record })
}

export function deleteSqlSnippet(id: string): Promise<void> {
  return invoke('delete_sql_snippet', { id })
}
