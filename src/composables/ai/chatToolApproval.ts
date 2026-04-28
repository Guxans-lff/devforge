import { requestApproval, type ApprovalDecision, type ApprovalToolName } from '@/composables/useToolApproval'
import type { ToolCallInfo } from '@/types/ai'
import { tryParseJson } from './chatHelpers'

export async function requestApprovalForTool(
  toolName: ApprovalToolName,
  tc: ToolCallInfo,
  sessionId: string,
  onAwaiting?: () => void,
  warning?: string,
  requiresDoubleConfirm?: boolean,
): Promise<'allow' | 'deny'> {
  const args = tc.parsedArgs ?? tryParseJson(tc.arguments) ?? {}
  tc.approvalState = 'awaiting'
  onAwaiting?.()

  let decision: ApprovalDecision
  if (toolName === 'bash') {
    const command = String((args as Record<string, unknown>).command ?? '')
    decision = await requestApproval({
      toolName,
      command,
      newContent: command,
      sessionId,
      warning,
      requiresDoubleConfirm,
    })
  } else if (toolName === 'web_fetch' || toolName === 'web_search') {
    decision = await requestApproval({
      toolName,
      url: String((args as Record<string, unknown>).url ?? (args as Record<string, unknown>).query ?? ''),
      sessionId,
      warning,
      requiresDoubleConfirm,
    })
  } else if (toolName === 'write_file') {
    decision = await requestApproval({
      toolName,
      path: String((args as Record<string, unknown>).path ?? ''),
      newContent: String((args as Record<string, unknown>).content ?? ''),
      sessionId,
      warning,
      requiresDoubleConfirm,
    })
  } else if (toolName === 'edit_file') {
    decision = await requestApproval({
      toolName,
      path: String((args as Record<string, unknown>).path ?? ''),
      oldContent: String((args as Record<string, unknown>).old_string ?? ''),
      newContent: String((args as Record<string, unknown>).new_string ?? ''),
      sessionId,
      warning,
      requiresDoubleConfirm,
    })
  } else {
    decision = await requestApproval({
      toolName,
      path: String((args as Record<string, unknown>).path ?? (args as Record<string, unknown>).query ?? ''),
      newContent: tc.arguments,
      sessionId,
      warning,
      requiresDoubleConfirm,
    })
  }

  tc.approvalState = decision === 'deny' ? 'denied' : 'allowed'
  return decision === 'deny' ? 'deny' : 'allow'
}
