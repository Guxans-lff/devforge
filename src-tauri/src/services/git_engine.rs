use std::collections::HashMap;
use std::path::PathBuf;

use git2::{
    BranchType, Delta, Diff, DiffFormat, DiffOptions, ObjectType, Repository,
    Sort, StatusOptions, StatusShow,
};
use tokio::sync::RwLock;

use crate::models::git::{
    GitBlameLine, GitBranch, GitCommit, GitConfig, GitContributor, GitDiff, GitDiffHunk, GitDiffLine, GitDiffStats,
    GitFileDiff, GitFileStatus, GitGraph, GitGraphEdge, GitGraphNode, GitMergeResult,
    GitRef, GitRemote, GitRepositoryInfo, GitStash, GitStatus, GitTag,
    RebaseAction, RebaseEntry, RebaseResult,
};
use crate::utils::error::AppError;

/// Git 引擎：管理已打开的仓库路径
///
/// `git2::Repository` 是 `!Send`，不能跨线程持有，
/// 所以只缓存路径，每次操作在 `spawn_blocking` 内重新打开。
pub struct GitEngine {
    repo_paths: RwLock<HashMap<String, PathBuf>>,
}

// ── 内部辅助宏 ──────────────────────────────────────────────────
/// 在 `spawn_blocking` 中打开仓库并执行闭包
macro_rules! with_repo {
    ($path:expr, |$repo:ident| $body:block) => {{
        let p = $path.to_owned();
        tokio::task::spawn_blocking(move || {
            #[allow(unused_mut)]
            let mut $repo = Repository::open(&p)
                .map_err(|e| AppError::Other(format!("打开仓库失败: {e}")))?;
            $body
        })
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
    }};
}

impl GitEngine {
    pub fn new() -> Self {
        Self {
            repo_paths: RwLock::new(HashMap::new()),
        }
    }

    // ── 仓库生命周期 ────────────────────────────────────────────

    /// 打开仓库（缓存路径）
    pub async fn open(&self, path: &str) -> Result<GitRepositoryInfo, AppError> {
        let path_owned = path.to_string();
        let info: GitRepositoryInfo = with_repo!(path, |repo| {
            build_repo_info(&repo, &path_owned)
        })?;
        self.repo_paths
            .write()
            .await
            .insert(path.to_string(), PathBuf::from(path));
        Ok(info)
    }

    /// 关闭仓库（移除缓存）
    pub async fn close(&self, path: &str) -> Result<(), AppError> {
        self.repo_paths.write().await.remove(path);
        Ok(())
    }

    /// 检查仓库是否已打开
    pub async fn is_open(&self, path: &str) -> bool {
        self.repo_paths.read().await.contains_key(path)
    }

    /// 校验路径是否为有效 Git 仓库（不注册到缓存）
    pub async fn validate_repo(&self, path: &str) -> Result<bool, AppError> {
        let p = path.to_owned();
        tokio::task::spawn_blocking(move || {
            Ok(Repository::open(&p).is_ok())
        })
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
    }

    // ── 状态 & 历史 ─────────────────────────────────────────────

    /// 获取工作区状态
    pub async fn get_status(&self, path: &str) -> Result<GitStatus, AppError> {
        with_repo!(path, |repo| { build_status(&repo) })
    }

    /// 获取当前分支名
    pub async fn current_branch(&self, path: &str) -> Result<String, AppError> {
        with_repo!(path, |repo| {
            let head = repo.head().map_err(|e| AppError::Other(format!("获取 HEAD 失败: {e}")))?;
            Ok(head
                .shorthand()
                .unwrap_or("HEAD")
                .to_string())
        })
    }

    /// 获取提交历史（分页）
    pub async fn get_commits(
        &self,
        path: &str,
        skip: usize,
        limit: usize,
    ) -> Result<Vec<GitCommit>, AppError> {
        with_repo!(path, |repo| { build_commits(&repo, skip, limit) })
    }

    /// 获取单个提交详情
    pub async fn get_commit_detail(
        &self,
        path: &str,
        hash: &str,
    ) -> Result<GitCommit, AppError> {
        let hash_owned = hash.to_string();
        with_repo!(path, |repo| {
            let oid = git2::Oid::from_str(&hash_owned)
                .map_err(|e| AppError::Validation(format!("无效的提交哈希: {e}")))?;
            let commit = repo.find_commit(oid)
                .map_err(|e| AppError::Other(format!("找不到提交: {e}")))?;
            Ok(parse_commit(&repo, &commit))
        })
    }

    // ── 暂存 & 提交 ─────────────────────────────────────────────

    /// 暂存单个文件
    pub async fn stage_file(
        &self,
        repo_path: &str,
        file_path: &str,
    ) -> Result<(), AppError> {
        let fp = file_path.to_string();
        with_repo!(repo_path, |repo| {
            let mut index = repo.index()
                .map_err(|e| AppError::Other(format!("获取索引失败: {e}")))?;
            // 检测文件是否已删除（在工作区中不存在）
            let full_path = repo.workdir()
                .ok_or_else(|| AppError::Other("裸仓库不支持暂存操作".into()))?
                .join(&fp);
            if full_path.exists() {
                index.add_path(std::path::Path::new(&fp))
                    .map_err(|e| AppError::Other(format!("暂存文件失败: {e}")))?;
            } else {
                index.remove_path(std::path::Path::new(&fp))
                    .map_err(|e| AppError::Other(format!("暂存删除失败: {e}")))?;
            }
            index.write()
                .map_err(|e| AppError::Other(format!("写入索引失败: {e}")))?;
            Ok(())
        })
    }

    /// 取消暂存单个文件
    pub async fn unstage_file(
        &self,
        repo_path: &str,
        file_path: &str,
    ) -> Result<(), AppError> {
        let fp = file_path.to_string();
        with_repo!(repo_path, |repo| {
            let head = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
            let target = head.as_ref().map(|c| c.as_object());
            repo.reset_default(target, [&fp])
                .map_err(|e| AppError::Other(format!("取消暂存失败: {e}")))?;
            Ok(())
        })
    }

    /// 暂存所有变更
    pub async fn stage_all(&self, path: &str) -> Result<(), AppError> {
        with_repo!(path, |repo| {
            let mut index = repo.index()
                .map_err(|e| AppError::Other(format!("获取索引失败: {e}")))?;
            index.add_all(["*"], git2::IndexAddOption::DEFAULT, None)
                .map_err(|e| AppError::Other(format!("暂存所有文件失败: {e}")))?;
            index.write()
                .map_err(|e| AppError::Other(format!("写入索引失败: {e}")))?;
            Ok(())
        })
    }

    /// 取消暂存所有文件
    pub async fn unstage_all(&self, path: &str) -> Result<(), AppError> {
        with_repo!(path, |repo| {
            let head = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
            let target = head.as_ref().map(|c| c.as_object());
            repo.reset_default(target, ["*"])
                .map_err(|e| AppError::Other(format!("取消暂存所有失败: {e}")))?;
            Ok(())
        })
    }

    /// 创建提交
    pub async fn commit(
        &self,
        path: &str,
        message: &str,
        author: &str,
        email: &str,
    ) -> Result<String, AppError> {
        let msg = message.to_string();
        let auth = author.to_string();
        let em = email.to_string();
        with_repo!(path, |repo| {
            let sig = git2::Signature::now(&auth, &em)
                .map_err(|e| AppError::Other(format!("创建签名失败: {e}")))?;
            let mut index = repo.index()
                .map_err(|e| AppError::Other(format!("获取索引失败: {e}")))?;
            let tree_oid = index.write_tree()
                .map_err(|e| AppError::Other(format!("写入 tree 失败: {e}")))?;
            let tree = repo.find_tree(tree_oid)
                .map_err(|e| AppError::Other(format!("查找 tree 失败: {e}")))?;

            let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
            let parents: Vec<&git2::Commit> = parent.as_ref().into_iter().collect();

            let oid = repo.commit(Some("HEAD"), &sig, &sig, &msg, &tree, &parents)
                .map_err(|e| AppError::Other(format!("提交失败: {e}")))?;
            Ok(oid.to_string())
        })
    }

    // ── Diff ────────────────────────────────────────────────────

    /// 获取工作区 diff（未暂存的变更）
    pub async fn get_diff_working(&self, path: &str) -> Result<GitDiff, AppError> {
        with_repo!(path, |repo| {
            let diff = repo.diff_index_to_workdir(None, Some(DiffOptions::new().include_untracked(true)))
                .map_err(|e| AppError::Other(format!("获取工作区 diff 失败: {e}")))?;
            parse_diff(&diff)
        })
    }

    /// 获取已暂存的 diff（index vs HEAD）
    pub async fn get_diff_staged(&self, path: &str) -> Result<GitDiff, AppError> {
        with_repo!(path, |repo| {
            let head_tree = repo.head().ok()
                .and_then(|h| h.peel_to_tree().ok());
            let diff = repo.diff_tree_to_index(
                head_tree.as_ref(),
                None,
                None,
            ).map_err(|e| AppError::Other(format!("获取暂存 diff 失败: {e}")))?;
            parse_diff(&diff)
        })
    }

    /// 获取某次提交的 diff（与父提交比较）
    pub async fn get_diff_commit(
        &self,
        path: &str,
        hash: &str,
    ) -> Result<GitDiff, AppError> {
        let hash_owned = hash.to_string();
        with_repo!(path, |repo| {
            let oid = git2::Oid::from_str(&hash_owned)
                .map_err(|e| AppError::Validation(format!("无效的提交哈希: {e}")))?;
            let commit = repo.find_commit(oid)
                .map_err(|e| AppError::Other(format!("找不到提交: {e}")))?;
            let tree = commit.tree()
                .map_err(|e| AppError::Other(format!("获取 tree 失败: {e}")))?;

            let parent_tree = commit.parent(0).ok()
                .and_then(|p| p.tree().ok());

            let diff = repo.diff_tree_to_tree(
                parent_tree.as_ref(),
                Some(&tree),
                None,
            ).map_err(|e| AppError::Other(format!("获取提交 diff 失败: {e}")))?;
            parse_diff(&diff)
        })
    }

    // ── 分支操作 ────────────────────────────────────────────────

    /// 获取所有分支
    pub async fn get_branches(&self, path: &str) -> Result<Vec<GitBranch>, AppError> {
        with_repo!(path, |repo| { build_branches(&repo) })
    }

    /// 创建分支
    pub async fn create_branch(
        &self,
        path: &str,
        name: &str,
        start_point: Option<&str>,
    ) -> Result<(), AppError> {
        let n = name.to_string();
        let sp = start_point.map(|s| s.to_string());
        with_repo!(path, |repo| {
            let commit = if let Some(ref hash) = sp {
                let oid = git2::Oid::from_str(hash)
                    .map_err(|e| AppError::Validation(format!("无效的起始点: {e}")))?;
                repo.find_commit(oid)
                    .map_err(|e| AppError::Other(format!("找不到起始提交: {e}")))?
            } else {
                repo.head()
                    .map_err(|e| AppError::Other(format!("获取 HEAD 失败: {e}")))?
                    .peel_to_commit()
                    .map_err(|e| AppError::Other(format!("HEAD 不是提交: {e}")))?
            };
            repo.branch(&n, &commit, false)
                .map_err(|e| AppError::Other(format!("创建分支失败: {e}")))?;
            Ok(())
        })
    }

    /// 删除分支
    pub async fn delete_branch(&self, path: &str, name: &str) -> Result<(), AppError> {
        let n = name.to_string();
        with_repo!(path, |repo| {
            let mut branch = repo.find_branch(&n, BranchType::Local)
                .map_err(|e| AppError::Other(format!("找不到分支: {e}")))?;
            branch.delete()
                .map_err(|e| AppError::Other(format!("删除分支失败: {e}")))?;
            Ok(())
        })
    }

    /// 切换分支
    pub async fn checkout_branch(&self, path: &str, name: &str) -> Result<(), AppError> {
        let n = name.to_string();
        with_repo!(path, |repo| {
            let refname = format!("refs/heads/{n}");
            let obj = repo.revparse_single(&refname)
                .map_err(|e| AppError::Other(format!("解析分支失败: {e}")))?;
            repo.checkout_tree(&obj, None)
                .map_err(|e| AppError::Other(format!("切换工作区失败: {e}")))?;
            repo.set_head(&refname)
                .map_err(|e| AppError::Other(format!("设置 HEAD 失败: {e}")))?;
            Ok(())
        })
    }

    // ── Stash ───────────────────────────────────────────────────

    /// 获取所有 stash
    pub async fn get_stashes(&self, path: &str) -> Result<Vec<GitStash>, AppError> {
        with_repo!(path, |repo| {
            let mut stashes = Vec::new();
            repo.stash_foreach(|index, name, oid| {
                stashes.push(GitStash {
                    index,
                    message: name.to_string(),
                    commit_hash: oid.to_string(),
                });
                true
            }).map_err(|e| AppError::Other(format!("遍历 stash 失败: {e}")))?;
            Ok(stashes)
        })
    }

    /// 创建 stash
    pub async fn create_stash(
        &self,
        path: &str,
        message: Option<&str>,
    ) -> Result<usize, AppError> {
        let msg = message.map(|s| s.to_string());
        with_repo!(path, |repo| {
            let sig = repo.signature()
                .map_err(|e| AppError::Other(format!("获取签名失败: {e}")))?;
            let _oid = repo.stash_save(
                &sig,
                msg.as_deref().unwrap_or("WIP"),
                None,
            ).map_err(|e| AppError::Other(format!("创建 stash 失败: {e}")))?;
            // 返回新 stash 的索引（总是 0，最新的）
            Ok(0usize)
        })
    }

    /// 应用 stash（不删除）
    pub async fn apply_stash(&self, path: &str, index: usize) -> Result<(), AppError> {
        with_repo!(path, |repo| {
            repo.stash_apply(index, None)
                .map_err(|e| AppError::Other(format!("应用 stash 失败: {e}")))?;
            Ok(())
        })
    }

    /// 删除 stash
    pub async fn drop_stash(&self, path: &str, index: usize) -> Result<(), AppError> {
        with_repo!(path, |repo| {
            repo.stash_drop(index)
                .map_err(|e| AppError::Other(format!("删除 stash 失败: {e}")))?;
            Ok(())
        })
    }

    // ── 分支图 ──────────────────────────────────────────────────

    /// 获取分支图数据
    pub async fn get_graph(
        &self,
        path: &str,
        skip: usize,
        limit: usize,
    ) -> Result<GitGraph, AppError> {
        with_repo!(path, |repo| { build_graph(&repo, skip, limit) })
    }

    // ── Remote 操作（使用系统 git CLI）───────────────────────────

    /// 获取所有远程仓库
    pub async fn get_remotes(&self, path: &str) -> Result<Vec<GitRemote>, AppError> {
        with_repo!(path, |repo| { build_remotes(&repo) })
    }

    /// 推送到远程
    pub async fn push(
        &self,
        path: &str,
        remote: &str,
        branch: &str,
        force: bool,
    ) -> Result<String, AppError> {
        let p = path.to_owned();
        let r = remote.to_owned();
        let b = branch.to_owned();
        tokio::task::spawn_blocking(move || {
            let mut cmd = std::process::Command::new("git");
            cmd.current_dir(&p).arg("push").arg(&r).arg(&b);
            if force {
                cmd.arg("--force");
            }
            let output = cmd
                .output()
                .map_err(|e| AppError::Other(format!("执行 git push 失败: {e}")))?;
            if output.status.success() {
                let msg = String::from_utf8_lossy(&output.stderr).to_string();
                Ok(msg)
            } else {
                let err = String::from_utf8_lossy(&output.stderr).to_string();
                Err(AppError::Other(format!("Push 失败: {err}")))
            }
        })
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
    }

    /// 拉取远程更新
    pub async fn pull(
        &self,
        path: &str,
        remote: &str,
        branch: &str,
    ) -> Result<String, AppError> {
        let p = path.to_owned();
        let r = remote.to_owned();
        let b = branch.to_owned();
        tokio::task::spawn_blocking(move || {
            let output = std::process::Command::new("git")
                .current_dir(&p)
                .arg("pull")
                .arg(&r)
                .arg(&b)
                .output()
                .map_err(|e| AppError::Other(format!("执行 git pull 失败: {e}")))?;
            if output.status.success() {
                let msg = String::from_utf8_lossy(&output.stdout).to_string();
                Ok(msg)
            } else {
                let err = String::from_utf8_lossy(&output.stderr).to_string();
                Err(AppError::Other(format!("Pull 失败: {err}")))
            }
        })
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
    }

    /// 抓取远程
    pub async fn fetch(&self, path: &str, remote: &str) -> Result<String, AppError> {
        let p = path.to_owned();
        let r = remote.to_owned();
        tokio::task::spawn_blocking(move || {
            let output = std::process::Command::new("git")
                .current_dir(&p)
                .arg("fetch")
                .arg(&r)
                .output()
                .map_err(|e| AppError::Other(format!("执行 git fetch 失败: {e}")))?;
            if output.status.success() {
                let msg = String::from_utf8_lossy(&output.stderr).to_string();
                Ok(msg)
            } else {
                let err = String::from_utf8_lossy(&output.stderr).to_string();
                Err(AppError::Other(format!("Fetch 失败: {err}")))
            }
        })
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
    }

    // ── Merge & Rebase ──────────────────────────────────────────

    /// 合并分支到当前分支
    pub async fn merge_branch(
        &self,
        path: &str,
        branch_name: &str,
    ) -> Result<GitMergeResult, AppError> {
        let p = path.to_owned();
        let bn = branch_name.to_owned();
        tokio::task::spawn_blocking(move || {
            let repo = Repository::open(&p)
                .map_err(|e| AppError::Other(format!("打开仓库失败: {e}")))?;

            // 查找要合并的分支
            let branch_ref = repo
                .find_branch(&bn, BranchType::Local)
                .or_else(|_| repo.find_branch(&bn, BranchType::Remote))
                .map_err(|e| AppError::Other(format!("找不到分支 {bn}: {e}")))?;

            let annotated = repo
                .reference_to_annotated_commit(branch_ref.get())
                .map_err(|e| AppError::Other(format!("获取提交引用失败: {e}")))?;

            // 分析合并类型
            let (analysis, _pref) = repo
                .merge_analysis(&[&annotated])
                .map_err(|e| AppError::Other(format!("合并分析失败: {e}")))?;

            if analysis.is_up_to_date() {
                return Ok(GitMergeResult {
                    success: true,
                    conflicts: vec![],
                    message: "已是最新，无需合并".into(),
                });
            }

            if analysis.is_fast_forward() {
                // Fast-forward
                let target_oid = annotated.id();
                let target = repo
                    .find_object(target_oid, None)
                    .map_err(|e| AppError::Other(format!("查找对象失败: {e}")))?;
                repo.checkout_tree(&target, None)
                    .map_err(|e| AppError::Other(format!("切换工作区失败: {e}")))?;
                let refname = repo
                    .head()
                    .ok()
                    .and_then(|h| h.name().map(|s| s.to_string()))
                    .unwrap_or_else(|| "refs/heads/main".into());
                repo.reference(&refname, target_oid, true, &format!("Fast-forward to {bn}"))
                    .map_err(|e| AppError::Other(format!("更新引用失败: {e}")))?;
                return Ok(GitMergeResult {
                    success: true,
                    conflicts: vec![],
                    message: format!("Fast-forward 合并 {bn} 成功"),
                });
            }

            // 常规合并
            repo.merge(&[&annotated], None, None)
                .map_err(|e| AppError::Other(format!("合并失败: {e}")))?;

            // 检查冲突
            let mut index = repo
                .index()
                .map_err(|e| AppError::Other(format!("获取索引失败: {e}")))?;

            if index.has_conflicts() {
                let mut conflicts = Vec::new();
                for conflict in index.conflicts().map_err(|e| AppError::Other(format!("获取冲突列表失败: {e}")))? {
                    if let Ok(c) = conflict {
                        if let Some(our) = c.our {
                            let path = String::from_utf8_lossy(&our.path).to_string();
                            conflicts.push(path);
                        }
                    }
                }
                return Ok(GitMergeResult {
                    success: false,
                    conflicts,
                    message: format!("合并 {bn} 产生冲突，请手动解决"),
                });
            }

            // 无冲突 → 创建合并提交
            let sig = repo
                .signature()
                .map_err(|e| AppError::Other(format!("获取签名失败: {e}")))?;
            let tree_oid = index
                .write_tree()
                .map_err(|e| AppError::Other(format!("写入 tree 失败: {e}")))?;
            let tree = repo
                .find_tree(tree_oid)
                .map_err(|e| AppError::Other(format!("查找 tree 失败: {e}")))?;
            let head_commit = repo
                .head()
                .map_err(|e| AppError::Other(format!("获取 HEAD 失败: {e}")))?
                .peel_to_commit()
                .map_err(|e| AppError::Other(format!("HEAD 不是提交: {e}")))?;
            let merge_commit = repo
                .find_commit(annotated.id())
                .map_err(|e| AppError::Other(format!("查找合并提交失败: {e}")))?;
            let msg = format!("Merge branch '{bn}'");
            repo.commit(
                Some("HEAD"),
                &sig,
                &sig,
                &msg,
                &tree,
                &[&head_commit, &merge_commit],
            )
            .map_err(|e| AppError::Other(format!("创建合并提交失败: {e}")))?;

            // 清理合并状态
            repo.cleanup_state()
                .map_err(|e| AppError::Other(format!("清理合并状态失败: {e}")))?;

            Ok(GitMergeResult {
                success: true,
                conflicts: vec![],
                message: format!("合并 {bn} 成功"),
            })
        })
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
    }

    /// 中止合并
    pub async fn abort_merge(&self, path: &str) -> Result<(), AppError> {
        let p = path.to_owned();
        tokio::task::spawn_blocking(move || {
            let output = std::process::Command::new("git")
                .current_dir(&p)
                .arg("merge")
                .arg("--abort")
                .output()
                .map_err(|e| AppError::Other(format!("执行 git merge --abort 失败: {e}")))?;
            if output.status.success() {
                Ok(())
            } else {
                let err = String::from_utf8_lossy(&output.stderr).to_string();
                Err(AppError::Other(format!("中止合并失败: {err}")))
            }
        })
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
    }

    /// Rebase 当前分支到目标分支
    pub async fn rebase_branch(&self, path: &str, onto_branch: &str) -> Result<(), AppError> {
        let p = path.to_owned();
        let onto = onto_branch.to_owned();
        tokio::task::spawn_blocking(move || {
            let output = std::process::Command::new("git")
                .current_dir(&p)
                .arg("rebase")
                .arg(&onto)
                .output()
                .map_err(|e| AppError::Other(format!("执行 git rebase 失败: {e}")))?;
            if output.status.success() {
                Ok(())
            } else {
                let err = String::from_utf8_lossy(&output.stderr).to_string();
                Err(AppError::Other(format!("Rebase 失败: {err}")))
            }
        })
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
    }

    /// 中止 rebase
    pub async fn abort_rebase(&self, path: &str) -> Result<(), AppError> {
        let p = path.to_owned();
        tokio::task::spawn_blocking(move || {
            let output = std::process::Command::new("git")
                .current_dir(&p)
                .arg("rebase")
                .arg("--abort")
                .output()
                .map_err(|e| AppError::Other(format!("执行 git rebase --abort 失败: {e}")))?;
            if output.status.success() {
                Ok(())
            } else {
                let err = String::from_utf8_lossy(&output.stderr).to_string();
                Err(AppError::Other(format!("中止 rebase 失败: {err}")))
            }
        })
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
    }

    // ── Tag 操作 ────────────────────────────────────────────────

    /// 获取所有标签
    pub async fn get_tags(&self, path: &str) -> Result<Vec<GitTag>, AppError> {
        with_repo!(path, |repo| { build_tags(&repo) })
    }

    /// 创建标签
    pub async fn create_tag(
        &self,
        path: &str,
        name: &str,
        message: Option<&str>,
        target: Option<&str>,
    ) -> Result<(), AppError> {
        let n = name.to_string();
        let msg = message.map(|s| s.to_string());
        let tgt = target.map(|s| s.to_string());
        with_repo!(path, |repo| {
            let commit = if let Some(ref hash) = tgt {
                let oid = git2::Oid::from_str(hash)
                    .map_err(|e| AppError::Validation(format!("无效的目标哈希: {e}")))?;
                repo.find_commit(oid)
                    .map_err(|e| AppError::Other(format!("找不到目标提交: {e}")))?
            } else {
                repo.head()
                    .map_err(|e| AppError::Other(format!("获取 HEAD 失败: {e}")))?
                    .peel_to_commit()
                    .map_err(|e| AppError::Other(format!("HEAD 不是提交: {e}")))?
            };

            if let Some(ref m) = msg {
                // Annotated tag
                let sig = repo.signature()
                    .map_err(|e| AppError::Other(format!("获取签名失败: {e}")))?;
                repo.tag(&n, commit.as_object(), &sig, m, false)
                    .map_err(|e| AppError::Other(format!("创建标签失败: {e}")))?;
            } else {
                // Lightweight tag
                repo.tag_lightweight(&n, commit.as_object(), false)
                    .map_err(|e| AppError::Other(format!("创建轻量标签失败: {e}")))?;
            }
            Ok(())
        })
    }

    /// 删除标签
    pub async fn delete_tag(&self, path: &str, name: &str) -> Result<(), AppError> {
        let n = name.to_string();
        with_repo!(path, |repo| {
            repo.tag_delete(&n)
                .map_err(|e| AppError::Other(format!("删除标签失败: {e}")))?;
            Ok(())
        })
    }

    // ── 文件操作 ────────────────────────────────────────────────

    /// 丢弃单个文件的工作区修改（git checkout -- file）
    pub async fn discard_file(&self, path: &str, file_path: &str) -> Result<(), AppError> {
        let fp = file_path.to_string();
        with_repo!(path, |repo| {
            let head = repo.head()
                .map_err(|e| AppError::Other(format!("获取 HEAD 失败: {e}")))?;
            let tree = head.peel_to_tree()
                .map_err(|e| AppError::Other(format!("获取 tree 失败: {e}")))?;
            let mut cb = git2::build::CheckoutBuilder::new();
            cb.path(&fp).force();
            repo.checkout_tree(tree.as_object(), Some(&mut cb))
                .map_err(|e| AppError::Other(format!("丢弃修改失败: {e}")))?;
            Ok(())
        })
    }

    /// 丢弃所有工作区修改
    pub async fn discard_all(&self, path: &str) -> Result<(), AppError> {
        with_repo!(path, |repo| {
            let head = repo.head()
                .map_err(|e| AppError::Other(format!("获取 HEAD 失败: {e}")))?;
            let obj = head.peel(ObjectType::Commit)
                .map_err(|e| AppError::Other(format!("获取提交对象失败: {e}")))?;
            repo.reset(&obj, git2::ResetType::Hard, None)
                .map_err(|e| AppError::Other(format!("重置工作区失败: {e}")))?;
            Ok(())
        })
    }

    /// 获取指定提交中某文件的内容（用于 Monaco DiffEditor 显示旧版本）
    pub async fn get_file_content(
        &self,
        path: &str,
        hash: &str,
        file_path: &str,
    ) -> Result<String, AppError> {
        let h = hash.to_string();
        let fp = file_path.to_string();
        with_repo!(path, |repo| {
            let oid = git2::Oid::from_str(&h)
                .map_err(|e| AppError::Validation(format!("无效的提交哈希: {e}")))?;
            let commit = repo.find_commit(oid)
                .map_err(|e| AppError::Other(format!("找不到提交: {e}")))?;
            let tree = commit.tree()
                .map_err(|e| AppError::Other(format!("获取 tree 失败: {e}")))?;
            let entry = tree.get_path(std::path::Path::new(&fp))
                .map_err(|e| AppError::Other(format!("文件不存在于该提交中: {e}")))?;
            let blob = repo.find_blob(entry.id())
                .map_err(|e| AppError::Other(format!("获取文件内容失败: {e}")))?;
            if blob.is_binary() {
                return Err(AppError::Other("二进制文件无法显示".into()));
            }
            Ok(String::from_utf8_lossy(blob.content()).to_string())
        })
    }

    // ── Git Config 读取 ─────────────────────────────────────────

    /// 读取仓库的 git 配置（user.name / user.email）
    pub async fn get_config(&self, path: &str) -> Result<GitConfig, AppError> {
        with_repo!(path, |repo| {
            let config = repo.config()
                .map_err(|e| AppError::Other(format!("获取配置失败: {e}")))?;
            let user_name = config.get_string("user.name").ok();
            let user_email = config.get_string("user.email").ok();
            Ok(GitConfig { user_name, user_email })
        })
    }

    // ── Amend 提交 ──────────────────────────────────────────────

    /// 修改最后一次提交（amend）
    pub async fn amend_commit(
        &self,
        path: &str,
        message: &str,
        author: &str,
        email: &str,
    ) -> Result<String, AppError> {
        let msg = message.to_string();
        let auth = author.to_string();
        let em = email.to_string();
        with_repo!(path, |repo| {
            let sig = git2::Signature::now(&auth, &em)
                .map_err(|e| AppError::Other(format!("创建签名失败: {e}")))?;
            let mut index = repo.index()
                .map_err(|e| AppError::Other(format!("获取索引失败: {e}")))?;
            let tree_oid = index.write_tree()
                .map_err(|e| AppError::Other(format!("写入 tree 失败: {e}")))?;
            let tree = repo.find_tree(tree_oid)
                .map_err(|e| AppError::Other(format!("查找 tree 失败: {e}")))?;
            let head_commit = repo.head()
                .map_err(|e| AppError::Other(format!("获取 HEAD 失败: {e}")))?
                .peel_to_commit()
                .map_err(|e| AppError::Other(format!("HEAD 不是提交: {e}")))?;

            let oid = head_commit.amend(Some("HEAD"), Some(&sig), Some(&sig), None, Some(&msg), Some(&tree))
                .map_err(|e| AppError::Other(format!("Amend 提交失败: {e}")))?;
            Ok(oid.to_string())
        })
    }

    // ── Pop Stash ───────────────────────────────────────────────

    /// 弹出 stash（apply + drop）
    pub async fn pop_stash(&self, path: &str, index: usize) -> Result<(), AppError> {
        with_repo!(path, |repo| {
            repo.stash_apply(index, None)
                .map_err(|e| AppError::Other(format!("应用 stash 失败: {e}")))?;
            repo.stash_drop(index)
                .map_err(|e| AppError::Other(format!("删除 stash 失败: {e}")))?;
            Ok(())
        })
    }

    // ── Cherry-pick ─────────────────────────────────────────────

    /// Cherry-pick 指定提交
    pub async fn cherry_pick(&self, path: &str, hash: &str) -> Result<GitMergeResult, AppError> {
        let h = hash.to_string();
        with_repo!(path, |repo| {
            let oid = git2::Oid::from_str(&h)
                .map_err(|e| AppError::Validation(format!("无效的提交哈希: {e}")))?;
            let commit = repo.find_commit(oid)
                .map_err(|e| AppError::Other(format!("找不到提交: {e}")))?;

            repo.cherrypick(&commit, None)
                .map_err(|e| AppError::Other(format!("Cherry-pick 失败: {e}")))?;

            let mut index = repo.index()
                .map_err(|e| AppError::Other(format!("获取索引失败: {e}")))?;

            if index.has_conflicts() {
                let mut conflicts = Vec::new();
                if let Ok(iter) = index.conflicts() {
                    for conflict in iter.flatten() {
                        if let Some(our) = conflict.our {
                            conflicts.push(String::from_utf8_lossy(&our.path).to_string());
                        }
                    }
                }
                Ok(GitMergeResult {
                    success: false,
                    conflicts,
                    message: format!("Cherry-pick {h} 产生冲突"),
                })
            } else {
                // 自动提交
                let sig = repo.signature()
                    .map_err(|e| AppError::Other(format!("获取签名失败: {e}")))?;
                let tree_oid = index.write_tree()
                    .map_err(|e| AppError::Other(format!("写入 tree 失败: {e}")))?;
                let tree = repo.find_tree(tree_oid)
                    .map_err(|e| AppError::Other(format!("查找 tree 失败: {e}")))?;
                let head_commit = repo.head()
                    .map_err(|e| AppError::Other(format!("获取 HEAD 失败: {e}")))?
                    .peel_to_commit()
                    .map_err(|e| AppError::Other(format!("HEAD 不是提交: {e}")))?;
                let msg = commit.message().unwrap_or("Cherry-pick commit");
                repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &[&head_commit])
                    .map_err(|e| AppError::Other(format!("创建提交失败: {e}")))?;
                repo.cleanup_state()
                    .map_err(|e| AppError::Other(format!("清理状态失败: {e}")))?;

                Ok(GitMergeResult {
                    success: true,
                    conflicts: vec![],
                    message: format!("Cherry-pick {} 成功", &h[..7.min(h.len())]),
                })
            }
        })
    }

    // ── 交互式 Rebase ──────────────────────────────────────────

    /// 获取交互式 rebase 计划：列出 base_commit..HEAD 的提交
    pub async fn interactive_rebase_plan(
        &self,
        path: &str,
        base_commit: &str,
    ) -> Result<Vec<RebaseEntry>, AppError> {
        let base = base_commit.to_string();
        with_repo!(path, |repo| {
            let base_oid = git2::Oid::from_str(&base)
                .map_err(|e| AppError::Validation(format!("无效的提交哈希: {e}")))?;

            let head_oid = repo.head()
                .map_err(|e| AppError::Other(format!("获取 HEAD 失败: {e}")))?
                .target()
                .ok_or_else(|| AppError::Other("HEAD 不指向有效提交".into()))?;

            // 如果 base == HEAD，没有可操作的提交
            if base_oid == head_oid {
                return Ok(vec![]);
            }

            let mut revwalk = repo.revwalk()
                .map_err(|e| AppError::Other(format!("创建 revwalk 失败: {e}")))?;
            revwalk.push(head_oid)
                .map_err(|e| AppError::Other(format!("push HEAD 失败: {e}")))?;
            revwalk.hide(base_oid)
                .map_err(|e| AppError::Other(format!("hide base 失败: {e}")))?;
            revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::REVERSE)
                .map_err(|e| AppError::Other(format!("设置排序失败: {e}")))?;

            let mut entries = Vec::new();
            for oid in revwalk {
                let oid = oid.map_err(|e| AppError::Other(format!("遍历提交失败: {e}")))?;
                let commit = repo.find_commit(oid)
                    .map_err(|e| AppError::Other(format!("查找提交失败: {e}")))?;
                let hash = oid.to_string();
                entries.push(RebaseEntry {
                    short_hash: hash[..7.min(hash.len())].to_string(),
                    hash,
                    message: commit.summary().unwrap_or("").to_string(),
                    author: commit.author().name().unwrap_or("").to_string(),
                    timestamp: commit.time().seconds(),
                    action: RebaseAction::Pick,
                });
            }
            Ok(entries)
        })
    }

    /// 执行交互式 rebase
    /// 按照用户指定的 plan 顺序，在 base_commit 之上依次 cherry-pick/squash/reword/drop
    pub async fn interactive_rebase_execute(
        &self,
        path: &str,
        base_commit: &str,
        plan: Vec<RebaseEntry>,
    ) -> Result<RebaseResult, AppError> {
        let base = base_commit.to_string();
        let total = plan.iter().filter(|e| !matches!(e.action, RebaseAction::Drop)).count();

        with_repo!(path, |repo| {
            // 保存原始 HEAD 用于 abort 回滚
            let original_head = repo.head()
                .map_err(|e| AppError::Other(format!("获取 HEAD 失败: {e}")))?
                .target()
                .ok_or_else(|| AppError::Other("HEAD 不指向有效提交".into()))?;

            // 将 HEAD 重置到 base_commit
            let base_oid = git2::Oid::from_str(&base)
                .map_err(|e| AppError::Validation(format!("无效的 base 哈希: {e}")))?;
            let base_obj = repo.find_object(base_oid, None)
                .map_err(|e| AppError::Other(format!("查找 base 对象失败: {e}")))?;
            repo.reset(&base_obj, git2::ResetType::Hard, None)
                .map_err(|e| AppError::Other(format!("重置到 base 失败: {e}")))?;

            // 在 .git 中写入原始 HEAD 引用（用于 abort）
            let git_dir = repo.path();
            let rebase_head_path = git_dir.join("INTERACTIVE_REBASE_ORIG_HEAD");
            std::fs::write(&rebase_head_path, original_head.to_string())
                .map_err(|e| AppError::Other(format!("保存原始 HEAD 失败: {e}")))?;

            let mut completed = 0usize;
            let mut pending_squash_messages: Vec<String> = Vec::new();

            for entry in &plan {
                match &entry.action {
                    RebaseAction::Drop => continue,
                    RebaseAction::Pick | RebaseAction::Reword(_) | RebaseAction::Squash | RebaseAction::Fixup => {
                        let oid = git2::Oid::from_str(&entry.hash)
                            .map_err(|e| AppError::Validation(format!("无效哈希 {}: {e}", entry.short_hash)))?;
                        let commit = repo.find_commit(oid)
                            .map_err(|e| AppError::Other(format!("查找提交 {} 失败: {e}", entry.short_hash)))?;

                        // cherry-pick 到当前 HEAD
                        repo.cherrypick(&commit, None)
                            .map_err(|e| AppError::Other(format!("Cherry-pick {} 失败: {e}", entry.short_hash)))?;

                        let mut index = repo.index()
                            .map_err(|e| AppError::Other(format!("获取索引失败: {e}")))?;

                        if index.has_conflicts() {
                            // 冲突 → 回滚到原始 HEAD
                            let orig_obj = repo.find_object(original_head, None)
                                .map_err(|e| AppError::Other(format!("查找原始 HEAD 失败: {e}")))?;
                            repo.reset(&orig_obj, git2::ResetType::Hard, None)
                                .map_err(|e| AppError::Other(format!("回滚失败: {e}")))?;
                            let _ = std::fs::remove_file(&rebase_head_path);

                            let mut conflicts = Vec::new();
                            if let Ok(iter) = index.conflicts() {
                                for conflict in iter.flatten() {
                                    if let Some(our) = conflict.our {
                                        conflicts.push(String::from_utf8_lossy(&our.path).to_string());
                                    }
                                }
                            }
                            return Ok(RebaseResult {
                                success: false,
                                conflicts,
                                completed_steps: completed,
                                total_steps: total,
                                message: format!("Rebase 在 {} 处遇到冲突，已回滚", entry.short_hash),
                            });
                        }

                        let sig = repo.signature()
                            .map_err(|e| AppError::Other(format!("获取签名失败: {e}")))?;
                        let tree_oid = index.write_tree()
                            .map_err(|e| AppError::Other(format!("写入 tree 失败: {e}")))?;
                        let tree = repo.find_tree(tree_oid)
                            .map_err(|e| AppError::Other(format!("查找 tree 失败: {e}")))?;
                        let head_commit = repo.head()
                            .map_err(|e| AppError::Other(format!("获取 HEAD 失败: {e}")))?
                            .peel_to_commit()
                            .map_err(|e| AppError::Other(format!("HEAD 不是提交: {e}")))?;

                        let original_msg = commit.message().unwrap_or("");

                        match &entry.action {
                            RebaseAction::Pick => {
                                // 使用原始 commit message
                                if !pending_squash_messages.is_empty() {
                                    // 如果之前有积攒的 squash 消息，先处理（不应出现，但保险起见）
                                    pending_squash_messages.clear();
                                }
                                repo.commit(Some("HEAD"), &sig, &sig, original_msg, &tree, &[&head_commit])
                                    .map_err(|e| AppError::Other(format!("创建提交失败: {e}")))?;
                            }
                            RebaseAction::Reword(new_msg) => {
                                repo.commit(Some("HEAD"), &sig, &sig, new_msg, &tree, &[&head_commit])
                                    .map_err(|e| AppError::Other(format!("创建提交失败: {e}")))?;
                            }
                            RebaseAction::Squash => {
                                // 收集消息，amend 上一个提交
                                let combined_msg = format!(
                                    "{}\n\n{}",
                                    head_commit.message().unwrap_or(""),
                                    original_msg
                                );
                                // Amend: 创建新提交替换 HEAD
                                let head_parents: Vec<_> = (0..head_commit.parent_count())
                                    .filter_map(|i| head_commit.parent(i).ok())
                                    .collect();
                                let parent_refs: Vec<&git2::Commit<'_>> = head_parents.iter().collect();
                                repo.commit(Some("HEAD"), &sig, &sig, &combined_msg, &tree, &parent_refs)
                                    .map_err(|e| AppError::Other(format!("Squash 提交失败: {e}")))?;
                            }
                            RebaseAction::Fixup => {
                                // 与上一个合并但不改消息 → amend HEAD 用相同消息
                                let keep_msg = head_commit.message().unwrap_or("");
                                let head_parents: Vec<_> = (0..head_commit.parent_count())
                                    .filter_map(|i| head_commit.parent(i).ok())
                                    .collect();
                                let parent_refs: Vec<&git2::Commit<'_>> = head_parents.iter().collect();
                                repo.commit(Some("HEAD"), &sig, &sig, keep_msg, &tree, &parent_refs)
                                    .map_err(|e| AppError::Other(format!("Fixup 提交失败: {e}")))?;
                            }
                            RebaseAction::Drop => unreachable!(),
                        }

                        repo.cleanup_state()
                            .map_err(|e| AppError::Other(format!("清理状态失败: {e}")))?;
                        completed += 1;
                    }
                }
            }

            let _ = std::fs::remove_file(&rebase_head_path);

            Ok(RebaseResult {
                success: true,
                conflicts: vec![],
                completed_steps: completed,
                total_steps: total,
                message: format!("交互式 Rebase 完成，处理了 {} 个提交", completed),
            })
        })
    }

    /// 中止交互式 rebase（回滚到原始 HEAD）
    pub async fn interactive_rebase_abort(&self, path: &str) -> Result<(), AppError> {
        with_repo!(path, |repo| {
            let git_dir = repo.path();
            let rebase_head_path = git_dir.join("INTERACTIVE_REBASE_ORIG_HEAD");

            if !rebase_head_path.exists() {
                return Err(AppError::Validation("没有正在进行的交互式 Rebase".into()));
            }

            let orig_hash = std::fs::read_to_string(&rebase_head_path)
                .map_err(|e| AppError::Other(format!("读取原始 HEAD 失败: {e}")))?;
            let orig_oid = git2::Oid::from_str(orig_hash.trim())
                .map_err(|e| AppError::Validation(format!("无效的原始 HEAD: {e}")))?;
            let orig_obj = repo.find_object(orig_oid, None)
                .map_err(|e| AppError::Other(format!("查找原始 HEAD 对象失败: {e}")))?;

            repo.reset(&orig_obj, git2::ResetType::Hard, None)
                .map_err(|e| AppError::Other(format!("回滚失败: {e}")))?;

            let _ = std::fs::remove_file(&rebase_head_path);
            Ok(())
        })
    }

    // ── 搜索提交 ────────────────────────────────────────────────

    /// 搜索提交（按消息/作者/哈希）
    pub async fn search_commits(
        &self,
        path: &str,
        query: &str,
        field: &str,
        skip: usize,
        limit: usize,
    ) -> Result<Vec<GitCommit>, AppError> {
        let q = query.to_lowercase();
        let f = field.to_string();
        with_repo!(path, |repo| {
            let mut revwalk = repo.revwalk()
                .map_err(|e| AppError::Other(format!("创建 revwalk 失败: {e}")))?;
            revwalk.push_head()
                .map_err(|e| AppError::Other(format!("push HEAD 失败: {e}")))?;
            revwalk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)
                .map_err(|e| AppError::Other(format!("设置排序失败: {e}")))?;

            let mut results = Vec::new();
            let mut skipped = 0usize;

            // P1 优化：添加遍历上限，防止大仓库搜索超时
            const MAX_SEARCH_WALK: usize = 50_000;
            let mut walked = 0usize;

            for oid_result in revwalk {
                walked += 1;
                if walked > MAX_SEARCH_WALK {
                    break;
                }

                let oid = match oid_result {
                    Ok(o) => o,
                    Err(_) => continue,
                };
                let commit = match repo.find_commit(oid) {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                let matched = match f.as_str() {
                    "message" => commit.message().unwrap_or("").to_lowercase().contains(&q),
                    "author" => {
                        let name = commit.author().name().unwrap_or("").to_lowercase();
                        let email = commit.author().email().unwrap_or("").to_lowercase();
                        name.contains(&q) || email.contains(&q)
                    }
                    "hash" => oid.to_string().starts_with(&q),
                    _ => commit.message().unwrap_or("").to_lowercase().contains(&q),
                };

                if matched {
                    if skipped < skip {
                        skipped += 1;
                        continue;
                    }
                    results.push(parse_commit(&repo, &commit));
                    if results.len() >= limit {
                        break;
                    }
                }
            }

            Ok(results)
        })
    }

    // ── Blame ───────────────────────────────────────────────────

    /// 获取文件的 blame 信息
    pub async fn blame_file(
        &self,
        path: &str,
        file_path: &str,
    ) -> Result<Vec<GitBlameLine>, AppError> {
        let fp = file_path.to_string();
        with_repo!(path, |repo| {
            let blame = repo.blame_file(std::path::Path::new(&fp), None)
                .map_err(|e| AppError::Other(format!("Blame 失败: {e}")))?;

            // 读取文件当前内容获取行
            let workdir = repo.workdir()
                .ok_or_else(|| AppError::Other("裸仓库不支持 blame".into()))?;
            let full_path = workdir.join(&fp);
            let content = std::fs::read_to_string(&full_path)
                .map_err(|e| AppError::Other(format!("读取文件失败: {e}")))?;
            let file_lines: Vec<&str> = content.lines().collect();

            let mut lines = Vec::new();
            for (i, line_content) in file_lines.iter().enumerate() {
                let lineno = (i + 1) as u32;
                if let Some(hunk) = blame.get_line(lineno as usize) {
                    let hash = hunk.final_commit_id().to_string();
                    let sig = hunk.final_signature();
                    lines.push(GitBlameLine {
                        line_number: lineno,
                        content: line_content.to_string(),
                        commit_hash: hash[..7.min(hash.len())].to_string(),
                        author: sig.name().unwrap_or("").to_string(),
                        timestamp: sig.when().seconds(),
                    });
                }
            }

            Ok(lines)
        })
    }

    // ── 文件历史 ────────────────────────────────────────────────

    /// 获取单个文件的提交历史
    pub async fn file_history(
        &self,
        path: &str,
        file_path: &str,
        skip: usize,
        limit: usize,
    ) -> Result<Vec<GitCommit>, AppError> {
        let fp = file_path.to_string();
        // 使用 git CLI 的 --follow 来追踪重命名
        let p = path.to_owned();
        tokio::task::spawn_blocking(move || {
            let output = std::process::Command::new("git")
                .current_dir(&p)
                .args(["log", "--follow", "--format=%H", "--"])
                .arg(&fp)
                .output()
                .map_err(|e| AppError::Other(format!("执行 git log 失败: {e}")))?;

            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr).to_string();
                return Err(AppError::Other(format!("获取文件历史失败: {err}")));
            }

            let stdout = String::from_utf8_lossy(&output.stdout);
            let hashes: Vec<&str> = stdout.lines()
                .skip(skip)
                .take(limit)
                .collect();

            let repo = Repository::open(&p)
                .map_err(|e| AppError::Other(format!("打开仓库失败: {e}")))?;

            let mut commits = Vec::new();
            for hash in hashes {
                if let Ok(oid) = git2::Oid::from_str(hash) {
                    if let Ok(commit) = repo.find_commit(oid) {
                        commits.push(parse_commit(&repo, &commit));
                    }
                }
            }

            Ok(commits)
        })
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
    }

    // ── 贡献者统计 ────────────────────────────────────────────────

    /// 获取贡献者统计
    pub async fn get_contributors(&self, path: &str) -> Result<Vec<GitContributor>, AppError> {
        with_repo!(path, |repo| { build_contributors(&repo) })
    }
}

// ═══════════════════════════════════════════════════════════════════
// 内部辅助函数
// ═══════════════════════════════════════════════════════════════════

/// 构建仓库基本信息
fn build_repo_info(repo: &Repository, path: &str) -> Result<GitRepositoryInfo, AppError> {
    let head = repo.head().ok();
    let current_branch = head
        .as_ref()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_else(|| "HEAD".into());
    let head_commit = head
        .as_ref()
        .and_then(|h| h.target().map(|oid| oid.to_string()))
        .unwrap_or_default();
    let remotes = repo
        .remotes()
        .map(|r| {
            (0..r.len())
                .filter_map(|i| r.get(i).map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    Ok(GitRepositoryInfo {
        path: path.to_string(),
        current_branch,
        head_commit,
        is_bare: repo.is_bare(),
        remotes,
    })
}

/// 构建工作区状态
fn build_status(repo: &Repository) -> Result<GitStatus, AppError> {
    let head = repo.head().ok();
    let current_branch = head
        .as_ref()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_else(|| "HEAD".into());

    let mut opts = StatusOptions::new();
    opts.show(StatusShow::IndexAndWorkdir)
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        // P2 优化：确保不包含已忽略的文件（默认应该是 false，但显式设置以防万一）
        .include_ignored(false);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| AppError::Other(format!("获取状态失败: {e}")))?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();
    let mut has_conflicts = false;

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let s = entry.status();

        // 冲突检测
        if s.is_conflicted() {
            has_conflicts = true;
            staged.push(GitFileStatus {
                path: path.clone(),
                status: "conflicted".into(),
            });
            continue;
        }

        // Index 侧变更（已暂存）
        if s.is_index_new() {
            staged.push(GitFileStatus { path: path.clone(), status: "added".into() });
        } else if s.is_index_modified() {
            staged.push(GitFileStatus { path: path.clone(), status: "modified".into() });
        } else if s.is_index_deleted() {
            staged.push(GitFileStatus { path: path.clone(), status: "deleted".into() });
        } else if s.is_index_renamed() {
            staged.push(GitFileStatus { path: path.clone(), status: "renamed".into() });
        }

        // Workdir 侧变更（未暂存）
        if s.is_wt_new() {
            untracked.push(path);
        } else if s.is_wt_modified() {
            unstaged.push(GitFileStatus { path: path.clone(), status: "modified".into() });
        } else if s.is_wt_deleted() {
            unstaged.push(GitFileStatus { path: path.clone(), status: "deleted".into() });
        } else if s.is_wt_renamed() {
            unstaged.push(GitFileStatus { path: path.clone(), status: "renamed".into() });
        }
    }

    // 计算 ahead/behind
    let (ahead, behind) = calc_ahead_behind(repo);

    Ok(GitStatus {
        current_branch,
        staged,
        unstaged,
        untracked,
        has_conflicts,
        ahead,
        behind,
    })
}

/// 计算领先/落后远程的提交数
fn calc_ahead_behind(repo: &Repository) -> (u32, u32) {
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return (0, 0),
    };
    let local_oid = match head.target() {
        Some(oid) => oid,
        None => return (0, 0),
    };
    // 尝试获取上游分支
    let branch_name = match head.shorthand() {
        Some(n) => n.to_string(),
        None => return (0, 0),
    };
    let branch = match repo.find_branch(&branch_name, BranchType::Local) {
        Ok(b) => b,
        Err(_) => return (0, 0),
    };
    let upstream = match branch.upstream() {
        Ok(u) => u,
        Err(_) => return (0, 0),
    };
    let upstream_oid = match upstream.get().target() {
        Some(oid) => oid,
        None => return (0, 0),
    };
    repo.graph_ahead_behind(local_oid, upstream_oid)
        .map(|(a, b)| (a as u32, b as u32))
        .unwrap_or((0, 0))
}

/// 构建提交历史
fn build_commits(
    repo: &Repository,
    skip: usize,
    limit: usize,
) -> Result<Vec<GitCommit>, AppError> {
    let mut revwalk = repo
        .revwalk()
        .map_err(|e| AppError::Other(format!("创建 revwalk 失败: {e}")))?;
    revwalk
        .push_head()
        .map_err(|e| AppError::Other(format!("push HEAD 失败: {e}")))?;
    revwalk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)
        .map_err(|e| AppError::Other(format!("设置排序失败: {e}")))?;

    // P0 优化：预构建所有 refs 的映射，避免 N+1 查询
    let refs_map = build_refs_map(repo);

    let commits: Vec<GitCommit> = revwalk
        .skip(skip)
        .take(limit)
        .filter_map(|oid| {
            let oid = oid.ok()?;
            let commit = repo.find_commit(oid).ok()?;
            Some(parse_commit_with_refs_map(repo, &commit, &refs_map))
        })
        .collect();

    Ok(commits)
}

/// 解析单个 commit 为 GitCommit
fn parse_commit(repo: &Repository, commit: &git2::Commit) -> GitCommit {
    let oid = commit.id();
    let hash = oid.to_string();
    let short_hash = hash[..7.min(hash.len())].to_string();

    let message = commit
        .summary()
        .unwrap_or("")
        .to_string();
    let body = commit.body().map(|s| s.to_string());

    let author = commit.author();
    let author_name = author.name().unwrap_or("").to_string();
    let author_email = author.email().unwrap_or("").to_string();
    let timestamp = commit.time().seconds();

    let parents: Vec<String> = commit
        .parent_ids()
        .map(|oid| oid.to_string())
        .collect();

    // 收集引用
    let refs = collect_refs_for_commit(repo, &oid);

    GitCommit {
        hash,
        short_hash,
        message,
        body,
        author: author_name,
        author_email,
        timestamp,
        parents,
        refs,
    }
}

/// 预构建所有 refs 的 OID → Vec<GitRef> 映射（P0 优化）
/// 一次性扫描所有分支和标签，避免逐个 commit 调用 collect_refs_for_commit 时的 N+1 查询
fn build_refs_map(repo: &Repository) -> HashMap<git2::Oid, Vec<GitRef>> {
    let mut map: HashMap<git2::Oid, Vec<GitRef>> = HashMap::new();

    // HEAD
    if let Ok(head) = repo.head() {
        if let Some(oid) = head.target() {
            map.entry(oid).or_default().push(GitRef {
                name: "HEAD".to_string(),
                ref_type: "HEAD".to_string(),
            });
        }
    }

    // 分支
    if let Ok(branches) = repo.branches(None) {
        for branch_result in branches {
            if let Ok((branch, branch_type)) = branch_result {
                let name = branch.name().ok().flatten().map(|s| s.to_string());
                if let (Some(name), Ok(ref_)) = (
                    name,
                    branch.into_reference().resolve(),
                ) {
                    if let Some(oid) = ref_.target() {
                        let ref_type = match branch_type {
                            git2::BranchType::Local => "branch",
                            git2::BranchType::Remote => "remote",
                        };
                        map.entry(oid).or_default().push(GitRef {
                            name: name.to_string(),
                            ref_type: ref_type.to_string(),
                        });
                    }
                }
            }
        }
    }

    // 标签
    if let Ok(tags) = repo.tag_names(None) {
        for tag_name in tags.iter().flatten() {
            let refname = format!("refs/tags/{}", tag_name);
            if let Ok(ref_) = repo.find_reference(&refname) {
                // 处理 annotated tag (peel) 和 lightweight tag
                let oid = ref_
                    .peel_to_commit()
                    .map(|c| c.id())
                    .or_else(|_| ref_.target().ok_or(git2::Error::from_str("no target")))
                    .unwrap_or_else(|_| ref_.target().unwrap_or_else(|| git2::Oid::zero()));
                if !oid.is_zero() {
                    map.entry(oid).or_default().push(GitRef {
                        name: tag_name.to_string(),
                        ref_type: "tag".to_string(),
                    });
                }
            }
        }
    }

    map
}

/// 使用预构建的 refs_map 解析 commit（避免 N+1 查询）
fn parse_commit_with_refs_map(
    _repo: &Repository,
    commit: &git2::Commit,
    refs_map: &HashMap<git2::Oid, Vec<GitRef>>,
) -> GitCommit {
    let oid = commit.id();
    let hash = oid.to_string();
    let short_hash = hash[..7.min(hash.len())].to_string();

    let message = commit
        .summary()
        .unwrap_or("")
        .to_string();
    let body = commit.body().map(|s| s.to_string());

    let author = commit.author();
    let author_name = author.name().unwrap_or("").to_string();
    let author_email = author.email().unwrap_or("").to_string();
    let timestamp = commit.time().seconds();

    let parents: Vec<String> = commit
        .parent_ids()
        .map(|oid| oid.to_string())
        .collect();

    // 从预构建的 map 中获取引用
    let refs = refs_map.get(&oid).cloned().unwrap_or_default();

    GitCommit {
        hash,
        short_hash,
        message,
        body,
        author: author_name,
        author_email,
        timestamp,
        parents,
        refs,
    }
}

/// 收集指向某个提交的所有引用（分支、标签、HEAD）
fn collect_refs_for_commit(repo: &Repository, oid: &git2::Oid) -> Vec<GitRef> {
    let mut refs = Vec::new();

    // HEAD
    if let Ok(head) = repo.head() {
        if head.target() == Some(*oid) {
            refs.push(GitRef {
                ref_type: "HEAD".into(),
                name: "HEAD".into(),
            });
        }
    }

    // 分支
    if let Ok(branches) = repo.branches(None) {
        for item in branches.flatten() {
            let (branch, bt) = item;
            if let Some(target) = branch.get().target() {
                if target == *oid {
                    let name = branch.name().ok().flatten().unwrap_or("").to_string();
                    let ref_type = match bt {
                        BranchType::Local => "branch",
                        BranchType::Remote => "remote",
                    };
                    refs.push(GitRef {
                        ref_type: ref_type.into(),
                        name,
                    });
                }
            }
        }
    }

    // 标签
    if let Ok(tag_names) = repo.tag_names(None) {
        for i in 0..tag_names.len() {
            if let Some(tag_name) = tag_names.get(i) {
                let refname = format!("refs/tags/{tag_name}");
                if let Ok(reference) = repo.find_reference(&refname) {
                    let target = reference
                        .peel(ObjectType::Commit)
                        .ok()
                        .and_then(|obj| obj.as_commit().map(|c| c.id()));
                    if target == Some(*oid) {
                        refs.push(GitRef {
                            ref_type: "tag".into(),
                            name: tag_name.to_string(),
                        });
                    }
                }
            }
        }
    }

    refs
}

/// 解析 diff 为 GitDiff
fn parse_diff(diff: &Diff) -> Result<GitDiff, AppError> {
    let diff_stats = diff
        .stats()
        .map_err(|e| AppError::Other(format!("获取 diff stats 失败: {e}")))?;

    let stats = GitDiffStats {
        insertions: diff_stats.insertions(),
        deletions: diff_stats.deletions(),
        files_changed: diff_stats.files_changed(),
    };

    let mut files: Vec<GitFileDiff> = Vec::new();

    // 遍历每个 delta
    let num_deltas = diff.deltas().len();
    for i in 0..num_deltas {
        let delta = match diff.get_delta(i) {
            Some(d) => d,
            None => continue,
        };
        let new_file = delta.new_file();
        let old_file = delta.old_file();

        let path = new_file
            .path()
            .and_then(|p| p.to_str())
            .unwrap_or("")
            .to_string();
        let old_path = old_file
            .path()
            .and_then(|p| p.to_str())
            .map(|s| s.to_string());

        let status = match delta.status() {
            Delta::Added => "added",
            Delta::Deleted => "deleted",
            Delta::Modified => "modified",
            Delta::Renamed => "renamed",
            Delta::Copied => "modified",
            _ => "modified",
        };

        let is_binary = new_file.is_binary() || old_file.is_binary();

        files.push(GitFileDiff {
            path,
            old_path,
            status: status.into(),
            hunks: Vec::new(),
            is_binary,
        });
    }

    // P2 优化：构建文件路径 → 索引的 HashMap，避免逐个 position() 查找
    let mut path_index_map: HashMap<String, usize> = HashMap::new();
    for (idx, file) in files.iter().enumerate() {
        path_index_map.insert(file.path.clone(), idx);
    }

    // 遍历 hunks 和 lines
    let mut current_hunks: Vec<GitDiffHunk> = Vec::new();
    let mut current_lines: Vec<GitDiffLine> = Vec::new();
    let mut current_header = String::new();
    let mut last_file_idx: Option<usize> = None;

    diff.print(DiffFormat::Patch, |delta, hunk, line| {
        // 确定当前文件索引
        let this_file_path = delta
            .new_file()
            .path()
            .and_then(|p| p.to_str())
            .unwrap_or("");

        let fi = path_index_map.get(this_file_path).copied().unwrap_or(0);

        // 文件切换 → 保存之前的 hunks
        if last_file_idx.is_some() && last_file_idx != Some(fi) {
            // 保存最后一个 hunk
            if !current_lines.is_empty() || !current_header.is_empty() {
                current_hunks.push(GitDiffHunk {
                    header: current_header.clone(),
                    lines: std::mem::take(&mut current_lines),
                });
            }
            // 写入文件
            if let Some(prev_fi) = last_file_idx {
                if prev_fi < files.len() {
                    files[prev_fi].hunks = std::mem::take(&mut current_hunks);
                }
            }
            current_header.clear();
        }

        last_file_idx = Some(fi);

        // Hunk 头
        if let Some(h) = hunk {
            // 保存上一个 hunk
            if !current_lines.is_empty() || !current_header.is_empty() {
                current_hunks.push(GitDiffHunk {
                    header: current_header.clone(),
                    lines: std::mem::take(&mut current_lines),
                });
            }
            let header_bytes = h.header();
            current_header = String::from_utf8_lossy(header_bytes).trim().to_string();
        }

        // Diff 行
        let origin = match line.origin() {
            '+' => "+",
            '-' => "-",
            _ => " ",
        };
        let content = String::from_utf8_lossy(line.content()).to_string();

        current_lines.push(GitDiffLine {
            origin: origin.into(),
            content,
            old_lineno: line.old_lineno(),
            new_lineno: line.new_lineno(),
        });

        true
    })
    .map_err(|e| AppError::Other(format!("遍历 diff 失败: {e}")))?;

    // 保存最后一个文件的 hunks
    if !current_lines.is_empty() || !current_header.is_empty() {
        current_hunks.push(GitDiffHunk {
            header: current_header,
            lines: current_lines,
        });
    }
    if let Some(fi) = last_file_idx {
        if fi < files.len() {
            files[fi].hunks = current_hunks;
        }
    }

    Ok(GitDiff { stats, files })
}

/// 构建所有分支
fn build_branches(repo: &Repository) -> Result<Vec<GitBranch>, AppError> {
    let mut branches = Vec::new();

    let current_branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    let iter = repo
        .branches(None)
        .map_err(|e| AppError::Other(format!("获取分支列表失败: {e}")))?;

    for item in iter.flatten() {
        let (branch, bt) = item;
        let name = branch
            .name()
            .ok()
            .flatten()
            .unwrap_or("")
            .to_string();
        let is_local = bt == BranchType::Local;
        let is_current = is_local && current_branch.as_deref() == Some(&name);

        let head_commit = branch
            .get()
            .target()
            .map(|oid| oid.to_string())
            .unwrap_or_default();

        let upstream_name = branch
            .upstream()
            .ok()
            .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()));

        // 计算 ahead/behind（仅本地分支有上游时）
        let (ahead, behind) = if is_local {
            if let (Some(local_oid), Ok(upstream)) =
                (branch.get().target(), branch.upstream())
            {
                if let Some(upstream_oid) = upstream.get().target() {
                    repo.graph_ahead_behind(local_oid, upstream_oid)
                        .map(|(a, b)| (a as u32, b as u32))
                        .unwrap_or((0, 0))
                } else {
                    (0, 0)
                }
            } else {
                (0, 0)
            }
        } else {
            (0, 0)
        };

        branches.push(GitBranch {
            name,
            is_local,
            is_current,
            upstream: upstream_name,
            head_commit,
            ahead,
            behind,
        });
    }

    Ok(branches)
}

/// 构建分支图
fn build_graph(
    repo: &Repository,
    skip: usize,
    limit: usize,
) -> Result<GitGraph, AppError> {
    let mut revwalk = repo
        .revwalk()
        .map_err(|e| AppError::Other(format!("创建 revwalk 失败: {e}")))?;
    revwalk
        .push_head()
        .map_err(|e| AppError::Other(format!("push HEAD 失败: {e}")))?;
    // 也推入所有本地分支的 HEAD，确保图完整
    if let Ok(branches) = repo.branches(Some(BranchType::Local)) {
        for item in branches.flatten() {
            let (branch, _) = item;
            if let Some(oid) = branch.get().target() {
                let _ = revwalk.push(oid);
            }
        }
    }
    revwalk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)
        .map_err(|e| AppError::Other(format!("设置排序失败: {e}")))?;

    // 收集 OID
    let oids: Vec<git2::Oid> = revwalk
        .skip(skip)
        .take(limit)
        .filter_map(|r| r.ok())
        .collect();

    // P0 优化：预构建所有 refs 的映射
    let refs_map = build_refs_map(repo);

    // P1 优化：单轮遍历分配列位置和构建节点，使用 OID 作为 key（而非 String）
    let mut col_map: HashMap<git2::Oid, usize> = HashMap::new(); // OID → col
    let mut active_cols: Vec<bool> = Vec::new(); // 哪些列正在使用
    let mut max_cols: usize = 0;
    let mut nodes = Vec::with_capacity(oids.len());

    for (row, oid) in oids.iter().enumerate() {
        // 列分配
        let col = if let Some(&c) = col_map.get(oid) {
            c
        } else {
            // 找一个空闲列
            let c = active_cols.iter().position(|&used| !used).unwrap_or_else(|| {
                active_cols.push(false);
                active_cols.len() - 1
            });
            col_map.insert(*oid, c);
            c
        };

        active_cols.resize(active_cols.len().max(col + 1), false);
        active_cols[col] = true;

        if let Ok(commit) = repo.find_commit(*oid) {
            let parent_ids: Vec<git2::Oid> = commit.parent_ids().collect();

            if parent_ids.is_empty() {
                // 根提交：释放列
                active_cols[col] = false;
            } else {
                // 第一个父节点继承当前列
                let first_parent = parent_ids[0];
                if !col_map.contains_key(&first_parent) {
                    col_map.insert(first_parent, col);
                } else {
                    // 第一个父节点已有列，释放当前列
                    active_cols[col] = false;
                }

                // 其余父节点分配新列
                for parent_id in &parent_ids[1..] {
                    if !col_map.contains_key(parent_id) {
                        let pc = active_cols.iter().position(|&used| !used).unwrap_or_else(|| {
                            active_cols.push(false);
                            active_cols.len() - 1
                        });
                        active_cols.resize(active_cols.len().max(pc + 1), false);
                        active_cols[pc] = true;
                        col_map.insert(*parent_id, pc);
                    }
                }
            }

            // 构建节点（与列分配在同一轮完成）
            let hash = oid.to_string();
            let short_hash = hash[..7.min(hash.len())].to_string();
            let message = commit.summary().unwrap_or("").to_string();
            let author = commit.author().name().unwrap_or("").to_string();
            let timestamp = commit.time().seconds();

            let parents: Vec<GitGraphEdge> = parent_ids
                .iter()
                .map(|pid| {
                    let parent_col = col_map.get(pid).copied().unwrap_or(0);
                    GitGraphEdge {
                        parent_hash: pid.to_string(),
                        parent_col,
                    }
                })
                .collect();

            // 从预构建的 refs_map 获取引用
            let refs = refs_map.get(oid).cloned().unwrap_or_default();

            nodes.push(GitGraphNode {
                hash,
                short_hash,
                message,
                author,
                timestamp,
                row,
                col,
                parents,
                refs,
            });
        }

        max_cols = max_cols.max(active_cols.len());
    }

    Ok(GitGraph { nodes, max_cols })
}

/// 构建所有远程仓库信息
fn build_remotes(repo: &Repository) -> Result<Vec<GitRemote>, AppError> {
    let remote_names = repo
        .remotes()
        .map_err(|e| AppError::Other(format!("获取远程列表失败: {e}")))?;

    let mut remotes = Vec::new();
    for i in 0..remote_names.len() {
        if let Some(name) = remote_names.get(i) {
            let remote = repo
                .find_remote(name)
                .map_err(|e| AppError::Other(format!("获取远程 {name} 失败: {e}")))?;
            let url = remote.url().map(|s| s.to_string());
            // pushurl 不同于 url 时才有值
            let push_url = remote.pushurl().map(|s| s.to_string());
            remotes.push(GitRemote {
                name: name.to_string(),
                url: url.clone(),
                fetch_url: if push_url.is_some() { url } else { url.clone() },
            });
            // 修正：url 作为 fetch_url，pushurl 作为 url（push 用途）
            if let Some(pu) = push_url {
                if let Some(last) = remotes.last_mut() {
                    last.url = Some(pu);
                }
            }
        }
    }

    Ok(remotes)
}

/// 构建所有标签信息
fn build_tags(repo: &Repository) -> Result<Vec<GitTag>, AppError> {
    let tag_names = repo
        .tag_names(None)
        .map_err(|e| AppError::Other(format!("获取标签列表失败: {e}")))?;

    let mut tags = Vec::new();
    for i in 0..tag_names.len() {
        if let Some(tag_name) = tag_names.get(i) {
            let refname = format!("refs/tags/{tag_name}");
            if let Ok(reference) = repo.find_reference(&refname) {
                // 尝试解析为 annotated tag
                let resolved = reference.peel(ObjectType::Tag);
                if let Ok(tag_obj) = resolved {
                    // Annotated tag
                    if let Some(tag) = tag_obj.as_tag() {
                        let target_commit = tag
                            .target()
                            .ok()
                            .and_then(|t| t.peel_to_commit().ok());
                        let hash = target_commit
                            .as_ref()
                            .map(|c| c.id().to_string())
                            .unwrap_or_else(|| tag.target_id().to_string());
                        let timestamp = target_commit
                            .as_ref()
                            .map(|c| c.time().seconds())
                            .unwrap_or(0);
                        tags.push(GitTag {
                            name: tag_name.to_string(),
                            message: tag.message().map(|s| s.to_string()),
                            tagger: tag.tagger().and_then(|s| s.name().map(|n| n.to_string())),
                            hash,
                            timestamp,
                            is_lightweight: false,
                        });
                        continue;
                    }
                }

                // Lightweight tag — 直接指向 commit
                if let Ok(commit_obj) = reference.peel(ObjectType::Commit) {
                    if let Some(commit) = commit_obj.as_commit() {
                        tags.push(GitTag {
                            name: tag_name.to_string(),
                            message: None,
                            tagger: None,
                            hash: commit.id().to_string(),
                            timestamp: commit.time().seconds(),
                            is_lightweight: true,
                        });
                    }
                }
            }
        }
    }

    // 按时间倒序排列
    tags.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(tags)
}

/// 构建贡献者统计
fn build_contributors(repo: &Repository) -> Result<Vec<GitContributor>, AppError> {
    let mut revwalk = repo
        .revwalk()
        .map_err(|e| AppError::Other(format!("创建 revwalk 失败: {e}")))?;
    revwalk
        .push_head()
        .map_err(|e| AppError::Other(format!("push HEAD 失败: {e}")))?;
    // 也推入所有本地分支
    if let Ok(branches) = repo.branches(Some(BranchType::Local)) {
        for item in branches.flatten() {
            let (branch, _) = item;
            if let Some(oid) = branch.get().target() {
                let _ = revwalk.push(oid);
            }
        }
    }

    // P1 优化：使用 simplify_first_parent() 避免重复遍历 merge commit 的多个父节点
    revwalk.simplify_first_parent()
        .map_err(|e| AppError::Other(format!("设置 simplify_first_parent 失败: {e}")))?;

    // email → (name, email, count, first_commit, last_commit)
    let mut map: HashMap<String, (String, String, usize, i64, i64)> = HashMap::new();

    for oid in revwalk.filter_map(|r| r.ok()) {
        if let Ok(commit) = repo.find_commit(oid) {
            let author = commit.author();
            let name = author.name().unwrap_or("Unknown").to_string();
            let email = author.email().unwrap_or("").to_string();
            let ts = commit.time().seconds();

            let entry = map.entry(email.clone()).or_insert_with(|| {
                (name.clone(), email.clone(), 0, ts, ts)
            });
            entry.2 += 1;
            if ts < entry.3 { entry.3 = ts; } // first_commit = 最早
            if ts > entry.4 { entry.4 = ts; } // last_commit = 最晚
        }
    }

    let mut contributors: Vec<GitContributor> = map
        .into_values()
        .map(|(name, email, commits, first_commit, last_commit)| GitContributor {
            name,
            email,
            commits,
            first_commit,
            last_commit,
        })
        .collect();

    // 按提交数降序
    contributors.sort_by(|a, b| b.commits.cmp(&a.commits));
    Ok(contributors)
}
