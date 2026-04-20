import { aiEnforceToolResultBudget, aiExecuteTool } from '@/api/ai'
import type { AiMessage, ToolCallInfo, ToolResultInfo } from '@/types/ai'
import { ensureErrorString } from '@/types/error'
import type { Logger } from '@/utils/logger'
import { hashArgs, pickApprovalTool } from './chatHelpers'
import { requestApprovalForTool } from './chatToolApproval'

const MAX_SAME_TOOL_FAILURE = 3

export interface ExecuteToolCallsParams {
  sessionId: string
  workDir: string
  toolCalls: ToolCallInfo[]
  toolFailureCounter: Map<string, number>
  log: Logger
  clearWatchdog: () => void
  setInToolExec: (value: boolean) => void
  updateStreamingMessage: (updater: (msg: AiMessage) => AiMessage) => void
  refreshWorkspaceDirectoryForToolPath: (targetPath: string) => Promise<void>
}

function updateToolCalls(
  toolCalls: ToolCallInfo[],
  updateStreamingMessage: ExecuteToolCallsParams['updateStreamingMessage'],
): void {
  updateStreamingMessage(msg => ({ ...msg, toolCalls: [...toolCalls] }))
}

export async function executeToolCalls({
  sessionId,
  workDir,
  toolCalls,
  toolFailureCounter,
  log,
  clearWatchdog,
  setInToolExec,
  updateStreamingMessage,
  refreshWorkspaceDirectoryForToolPath,
}: ExecuteToolCallsParams): Promise<ToolResultInfo[]> {
  setInToolExec(true)
  clearWatchdog()

  try {
    for (const toolCall of toolCalls) {
      const needApproval = pickApprovalTool(toolCall.name) !== null
      toolCall.status = needApproval ? 'pending' : 'running'
    }
    updateToolCalls(toolCalls, updateStreamingMessage)

    const results: ToolResultInfo[] = []
    const promises = toolCalls.map(async (toolCall) => {
      const failureKey = `${toolCall.name}:${hashArgs(toolCall.arguments)}`
      const previousFailures = toolFailureCounter.get(failureKey) ?? 0

      if (previousFailures >= MAX_SAME_TOOL_FAILURE) {
        const argsBrief = toolCall.arguments.length > 80
          ? `${toolCall.arguments.slice(0, 80)}...`
          : toolCall.arguments
        const content = `[CIRCUIT_OPEN] 同一调用 ${toolCall.name}(${argsBrief}) 已连续失败 ${previousFailures} 次，请换一种思路或直接回答用户`
        log.warn('tool_circuit_open', { sessionId, tool: toolCall.name, failures: previousFailures })
        toolCall.status = 'error'
        toolCall.error = content
        results.push({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          success: false,
          content,
        })
        return
      }

      try {
        const approvalTool = pickApprovalTool(toolCall.name)
        if (approvalTool) {
          const decision = await requestApprovalForTool(approvalTool, toolCall, sessionId, () => {
            updateToolCalls(toolCalls, updateStreamingMessage)
          })
          updateToolCalls(toolCalls, updateStreamingMessage)

          if (decision === 'deny') {
            const content = `[user_rejected] 用户拒绝了 ${toolCall.name} 调用`
            toolCall.status = 'error'
            toolCall.error = content
            toolFailureCounter.delete(failureKey)
            results.push({
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              success: false,
              content,
            })
            return
          }

          toolCall.status = 'running'
          updateToolCalls(toolCalls, updateStreamingMessage)
        }

        const result = await aiExecuteTool(
          toolCall.name,
          toolCall.arguments,
          workDir,
          sessionId,
          toolCall.id,
        )

        toolCall.status = result.success ? 'success' : 'error'
        toolCall.result = result.content

        if (!result.success) {
          toolCall.error = result.content
          toolFailureCounter.set(failureKey, previousFailures + 1)
        } else {
          toolFailureCounter.delete(failureKey)

          if (toolCall.name === 'write_file' || toolCall.name === 'edit_file') {
            const rawPath = (toolCall.parsedArgs?.path as string) ?? ''
            const filePath = rawPath
              ? (rawPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rawPath)
                  ? rawPath
                  : `${workDir}/${rawPath}`)
              : ''

            if (filePath) {
              import('@/stores/local-file-editor').then(({ useLocalFileEditorStore }) => {
                useLocalFileEditorStore().close(filePath)
              })
              refreshWorkspaceDirectoryForToolPath(filePath)
                .catch(error => log.warn('refresh_workspace_dir_failed', { filePath }, error))
            }
          }
        }

        results.push({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          success: result.success,
          content: result.content,
        })
      } catch (error) {
        const errMsg = ensureErrorString(error)
        toolCall.status = 'error'
        toolCall.error = errMsg
        toolFailureCounter.set(failureKey, previousFailures + 1)
        results.push({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          success: false,
          content: `工具执行异常: ${errMsg}`,
        })
      }
    })

    await Promise.all(promises)

    try {
      const budgeted = await aiEnforceToolResultBudget(
        sessionId,
        results.map(result => ({
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          content: result.content,
        })),
      )

      for (const item of budgeted) {
        const result = results.find(candidate => candidate.toolCallId === item.toolCallId)
        if (result && result.content !== item.content) {
          result.content = item.content
          const toolCall = toolCalls.find(candidate => candidate.id === item.toolCallId)
          if (toolCall) toolCall.result = item.content
        }
      }
    } catch (error) {
      log.warn('budget_check_failed', { sessionId }, error)
    }

    updateToolCalls(toolCalls, updateStreamingMessage)
    return results
  } finally {
    setInToolExec(false)
  }
}
