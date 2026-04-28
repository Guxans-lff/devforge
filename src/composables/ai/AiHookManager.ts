/**
 * AI Hook 生命周期管理器
 *
 * 提供内部 Hook 机制，用于在关键节点执行副作用：
 * - pre_compact / post_compact：压缩前后
 * - pre_tool_use / post_tool_use：工具执行前后
 * - turn_start / turn_end：对话轮次开始/结束
 * - session_start / session_stop：会话开始/结束
 */

import type { ToolCallInfo, ToolResultInfo } from '@/types/ai'
import type { Logger } from '@/utils/logger'

// ─────────────────────────── Hook 事件类型 ───────────────────────────

export type AiHookEvent =
  | 'pre_compact'
  | 'post_compact'
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'turn_start'
  | 'turn_end'
  | 'session_start'
  | 'session_stop'

// ─────────────────────────── Hook 上下文 ───────────────────────────

export interface PreCompactContext {
  sessionId: string
  messageCount: number
  totalTokens: number
}

export interface PostCompactContext {
  sessionId: string
  originalCount: number
  compressedTokens: number
  summaryLength: number
  source: 'ai' | 'local'
}

export interface PreToolUseContext {
  sessionId: string
  turnId: string
  toolCall: ToolCallInfo
}

export interface PostToolUseContext {
  sessionId: string
  turnId: string
  toolCall: ToolCallInfo
  result: ToolResultInfo
}

export interface TurnStartContext {
  sessionId: string
  turnId: string
}

export interface TurnEndContext {
  sessionId: string
  turnId: string
  status: 'done' | 'error' | 'cancelled'
  duration: number
}

export interface SessionStartContext {
  sessionId: string
}

export interface SessionStopContext {
  sessionId: string
}

export type AiHookContext =
  | { event: 'pre_compact'; context: PreCompactContext }
  | { event: 'post_compact'; context: PostCompactContext }
  | { event: 'pre_tool_use'; context: PreToolUseContext }
  | { event: 'post_tool_use'; context: PostToolUseContext }
  | { event: 'turn_start'; context: TurnStartContext }
  | { event: 'turn_end'; context: TurnEndContext }
  | { event: 'session_start'; context: SessionStartContext }
  | { event: 'session_stop'; context: SessionStopContext }

// ─────────────────────────── Hook 处理函数 ───────────────────────────

export type AiHookContextFor<T extends AiHookEvent> = Extract<AiHookContext, { event: T }>
export type AiHookHandler<T extends AiHookEvent = AiHookEvent> = (ctx: AiHookContextFor<T>['context']) => void | Promise<void>

interface RegisteredHook {
  id: string
  event: AiHookEvent
  handler: (ctx: AiHookContext) => void | Promise<void>
  priority: number
}

// ─────────────────────────── Hook 管理器 ───────────────────────────

let hookIdCounter = 0

export function createAiHookManager(log: Logger) {
  const hooks: RegisteredHook[] = []

  /**
   * 注册 Hook
   * @returns hookId，用于注销
   */
  function register<T extends AiHookEvent>(event: T, handler: AiHookHandler<T>, priority = 0): string {
    hookIdCounter += 1
    const id = `hook-${hookIdCounter}`
    const wrappedHandler = (ctx: AiHookContext) => {
      if (ctx.event !== event) return undefined
      return handler(ctx.context as AiHookContextFor<T>['context'])
    }
    hooks.push({ id, event, handler: wrappedHandler, priority })
    // 按 priority 降序排列（高优先级先执行）
    hooks.sort((a, b) => b.priority - a.priority)
    log.info('hook_registered', { id, event, priority })
    return id
  }

  /**
   * 注销 Hook
   */
  function unregister(id: string): void {
    const idx = hooks.findIndex(h => h.id === id)
    if (idx !== -1) {
      hooks.splice(idx, 1)
      log.info('hook_unregistered', { id })
    }
  }

  /**
   * 触发 Hook（不阻塞主链路，失败只记录不抛出）
   */
  async function emit(ctx: AiHookContext): Promise<void> {
    const matching = hooks.filter(h => h.event === ctx.event)
    if (matching.length === 0) return

    for (const hook of matching) {
      try {
        await hook.handler(ctx)
      } catch (e) {
        log.warn('hook_error', { id: hook.id, event: ctx.event }, e)
      }
    }
  }

  /**
   * 获取指定事件的所有 Hook
   */
  function getHooks(event: AiHookEvent): RegisteredHook[] {
    return hooks.filter(h => h.event === event)
  }

  /**
   * 清除所有 Hook
   */
  function clear(): void {
    hooks.length = 0
  }

  return {
    register,
    unregister,
    emit,
    getHooks,
    clear,
  }
}

export type AiHookManager = ReturnType<typeof createAiHookManager>
