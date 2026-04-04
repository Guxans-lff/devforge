use crate::models::git::{
    GitBlameLine, GitBranch, GitCommit, GitConfig, GitContributor, GitDiff, GitGraph, GitMergeResult,
    GitRemote, GitRepositoryInfo, GitStash, GitStatus, GitTag,
};
use crate::services::git_engine::GitEngine;
use crate::utils::error::AppError;
use std::sync::Arc;

pub type GitEngineState = Arc<GitEngine>;

// ── 仓库生命周期 ──────────────────────────────────────────────────

#[tauri::command]
pub async fn git_open(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<GitRepositoryInfo, AppError> {
    state.open(&path).await
}

#[tauri::command]
pub async fn git_close(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<(), AppError> {
    state.close(&path).await
}

#[tauri::command]
pub async fn git_is_open(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<bool, AppError> {
    Ok(state.is_open(&path).await)
}

#[tauri::command]
pub async fn git_validate_repo(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<bool, AppError> {
    state.validate_repo(&path).await
}

// ── 状态 & 历史 ───────────────────────────────────────────────────

#[tauri::command]
pub async fn git_get_status(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<GitStatus, AppError> {
    state.get_status(&path).await
}

#[tauri::command]
pub async fn git_current_branch(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<String, AppError> {
    state.current_branch(&path).await
}

#[tauri::command]
pub async fn git_get_commits(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    skip: usize,
    limit: usize,
) -> Result<Vec<GitCommit>, AppError> {
    state.get_commits(&path, skip, limit).await
}

#[tauri::command]
pub async fn git_get_commit_detail(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    hash: String,
) -> Result<GitCommit, AppError> {
    state.get_commit_detail(&path, &hash).await
}

// ── 暂存 & 提交 ──────────────────────────────────────────────────

#[tauri::command]
pub async fn git_stage_file(
    state: tauri::State<'_, GitEngineState>,
    repo_path: String,
    file_path: String,
) -> Result<(), AppError> {
    state.stage_file(&repo_path, &file_path).await
}

#[tauri::command]
pub async fn git_unstage_file(
    state: tauri::State<'_, GitEngineState>,
    repo_path: String,
    file_path: String,
) -> Result<(), AppError> {
    state.unstage_file(&repo_path, &file_path).await
}

#[tauri::command]
pub async fn git_stage_all(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<(), AppError> {
    state.stage_all(&path).await
}

#[tauri::command]
pub async fn git_unstage_all(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<(), AppError> {
    state.unstage_all(&path).await
}

#[tauri::command]
pub async fn git_commit(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    message: String,
    author: String,
    email: String,
) -> Result<String, AppError> {
    state.commit(&path, &message, &author, &email).await
}

// ── Diff ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_get_diff_working(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<GitDiff, AppError> {
    state.get_diff_working(&path).await
}

#[tauri::command]
pub async fn git_get_diff_staged(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<GitDiff, AppError> {
    state.get_diff_staged(&path).await
}

#[tauri::command]
pub async fn git_get_diff_commit(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    hash: String,
) -> Result<GitDiff, AppError> {
    state.get_diff_commit(&path, &hash).await
}

// ── 分支 ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_get_branches(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<Vec<GitBranch>, AppError> {
    state.get_branches(&path).await
}

#[tauri::command]
pub async fn git_create_branch(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    name: String,
    start_point: Option<String>,
) -> Result<(), AppError> {
    state.create_branch(&path, &name, start_point.as_deref()).await
}

#[tauri::command]
pub async fn git_delete_branch(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    name: String,
) -> Result<(), AppError> {
    state.delete_branch(&path, &name).await
}

#[tauri::command]
pub async fn git_checkout_branch(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    name: String,
) -> Result<(), AppError> {
    state.checkout_branch(&path, &name).await
}

// ── Stash ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_get_stashes(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<Vec<GitStash>, AppError> {
    state.get_stashes(&path).await
}

#[tauri::command]
pub async fn git_create_stash(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    message: Option<String>,
) -> Result<usize, AppError> {
    state.create_stash(&path, message.as_deref()).await
}

#[tauri::command]
pub async fn git_apply_stash(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    index: usize,
) -> Result<(), AppError> {
    state.apply_stash(&path, index).await
}

#[tauri::command]
pub async fn git_drop_stash(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    index: usize,
) -> Result<(), AppError> {
    state.drop_stash(&path, index).await
}

// ── 分支图 ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_get_graph(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    skip: usize,
    limit: usize,
) -> Result<GitGraph, AppError> {
    state.get_graph(&path, skip, limit).await
}

// ── Remote 操作 ──────────────────────────────────────────────────

#[tauri::command]
pub async fn git_get_remotes(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<Vec<GitRemote>, AppError> {
    state.get_remotes(&path).await
}

#[tauri::command]
pub async fn git_push(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    remote: String,
    branch: String,
    force: bool,
) -> Result<String, AppError> {
    state.push(&path, &remote, &branch, force).await
}

#[tauri::command]
pub async fn git_pull(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    remote: String,
    branch: String,
) -> Result<String, AppError> {
    state.pull(&path, &remote, &branch).await
}

#[tauri::command]
pub async fn git_fetch(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    remote: String,
) -> Result<String, AppError> {
    state.fetch(&path, &remote).await
}

// ── Merge & Rebase ──────────────────────────────────────────────

#[tauri::command]
pub async fn git_merge_branch(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    branch_name: String,
) -> Result<GitMergeResult, AppError> {
    state.merge_branch(&path, &branch_name).await
}

#[tauri::command]
pub async fn git_abort_merge(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<(), AppError> {
    state.abort_merge(&path).await
}

#[tauri::command]
pub async fn git_rebase_branch(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    onto_branch: String,
) -> Result<(), AppError> {
    state.rebase_branch(&path, &onto_branch).await
}

#[tauri::command]
pub async fn git_abort_rebase(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<(), AppError> {
    state.abort_rebase(&path).await
}

// ── Tag 操作 ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_get_tags(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<Vec<GitTag>, AppError> {
    state.get_tags(&path).await
}

#[tauri::command]
pub async fn git_create_tag(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    name: String,
    message: Option<String>,
    target: Option<String>,
) -> Result<(), AppError> {
    state.create_tag(&path, &name, message.as_deref(), target.as_deref()).await
}

#[tauri::command]
pub async fn git_delete_tag(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    name: String,
) -> Result<(), AppError> {
    state.delete_tag(&path, &name).await
}

// ── 文件操作 ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_discard_file(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    file_path: String,
) -> Result<(), AppError> {
    state.discard_file(&path, &file_path).await
}

#[tauri::command]
pub async fn git_discard_all(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<(), AppError> {
    state.discard_all(&path).await
}

#[tauri::command]
pub async fn git_get_file_content(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    hash: String,
    file_path: String,
) -> Result<String, AppError> {
    state.get_file_content(&path, &hash, &file_path).await
}

// ── Git Config ──────────────────────────────────────────────────

#[tauri::command]
pub async fn git_get_config(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<GitConfig, AppError> {
    state.get_config(&path).await
}

// ── Amend 提交 ──────────────────────────────────────────────────

#[tauri::command]
pub async fn git_amend_commit(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    message: String,
    author: String,
    email: String,
) -> Result<String, AppError> {
    state.amend_commit(&path, &message, &author, &email).await
}

// ── Pop Stash ───────────────────────────────────────────────────

#[tauri::command]
pub async fn git_pop_stash(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    index: usize,
) -> Result<(), AppError> {
    state.pop_stash(&path, index).await
}

// ── Cherry-pick ─────────────────────────────────────────────────

#[tauri::command]
pub async fn git_cherry_pick(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    hash: String,
) -> Result<GitMergeResult, AppError> {
    state.cherry_pick(&path, &hash).await
}

// ── 搜索提交 ────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_search_commits(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    query: String,
    field: String,
    skip: usize,
    limit: usize,
) -> Result<Vec<GitCommit>, AppError> {
    state.search_commits(&path, &query, &field, skip, limit).await
}

// ── Blame ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_blame_file(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    file_path: String,
) -> Result<Vec<GitBlameLine>, AppError> {
    state.blame_file(&path, &file_path).await
}

// ── 文件历史 ────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_file_history(
    state: tauri::State<'_, GitEngineState>,
    path: String,
    file_path: String,
    skip: usize,
    limit: usize,
) -> Result<Vec<GitCommit>, AppError> {
    state.file_history(&path, &file_path, skip, limit).await
}

// ── 贡献者统计 ─────────────────────────────────────────────────

#[tauri::command]
pub async fn git_get_contributors(
    state: tauri::State<'_, GitEngineState>,
    path: String,
) -> Result<Vec<GitContributor>, AppError> {
    state.get_contributors(&path).await
}
