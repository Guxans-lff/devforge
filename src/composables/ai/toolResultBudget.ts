/**
 * 工具结果预算（前端侧）
 *
 * 后端 `aiEnforceToolResultBudget` 负责落盘替换，
 * 本模块负责：
 * 1. 检测结果是否已被落盘（含 <persisted-output> 标签）
 * 2. 从落盘预览中提取摘要和 tool_call_id
 * 3. 提供"展开查看全文"的读取接口
 */

import { aiReadToolResultFile } from '@/api/ai'
import type { ToolResultInfo } from '@/types/ai'

/** 落盘预览标签（与后端 tool_result_store.rs 一致） */
const PERSISTED_OPEN_TAG = '<persisted-output>'
const PERSISTED_CLOSE_TAG = '</persisted-output>'

/** 落盘预览信息 */
export interface PersistedPreview {
  toolCallId: string
  toolName: string
  /** 预览摘要（标签内的文本） */
  preview: string
  /** 原始字符数 */
  originalChars: number
}

/**
 * 检测工具结果是否已被落盘
 */
export function isPersistedResult(content: string): boolean {
  return content.includes(PERSISTED_OPEN_TAG)
}

/**
 * 从落盘预览中提取摘要文本
 */
export function extractPersistedPreview(content: string): string | null {
  const openIdx = content.indexOf(PERSISTED_OPEN_TAG)
  const closeIdx = content.indexOf(PERSISTED_CLOSE_TAG)
  if (openIdx === -1 || closeIdx === -1) return null
  return content.slice(openIdx + PERSISTED_OPEN_TAG.length, closeIdx).trim()
}

/**
 * 读取落盘的完整工具结果
 *
 * @param sessionId 会话 ID
 * @param toolCallId 工具调用 ID
 * @returns 完整内容，失败返回 null
 */
export async function readFullToolResult(
  sessionId: string,
  toolCallId: string,
): Promise<string | null> {
  try {
    return await aiReadToolResultFile(sessionId, toolCallId)
  } catch {
    return null
  }
}

/**
 * 为工具结果列表生成预算摘要（用于 UI 展示）
 *
 * 返回每个结果的摘要信息，落盘结果标注为 persisted。
 */
export function summarizeToolResults(results: ToolResultInfo[]): Array<{
  toolCallId: string
  toolName: string
  summary: string
  isPersisted: boolean
  originalLength: number
}> {
  return results.map(result => {
    const persisted = isPersistedResult(result.content)
    const preview = persisted ? extractPersistedPreview(result.content) : null
    return {
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      summary: preview ?? result.content.slice(0, 500),
      isPersisted: persisted,
      originalLength: result.content.length,
    }
  })
}
