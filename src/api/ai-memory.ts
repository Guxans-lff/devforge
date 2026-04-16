/**
 * AI 记忆系统 API 层
 *
 * 封装记忆和压缩相关的 Tauri 命令调用。
 */

import { invokeCommand } from '@/api/base'
import type { AiMemory, AiCompaction } from '@/types/ai'

/** 按工作区查询记忆列表 */
export function aiListMemories(workspaceId: string): Promise<AiMemory[]> {
  return invokeCommand('ai_list_memories', { workspaceId }, { source: 'AI' })
}

/** 保存记忆（新增或更新） */
export function aiSaveMemory(memory: AiMemory): Promise<void> {
  return invokeCommand('ai_save_memory', { memory }, { source: 'AI' })
}

/** 删除记忆 */
export function aiDeleteMemory(id: string): Promise<void> {
  return invokeCommand('ai_delete_memory', { id }, { source: 'AI' })
}

/** 按关键词搜索记忆 */
export function aiSearchMemories(workspaceId: string, keywords: string[]): Promise<AiMemory[]> {
  return invokeCommand('ai_search_memories', { workspaceId, keywords }, { source: 'AI' })
}

/** 保存压缩记录 */
export function aiSaveCompaction(compaction: AiCompaction): Promise<void> {
  return invokeCommand('ai_save_compaction', { compaction }, { source: 'AI' })
}

/** 查询会话的压缩历史 */
export function aiListCompactions(sessionId: string): Promise<AiCompaction[]> {
  return invokeCommand('ai_list_compactions', { sessionId }, { source: 'AI' })
}
