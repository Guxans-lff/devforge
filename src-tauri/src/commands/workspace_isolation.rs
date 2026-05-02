use crate::utils::error::AppError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;

const TEMP_WORKSPACE_ROOT: &str = ".devforge/tmp/agents";
const WORKTREE_ROOT: &str = ".devforge/worktrees";
const MANIFEST_PATH: &str = ".devforge/isolation-manifest.json";
const MAX_COPY_FILE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceIsolationMode {
    Temporary,
    Worktree,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIsolationPathValidation {
    pub valid: bool,
    pub repo_path: String,
    pub workspace_path: String,
    pub allowed_root: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIsolationPrepareResult {
    pub repo_path: String,
    pub workspace_path: String,
    pub mode: WorkspaceIsolationMode,
    pub branch_name: Option<String>,
    pub copied_files: usize,
    pub skipped_paths: Vec<String>,
    pub reused_existing: bool,
    pub manifest_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIsolationDiffEntry {
    pub path: String,
    pub status: String,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIsolationDiffSummary {
    pub added: usize,
    pub modified: usize,
    pub deleted: usize,
    pub unchanged: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIsolationDiffResult {
    pub repo_path: String,
    pub workspace_path: String,
    pub mode: WorkspaceIsolationMode,
    pub entries: Vec<WorkspaceIsolationDiffEntry>,
    pub summary: WorkspaceIsolationDiffSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIsolationApplyResult {
    pub repo_path: String,
    pub workspace_path: String,
    pub applied_files: usize,
    pub deleted_files: usize,
    pub skipped_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIsolationCleanupResult {
    pub workspace_path: String,
    pub mode: WorkspaceIsolationMode,
    pub removed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceIsolationManifest {
    repo_path: String,
    workspace_path: String,
    mode: WorkspaceIsolationMode,
    allowed_paths: Vec<String>,
    blocked_paths: Vec<String>,
    files: Vec<WorkspaceIsolationManifestFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceIsolationManifestFile {
    path: String,
    sha256: String,
    size: u64,
}

#[tauri::command]
pub async fn workspace_isolation_validate_path(
    repo_path: String,
    workspace_path: String,
    mode: WorkspaceIsolationMode,
) -> Result<WorkspaceIsolationPathValidation, AppError> {
    let repo = canonical_repo_path(&repo_path)?;
    let allowed_root = allowed_workspace_root(&repo, mode)?;
    let resolved = resolve_workspace_path(&repo, &workspace_path, mode);

    Ok(match resolved {
        Ok(path) => WorkspaceIsolationPathValidation {
            valid: true,
            repo_path: path_string(&repo),
            workspace_path: path_string(&path),
            allowed_root: path_string(&allowed_root),
            reason: None,
        },
        Err(error) => WorkspaceIsolationPathValidation {
            valid: false,
            repo_path: path_string(&repo),
            workspace_path,
            allowed_root: path_string(&allowed_root),
            reason: Some(error.to_string()),
        },
    })
}

#[tauri::command]
pub async fn workspace_isolation_prepare(
    repo_path: String,
    workspace_path: String,
    branch_name: Option<String>,
    mode: WorkspaceIsolationMode,
    allowed_paths: Vec<String>,
    blocked_paths: Vec<String>,
) -> Result<WorkspaceIsolationPrepareResult, AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = canonical_repo_path(&repo_path)?;
        let workspace = resolve_workspace_path(&repo, &workspace_path, mode)?;

        match mode {
            WorkspaceIsolationMode::Temporary => {
                prepare_temporary_workspace(&repo, &workspace, allowed_paths, blocked_paths)
            }
            WorkspaceIsolationMode::Worktree => {
                prepare_worktree_workspace(&repo, &workspace, branch_name)
            }
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("隔离工作区准备任务失败: {e}")))?
}

#[tauri::command]
pub async fn workspace_isolation_diff(
    repo_path: String,
    workspace_path: String,
    mode: WorkspaceIsolationMode,
) -> Result<WorkspaceIsolationDiffResult, AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = canonical_repo_path(&repo_path)?;
        let workspace = resolve_workspace_path(&repo, &workspace_path, mode)?;

        match mode {
            WorkspaceIsolationMode::Temporary => diff_temporary_workspace(&repo, &workspace),
            WorkspaceIsolationMode::Worktree => diff_worktree_workspace(&repo, &workspace),
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("隔离工作区 diff 任务失败: {e}")))?
}

#[tauri::command]
pub async fn workspace_isolation_apply_changes(
    repo_path: String,
    workspace_path: String,
    mode: WorkspaceIsolationMode,
    confirmed: bool,
) -> Result<WorkspaceIsolationApplyResult, AppError> {
    tokio::task::spawn_blocking(move || {
        if !confirmed {
            return Err(AppError::Permission("回放隔离工作区变更需要显式确认".into()));
        }

        let repo = canonical_repo_path(&repo_path)?;
        let workspace = resolve_workspace_path(&repo, &workspace_path, mode)?;
        match mode {
            WorkspaceIsolationMode::Temporary => apply_temporary_workspace(&repo, &workspace),
            WorkspaceIsolationMode::Worktree => Err(AppError::Validation(
                "Worktree 变更需要通过 Git 审核/合并流程处理，当前命令不会自动合并".into(),
            )),
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("隔离工作区回放任务失败: {e}")))?
}

#[tauri::command]
pub async fn workspace_isolation_cleanup(
    repo_path: String,
    workspace_path: String,
    mode: WorkspaceIsolationMode,
    force: Option<bool>,
) -> Result<WorkspaceIsolationCleanupResult, AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = canonical_repo_path(&repo_path)?;
        let workspace = resolve_workspace_path(&repo, &workspace_path, mode)?;
        if !workspace.exists() {
            return Ok(WorkspaceIsolationCleanupResult {
                workspace_path: path_string(&workspace),
                mode,
                removed: false,
            });
        }

        match mode {
            WorkspaceIsolationMode::Temporary => {
                std::fs::remove_dir_all(&workspace)
                    .map_err(|e| AppError::Io(e))?;
            }
            WorkspaceIsolationMode::Worktree => {
                let mut args = vec![
                    "-C".to_string(),
                    path_string(&repo),
                    "worktree".to_string(),
                    "remove".to_string(),
                ];
                if force.unwrap_or(false) {
                    args.push("--force".to_string());
                }
                args.push(path_string(&workspace));
                run_git(args, "移除 worktree 失败")?;
            }
        }

        Ok(WorkspaceIsolationCleanupResult {
            workspace_path: path_string(&workspace),
            mode,
            removed: true,
        })
    })
    .await
    .map_err(|e| AppError::Other(format!("隔离工作区清理任务失败: {e}")))?
}

fn prepare_temporary_workspace(
    repo: &Path,
    workspace: &Path,
    allowed_paths: Vec<String>,
    blocked_paths: Vec<String>,
) -> Result<WorkspaceIsolationPrepareResult, AppError> {
    if allowed_paths.is_empty() {
        return Err(AppError::Validation("临时隔离空间需要显式 allowedPaths".into()));
    }

    let manifest_path = workspace.join(MANIFEST_PATH);
    if workspace.exists() {
        if manifest_path.exists() {
            return Ok(WorkspaceIsolationPrepareResult {
                repo_path: path_string(repo),
                workspace_path: path_string(workspace),
                mode: WorkspaceIsolationMode::Temporary,
                branch_name: None,
                copied_files: 0,
                skipped_paths: vec!["隔离空间已存在，未覆盖已有内容".into()],
                reused_existing: true,
                manifest_path: Some(path_string(&manifest_path)),
            });
        }

        if !is_dir_empty(workspace)? {
            return Err(AppError::Validation(
                "目标临时隔离空间已存在且没有 manifest，拒绝覆盖".into(),
            ));
        }
    }

    std::fs::create_dir_all(workspace)?;

    let mut copied_files = 0;
    let mut skipped_paths = Vec::new();
    let mut manifest_files = Vec::new();
    let mut seen_files = HashSet::new();

    for allowed_path in &allowed_paths {
        let Some(base) = pattern_base(allowed_path) else {
            skipped_paths.push(format!("{allowed_path}：不是可复制路径"));
            continue;
        };
        if is_forbidden_copy_root(&base) {
            skipped_paths.push(format!("{allowed_path}：路径范围过大或受保护"));
            continue;
        }

        let source = safe_repo_child(repo, &base)?;
        if !source.exists() {
            skipped_paths.push(format!("{allowed_path}：源路径不存在"));
            continue;
        }

        if source.is_file() {
            let relative = normalize_slash(&base);
            if !path_matches_pattern(&relative, allowed_path) {
                skipped_paths.push(format!("{relative}：未匹配 allowedPaths"));
                continue;
            }
            if is_blocked_path(&relative, &blocked_paths) {
                skipped_paths.push(format!("{relative}：命中 blockedPaths"));
                continue;
            }
            copy_one_file(repo, workspace, &source, &relative, &mut manifest_files, &mut seen_files)?;
            copied_files += 1;
            continue;
        }

        for entry in WalkDir::new(&source).into_iter().filter_entry(|entry| {
            !is_ignored_dir_name(entry.file_name())
        }) {
            let entry = entry.map_err(|e| AppError::Io(e.into()))?;
            if !entry.file_type().is_file() {
                continue;
            }

            let relative = relative_to_repo(repo, entry.path())?;
            if !path_matches_pattern(&relative, allowed_path) {
                continue;
            }
            if is_blocked_path(&relative, &blocked_paths) {
                skipped_paths.push(format!("{relative}：命中 blockedPaths"));
                continue;
            }

            copy_one_file(
                repo,
                workspace,
                entry.path(),
                &relative,
                &mut manifest_files,
                &mut seen_files,
            )?;
            copied_files += 1;
        }
    }

    let manifest = WorkspaceIsolationManifest {
        repo_path: path_string(repo),
        workspace_path: path_string(workspace),
        mode: WorkspaceIsolationMode::Temporary,
        allowed_paths,
        blocked_paths,
        files: manifest_files,
    };
    write_manifest(&manifest_path, &manifest)?;

    Ok(WorkspaceIsolationPrepareResult {
        repo_path: path_string(repo),
        workspace_path: path_string(workspace),
        mode: WorkspaceIsolationMode::Temporary,
        branch_name: None,
        copied_files,
        skipped_paths,
        reused_existing: false,
        manifest_path: Some(path_string(&manifest_path)),
    })
}

fn prepare_worktree_workspace(
    repo: &Path,
    workspace: &Path,
    branch_name: Option<String>,
) -> Result<WorkspaceIsolationPrepareResult, AppError> {
    git2::Repository::open(repo)
        .map_err(|e| AppError::Validation(format!("不是有效 Git 仓库: {e}")))?;
    if workspace.exists() && !is_dir_empty(workspace)? {
        return Err(AppError::Validation("目标 worktree 路径已存在且不为空".into()));
    }

    if let Some(parent) = workspace.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut args = vec![
        "-C".to_string(),
        path_string(repo),
        "worktree".to_string(),
        "add".to_string(),
    ];

    if let Some(branch) = branch_name.as_ref() {
        validate_branch_name(branch)?;
        args.push("-b".to_string());
        args.push(branch.clone());
    }
    args.push(path_string(workspace));
    run_git(args, "创建 worktree 失败")?;

    Ok(WorkspaceIsolationPrepareResult {
        repo_path: path_string(repo),
        workspace_path: path_string(workspace),
        mode: WorkspaceIsolationMode::Worktree,
        branch_name,
        copied_files: 0,
        skipped_paths: Vec::new(),
        reused_existing: false,
        manifest_path: None,
    })
}

fn diff_temporary_workspace(repo: &Path, workspace: &Path) -> Result<WorkspaceIsolationDiffResult, AppError> {
    let manifest = read_manifest(&workspace.join(MANIFEST_PATH))?;
    let manifest_by_path: HashMap<String, WorkspaceIsolationManifestFile> = manifest
        .files
        .iter()
        .cloned()
        .map(|file| (file.path.clone(), file))
        .collect();
    let mut workspace_files = HashSet::new();
    let mut entries = Vec::new();
    let mut summary = WorkspaceIsolationDiffSummary::default();

    for entry in WalkDir::new(workspace).into_iter().filter_entry(|entry| {
        should_visit_workspace_diff_entry(entry.path(), workspace)
    }) {
        let entry = entry.map_err(|e| AppError::Io(e.into()))?;
        if !entry.file_type().is_file() {
            continue;
        }

        let relative = relative_to_base(workspace, entry.path())?;
        if !matches_any_allowed(&relative, &manifest.allowed_paths)
            || is_blocked_path(&relative, &manifest.blocked_paths)
        {
            continue;
        }

        workspace_files.insert(relative.clone());
        let metadata = entry.metadata().map_err(|e| AppError::Io(e.into()))?;
        let status = match manifest_by_path.get(&relative) {
            None => {
                summary.added += 1;
                "added"
            }
            Some(file) => {
                let current_hash = sha256_file(entry.path())?;
                if current_hash == file.sha256 {
                    summary.unchanged += 1;
                    continue;
                }
                summary.modified += 1;
                "modified"
            }
        };
        entries.push(WorkspaceIsolationDiffEntry {
            path: relative,
            status: status.into(),
            size: Some(metadata.len()),
        });
    }

    for file in &manifest.files {
        if workspace_files.contains(&file.path) {
            continue;
        }
        summary.deleted += 1;
        entries.push(WorkspaceIsolationDiffEntry {
            path: file.path.clone(),
            status: "deleted".into(),
            size: Some(file.size),
        });
    }

    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(WorkspaceIsolationDiffResult {
        repo_path: path_string(repo),
        workspace_path: path_string(workspace),
        mode: WorkspaceIsolationMode::Temporary,
        entries,
        summary,
    })
}

fn diff_worktree_workspace(repo: &Path, workspace: &Path) -> Result<WorkspaceIsolationDiffResult, AppError> {
    if !workspace.exists() {
        return Err(AppError::Validation("worktree 路径不存在".into()));
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(workspace)
        .arg("status")
        .arg("--short")
        .output()
        .map_err(|e| AppError::Other(format!("执行 git status 失败: {e}")))?;

    if !output.status.success() {
        return Err(AppError::Other(format!(
            "获取 worktree 状态失败: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();
    let mut summary = WorkspaceIsolationDiffSummary::default();

    for line in stdout.lines() {
        if line.len() < 4 {
            continue;
        }
        let code = &line[..2];
        let path = line[3..].trim().to_string();
        let status = git_short_status_to_label(code);
        match status {
            "added" => summary.added += 1,
            "deleted" => summary.deleted += 1,
            "modified" | "renamed" | "conflicted" => summary.modified += 1,
            _ => summary.unchanged += 1,
        }
        entries.push(WorkspaceIsolationDiffEntry {
            path,
            status: status.into(),
            size: None,
        });
    }

    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(WorkspaceIsolationDiffResult {
        repo_path: path_string(repo),
        workspace_path: path_string(workspace),
        mode: WorkspaceIsolationMode::Worktree,
        entries,
        summary,
    })
}

fn apply_temporary_workspace(repo: &Path, workspace: &Path) -> Result<WorkspaceIsolationApplyResult, AppError> {
    let diff = diff_temporary_workspace(repo, workspace)?;
    let manifest = read_manifest(&workspace.join(MANIFEST_PATH))?;
    let mut applied_files = 0;
    let mut deleted_files = 0;
    let mut skipped_paths = Vec::new();

    for entry in diff.entries {
        if !matches_any_allowed(&entry.path, &manifest.allowed_paths)
            || is_blocked_path(&entry.path, &manifest.blocked_paths)
        {
            skipped_paths.push(format!("{}：越过 allowedPaths 或命中 blockedPaths", entry.path));
            continue;
        }

        let target = safe_repo_child(repo, &entry.path)?;
        match entry.status.as_str() {
            "added" | "modified" => {
                let source = safe_child_path(workspace, &entry.path)?;
                if !source.is_file() {
                    skipped_paths.push(format!("{}：源文件不存在", entry.path));
                    continue;
                }
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::copy(&source, &target)
                    .map_err(|e| AppError::Other(format!("回放文件失败 {}: {e}", entry.path)))?;
                applied_files += 1;
            }
            "deleted" => {
                if target.exists() {
                    std::fs::remove_file(&target)
                        .map_err(|e| AppError::Other(format!("删除目标文件失败 {}: {e}", entry.path)))?;
                    deleted_files += 1;
                }
            }
            _ => skipped_paths.push(format!("{}：未知状态 {}", entry.path, entry.status)),
        }
    }

    Ok(WorkspaceIsolationApplyResult {
        repo_path: path_string(repo),
        workspace_path: path_string(workspace),
        applied_files,
        deleted_files,
        skipped_paths,
    })
}

fn canonical_repo_path(path: &str) -> Result<PathBuf, AppError> {
    let repo = dunce::canonicalize(path)
        .map_err(|e| AppError::Validation(format!("仓库路径无效: {e}")))?;
    git2::Repository::open(&repo)
        .map_err(|e| AppError::Validation(format!("不是有效 Git 仓库: {e}")))?;
    Ok(repo)
}

fn allowed_workspace_root(repo: &Path, mode: WorkspaceIsolationMode) -> Result<PathBuf, AppError> {
    let root = match mode {
        WorkspaceIsolationMode::Temporary => repo.join(TEMP_WORKSPACE_ROOT),
        WorkspaceIsolationMode::Worktree => repo.join(WORKTREE_ROOT),
    };
    lexical_normalize(root)
}

fn resolve_workspace_path(
    repo: &Path,
    workspace_path: &str,
    mode: WorkspaceIsolationMode,
) -> Result<PathBuf, AppError> {
    if workspace_path.trim().is_empty() {
        return Err(AppError::Validation("workspacePath 不能为空".into()));
    }

    let input = PathBuf::from(workspace_path);
    let joined = if input.is_absolute() {
        input
    } else {
        repo.join(input)
    };
    let workspace = lexical_normalize(joined)?;
    let allowed_root = allowed_workspace_root(repo, mode)?;

    if !path_starts_with(&workspace, &allowed_root) || workspace == allowed_root {
        return Err(AppError::Permission(format!(
            "隔离工作区必须位于 {} 内",
            path_string(&allowed_root)
        )));
    }
    Ok(workspace)
}

fn safe_repo_child(repo: &Path, relative: &str) -> Result<PathBuf, AppError> {
    safe_child_path(repo, relative)
}

fn safe_child_path(base: &Path, relative: &str) -> Result<PathBuf, AppError> {
    let input = PathBuf::from(relative);
    if input.is_absolute() {
        return Err(AppError::Validation(format!("不允许绝对路径: {relative}")));
    }
    if input.components().any(|component| {
        matches!(component, Component::ParentDir | Component::Prefix(_) | Component::RootDir)
    }) {
        return Err(AppError::Validation(format!("路径包含非法片段: {relative}")));
    }
    lexical_normalize(base.join(input))
}

fn lexical_normalize(path: PathBuf) -> Result<PathBuf, AppError> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::Normal(part) => normalized.push(part),
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(AppError::Validation("路径不能向上逃逸".into()));
                }
            }
        }
    }
    Ok(normalized)
}

fn path_starts_with(path: &Path, base: &Path) -> bool {
    normalize_slash_path(path)
        .to_lowercase()
        .starts_with(&format!("{}/", normalize_slash_path(base).to_lowercase()))
}

fn pattern_base(pattern: &str) -> Option<String> {
    let normalized = normalize_slash(pattern)
        .trim_start_matches("./")
        .trim_matches('/')
        .to_string();
    if normalized.is_empty() {
        return None;
    }

    let mut parts = Vec::new();
    for part in normalized.split('/') {
        if part.contains('*') {
            break;
        }
        parts.push(part);
    }
    let base = parts.join("/");
    if base.is_empty() {
        None
    } else {
        Some(base)
    }
}

fn is_forbidden_copy_root(path: &str) -> bool {
    let normalized = normalize_slash(path).trim_matches('/').to_string();
    normalized.is_empty()
        || normalized == "."
        || normalized == ".git"
        || normalized == ".devforge"
        || normalized == "node_modules"
        || normalized == "target"
        || normalized == "dist"
}

fn is_ignored_dir_name(name: &OsStr) -> bool {
    matches!(
        name.to_string_lossy().as_ref(),
        ".git" | ".devforge" | "node_modules" | "target" | "dist"
    )
}

fn should_visit_workspace_diff_entry(path: &Path, workspace: &Path) -> bool {
    if path == workspace {
        return true;
    }
    let Some(name) = path.file_name() else {
        return true;
    };
    if is_ignored_dir_name(name) {
        return false;
    }
    relative_to_base(workspace, path)
        .map(|relative| relative != ".devforge/isolation-manifest.json")
        .unwrap_or(true)
}

fn copy_one_file(
    repo: &Path,
    workspace: &Path,
    source: &Path,
    relative: &str,
    manifest_files: &mut Vec<WorkspaceIsolationManifestFile>,
    seen_files: &mut HashSet<String>,
) -> Result<(), AppError> {
    if !seen_files.insert(relative.to_string()) {
        return Ok(());
    }
    let metadata = source.metadata()?;
    if metadata.len() > MAX_COPY_FILE_BYTES {
        return Ok(());
    }

    let target = safe_child_path(workspace, relative)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(source, &target)
        .map_err(|e| AppError::Other(format!("复制文件失败 {}: {e}", relative)))?;

    manifest_files.push(WorkspaceIsolationManifestFile {
        path: relative_to_repo(repo, source)?,
        sha256: sha256_file(source)?,
        size: metadata.len(),
    });
    Ok(())
}

fn relative_to_repo(repo: &Path, path: &Path) -> Result<String, AppError> {
    relative_to_base(repo, path)
}

fn relative_to_base(base: &Path, path: &Path) -> Result<String, AppError> {
    path.strip_prefix(base)
        .map(|p| normalize_slash_path(p))
        .map_err(|_| AppError::Permission("路径不在允许的根目录内".into()))
}

fn is_blocked_path(path: &str, blocked_paths: &[String]) -> bool {
    blocked_paths.iter().any(|pattern| path_matches_pattern(path, pattern))
}

fn matches_any_allowed(path: &str, allowed_paths: &[String]) -> bool {
    allowed_paths.is_empty() || allowed_paths.iter().any(|pattern| path_matches_pattern(path, pattern))
}

fn path_matches_pattern(path: &str, pattern: &str) -> bool {
    let normalized_path = normalize_slash(path).trim_matches('/').to_string();
    let normalized_pattern = normalize_slash(pattern)
        .trim_start_matches("./")
        .trim_matches('/')
        .to_string();
    if normalized_pattern.is_empty() {
        return false;
    }
    if let Some(prefix) = normalized_pattern.strip_suffix("/**") {
        return normalized_path == prefix || normalized_path.starts_with(&format!("{prefix}/"));
    }
    if let Some(prefix) = normalized_pattern.strip_suffix("/*") {
        let rest = normalized_path
            .strip_prefix(&format!("{prefix}/"))
            .unwrap_or_default();
        return !rest.is_empty() && !rest.contains('/');
    }
    if normalized_pattern.contains('*') {
        return wildcard_match(&normalized_path, &normalized_pattern);
    }
    normalized_path == normalized_pattern || normalized_path.starts_with(&format!("{normalized_pattern}/"))
}

fn wildcard_match(value: &str, pattern: &str) -> bool {
    let value_chars: Vec<char> = value.chars().collect();
    let pattern_chars: Vec<char> = pattern.chars().collect();
    let mut value_index = 0;
    let mut pattern_index = 0;
    let mut star_index: Option<usize> = None;
    let mut match_index = 0;

    while value_index < value_chars.len() {
        if pattern_index < pattern_chars.len()
            && pattern_chars[pattern_index] != '*'
            && pattern_chars[pattern_index] == value_chars[value_index]
        {
            value_index += 1;
            pattern_index += 1;
        } else if pattern_index < pattern_chars.len() && pattern_chars[pattern_index] == '*' {
            star_index = Some(pattern_index);
            match_index = value_index;
            pattern_index += 1;
        } else if let Some(star) = star_index {
            if value_chars.get(match_index) == Some(&'/') {
                return false;
            }
            pattern_index = star + 1;
            match_index += 1;
            value_index = match_index;
        } else {
            return false;
        }
    }

    while pattern_index < pattern_chars.len() && pattern_chars[pattern_index] == '*' {
        pattern_index += 1;
    }
    pattern_index == pattern_chars.len()
}

fn write_manifest(path: &Path, manifest: &WorkspaceIsolationManifest) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(manifest)?;
    std::fs::write(path, content)?;
    Ok(())
}

fn read_manifest(path: &Path) -> Result<WorkspaceIsolationManifest, AppError> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| AppError::Validation(format!("读取隔离 manifest 失败: {e}")))?;
    serde_json::from_str(&content)
        .map_err(|e| AppError::Validation(format!("解析隔离 manifest 失败: {e}")))
}

fn sha256_file(path: &Path) -> Result<String, AppError> {
    let bytes = std::fs::read(path)?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

fn run_git(args: Vec<String>, context: &str) -> Result<(), AppError> {
    let output = Command::new("git")
        .args(args)
        .output()
        .map_err(|e| AppError::Other(format!("{context}: {e}")))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(AppError::Other(format!(
        "{context}: {}",
        if stderr.is_empty() { stdout } else { stderr }
    )))
}

fn validate_branch_name(branch: &str) -> Result<(), AppError> {
    let invalid = branch.trim().is_empty()
        || branch.starts_with('/')
        || branch.ends_with('/')
        || branch.contains("..")
        || branch.contains('\\')
        || branch.contains(' ')
        || branch.ends_with(".lock")
        || branch.chars().any(|c| !c.is_ascii_alphanumeric() && !matches!(c, '/' | '-' | '_' | '.'));
    if invalid {
        return Err(AppError::Validation(format!("非法分支名: {branch}")));
    }
    Ok(())
}

fn is_dir_empty(path: &Path) -> Result<bool, AppError> {
    Ok(std::fs::read_dir(path)?.next().is_none())
}

fn git_short_status_to_label(code: &str) -> &'static str {
    if code.contains('U') {
        return "conflicted";
    }
    if code.contains('R') {
        return "renamed";
    }
    if code.contains('D') {
        return "deleted";
    }
    if code.contains('A') || code == "??" {
        return "added";
    }
    if code.contains('M') {
        return "modified";
    }
    "modified"
}

fn normalize_slash(path: &str) -> String {
    path.replace('\\', "/")
}

fn normalize_slash_path(path: &Path) -> String {
    normalize_slash(&path.to_string_lossy())
        .trim_end_matches('/')
        .to_string()
}

fn path_string(path: &Path) -> String {
    normalize_slash_path(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn init_repo() -> (TempDir, PathBuf) {
        let temp = tempfile::tempdir().expect("create temp dir");
        let repo = temp.path().join("repo");
        std::fs::create_dir_all(repo.join("src/secrets")).expect("create repo dirs");
        std::fs::write(repo.join("src/app.ts"), "old").expect("write app");
        std::fs::write(repo.join("src/app.test.ts"), "test").expect("write test");
        std::fs::write(repo.join("src/secrets/key.ts"), "secret").expect("write secret");

        Command::new("git")
            .arg("init")
            .arg(&repo)
            .output()
            .expect("git init");
        Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["config", "user.email", "test@example.com"])
            .output()
            .expect("git config email");
        Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["config", "user.name", "Tester"])
            .output()
            .expect("git config name");
        Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["add", "."])
            .output()
            .expect("git add");
        Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["commit", "-m", "init"])
            .output()
            .expect("git commit");
        (temp, repo)
    }

    #[test]
    fn matches_workspace_patterns_without_crossing_single_star_directories() {
        assert!(path_matches_pattern("src/app.ts", "src/*.ts"));
        assert!(!path_matches_pattern("src/nested/app.ts", "src/*.ts"));
        assert!(path_matches_pattern("src/nested/app.ts", "src/**"));
        assert!(!path_matches_pattern("docs/readme.md", "src/**"));
    }

    #[test]
    fn rejects_workspace_path_outside_allowed_root() {
        let (_temp, repo) = init_repo();
        let repo = canonical_repo_path(&path_string(&repo)).expect("repo");
        let outside = repo.parent().unwrap().join("outside");
        let result = resolve_workspace_path(
            &repo,
            &path_string(&outside),
            WorkspaceIsolationMode::Temporary,
        );

        assert!(matches!(result, Err(AppError::Permission(_))));
    }

    #[test]
    fn prepares_diffs_and_applies_temporary_workspace_changes() {
        let (_temp, repo) = init_repo();
        let workspace = repo.join(".devforge/tmp/agents/test-agent");

        let prepared = prepare_temporary_workspace(
            &repo,
            &workspace,
            vec!["src/*.ts".into()],
            vec!["src/secrets/**".into()],
        )
        .expect("prepare temp workspace");

        assert_eq!(prepared.copied_files, 2);
        assert!(workspace.join("src/app.ts").exists());
        assert!(!workspace.join("src/secrets/key.ts").exists());

        std::fs::write(workspace.join("src/app.ts"), "new").expect("modify copied file");
        std::fs::write(workspace.join("src/new.ts"), "created").expect("create copied file");
        std::fs::remove_file(workspace.join("src/app.test.ts")).expect("delete copied file");

        let diff = diff_temporary_workspace(&repo, &workspace).expect("diff workspace");
        assert_eq!(diff.summary.added, 1);
        assert_eq!(diff.summary.modified, 1);
        assert_eq!(diff.summary.deleted, 1);

        let applied = apply_temporary_workspace(&repo, &workspace).expect("apply workspace");
        assert_eq!(applied.applied_files, 2);
        assert_eq!(applied.deleted_files, 1);
        assert_eq!(std::fs::read_to_string(repo.join("src/app.ts")).unwrap(), "new");
        assert!(repo.join("src/new.ts").exists());
        assert!(!repo.join("src/app.test.ts").exists());
        assert_eq!(std::fs::read_to_string(repo.join("src/secrets/key.ts")).unwrap(), "secret");
    }
}
