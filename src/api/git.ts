import { invokeCommand } from '@/api/base'
import type {
  GitRepositoryInfo,
  GitStatus,
  GitCommit,
  GitDiff,
  GitBranch,
  GitStash,
  GitGraph,
  GitRemote,
  GitTag,
  GitMergeResult,
  GitConfig,
  GitBlameLine,
  GitContributor,
  RebaseEntry,
  RebaseResult,
} from '@/types/git'

// ── 仓库生命周期 ──────────────────────────────────────────────────

export function gitOpen(path: string): Promise<GitRepositoryInfo> {
  return invokeCommand<GitRepositoryInfo>('git_open', { path }, { source: 'GIT' })
}

export function gitClose(path: string): Promise<void> {
  return invokeCommand('git_close', { path }, { source: 'GIT' })
}

export function gitIsOpen(path: string): Promise<boolean> {
  return invokeCommand<boolean>('git_is_open', { path }, { source: 'GIT' })
}

export function gitValidateRepo(path: string): Promise<boolean> {
  return invokeCommand<boolean>('git_validate_repo', { path }, { source: 'GIT' })
}

// ── 状态 & 历史 ───────────────────────────────────────────────────

export function gitGetStatus(path: string): Promise<GitStatus> {
  return invokeCommand<GitStatus>('git_get_status', { path }, { source: 'GIT' })
}

export function gitCurrentBranch(path: string): Promise<string> {
  return invokeCommand<string>('git_current_branch', { path }, { source: 'GIT' })
}

export function gitGetCommits(path: string, skip: number, limit: number): Promise<GitCommit[]> {
  return invokeCommand<GitCommit[]>('git_get_commits', { path, skip, limit }, { source: 'GIT' })
}

export function gitGetCommitDetail(path: string, hash: string): Promise<GitCommit> {
  return invokeCommand<GitCommit>('git_get_commit_detail', { path, hash }, { source: 'GIT' })
}

// ── 暂存 & 提交 ──────────────────────────────────────────────────

export function gitStageFile(repoPath: string, filePath: string): Promise<void> {
  return invokeCommand('git_stage_file', { repoPath, filePath }, { source: 'GIT' })
}

export function gitUnstageFile(repoPath: string, filePath: string): Promise<void> {
  return invokeCommand('git_unstage_file', { repoPath, filePath }, { source: 'GIT' })
}

export function gitStageAll(path: string): Promise<void> {
  return invokeCommand('git_stage_all', { path }, { source: 'GIT' })
}

export function gitUnstageAll(path: string): Promise<void> {
  return invokeCommand('git_unstage_all', { path }, { source: 'GIT' })
}

export function gitCommit(path: string, message: string, author: string, email: string): Promise<string> {
  return invokeCommand<string>('git_commit', { path, message, author, email }, { source: 'GIT' })
}

// ── Diff ──────────────────────────────────────────────────────────

export function gitGetDiffWorking(path: string): Promise<GitDiff> {
  return invokeCommand<GitDiff>('git_get_diff_working', { path }, { source: 'GIT' })
}

export function gitGetDiffStaged(path: string): Promise<GitDiff> {
  return invokeCommand<GitDiff>('git_get_diff_staged', { path }, { source: 'GIT' })
}

export function gitGetDiffCommit(path: string, hash: string): Promise<GitDiff> {
  return invokeCommand<GitDiff>('git_get_diff_commit', { path, hash }, { source: 'GIT' })
}

// ── 分支 ──────────────────────────────────────────────────────────

export function gitGetBranches(path: string): Promise<GitBranch[]> {
  return invokeCommand<GitBranch[]>('git_get_branches', { path }, { source: 'GIT' })
}

export function gitCreateBranch(path: string, name: string, startPoint?: string): Promise<void> {
  return invokeCommand('git_create_branch', { path, name, startPoint }, { source: 'GIT' })
}

export function gitDeleteBranch(path: string, name: string): Promise<void> {
  return invokeCommand('git_delete_branch', { path, name }, { source: 'GIT' })
}

export function gitCheckoutBranch(path: string, name: string): Promise<void> {
  return invokeCommand('git_checkout_branch', { path, name }, { source: 'GIT' })
}

// ── Stash ─────────────────────────────────────────────────────────

export function gitGetStashes(path: string): Promise<GitStash[]> {
  return invokeCommand<GitStash[]>('git_get_stashes', { path }, { source: 'GIT' })
}

export function gitCreateStash(path: string, message?: string): Promise<number> {
  return invokeCommand<number>('git_create_stash', { path, message }, { source: 'GIT' })
}

export function gitApplyStash(path: string, index: number): Promise<void> {
  return invokeCommand('git_apply_stash', { path, index }, { source: 'GIT' })
}

export function gitDropStash(path: string, index: number): Promise<void> {
  return invokeCommand('git_drop_stash', { path, index }, { source: 'GIT' })
}

// ── 分支图 ────────────────────────────────────────────────────────

export function gitGetGraph(path: string, skip: number, limit: number): Promise<GitGraph> {
  return invokeCommand<GitGraph>('git_get_graph', { path, skip, limit }, { source: 'GIT' })
}

// ── Remote 操作 ──────────────────────────────────────────────────

export function gitGetRemotes(path: string): Promise<GitRemote[]> {
  return invokeCommand<GitRemote[]>('git_get_remotes', { path }, { source: 'GIT' })
}

export function gitPush(path: string, remote: string, branch: string, force = false): Promise<string> {
  return invokeCommand<string>('git_push', { path, remote, branch, force }, { source: 'GIT' })
}

export function gitPull(path: string, remote: string, branch: string): Promise<string> {
  return invokeCommand<string>('git_pull', { path, remote, branch }, { source: 'GIT' })
}

export function gitFetch(path: string, remote: string): Promise<string> {
  return invokeCommand<string>('git_fetch', { path, remote }, { source: 'GIT' })
}

// ── Merge & Rebase ──────────────────────────────────────────────

export function gitMergeBranch(path: string, branchName: string): Promise<GitMergeResult> {
  return invokeCommand<GitMergeResult>('git_merge_branch', { path, branchName }, { source: 'GIT' })
}

export function gitAbortMerge(path: string): Promise<void> {
  return invokeCommand('git_abort_merge', { path }, { source: 'GIT' })
}

export function gitRebaseBranch(path: string, ontoBranch: string): Promise<void> {
  return invokeCommand('git_rebase_branch', { path, ontoBranch }, { source: 'GIT' })
}

export function gitAbortRebase(path: string): Promise<void> {
  return invokeCommand('git_abort_rebase', { path }, { source: 'GIT' })
}

// ── Tag 操作 ─────────────────────────────────────────────────────

export function gitGetTags(path: string): Promise<GitTag[]> {
  return invokeCommand<GitTag[]>('git_get_tags', { path }, { source: 'GIT' })
}

export function gitCreateTag(path: string, name: string, message?: string, target?: string): Promise<void> {
  return invokeCommand('git_create_tag', { path, name, message, target }, { source: 'GIT' })
}

export function gitDeleteTag(path: string, name: string): Promise<void> {
  return invokeCommand('git_delete_tag', { path, name }, { source: 'GIT' })
}

// ── 文件操作 ─────────────────────────────────────────────────────

export function gitDiscardFile(path: string, filePath: string): Promise<void> {
  return invokeCommand('git_discard_file', { path, filePath }, { source: 'GIT' })
}

export function gitDiscardAll(path: string): Promise<void> {
  return invokeCommand('git_discard_all', { path }, { source: 'GIT' })
}

export function gitGetFileContent(path: string, hash: string, filePath: string): Promise<string> {
  return invokeCommand<string>('git_get_file_content', { path, hash, filePath }, { source: 'GIT' })
}

// ── Git Config ──────────────────────────────────────────────────

export function gitGetConfig(path: string): Promise<GitConfig> {
  return invokeCommand<GitConfig>('git_get_config', { path }, { source: 'GIT' })
}

// ── Amend 提交 ──────────────────────────────────────────────────

export function gitAmendCommit(path: string, message: string, author: string, email: string): Promise<string> {
  return invokeCommand<string>('git_amend_commit', { path, message, author, email }, { source: 'GIT' })
}

// ── Pop Stash ───────────────────────────────────────────────────

export function gitPopStash(path: string, index: number): Promise<void> {
  return invokeCommand('git_pop_stash', { path, index }, { source: 'GIT' })
}

// ── Cherry-pick ─────────────────────────────────────────────────

export function gitCherryPick(path: string, hash: string): Promise<GitMergeResult> {
  return invokeCommand<GitMergeResult>('git_cherry_pick', { path, hash }, { source: 'GIT' })
}

// ── 搜索提交 ────────────────────────────────────────────────────

export function gitSearchCommits(path: string, query: string, field: string, skip: number, limit: number): Promise<GitCommit[]> {
  return invokeCommand<GitCommit[]>('git_search_commits', { path, query, field, skip, limit }, { source: 'GIT' })
}

// ── Blame ───────────────────────────────────────────────────────

export function gitBlameFile(path: string, filePath: string): Promise<GitBlameLine[]> {
  return invokeCommand<GitBlameLine[]>('git_blame_file', { path, filePath }, { source: 'GIT' })
}

// ── 文件历史 ────────────────────────────────────────────────────

export function gitFileHistory(path: string, filePath: string, skip: number, limit: number): Promise<GitCommit[]> {
  return invokeCommand<GitCommit[]>('git_file_history', { path, filePath, skip, limit }, { source: 'GIT' })
}

// ── 贡献者统计 ──────────────────────────────────────────────────

export function gitGetContributors(path: string): Promise<GitContributor[]> {
  return invokeCommand<GitContributor[]>('git_get_contributors', { path }, { source: 'GIT' })
}

// ── 交互式 Rebase ──────────────────────────────────────────────

export function gitInteractiveRebasePlan(path: string, baseCommit: string): Promise<RebaseEntry[]> {
  return invokeCommand<RebaseEntry[]>('git_interactive_rebase_plan', { path, baseCommit }, { source: 'GIT' })
}

export function gitInteractiveRebaseExecute(path: string, baseCommit: string, plan: RebaseEntry[]): Promise<RebaseResult> {
  return invokeCommand<RebaseResult>('git_interactive_rebase_execute', { path, baseCommit, plan }, { source: 'GIT' })
}

export function gitInteractiveRebaseAbort(path: string): Promise<void> {
  return invokeCommand('git_interactive_rebase_abort', { path }, { source: 'GIT' })
}
