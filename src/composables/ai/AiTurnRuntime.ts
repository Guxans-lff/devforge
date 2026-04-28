/**
 * AI Turn 状态机
 *
 * 统一一轮 AI 交互的状态，替代分散在 isStreaming/isLoading/error/streamState 中的状态猜测。
 * UI 只需订阅 turnState 即可准确反映当前阶段。
 */

import { computed, reactive } from 'vue'
import type { AiStreamEvent, ToolCallInfo } from '@/types/ai'
import type { Logger } from '@/utils/logger'
import { tryParseJson } from './chatHelpers'

// ─────────────────────────── 状态定义 ───────────────────────────

export type AiTurnPhase =
  | 'idle'
  | 'preparing'
  | 'streaming'
  | 'tool_executing'
  | 'compacting'
  | 'recovering'
  | 'completed'
  | 'failed'
  | 'aborted'

export interface AiTurnState {
  phase: AiTurnPhase
  turnId: string
  /** 当前流式消息 ID（streaming/tool_executing 阶段有效） */
  messageId?: string
  /** 正在执行的工具调用 ID 列表 */
  executingToolIds?: string[]
  /** 错误信息（failed/recovering 阶段有效） */
  error?: string
  /** 错误是否可重试 */
  retryable?: boolean
  /** 恢复尝试次数 */
  recoveryAttempt?: number
  /** 完成摘要（completed 阶段有效） */
  summary?: string
  /** 流式累积文本（streaming 阶段实时更新） */
  pendingTextDelta?: string
  /** 流式累积思考（streaming 阶段实时更新） */
  pendingThinkingDelta?: string
  /** 待处理的工具调用列表 */
  pendingToolCalls?: ToolCallInfo[]
  /** 最后一次 finish reason */
  lastFinishReason?: string
  /** turn 开始时间 */
  startedAt?: number
  /** turn 结束时间 */
  finishedAt?: number
}

// ─────────────────────────── 流式状态（内部使用） ───────────────────────────

export interface AiStreamAccumulator {
  pendingTextDelta: string
  pendingThinkingDelta: string
  pendingToolCalls: ToolCallInfo[]
  lastFinishReason: string
  lastErrorRetryable?: boolean
  streamingMessageId: string
  inToolExec: boolean
}

// ─────────────────────────── Watchdog ───────────────────────────

const DEFAULT_STREAM_WATCHDOG_MS = 60_000
const DEFAULT_TOOL_WATCHDOG_MS = 120_000

export interface WatchdogConfig {
  /** 流式无数据超时（ms） */
  streamTimeoutMs?: number
  /** 工具执行超时（ms） */
  toolTimeoutMs?: number
}

// ─────────────────────────── Turn ID 生成 ───────────────────────────

let turnCounter = 0

export function generateTurnId(): string {
  turnCounter += 1
  return `turn-${Date.now()}-${turnCounter.toString(36)}`
}

// ─────────────────────────── Runtime ───────────────────────────

export interface AiTurnRuntimeOptions {
  log: Logger
  watchdog?: WatchdogConfig
  onWatchdogTimeout?: (phase: 'streaming' | 'tool_executing', turnId: string) => void
}

export function createAiTurnRuntime(options: AiTurnRuntimeOptions) {
  const { log, watchdog, onWatchdogTimeout } = options

  const streamTimeoutMs = watchdog?.streamTimeoutMs ?? DEFAULT_STREAM_WATCHDOG_MS
  const toolTimeoutMs = watchdog?.toolTimeoutMs ?? DEFAULT_TOOL_WATCHDOG_MS

  // ── 核心状态 ──
  const state = reactive<AiTurnState>({
    phase: 'idle',
    turnId: '',
  })

  // ── 流式累积器（内部） ──
  const streamAccumulator: AiStreamAccumulator = {
    pendingTextDelta: '',
    pendingThinkingDelta: '',
    pendingToolCalls: [],
    lastFinishReason: '',
    streamingMessageId: '',
    inToolExec: false,
  }

  // ── Watchdog 定时器 ──
  let streamWatchdogTimer: ReturnType<typeof setTimeout> | null = null
  let toolWatchdogTimer: ReturnType<typeof setTimeout> | null = null

  function clearStreamWatchdog(): void {
    if (streamWatchdogTimer) {
      clearTimeout(streamWatchdogTimer)
      streamWatchdogTimer = null
    }
  }

  function clearToolWatchdog(): void {
    if (toolWatchdogTimer) {
      clearTimeout(toolWatchdogTimer)
      toolWatchdogTimer = null
    }
  }

  function clearAllWatchdogs(): void {
    clearStreamWatchdog()
    clearToolWatchdog()
  }

  function resetStreamWatchdog(): void {
    clearStreamWatchdog()
    if (state.phase === 'streaming') {
      streamWatchdogTimer = setTimeout(() => {
        log.warn('stream_watchdog_timeout', { turnId: state.turnId })
        onWatchdogTimeout?.('streaming', state.turnId)
      }, streamTimeoutMs)
    }
  }

  function resetToolWatchdog(): void {
    clearToolWatchdog()
    if (state.phase === 'tool_executing') {
      toolWatchdogTimer = setTimeout(() => {
        log.warn('tool_watchdog_timeout', { turnId: state.turnId })
        onWatchdogTimeout?.('tool_executing', state.turnId)
      }, toolTimeoutMs)
    }
  }

  // ── 状态转换 ──

  function startTurn(): string {
    const turnId = generateTurnId()
    Object.assign(state, {
      phase: 'preparing',
      turnId,
      messageId: undefined,
      executingToolIds: undefined,
      error: undefined,
      retryable: undefined,
      recoveryAttempt: undefined,
      summary: undefined,
      pendingTextDelta: '',
      pendingThinkingDelta: '',
      pendingToolCalls: [],
      lastFinishReason: undefined,
      startedAt: Date.now(),
      finishedAt: undefined,
    })
    // 重置累积器
    streamAccumulator.pendingTextDelta = ''
    streamAccumulator.pendingThinkingDelta = ''
    streamAccumulator.pendingToolCalls = []
    streamAccumulator.lastFinishReason = ''
    streamAccumulator.lastErrorRetryable = undefined
    streamAccumulator.streamingMessageId = ''
    streamAccumulator.inToolExec = false
    log.info('turn_start', { turnId })
    return turnId
  }

  function transitionToStreaming(messageId: string): void {
    if (state.phase === 'aborted') return
    state.phase = 'streaming'
    state.messageId = messageId
    streamAccumulator.streamingMessageId = messageId
    resetStreamWatchdog()
  }

  function transitionToToolExecuting(toolCallIds: string[]): void {
    if (state.phase === 'aborted') return
    clearStreamWatchdog()
    state.phase = 'tool_executing'
    state.executingToolIds = toolCallIds
    streamAccumulator.inToolExec = true
    resetToolWatchdog()
  }

  function transitionToCompacting(): void {
    clearAllWatchdogs()
    state.phase = 'compacting'
  }

  function transitionToRecovering(error: string, attempt: number): void {
    clearAllWatchdogs()
    state.phase = 'recovering'
    state.error = error
    state.recoveryAttempt = attempt
  }

  function transitionToCompleted(summary?: string): void {
    clearAllWatchdogs()
    state.phase = 'completed'
    state.summary = summary
    state.finishedAt = Date.now()
    log.info('turn_completed', { turnId: state.turnId, duration: state.finishedAt - (state.startedAt ?? state.finishedAt) })
  }

  function transitionToFailed(error: string, retryable: boolean): void {
    clearAllWatchdogs()
    state.phase = 'failed'
    state.error = error
    state.retryable = retryable
    state.finishedAt = Date.now()
    log.info('turn_failed', { turnId: state.turnId, error, retryable })
  }

  function transitionToAborted(): void {
    clearAllWatchdogs()
    state.phase = 'aborted'
    state.finishedAt = Date.now()
    log.info('turn_aborted', { turnId: state.turnId })
  }

  function resetToIdle(): void {
    clearAllWatchdogs()
    state.phase = 'idle'
    state.turnId = ''
  }

  // ── 流式事件处理 ──

  function handleStreamEvent(event: AiStreamEvent): void {
    resetStreamWatchdog()

    switch (event.type) {
      case 'TextDelta':
        streamAccumulator.pendingTextDelta += event.delta
        state.pendingTextDelta = streamAccumulator.pendingTextDelta
        break

      case 'ThinkingDelta':
        streamAccumulator.pendingThinkingDelta += event.delta
        state.pendingThinkingDelta = streamAccumulator.pendingThinkingDelta
        break

      case 'Usage':
        // 由外部 updateStreamingMessage 处理
        break

      case 'Done':
        streamAccumulator.lastFinishReason = event.finish_reason
        state.lastFinishReason = event.finish_reason
        clearStreamWatchdog()
        break

      case 'Error':
        streamAccumulator.lastErrorRetryable = event.retryable
        break

      case 'ToolCall': {
        const existing = streamAccumulator.pendingToolCalls.find(tc => tc.id === event.id)
        if (existing) {
          existing.name = event.name
          existing.arguments = event.arguments
          existing.parsedArgs = tryParseJson(event.arguments)
          existing.status = 'pending'
        } else {
          streamAccumulator.pendingToolCalls.push({
            id: event.id,
            name: event.name,
            arguments: event.arguments,
            parsedArgs: tryParseJson(event.arguments),
            status: 'pending',
          })
        }
        state.pendingToolCalls = [...streamAccumulator.pendingToolCalls]
        break
      }

      case 'ToolCallDelta': {
        let existing = streamAccumulator.pendingToolCalls.find(tc => tc.streamingIndex === event.index)
        if (!existing && event.id && event.name) {
          existing = {
            id: event.id,
            name: event.name,
            arguments: '',
            status: 'streaming',
            streamingChars: 0,
            streamingIndex: event.index,
          }
          streamAccumulator.pendingToolCalls.push(existing)
        }
        if (existing) {
          existing.arguments += event.arguments_delta
          existing.streamingChars = existing.arguments.length
          existing.parsedArgs = tryParseJson(existing.arguments)
        }
        state.pendingToolCalls = [...streamAccumulator.pendingToolCalls]
        break
      }
    }
  }

  // ── 派生状态（供 UI 订阅） ──

  const isBusy = computed(() =>
    state.phase === 'preparing' ||
    state.phase === 'streaming' ||
    state.phase === 'tool_executing' ||
    state.phase === 'compacting' ||
    state.phase === 'recovering',
  )

  const isStreaming = computed(() => state.phase === 'streaming')
  const isToolExecuting = computed(() => state.phase === 'tool_executing')
  const isCompacting = computed(() => state.phase === 'compacting')
  const canAbort = computed(() => isBusy.value)
  const canSend = computed(() => state.phase === 'idle' || state.phase === 'completed' || state.phase === 'failed' || state.phase === 'aborted')

  // ── 清理 ──

  function dispose(): void {
    clearAllWatchdogs()
  }

  return {
    // 状态
    state,
    streamAccumulator,

    // 状态转换
    startTurn,
    transitionToStreaming,
    transitionToToolExecuting,
    transitionToCompacting,
    transitionToRecovering,
    transitionToCompleted,
    transitionToFailed,
    transitionToAborted,
    resetToIdle,

    // 流式事件
    handleStreamEvent,

    // Watchdog
    resetStreamWatchdog,
    resetToolWatchdog,
    clearAllWatchdogs,

    // 派生状态
    isBusy,
    isStreaming,
    isToolExecuting,
    isCompacting,
    canAbort,
    canSend,

    // 清理
    dispose,
  }
}

export type AiTurnRuntime = ReturnType<typeof createAiTurnRuntime>
