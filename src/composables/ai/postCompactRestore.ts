/**
 * 压缩后上下文恢复
 *
 * 压缩会丢失部分上下文，本模块负责在压缩后重新注入必要信息：
 * 1. 当前工作目录（workDir）
 * 2. 当前打开/选中的文件附件
 * 3. 最近 N 个工具结果摘要
 * 4. 当前 Plan/任务列表状态
 * 5. 数据库上下文（连接、database、table）
 */

import type { AiMessage, FileAttachment } from '@/types/ai'
import type { Logger } from '@/utils/logger'

/** 压缩后恢复的上下文信息 */
export interface PostCompactContext {
  workDir: string
  attachments: FileAttachment[]
  planApproved: boolean
  pendingPlan: string
  /** 最近的工具结果摘要（最多 N 条） */
  recentToolSummaries: string[]
}

/** 恢复上下文注入的最大工具结果数 */
const MAX_RESTORED_TOOL_SUMMARIES = 5
/** 每条工具结果摘要的最大字符数 */
const TOOL_SUMMARY_MAX_CHARS = 300

/**
 * 从消息列表中提取最近的工具结果摘要
 */
function extractRecentToolSummaries(messages: AiMessage[], limit: number): string[] {
  const summaries: string[] = []
  for (let i = messages.length - 1; i >= 0 && summaries.length < limit; i--) {
    const msg = messages[i]!
    if (msg.role !== 'assistant' || !msg.toolResults?.length) continue
    for (const result of [...msg.toolResults].reverse()) {
      if (summaries.length >= limit) break
      const preview = result.content.slice(0, TOOL_SUMMARY_MAX_CHARS)
      summaries.push(`[${result.toolName}] ${preview}${result.content.length > TOOL_SUMMARY_MAX_CHARS ? '...' : ''}`)
    }
  }
  return summaries.reverse()
}

/**
 * 构建压缩后的上下文恢复消息（system 角色）
 *
 * 此消息插入到 compact-boundary 之后、用户下一条消息之前，
 * 确保模型在压缩后仍能感知当前工作状态。
 */
export function buildPostCompactRestoreMessage(
  messages: AiMessage[],
  context: PostCompactContext,
  log: Logger,
): AiMessage | null {
  const parts: string[] = []

  // 工作目录
  if (context.workDir) {
    parts.push(`Current working directory: ${context.workDir}`)
  }

  // 文件附件
  const readyAttachments = context.attachments.filter(a => a.status === 'ready')
  if (readyAttachments.length > 0) {
    const fileList = readyAttachments.map(a => `- ${a.name} (${a.path})`).join('\n')
    parts.push(`Active file attachments:\n${fileList}`)
  }

  // Plan 状态
  if (context.pendingPlan && !context.planApproved) {
    parts.push(`Pending plan awaiting approval:\n${context.pendingPlan.slice(0, 500)}`)
  } else if (context.planApproved) {
    parts.push('Plan was approved and is being executed.')
  }

  // 最近工具结果摘要
  const toolSummaries = extractRecentToolSummaries(messages, MAX_RESTORED_TOOL_SUMMARIES)
  if (toolSummaries.length > 0) {
    parts.push(`Recent tool results (for context):\n${toolSummaries.join('\n')}`)
  }

  if (parts.length === 0) return null

  const content = `[Post-compact context restoration]\n\n${parts.join('\n\n')}`
  log.info('post_compact_restore', { parts: parts.length, chars: content.length })

  return {
    id: `post-compact-restore-${Date.now()}`,
    role: 'system',
    content,
    timestamp: Date.now(),
  }
}
