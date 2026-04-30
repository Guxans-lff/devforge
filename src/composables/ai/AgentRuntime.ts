/**
 * Agent Runtime 状态机外壳
 *
 * 目标是把 chat 主链路的阶段转换从零散回调收敛为显式 transition。
 * 当前版本先保持轻量：不替换消息/工具执行实现，只统一 turn 生命周期与运行态。
 */

import { computed } from 'vue'
import type { AiStreamEvent, ToolCallInfo } from '@/types/ai'
import type { Logger } from '@/utils/logger'
import { createAiTurnRuntime, type AiTurnRuntime } from './AiTurnRuntime'

export type AgentRuntimePhase =
  | 'idle'
  | 'preparing'
  | 'routing'
  | 'streaming'
  | 'tool_executing'
  | 'compacting'
  | 'recovering'
  | 'completed'
  | 'failed'
  | 'aborted'

export type AgentRuntimeTransitionReason =
  | 'send_start'
  | 'prepare_complete'
  | 'request_start'
  | 'first_token'
  | 'tool_queue'
  | 'tool_start'
  | 'tool_done'
  | 'compact_start'
  | 'compact_done'
  | 'recovery_start'
  | 'response_complete'
  | 'failed'
  | 'aborted'
  | 'reset'

export interface AgentRuntimeTransition {
  id: string
  turnId: string
  from: AgentRuntimePhase
  to: AgentRuntimePhase
  reason: AgentRuntimeTransitionReason
  timestamp: number
  data?: Record<string, unknown>
}

export interface AgentRuntimeOptions {
  log: Logger
  onTransition?: (transition: AgentRuntimeTransition) => void
}

let transitionCounter = 0

function nextTransitionId(): string {
  transitionCounter += 1
  return `agent-transition-${Date.now()}-${transitionCounter.toString(36)}`
}

function mapTurnPhase(phase: AiTurnRuntime['state']['phase']): AgentRuntimePhase {
  return phase
}

export function createAgentRuntime(options: AgentRuntimeOptions) {
  const { log, onTransition } = options
  const turnRuntime = createAiTurnRuntime({ log })

  function currentPhase(): AgentRuntimePhase {
    return mapTurnPhase(turnRuntime.state.phase)
  }

  function emitTransition(
    from: AgentRuntimePhase,
    to: AgentRuntimePhase,
    reason: AgentRuntimeTransitionReason,
    data?: Record<string, unknown>,
  ): void {
    const transition: AgentRuntimeTransition = {
      id: nextTransitionId(),
      turnId: turnRuntime.state.turnId,
      from,
      to,
      reason,
      timestamp: Date.now(),
      data,
    }
    log.info('agent_runtime_transition', {
      id: transition.id,
      turnId: transition.turnId,
      from: transition.from,
      to: transition.to,
      reason: transition.reason,
      timestamp: transition.timestamp,
      data: transition.data,
    })
    onTransition?.(transition)
  }

  function startTurn(data?: Record<string, unknown>): string {
    const from = currentPhase()
    const turnId = turnRuntime.startTurn()
    emitTransition(from, 'preparing', 'send_start', data)
    return turnId
  }

  function markPrepareComplete(data?: Record<string, unknown>): void {
    const from = currentPhase()
    turnRuntime.transitionToRouting()
    emitTransition(from, 'routing', 'prepare_complete', data)
  }

  function markRequestStart(data?: Record<string, unknown>): void {
    const from = currentPhase()
    emitTransition(from, 'streaming', 'request_start', data)
  }

  function transitionToStreaming(messageId: string, data?: Record<string, unknown>): void {
    const from = currentPhase()
    turnRuntime.transitionToStreaming(messageId)
    emitTransition(from, 'streaming', 'request_start', { messageId, ...data })
  }

  function handleStreamEvent(event: AiStreamEvent): void {
    const from = currentPhase()
    turnRuntime.handleStreamEvent(event)
    if (event.type === 'TextDelta' || event.type === 'ThinkingDelta') {
      emitTransition(from, 'streaming', 'first_token', { eventType: event.type })
    }
    if (event.type === 'ToolCall') {
      emitTransition(from, 'streaming', 'tool_queue', {
        toolCallId: event.id,
        toolName: event.name,
      })
    }
  }

  function transitionToToolExecuting(toolCalls: ToolCallInfo[]): void {
    const from = currentPhase()
    const toolCallIds = toolCalls.map(toolCall => toolCall.id)
    turnRuntime.transitionToToolExecuting(toolCallIds)
    emitTransition(from, 'tool_executing', 'tool_start', {
      toolCallIds,
      toolNames: toolCalls.map(toolCall => toolCall.name),
    })
  }

  function markToolDone(data?: Record<string, unknown>): void {
    const from = currentPhase()
    turnRuntime.transitionToRouting()
    emitTransition(from, 'routing', 'tool_done', data)
  }

  function transitionToCompacting(data?: Record<string, unknown>): void {
    const from = currentPhase()
    turnRuntime.transitionToCompacting()
    emitTransition(from, 'compacting', 'compact_start', data)
  }

  function markCompactDone(data?: Record<string, unknown>): void {
    const from = currentPhase()
    turnRuntime.transitionToRouting()
    emitTransition(from, 'routing', 'compact_done', data)
  }

  function transitionToRecovering(error: string, attempt: number): void {
    const from = currentPhase()
    turnRuntime.transitionToRecovering(error, attempt)
    emitTransition(from, 'recovering', 'recovery_start', { error, attempt })
  }

  function transitionToCompleted(summary?: string): void {
    const from = currentPhase()
    turnRuntime.transitionToCompleted(summary)
    emitTransition(from, 'completed', 'response_complete', { summary })
  }

  function transitionToFailed(error: string, retryable: boolean): void {
    const from = currentPhase()
    turnRuntime.transitionToFailed(error, retryable)
    emitTransition(from, 'failed', 'failed', { error, retryable })
  }

  function transitionToAborted(): void {
    const from = currentPhase()
    turnRuntime.transitionToAborted()
    emitTransition(from, 'aborted', 'aborted')
  }

  function resetToIdle(): void {
    const from = currentPhase()
    turnRuntime.resetToIdle()
    emitTransition(from, 'idle', 'reset')
  }

  const state = computed(() => turnRuntime.state)

  return {
    state,
    turnRuntime,
    startTurn,
    markPrepareComplete,
    markRequestStart,
    transitionToStreaming,
    handleStreamEvent,
    transitionToToolExecuting,
    markToolDone,
    transitionToCompacting,
    markCompactDone,
    transitionToRecovering,
    transitionToCompleted,
    transitionToFailed,
    transitionToAborted,
    resetToIdle,
    dispose: turnRuntime.dispose,
  }
}

export type AgentRuntime = ReturnType<typeof createAgentRuntime>
