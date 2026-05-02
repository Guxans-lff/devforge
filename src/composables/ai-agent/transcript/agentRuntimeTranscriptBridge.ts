/**
 * AgentRuntime → Transcript bridge
 *
 * 把显式 AgentRuntime transition 转成统一 Transcript 事件。
 * 当前写入前端 TranscriptStore；后续后端化时只需要替换 store 实现。
 */

import type { AgentRuntimeTransition } from '@/composables/ai/AgentRuntime'
import type { Logger } from '@/utils/logger'
import type { TranscriptStore } from './transcriptStore'

export interface AgentRuntimeTranscriptBridgeOptions {
  sessionId: string | (() => string)
  transcriptStore: TranscriptStore
  log: Logger
}

const terminalTransitions = new Set(['response_complete', 'failed', 'aborted'])

function resolveSessionId(sessionId: AgentRuntimeTranscriptBridgeOptions['sessionId']): string {
  return typeof sessionId === 'function' ? sessionId() : sessionId
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

export function createAgentRuntimeTranscriptBridge(options: AgentRuntimeTranscriptBridgeOptions) {
  const { transcriptStore, log } = options
  const endedTurns = new Set<string>()
  const startedAtByTurn = new Map<string, number>()
  const recordedToolCalls = new Set<string>()

  function appendTransition(transition: AgentRuntimeTransition): void {
    const sessionId = resolveSessionId(options.sessionId)
    if (!sessionId || !transition.turnId) return

    try {
      switch (transition.reason) {
        case 'send_start':
          endedTurns.delete(transition.turnId)
          startedAtByTurn.set(transition.turnId, transition.timestamp)
          transcriptStore.appendEvent({
            sessionId,
            turnId: transition.turnId,
            type: 'turn_start',
            timestamp: transition.timestamp,
            payload: { type: 'turn_start', data: { turnId: transition.turnId } },
          })
          break

        case 'prepare_complete':
        case 'request_start':
        case 'tool_done':
        case 'compact_done':
          transcriptStore.appendEvent({
            sessionId,
            turnId: transition.turnId,
            type: 'routing',
            timestamp: transition.timestamp,
            payload: {
              type: 'routing',
              data: {
                reason: transition.reason,
                fromModel: typeof transition.data?.model === 'string' ? transition.data.model : undefined,
                fromProviderId: typeof transition.data?.provider === 'string' ? transition.data.provider : undefined,
              },
            },
          })
          break

        case 'tool_queue':
        case 'tool_start': {
          const toolCallIds = transition.reason === 'tool_queue'
            ? [String(transition.data?.toolCallId ?? '')].filter(Boolean)
            : asStringArray(transition.data?.toolCallIds)
          const toolNames = transition.reason === 'tool_queue'
            ? [String(transition.data?.toolName ?? '')].filter(Boolean)
            : asStringArray(transition.data?.toolNames)

          toolCallIds.forEach((toolCallId, index) => {
            const dedupeKey = `${transition.turnId}:${toolCallId}`
            if (recordedToolCalls.has(dedupeKey)) return
            recordedToolCalls.add(dedupeKey)
            transcriptStore.appendEvent({
              sessionId,
              turnId: transition.turnId,
              type: 'tool_call',
              timestamp: transition.timestamp,
              payload: {
                type: 'tool_call',
                data: {
                  toolCallId,
                  toolName: toolNames[index] ?? 'unknown_tool',
                  argumentsPreview: typeof transition.data?.argumentsPreview === 'string'
                    ? transition.data.argumentsPreview
                    : '',
                },
              },
            })
          })
          break
        }

        case 'recovery_start':
          transcriptStore.appendEvent({
            sessionId,
            turnId: transition.turnId,
            type: 'recovery',
            timestamp: transition.timestamp,
            payload: {
              type: 'recovery',
              data: {
                reason: typeof transition.data?.error === 'string' ? transition.data.error : 'unknown',
                attempt: typeof transition.data?.attempt === 'number' ? transition.data.attempt : 1,
              },
            },
          })
          break

        case 'compact_start':
          transcriptStore.appendEvent({
            sessionId,
            turnId: transition.turnId,
            type: 'compact',
            timestamp: transition.timestamp,
            payload: {
              type: 'compact',
              data: {
                trigger: 'auto',
                originalMessageCount: 0,
                originalTokens: 0,
                summaryLength: 0,
                source: 'local',
              },
            },
          })
          break

        case 'first_token':
        case 'reset':
          break
      }

      if (terminalTransitions.has(transition.reason) && !endedTurns.has(transition.turnId)) {
        endedTurns.add(transition.turnId)
        const startedAt = startedAtByTurn.get(transition.turnId) ?? transition.timestamp
        const status = transition.reason === 'response_complete'
          ? 'done'
          : transition.reason === 'aborted'
            ? 'cancelled'
            : 'error'
        transcriptStore.appendEvent({
          sessionId,
          turnId: transition.turnId,
          type: 'turn_end',
          timestamp: transition.timestamp,
          payload: {
            type: 'turn_end',
            data: {
              turnId: transition.turnId,
              status,
              durationMs: Math.max(0, transition.timestamp - startedAt),
            },
          },
        })
        startedAtByTurn.delete(transition.turnId)
      }
    } catch (error) {
      log.warn('agent_runtime_transcript_bridge_failed', {
        sessionId,
        turnId: transition.turnId,
        reason: transition.reason,
      }, error)
    }
  }

  return {
    appendTransition,
  }
}
