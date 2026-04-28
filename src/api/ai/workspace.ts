import { invokeAiCommand } from './errors'

export function aiReadWorkspaceConfig(root: string): Promise<string | null> {
  return invokeAiCommand('ai_read_workspace_config', { root }, { source: 'AI' })
}

export function aiWriteWorkspaceConfig(root: string, content: string): Promise<void> {
  return invokeAiCommand('ai_write_workspace_config', { root, content }, { source: 'AI' })
}

export function aiReadContextFile(root: string, path: string, maxLines?: number): Promise<string> {
  return invokeAiCommand('ai_read_context_file', { root, path, maxLines: maxLines ?? null }, { source: 'AI' })
}

export function aiUpdateJournalSection(root: string, marker: string, content: string): Promise<void> {
  return invokeAiCommand('ai_update_journal_section', { root, marker, content }, { source: 'AI' })
}

