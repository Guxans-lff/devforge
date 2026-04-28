import { invokeAiCommand } from './errors'
import type { McpStatusResult, ToolDefinition, ToolExecResult } from '@/types/ai'

export function aiGetTools(): Promise<ToolDefinition[]> {
  return invokeAiCommand('ai_get_tools', undefined, { source: 'AI' })
}

export function aiGetMcpStatus(workDir: string): Promise<McpStatusResult> {
  return invokeAiCommand('ai_get_mcp_status', { workDir }, { source: 'AI' })
}

export function aiExecuteTool(
  name: string,
  args: string,
  workDir: string,
  sessionId: string,
  toolCallId: string,
  timeoutMs?: number,
): Promise<ToolExecResult> {
  return invokeAiCommand(
    'ai_execute_tool',
    { name, arguments: args, workDir, sessionId, toolCallId, timeoutMs: timeoutMs ?? null },
    { source: 'AI' },
  )
}

export interface ToolResultEntry {
  toolCallId: string
  toolName: string
  content: string
}

export function aiEnforceToolResultBudget(
  sessionId: string,
  results: ToolResultEntry[],
): Promise<ToolResultEntry[]> {
  return invokeAiCommand(
    'ai_enforce_tool_result_budget',
    { sessionId, results },
    { source: 'AI' },
  )
}

export function aiReadToolResultFile(
  sessionId: string,
  toolCallId: string,
): Promise<string> {
  return invokeAiCommand(
    'ai_read_tool_result_file',
    { sessionId, toolCallId },
    { source: 'AI' },
  )
}

export function aiRevertWriteFile(
  sessionId: string,
  toolCallId: string,
  targetPath: string,
): Promise<string> {
  return invokeAiCommand(
    'ai_revert_write_file',
    { sessionId, toolCallId, targetPath },
    { source: 'AI' },
  )
}

