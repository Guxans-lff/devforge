/**
 * Transcript Hook Integration
 *
 * Bridges AiHookManager events into the Transcript Event Store.
 * Also provides manual recording APIs for events not captured by hooks.
 */

import type { Logger } from '@/utils/logger'
import type {
  PreCompactContext,
  PostCompactContext,
  PreToolUseContext,
  PostToolUseContext,
  TurnStartContext,
  TurnEndContext,
} from '@/composables/ai/AiHookManager'
import type { AiPlan, AiPlanStep } from '@/types/plan'
import type { TranscriptStore } from './transcriptStore'

const USER_MESSAGE_PREVIEW_LIMIT = 200
const ASSISTANT_MESSAGE_PREVIEW_LIMIT = 200
const TOOL_ARGS_PREVIEW_LIMIT = 200
const TOOL_RESULT_PREVIEW_LIMIT = 300

function truncate(str: string, limit: number): string {
  if (!str || str.length <= limit) return str
  return str.slice(0, limit).trimEnd() + '...'
}

export interface TranscriptIntegrationOptions {
  sessionId: string | (() => string)
  transcriptStore: TranscriptStore
  log: Logger
}

export interface TranscriptHookIntegration {
  // Hook handlers (register with AiHookManager)
  onTurnStart: (ctx: TurnStartContext) => void
  onTurnEnd: (ctx: TurnEndContext) => void
  onPreToolUse: (ctx: PreToolUseContext) => void
  onPostToolUse: (ctx: PostToolUseContext) => void
  onPreCompact: (ctx: PreCompactContext) => void
  onPostCompact: (ctx: PostCompactContext) => void

  // Manual recording APIs
  recordUserMessage: (content: string, attachmentNames?: string[]) => void
  recordAssistantMessage: (content: string, tokens?: number, finishReason?: string) => void
  recordStreamError: (error: string, retryable: boolean) => void
  recordUsage: (tokens: { prompt: number; completion: number; cacheRead?: number }) => void
  recordRouting: (reason: string, fromProviderId?: string, toProviderId?: string, fromModel?: string, toModel?: string) => void
  recordPermission: (toolCallId: string, toolName: string, decision: 'allowed' | 'denied', reason?: string) => void
  recordRecovery: (reason: string, attempt: number) => void
  recordPlanStatus: (plan: AiPlan, step?: AiPlanStep) => void
}

export function createTranscriptHookIntegration(options: TranscriptIntegrationOptions): TranscriptHookIntegration {
  const { transcriptStore } = options

  let currentTurnId = ''

  function currentSessionId(): string {
    return typeof options.sessionId === 'function' ? options.sessionId() : options.sessionId
  }

  // ── Hook Handlers ──

  function onTurnStart(ctx: TurnStartContext): void {
    currentTurnId = ctx.turnId
    transcriptStore.appendEvent({
      sessionId: currentSessionId(),
      turnId: ctx.turnId,
      type: 'turn_start',
      timestamp: Date.now(),
      payload: { type: 'turn_start', data: { turnId: ctx.turnId } },
    })
  }

  function onTurnEnd(ctx: TurnEndContext): void {
    transcriptStore.appendEvent({
      sessionId: currentSessionId(),
      turnId: ctx.turnId,
      type: 'turn_end',
      timestamp: Date.now(),
      payload: { type: 'turn_end', data: { turnId: ctx.turnId, status: ctx.status, durationMs: ctx.duration } },
    })
    if (currentTurnId === ctx.turnId) {
      currentTurnId = ''
    }
  }

  function onPreToolUse(ctx: PreToolUseContext): void {
    const path = typeof ctx.toolCall.parsedArgs?.path === 'string'
      ? ctx.toolCall.parsedArgs.path
      : undefined

    transcriptStore.appendEvent({
      sessionId: currentSessionId(),
      turnId: ctx.turnId,
      type: 'tool_call',
      timestamp: Date.now(),
      payload: {
        type: 'tool_call',
        data: {
          toolCallId: ctx.toolCall.id,
          toolName: ctx.toolCall.name,
          argumentsPreview: truncate(ctx.toolCall.arguments, TOOL_ARGS_PREVIEW_LIMIT),
          path,
        },
      },
    })
  }

  function onPostToolUse(ctx: PostToolUseContext): void {
    const meta = ctx.result.metadata
    transcriptStore.appendEvent({
      sessionId: currentSessionId(),
      turnId: ctx.turnId,
      type: 'tool_result',
      timestamp: Date.now(),
      payload: {
        type: 'tool_result',
        data: {
          toolCallId: ctx.result.toolCallId,
          toolName: ctx.result.toolName,
          success: ctx.result.success,
          contentPreview: truncate(ctx.result.content, TOOL_RESULT_PREVIEW_LIMIT),
          durationMs: meta?.durationMs,
          errorKind: meta?.errorKind,
        },
      },
    })
  }

  function onPreCompact(ctx: PreCompactContext): void {
    // Pre-compact: we don't record yet, wait for post_compact with full stats
    void ctx
  }

  function onPostCompact(ctx: PostCompactContext): void {
    transcriptStore.appendEvent({
      sessionId: currentSessionId(),
      turnId: currentTurnId || undefined,
      type: 'compact',
      timestamp: Date.now(),
      payload: {
        type: 'compact',
        data: {
          trigger: 'auto',
          originalMessageCount: ctx.originalCount,
          originalTokens: ctx.compressedTokens,
          summaryLength: ctx.summaryLength,
          source: ctx.source,
        },
      },
    })
  }

  // ── Manual Recording APIs ──

  function recordUserMessage(content: string, attachmentNames?: string[]): void {
    transcriptStore.appendEvent({
      sessionId: currentSessionId(),
      turnId: currentTurnId || undefined,
      type: 'user_message',
      timestamp: Date.now(),
      payload: {
        type: 'user_message',
        data: {
          contentPreview: truncate(content, USER_MESSAGE_PREVIEW_LIMIT),
          attachmentCount: attachmentNames?.length ?? 0,
          attachmentNames: attachmentNames && attachmentNames.length > 0 ? attachmentNames : undefined,
        },
      },
    })
  }

  function recordAssistantMessage(content: string, tokens?: number, finishReason?: string): void {
    transcriptStore.appendEvent({
      sessionId: currentSessionId(),
      turnId: currentTurnId || undefined,
      type: 'assistant_message',
      timestamp: Date.now(),
      payload: {
        type: 'assistant_message',
        data: {
          contentPreview: truncate(content, ASSISTANT_MESSAGE_PREVIEW_LIMIT),
          tokens,
          finishReason,
        },
      },
    })
  }

  function recordStreamError(error: string, retryable: boolean): void {
    transcriptStore.appendEvent({
      sessionId: currentSessionId(),
      turnId: currentTurnId || undefined,
      type: 'stream_error',
      timestamp: Date.now(),
      payload: {
        type: 'stream_error',
        data: { error: truncate(error, 500), retryable },
      },
    })
  }

  function recordUsage(tokens: { prompt: number; completion: number; cacheRead?: number }): void {
    transcriptStore.appendEvent({
      sessionId: currentSessionId(),
      turnId: currentTurnId || undefined,
      type: 'usage',
      timestamp: Date.now(),
      payload: {
        type: 'usage',
        data: {
          promptTokens: tokens.prompt,
          completionTokens: tokens.completion,
          cacheReadTokens: tokens.cacheRead,
          totalTokens: tokens.prompt + tokens.completion,
        },
      },
    })
  }

  function recordRouting(
    reason: string,
    fromProviderId?: string,
    toProviderId?: string,
    fromModel?: string,
    toModel?: string,
  ): void {
    transcriptStore.appendEvent({
      sessionId: currentSessionId(),
      turnId: currentTurnId || undefined,
      type: 'routing',
      timestamp: Date.now(),
      payload: {
        type: 'routing',
        data: { reason, fromProviderId, toProviderId, fromModel, toModel },
      },
    })
  }

  function recordPermission(toolCallId: string, toolName: string, decision: 'allowed' | 'denied', reason?: string): void {
    transcriptStore.appendEvent({
      sessionId: currentSessionId(),
      turnId: currentTurnId || undefined,
      type: 'permission',
      timestamp: Date.now(),
      payload: {
        type: 'permission',
        data: { toolCallId, toolName, decision, reason },
      },
    })
  }

  function recordRecovery(reason: string, attempt: number): void {
    transcriptStore.appendEvent({
      sessionId: currentSessionId(),
      turnId: currentTurnId || undefined,
      type: 'recovery',
      timestamp: Date.now(),
      payload: {
        type: 'recovery',
        data: { reason: truncate(reason, 500), attempt },
      },
    })
  }

  function recordPlanStatus(plan: AiPlan, step?: AiPlanStep): void {
    transcriptStore.appendEvent({
      sessionId: currentSessionId(),
      turnId: currentTurnId || undefined,
      type: 'plan_status',
      timestamp: Date.now(),
      payload: {
        type: 'plan_status',
        data: {
          planId: plan.id,
          status: plan.status,
          stepIndex: step?.index,
          stepTitle: step?.title,
        },
      },
    })
  }

  return {
    onTurnStart,
    onTurnEnd,
    onPreToolUse,
    onPostToolUse,
    onPreCompact,
    onPostCompact,
    recordUserMessage,
    recordAssistantMessage,
    recordStreamError,
    recordUsage,
    recordRouting,
    recordPermission,
    recordRecovery,
    recordPlanStatus,
  }
}
