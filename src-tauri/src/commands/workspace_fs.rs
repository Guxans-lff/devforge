use crate::models::workspace_fs::{DirEntry, GitFileStatus, RecursiveDirEntry};
use crate::services::file_watcher::FileWatcher;
use crate::utils::error::AppError;
use std::sync::Arc;

pub type FileWatcherState = Arc<FileWatcher>;

/// 读取单层目录
#[tauri::command]
pub async fn ws_read_directory(path: String) -> Result<Vec<DirEntry>, AppError> {
    let dir_path = std::path::Path::new(&path);
    let mut entries = Vec::new();
    let mut read_dir = tokio::fs::read_dir(dir_path)
        .await
        .map_err(|e| AppError::Other(format!("读取目录失败: {}", e)))?;

    while let Some(entry) = read_dir.next_entry().await
        .map_err(|e| AppError::Other(format!("读取条目失败: {}", e)))? {
        let name = entry.file_name().to_string_lossy().to_string();
        // 跳过隐藏文件（以 . 开头）
        if name.starts_with('.') {
            continue;
        }
        let metadata = entry.metadata().await.ok();
        let is_dir = metadata.as_ref().map_or(false, |m| m.is_dir());
        let size = metadata.as_ref().and_then(|m| if !m.is_dir() { Some(m.len()) } else { None });
        let modified = metadata.as_ref().and_then(|m| {
            m.modified().ok().and_then(|t| {
                t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs() as i64)
            })
        });

        entries.push(DirEntry {
            name,
            is_dir,
            size,
            modified,
        });
    }

    // 目录在前，文件在后；同类按名称排序
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

/// 递归读取目录（限深度，用于预取）
#[tauri::command]
pub async fn ws_read_directory_recursive(
    path: String,
    max_depth: u32,
) -> Result<Vec<RecursiveDirEntry>, AppError> {
    use walkdir::WalkDir;

    let base_path = std::path::Path::new(&path);
    let entries: Vec<RecursiveDirEntry> = WalkDir::new(&path)
        .max_depth(max_depth as usize)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path() != base_path)
        .filter(|e| {
            // 跳过隐藏目录及其内容
            !e.path().components().any(|c| {
                c.as_os_str().to_string_lossy().starts_with('.')
            })
        })
        .map(|e| {
            let relative = e.path().strip_prefix(&path).unwrap_or(e.path());
            RecursiveDirEntry {
                relative_path: relative.to_string_lossy().to_string().replace('\\', "/"),
                name: e.file_name().to_string_lossy().to_string(),
                is_dir: e.file_type().is_dir(),
                depth: e.depth() as u32,
            }
        })
        .collect();

    Ok(entries)
}

/// 新建文件
#[tauri::command]
pub async fn ws_create_file(path: String, content: Option<String>) -> Result<(), AppError> {
    tokio::fs::write(&path, content.unwrap_or_default())
        .await
        .map_err(|e| AppError::Other(format!("创建文件失败: {}", e)))
}

/// 新建文件夹
#[tauri::command]
pub async fn ws_create_directory(path: String) -> Result<(), AppError> {
    tokio::fs::create_dir_all(&path)
        .await
        .map_err(|e| AppError::Other(format!("创建文件夹失败: {}", e)))
}

/// 重命名
#[tauri::command]
pub async fn ws_rename_entry(old_path: String, new_path: String) -> Result<(), AppError> {
    tokio::fs::rename(&old_path, &new_path)
        .await
        .map_err(|e| AppError::Other(format!("重命名失败: {}", e)))
}

/// 删除（默认回收站）
#[tauri::command]
pub async fn ws_delete_entry(path: String, permanent: Option<bool>) -> Result<(), AppError> {
    if permanent.unwrap_or(false) {
        let p = std::path::Path::new(&path);
        if p.is_dir() {
            tokio::fs::remove_dir_all(&path).await
        } else {
            tokio::fs::remove_file(&path).await
        }
        .map_err(|e| AppError::Other(format!("删除失败: {}", e)))
    } else {
        trash::delete(&path)
            .map_err(|e| AppError::Other(format!("移至回收站失败: {}", e)))
    }
}

/// 移动文件/文件夹
#[tauri::command]
pub async fn ws_move_entry(source: String, target_dir: String) -> Result<(), AppError> {
    let source_path = std::path::Path::new(&source);
    let file_name = source_path.file_name()
        .ok_or_else(|| AppError::Other("无效源路径".into()))?;
    let target_path = std::path::Path::new(&target_dir).join(file_name);
    tokio::fs::rename(&source, &target_path)
        .await
        .map_err(|e| AppError::Other(format!("移动失败: {}", e)))
}

/// 启动目录监听
#[tauri::command]
pub async fn ws_watch_directory(
    state: tauri::State<'_, FileWatcherState>,
    app: tauri::AppHandle,
    id: String,
    path: String,
) -> Result<(), AppError> {
    state.watch(id, path, app)
        .await
        .map_err(|e| AppError::Other(e))
}

/// 停止目录监听
#[tauri::command]
pub async fn ws_unwatch_directory(
    state: tauri::State<'_, FileWatcherState>,
    id: String,
) -> Result<(), AppError> {
    state.unwatch(&id).await;
    Ok(())
}

/// 获取 Git 状态
#[tauri::command]
pub async fn ws_get_git_status(repo_path: String) -> Result<Vec<GitFileStatus>, AppError> {
    let statuses = tokio::task::spawn_blocking(move || -> Result<Vec<GitFileStatus>, String> {
        let repo = git2::Repository::open(&repo_path)
            .map_err(|e| format!("打开仓库失败: {}", e))?;

        let status_opts = &mut git2::StatusOptions::new();
        status_opts.include_untracked(true);
        status_opts.recurse_untracked_dirs(true);

        let statuses = repo.statuses(Some(status_opts))
            .map_err(|e| format!("获取状态失败: {}", e))?;

        let result: Vec<GitFileStatus> = statuses.iter().filter_map(|entry| {
            let path = entry.path()?.to_string();
            let status = entry.status();
            let status_str = if status.is_conflicted() {
                "conflict"
            } else if status.is_wt_new() || status.is_index_new() {
                if status.is_index_new() { "added" } else { "untracked" }
            } else if status.is_wt_deleted() || status.is_index_deleted() {
                "deleted"
            } else if status.is_wt_renamed() || status.is_index_renamed() {
                "renamed"
            } else if status.is_wt_modified() || status.is_index_modified() {
                "modified"
            } else {
                return None;
            };
            Some(GitFileStatus {
                path,
                status: status_str.to_string(),
            })
        }).collect();

        Ok(result)
    })
    .await
    .map_err(|e| AppError::Other(format!("Git 任务失败: {}", e)))?
    .map_err(|e| AppError::Other(e))?;

    Ok(statuses)
}
