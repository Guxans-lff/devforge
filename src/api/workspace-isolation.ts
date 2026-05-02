import { invokeCommand } from '@/api/base'

export type WorkspaceIsolationMode = 'temporary' | 'worktree'

export interface WorkspaceIsolationPathValidation {
  valid: boolean
  repoPath: string
  workspacePath: string
  allowedRoot: string
  reason?: string
}

export interface WorkspaceIsolationPrepareResult {
  repoPath: string
  workspacePath: string
  mode: WorkspaceIsolationMode
  branchName?: string
  copiedFiles: number
  skippedPaths: string[]
  reusedExisting: boolean
  manifestPath?: string
}

export interface WorkspaceIsolationDiffEntry {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'conflicted' | string
  size?: number
}

export interface WorkspaceIsolationDiffSummary {
  added: number
  modified: number
  deleted: number
  unchanged: number
}

export interface WorkspaceIsolationDiffResult {
  repoPath: string
  workspacePath: string
  mode: WorkspaceIsolationMode
  entries: WorkspaceIsolationDiffEntry[]
  summary: WorkspaceIsolationDiffSummary
}

export interface WorkspaceIsolationApplyResult {
  repoPath: string
  workspacePath: string
  appliedFiles: number
  deletedFiles: number
  skippedPaths: string[]
}

export interface WorkspaceIsolationCleanupResult {
  workspacePath: string
  mode: WorkspaceIsolationMode
  removed: boolean
}

export interface TaskIsolationBackendState {
  status: 'idle' | 'preparing' | 'prepared' | 'diffing' | 'diffed' | 'verifying' | 'verified' | 'applying' | 'applied' | 'cleaning' | 'cleaned' | 'error'
  message?: string
  diff?: WorkspaceIsolationDiffResult
  verificationJobId?: string
}

export function workspaceIsolationValidatePath(input: {
  repoPath: string
  workspacePath: string
  mode: WorkspaceIsolationMode
}): Promise<WorkspaceIsolationPathValidation> {
  return invokeCommand<WorkspaceIsolationPathValidation>('workspace_isolation_validate_path', input, { source: 'AI' })
}

export function workspaceIsolationPrepare(input: {
  repoPath: string
  workspacePath: string
  branchName?: string
  mode: WorkspaceIsolationMode
  allowedPaths: string[]
  blockedPaths: string[]
}): Promise<WorkspaceIsolationPrepareResult> {
  return invokeCommand<WorkspaceIsolationPrepareResult>('workspace_isolation_prepare', input, { source: 'AI' })
}

export function workspaceIsolationDiff(input: {
  repoPath: string
  workspacePath: string
  mode: WorkspaceIsolationMode
}): Promise<WorkspaceIsolationDiffResult> {
  return invokeCommand<WorkspaceIsolationDiffResult>('workspace_isolation_diff', input, { source: 'AI' })
}

export function workspaceIsolationApplyChanges(input: {
  repoPath: string
  workspacePath: string
  mode: WorkspaceIsolationMode
  confirmed: boolean
}): Promise<WorkspaceIsolationApplyResult> {
  return invokeCommand<WorkspaceIsolationApplyResult>('workspace_isolation_apply_changes', input, { source: 'AI' })
}

export function workspaceIsolationCleanup(input: {
  repoPath: string
  workspacePath: string
  mode: WorkspaceIsolationMode
  force?: boolean
}): Promise<WorkspaceIsolationCleanupResult> {
  return invokeCommand<WorkspaceIsolationCleanupResult>('workspace_isolation_cleanup', input, { source: 'AI' })
}
