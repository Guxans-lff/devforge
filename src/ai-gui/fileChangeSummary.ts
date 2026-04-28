import type { AiMessage, FileOperation, ToolCallInfo } from '@/types/ai'

export interface FileChangeSummary {
  operations: FileOperation[]
  total: number
  pending: number
  applied: number
  rejected: number
  errored: number
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || path
}

function inferOperation(toolCall: ToolCallInfo): FileOperation | null {
  if (toolCall.status !== 'success') return null
  if (toolCall.name !== 'write_file' && toolCall.name !== 'edit_file') return null

  const args = toolCall.parsedArgs ?? {}
  const path = typeof args.path === 'string' ? args.path : ''
  if (!path) return null

  if (toolCall.name === 'edit_file') {
    return {
      op: 'modify',
      path,
      fileName: fileNameFromPath(path),
      oldContent: typeof args.old_string === 'string' ? args.old_string : undefined,
      newContent: typeof args.new_string === 'string' ? args.new_string : undefined,
      status: 'pending',
      toolCallId: toolCall.id,
    }
  }

  return {
    op: 'modify',
    path,
    fileName: fileNameFromPath(path),
    newContent: typeof args.content === 'string' ? args.content : undefined,
    status: 'pending',
    toolCallId: toolCall.id,
  }
}

export function collectFileOperations(messages: AiMessage[]): FileOperation[] {
  const byToolCallId = new Map<string, FileOperation>()

  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      const operation = inferOperation(toolCall)
      if (!operation) continue
      byToolCallId.set(operation.toolCallId, operation)
    }
  }

  return Array.from(byToolCallId.values())
}

export function summarizeFileChanges(operations: FileOperation[]): FileChangeSummary {
  return {
    operations,
    total: operations.length,
    pending: operations.filter(op => op.status === 'pending').length,
    applied: operations.filter(op => op.status === 'applied').length,
    rejected: operations.filter(op => op.status === 'rejected').length,
    errored: operations.filter(op => op.status === 'error').length,
  }
}
