import { invoke } from '@tauri-apps/api/core'

export interface CommandSnippet {
  id: string
  title: string
  command: string
  description?: string
  category?: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export function listCommandSnippets(
  category?: string,
  search?: string,
): Promise<CommandSnippet[]> {
  return invoke('list_command_snippets', { category, search })
}

export function createCommandSnippet(record: CommandSnippet): Promise<void> {
  return invoke('create_command_snippet', { record })
}

export function updateCommandSnippet(record: CommandSnippet): Promise<void> {
  return invoke('update_command_snippet', { record })
}

export function deleteCommandSnippet(id: string): Promise<void> {
  return invoke('delete_command_snippet', { id })
}
