/**
 * Transcript Event Types
 *
 * Unified structured event stream for AI session activities.
 * All key activities (messages, tool calls, compaction, errors, turns, plans)
 * are recorded as immutable events for diagnostics, audit, and search.
 */

// ─────────────────────────── Event Type Enum ───────────────────────────

export type AiTranscriptEventType =
  | 'turn_start'
  | 'turn_end'
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'stream_error'
  | 'compact'
  | 'recovery'
  | 'permission'
  | 'plan_status'
  | 'usage'
  | 'routing'
  | 'agent_runtime_context'

// ─────────────────────────── Payload Types ───────────────────────────

export interface TurnStartPayload {
  turnId: string
}

export interface TurnEndPayload {
  turnId: string
  status: 'done' | 'error' | 'cancelled'
  durationMs: number
}

export interface UserMessagePayload {
  contentPreview: string
  attachmentCount: number
  attachmentNames?: string[]
}

export interface AssistantMessagePayload {
  contentPreview: string
  tokens?: number
  finishReason?: string
}

export interface ToolCallPayload {
  toolCallId: string
  toolName: string
  argumentsPreview: string
  path?: string
}

export interface ToolResultPayload {
  toolCallId: string
  toolName: string
  success: boolean
  contentPreview: string
  durationMs?: number
  errorKind?: string
}

export interface StreamErrorPayload {
  error: string
  retryable: boolean
}

export interface CompactPayload {
  trigger: 'manual' | 'auto' | 'recovery'
  originalMessageCount: number
  originalTokens: number
  summaryLength: number
  source: 'ai' | 'local'
}

export interface RecoveryPayload {
  reason: string
  attempt: number
}

export interface PermissionPayload {
  toolCallId: string
  toolName: string
  decision: 'allowed' | 'denied'
  reason?: string
}

export interface PlanStatusPayload {
  planId: string
  status: string
  stepIndex?: number
  stepTitle?: string
}

export interface UsagePayload {
  promptTokens: number
  completionTokens: number
  cacheReadTokens?: number
  totalTokens: number
}

export interface RoutingPayload {
  reason: string
  fromProviderId?: string
  toProviderId?: string
  fromModel?: string
  toModel?: string
}

export interface AgentRuntimeContextPayload {
  assignmentCount: number
  blockedCount: number
  warningCount: number
  verificationRisk: string
  verificationCommandCount: number
  verificationGateStatus?: string
  verificationSafeToComplete?: boolean
  verificationMissingCommandCount?: number
  verificationFailedCommandCount?: number
  isolationBoundaryCount: number
  isolationMergeRequiredCount?: number
  isolationBlockedCount?: number
  isolationWorktreeCount?: number
  isolationTemporaryWorkspaceCount?: number
  isolationReviewRequiredCount?: number
  isolationConfirmationRequiredCount?: number
  isolationGateStatus?: string
  isolationSafeToAutoRun?: boolean
  lspDiagnosticCount: number
  lspSummary: string
  warnings: string[]
}

// ─────────────────────────── Tagged Union Payload ───────────────────────────

export type AiTranscriptPayload =
  | { type: 'turn_start'; data: TurnStartPayload }
  | { type: 'turn_end'; data: TurnEndPayload }
  | { type: 'user_message'; data: UserMessagePayload }
  | { type: 'assistant_message'; data: AssistantMessagePayload }
  | { type: 'tool_call'; data: ToolCallPayload }
  | { type: 'tool_result'; data: ToolResultPayload }
  | { type: 'stream_error'; data: StreamErrorPayload }
  | { type: 'compact'; data: CompactPayload }
  | { type: 'recovery'; data: RecoveryPayload }
  | { type: 'permission'; data: PermissionPayload }
  | { type: 'plan_status'; data: PlanStatusPayload }
  | { type: 'usage'; data: UsagePayload }
  | { type: 'routing'; data: RoutingPayload }
  | { type: 'agent_runtime_context'; data: AgentRuntimeContextPayload }

// ─────────────────────────── Core Event Interface ───────────────────────────

export type AiTranscriptEventOf<T extends AiTranscriptEventType> = T extends AiTranscriptEventType ? {
  id: string
  sessionId: string
  turnId?: string
  type: T
  timestamp: number
  payload: Extract<AiTranscriptPayload, { type: T }>
} : never

export type AiTranscriptEvent = {
  [T in AiTranscriptEventType]: AiTranscriptEventOf<T>
}[AiTranscriptEventType]

// ─────────────────────────── Diagnostic Report Types ───────────────────────────

export interface TurnTimelineItem {
  turnId: string
  startedAt: number
  finishedAt?: number
  status: string
  durationMs?: number
}

export interface ToolCallTimelineItem {
  turnId: string
  toolCallId: string
  toolName: string
  startedAt: number
  finishedAt?: number
  success: boolean
  path?: string
}

export interface ErrorTimelineItem {
  turnId?: string
  timestamp: number
  kind: string
  message: string
}

export interface CompactHistoryItem {
  timestamp: number
  trigger: string
  originalMessageCount: number
  originalTokens: number
  summaryLength: number
}

export interface RoutingHistoryItem {
  timestamp: number
  reason: string
  fromProviderId?: string
  toProviderId?: string
}

export interface PlanHistoryItem {
  timestamp: number
  planId: string
  status: string
  stepTitle?: string
}

export interface AgentRuntimeContextHistoryItem {
  timestamp: number
  assignmentCount: number
  blockedCount: number
  warningCount: number
  verificationRisk: string
  verificationCommandCount: number
  verificationGateStatus?: string
  verificationSafeToComplete?: boolean
  verificationMissingCommandCount?: number
  verificationFailedCommandCount?: number
  isolationBoundaryCount: number
  isolationMergeRequiredCount?: number
  isolationBlockedCount?: number
  isolationWorktreeCount?: number
  isolationTemporaryWorkspaceCount?: number
  isolationReviewRequiredCount?: number
  isolationConfirmationRequiredCount?: number
  isolationGateStatus?: string
  isolationSafeToAutoRun?: boolean
  lspDiagnosticCount: number
  lspSummary: string
  warnings: string[]
}

export interface AgentRuntimeGovernanceSnapshot {
  status: 'healthy' | 'watch' | 'critical'
  contextCount: number
  latestRisk?: string
  maxBlockedCount: number
  maxIsolationBlockedCount: number
  maxIsolationMergeRequiredCount: number
  maxIsolationWorktreeCount?: number
  maxIsolationTemporaryWorkspaceCount?: number
  maxIsolationReviewRequiredCount?: number
  maxIsolationConfirmationRequiredCount?: number
  maxLspDiagnosticCount: number
  highRiskCount: number
  verificationBlockedCount?: number
  verificationWarningCount?: number
  maxVerificationMissingCommandCount?: number
  maxVerificationFailedCommandCount?: number
  warningCount: number
  recommendations: string[]
}

export interface CompactBoundaryProjectionReport {
  hasBoundary: boolean
  boundaryEventId?: string
  boundaryTimestamp?: number
  trigger?: 'manual' | 'auto' | 'recovery'
  source?: 'ai' | 'local'
  originalMessageCount: number
  originalTokens: number
  summaryLength: number
  eventsBeforeBoundary: number
  projectedEventCount: number
  projectedTurnCount: number
  projectedToolCallCount: number
  projectedToolResultCount: number
  unpairedToolCallIds: string[]
  orphanToolResultIds: string[]
  warnings: string[]
}

export interface TranscriptDiagnosticReport {
  sessionId: string
  exportedAt: number
  eventCount: number
  turnTimeline: TurnTimelineItem[]
  toolCallTimeline: ToolCallTimelineItem[]
  errorTimeline: ErrorTimelineItem[]
  compactHistory: CompactHistoryItem[]
  routingHistory: RoutingHistoryItem[]
  planHistory: PlanHistoryItem[]
  agentRuntimeContextHistory: AgentRuntimeContextHistoryItem[]
  agentRuntimeGovernance: AgentRuntimeGovernanceSnapshot
  compactBoundaryProjection: CompactBoundaryProjectionReport
}
