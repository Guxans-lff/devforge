import { invokeCommand } from '@/api/base'

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
  return invokeCommand('list_sql_snippets', {
    category: params?.category ?? null,
    search: params?.search ?? null,
  })
}

export function createSqlSnippet(record: SqlSnippetRecord): Promise<void> {
  return invokeCommand('create_sql_snippet', { record })
}

export function updateSqlSnippet(record: SqlSnippetRecord): Promise<void> {
  return invokeCommand('update_sql_snippet', { record })
}

export function deleteSqlSnippet(id: string): Promise<void> {
  return invokeCommand('delete_sql_snippet', { id })
}
