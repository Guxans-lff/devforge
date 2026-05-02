/**
 * Transcript Diagnostic Export
 *
 * Generates structured diagnostic reports from transcript events
 * for debugging, audit, and support purposes.
 */

import type { AiTranscriptEvent, AiTranscriptEventOf, AiTranscriptEventType, TranscriptDiagnosticReport } from './transcriptTypes'
import type { TranscriptStore } from './transcriptStore'
import { buildAdvancedAgentGovernanceSnapshot } from '@/ai-gui/advancedAgentGovernance'

function isTranscriptEvent<T extends AiTranscriptEventType>(
  event: AiTranscriptEvent,
  type: T,
): event is AiTranscriptEventOf<T> {
  return event.type === type && event.payload.type === type
}

function toTurnTimeline(events: AiTranscriptEvent[]): TranscriptDiagnosticReport['turnTimeline'] {
  const starts = new Map<string, number>()
  const timeline: TranscriptDiagnosticReport['turnTimeline'] = []

  for (const event of events) {
    if (event.type === 'turn_start' && event.payload.type === 'turn_start') {
      starts.set(event.payload.data.turnId, event.timestamp)
    }
    if (event.type === 'turn_end' && event.payload.type === 'turn_end') {
      const startedAt = starts.get(event.payload.data.turnId) ?? event.timestamp
      timeline.push({
        turnId: event.payload.data.turnId,
        startedAt,
        finishedAt: event.timestamp,
        status: event.payload.data.status,
        durationMs: event.payload.data.durationMs,
      })
      starts.delete(event.payload.data.turnId)
    }
  }

  return timeline
}

function toToolCallTimeline(events: AiTranscriptEvent[]): TranscriptDiagnosticReport['toolCallTimeline'] {
  const starts = new Map<string, number>()
  const timeline: TranscriptDiagnosticReport['toolCallTimeline'] = []

  for (const event of events) {
    if (event.type === 'tool_call' && event.payload.type === 'tool_call') {
      starts.set(event.payload.data.toolCallId, event.timestamp)
    }
    if (event.type === 'tool_result' && event.payload.type === 'tool_result') {
      const startedAt = starts.get(event.payload.data.toolCallId) ?? event.timestamp
      timeline.push({
        turnId: event.turnId ?? '',
        toolCallId: event.payload.data.toolCallId,
        toolName: event.payload.data.toolName,
        startedAt,
        finishedAt: event.timestamp,
        success: event.payload.data.success,
        path: event.payload.data.contentPreview.slice(0, 100),
      })
      starts.delete(event.payload.data.toolCallId)
    }
  }

  return timeline
}

function toErrorTimeline(events: AiTranscriptEvent[]): TranscriptDiagnosticReport['errorTimeline'] {
  return events
    .filter(e =>
      e.type === 'stream_error'
      || e.type === 'recovery'
      || (e.type === 'turn_end' && e.payload.type === 'turn_end' && e.payload.data.status === 'error')
      || (e.type === 'tool_result' && e.payload.type === 'tool_result' && !e.payload.data.success),
    )
    .map(e => {
      if (e.type === 'stream_error' && e.payload.type === 'stream_error') {
        return { turnId: e.turnId, timestamp: e.timestamp, kind: 'stream_error', message: e.payload.data.error }
      }
      if (e.type === 'recovery' && e.payload.type === 'recovery') {
        return { turnId: e.turnId, timestamp: e.timestamp, kind: 'recovery', message: e.payload.data.reason }
      }
      if (e.type === 'turn_end' && e.payload.type === 'turn_end') {
        return { turnId: e.turnId, timestamp: e.timestamp, kind: 'turn_error', message: `Turn ended with error (${e.payload.data.durationMs}ms)` }
      }
      if (e.type === 'tool_result' && e.payload.type === 'tool_result') {
        return { turnId: e.turnId, timestamp: e.timestamp, kind: e.payload.data.errorKind ?? 'tool_error', message: e.payload.data.contentPreview }
      }
      return { turnId: e.turnId, timestamp: e.timestamp, kind: 'unknown', message: '' }
    })
}

function toCompactHistory(events: AiTranscriptEvent[]): TranscriptDiagnosticReport['compactHistory'] {
  return events
    .filter((e): e is AiTranscriptEventOf<'compact'> => isTranscriptEvent(e, 'compact'))
    .map(e => ({
      timestamp: e.timestamp,
      trigger: e.payload.data.trigger,
      originalMessageCount: e.payload.data.originalMessageCount,
      originalTokens: e.payload.data.originalTokens,
      summaryLength: e.payload.data.summaryLength,
    }))
}

function toRoutingHistory(events: AiTranscriptEvent[]): TranscriptDiagnosticReport['routingHistory'] {
  return events
    .filter((e): e is AiTranscriptEventOf<'routing'> => isTranscriptEvent(e, 'routing'))
    .map(e => ({
      timestamp: e.timestamp,
      reason: e.payload.data.reason,
      fromProviderId: e.payload.data.fromProviderId,
      toProviderId: e.payload.data.toProviderId,
    }))
}

function toPlanHistory(events: AiTranscriptEvent[]): TranscriptDiagnosticReport['planHistory'] {
  return events
    .filter((e): e is AiTranscriptEventOf<'plan_status'> => isTranscriptEvent(e, 'plan_status'))
    .map(e => ({
      timestamp: e.timestamp,
      planId: e.payload.data.planId,
      status: e.payload.data.status,
      stepTitle: e.payload.data.stepTitle,
    }))
}

function toAgentRuntimeContextHistory(events: AiTranscriptEvent[]): TranscriptDiagnosticReport['agentRuntimeContextHistory'] {
  return events
    .filter((e): e is AiTranscriptEventOf<'agent_runtime_context'> => isTranscriptEvent(e, 'agent_runtime_context'))
    .map(e => ({
      timestamp: e.timestamp,
      assignmentCount: e.payload.data.assignmentCount,
      blockedCount: e.payload.data.blockedCount,
      warningCount: e.payload.data.warningCount,
      verificationRisk: e.payload.data.verificationRisk,
      verificationCommandCount: e.payload.data.verificationCommandCount,
      verificationGateStatus: e.payload.data.verificationGateStatus,
      verificationSafeToComplete: e.payload.data.verificationSafeToComplete,
      verificationMissingCommandCount: e.payload.data.verificationMissingCommandCount,
      verificationFailedCommandCount: e.payload.data.verificationFailedCommandCount,
      isolationBoundaryCount: e.payload.data.isolationBoundaryCount,
      isolationMergeRequiredCount: e.payload.data.isolationMergeRequiredCount,
      isolationBlockedCount: e.payload.data.isolationBlockedCount,
      isolationWorktreeCount: e.payload.data.isolationWorktreeCount,
      isolationTemporaryWorkspaceCount: e.payload.data.isolationTemporaryWorkspaceCount,
      isolationReviewRequiredCount: e.payload.data.isolationReviewRequiredCount,
      isolationConfirmationRequiredCount: e.payload.data.isolationConfirmationRequiredCount,
      isolationGateStatus: e.payload.data.isolationGateStatus,
      isolationSafeToAutoRun: e.payload.data.isolationSafeToAutoRun,
      lspDiagnosticCount: e.payload.data.lspDiagnosticCount,
      lspSummary: e.payload.data.lspSummary,
      warnings: e.payload.data.warnings,
    }))
}

/**
 * Generate a diagnostic report from transcript events for a session.
 */
export function generateTranscriptDiagnosticReport(
  store: TranscriptStore,
  sessionId: string,
): TranscriptDiagnosticReport {
  const events = store.getEvents(sessionId)
  const now = Date.now()
  const agentRuntimeContextHistory = toAgentRuntimeContextHistory(events)

  return {
    sessionId,
    exportedAt: now,
    eventCount: events.length,
    turnTimeline: toTurnTimeline(events),
    toolCallTimeline: toToolCallTimeline(events),
    errorTimeline: toErrorTimeline(events),
    compactHistory: toCompactHistory(events),
    routingHistory: toRoutingHistory(events),
    planHistory: toPlanHistory(events),
    agentRuntimeContextHistory,
    agentRuntimeGovernance: buildAdvancedAgentGovernanceSnapshot(agentRuntimeContextHistory),
  }
}

/**
 * Export diagnostic report as a JSON string (sanitized).
 */
export function exportTranscriptDiagnostics(store: TranscriptStore, sessionId: string): string {
  const report = generateTranscriptDiagnosticReport(store, sessionId)
  return JSON.stringify(report, null, 2)
}
