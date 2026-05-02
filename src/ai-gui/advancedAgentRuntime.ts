import type { AiWorkspaceIsolationConfig } from '@/types/ai'
import type { SpawnedTask } from '@/composables/ai/chatSideEffects'
import type { MultiAgentPlan } from './multiAgentOrchestrator'
import { collectLspDiagnostics, summarizeLspDiagnostics, type LspDiagnostic } from './lspDiagnostics'
import { buildVerificationAgentPlan, type VerificationAgentPlan } from './verificationAgent'
import { buildVerificationGateDecision, type VerificationGateDecision } from './verificationGate'
import type { ParsedVerificationReport } from './verificationReport'
import type { WorkspaceIsolationBoundarySummary } from './workspaceIsolation'
import type { WorkspaceIsolationExecutionPlan } from './workspaceIsolationPlan'
import { buildSpawnedTaskIsolationContext } from './spawnedTaskIsolationPlan'

export interface AdvancedAgentRuntimeInput {
  sessionId: string
  tasks: SpawnedTask[]
  changedFiles: string[]
  workspaceIsolation?: AiWorkspaceIsolationConfig
  lspFiles?: Array<{ path: string; content: string }>
  verificationReport?: ParsedVerificationReport | null
  verifying?: boolean
  maxAgents?: number
}

export interface AdvancedAgentRuntimeContext {
  multiAgentPlan: MultiAgentPlan
  verificationPlan: VerificationAgentPlan
  isolationBoundaries: WorkspaceIsolationBoundarySummary[]
  isolationExecutionPlan: WorkspaceIsolationExecutionPlan
  verificationGate: VerificationGateDecision
  lspDiagnostics: LspDiagnostic[]
  lspSummary: string
  warnings: string[]
}

export interface AdvancedAgentRuntimePayload {
  assignmentCount: number
  blockedCount: number
  warningCount: number
  verificationRisk: string
  verificationCommandCount: number
  verificationGateStatus: string
  verificationSafeToComplete: boolean
  verificationMissingCommandCount: number
  verificationFailedCommandCount: number
  isolationBoundaryCount: number
  isolationMergeRequiredCount: number
  isolationBlockedCount: number
  isolationWorktreeCount: number
  isolationTemporaryWorkspaceCount: number
  isolationReviewRequiredCount: number
  isolationConfirmationRequiredCount: number
  isolationGateStatus: string
  isolationSafeToAutoRun: boolean
  lspDiagnosticCount: number
  lspSummary: string
  warnings: string[]
}

export function buildAdvancedAgentRuntimePayload(
  context: AdvancedAgentRuntimeContext,
): AdvancedAgentRuntimePayload {
  return {
    assignmentCount: context.multiAgentPlan.assignments.length,
    blockedCount: context.multiAgentPlan.blocked.length,
    warningCount: context.warnings.length,
    verificationRisk: context.verificationPlan.risk,
    verificationCommandCount: context.verificationPlan.commands.length,
    verificationGateStatus: context.verificationGate.status,
    verificationSafeToComplete: context.verificationGate.safeToComplete,
    verificationMissingCommandCount: context.verificationGate.missingCommands.length,
    verificationFailedCommandCount: context.verificationGate.failedCommands.length,
    isolationBoundaryCount: context.isolationBoundaries.length,
    isolationMergeRequiredCount: context.isolationExecutionPlan.mergeRequiredCount,
    isolationBlockedCount: context.isolationExecutionPlan.blockedCount,
    isolationWorktreeCount: context.isolationExecutionPlan.worktreeCount,
    isolationTemporaryWorkspaceCount: context.isolationExecutionPlan.temporaryWorkspaceCount,
    isolationReviewRequiredCount: context.isolationExecutionPlan.reviewRequiredCount,
    isolationConfirmationRequiredCount: context.isolationExecutionPlan.confirmationRequiredCount,
    isolationGateStatus: context.isolationExecutionPlan.gate.status,
    isolationSafeToAutoRun: context.isolationExecutionPlan.gate.safeToAutoRun,
    lspDiagnosticCount: context.lspDiagnostics.length,
    lspSummary: context.lspSummary,
    warnings: context.warnings.slice(0, 8),
  }
}

export function createAdvancedAgentRuntimePayloadSignature(payload: AdvancedAgentRuntimePayload): string {
  return JSON.stringify(payload)
}

export async function buildAdvancedAgentRuntimeContext(
  input: AdvancedAgentRuntimeInput,
): Promise<AdvancedAgentRuntimeContext> {
  const isolationContext = buildSpawnedTaskIsolationContext(input.tasks, {
    sessionId: input.sessionId,
    maxAgents: input.maxAgents,
    boundaryForAssignment: assignment => ({
      allowedPaths: input.workspaceIsolation?.allowedPaths ?? assignment.allowedPaths,
      blockedPaths: input.workspaceIsolation?.blockedPaths,
      strength: input.workspaceIsolation?.strength ?? (assignment.role === 'implementer' ? 'agent' : 'session'),
    }),
  })
  const { multiAgentPlan, isolationBoundaries, isolationExecutionPlan } = isolationContext
  const changedFiles = input.changedFiles.map(file => file.replace(/\\/g, '/'))
  const lspDiagnostics = await collectLspDiagnostics(input.lspFiles ?? [])
  const verificationPlan = buildVerificationAgentPlan({
    changedFiles,
    includeTypecheck: changedFiles.some(file => /\.(vue|tsx?|jsx?)$/i.test(file)),
    includeRustCheck: changedFiles.some(file => file.startsWith('src-tauri/') || /\.rs$/i.test(file)),
  })
  const verificationGate = buildVerificationGateDecision({
    changedFiles,
    plan: verificationPlan,
    report: input.verificationReport,
    verifying: input.verifying,
  })

  return {
    multiAgentPlan,
    verificationPlan,
    isolationBoundaries,
    isolationExecutionPlan,
    verificationGate,
    lspDiagnostics,
    lspSummary: summarizeLspDiagnostics(lspDiagnostics),
    warnings: [
      ...multiAgentPlan.warnings,
      ...verificationGate.reasons,
      ...isolationExecutionPlan.warnings,
      ...isolationExecutionPlan.gate.reasons,
      ...isolationBoundaries.map(boundary => boundary.reason).filter((reason): reason is string => Boolean(reason)),
    ],
  }
}
