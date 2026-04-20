import { requestApproval, type ApprovalDecision, type ApprovalToolName } from '@/composables/useToolApproval'
import type { ToolCallInfo } from '@/types/ai'
import { tryParseJson } from './chatHelpers'

export async function requestApprovalForTool(
  toolName: ApprovalToolName,
  tc: ToolCallInfo,
  sessionId: string,
  onAwaiting?: () => void,
): Promise<'allow' | 'deny'> {
  const args = tc.parsedArgs ?? tryParseJson(tc.arguments) ?? {}
  tc.approvalState = 'awaiting'
  onAwaiting?.()

  let decision: ApprovalDecision
  if (toolName === 'bash') {
    decision = await requestApproval({
      toolName,
      command: String((args as Record<string, unknown>).command ?? ''),
      newContent: String((args as Record<string, unknown>).command ?? ''),
      sessionId,
    })
  } else if (toolName === 'web_fetch') {
    decision = await requestApproval({
      toolName,
      url: String((args as Record<string, unknown>).url ?? ''),
      sessionId,
    })
  } else if (toolName === 'write_file') {
    decision = await requestApproval({
      toolName,
      path: String((args as Record<string, unknown>).path ?? ''),
      newContent: String((args as Record<string, unknown>).content ?? ''),
      sessionId,
    })
  } else {
    decision = await requestApproval({
      toolName,
      path: String((args as Record<string, unknown>).path ?? ''),
      oldContent: String((args as Record<string, unknown>).old_string ?? ''),
      newContent: String((args as Record<string, unknown>).new_string ?? ''),
      sessionId,
    })
  }

  tc.approvalState = decision === 'deny' ? 'denied' : 'allowed'
  return decision === 'deny' ? 'deny' : 'allow'
}
