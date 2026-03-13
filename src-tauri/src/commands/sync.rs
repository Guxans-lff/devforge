use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;

use crate::commands::sftp::SftpEngineState;
use russh_sftp::client::SftpSession;
use futures::future::BoxFuture;
use futures::FutureExt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub local_size: Option<u64>,
    pub remote_size: Option<u64>,
    pub local_modified: Option<i64>,
    pub remote_modified: Option<i64>,
    pub status: String, // "added_local", "added_remote", "modified", "unchanged"
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDiff {
    pub entries: Vec<SyncEntry>,
    pub added_local: u32,
    pub added_remote: u32,
    pub modified: u32,
    pub unchanged: u32,
}

/// 比较本地和远程目录差异
#[tauri::command]
pub async fn sync_compare(
    app: tauri::AppHandle,
    connection_id: String,
    local_path: String,
    remote_path: String,
) -> Result<SyncDiff, String> {
    let sftp_engine = app.state::<SftpEngineState>().inner().clone();
        // 收集本地文件
    let local_files = match collect_local_files(&local_path).await {
        Ok(f) => f,
        Err(e) => return Err(format!("扫描本地目录失败: {}", e)),
    };

    // 收集远程文件
    let sftp = sftp_engine
        .get_sftp_session(&connection_id)
        .await
        .ok_or_else(|| format!("No SFTP session for connection: {}", connection_id))?;

    let remote_files = match collect_remote_files_map(&sftp, &remote_path).await {
        Ok(f) => f,
        Err(e) => return Err(format!("扫描远程目录失败: {}", e)),
    };

    // 比较差异
    let mut entries = Vec::new();
    let mut added_local: u32 = 0;
    let mut added_remote: u32 = 0;
    let mut modified: u32 = 0;
    let mut unchanged: u32 = 0;

    let mut remote_remaining: HashMap<String, FileMetaInfo> = remote_files;

    for (rel_path, local_info) in &local_files {
        if let Some(remote_info) = remote_remaining.remove(rel_path) {
            // 两边都有
            let is_modified = if local_info.is_dir {
                false
            } else {
                local_info.size != remote_info.size
                    || (local_info.modified.is_some()
                        && remote_info.modified.is_some()
                        && (local_info.modified.unwrap() - remote_info.modified.unwrap()).abs() > 1)
            };

            let status = if is_modified { "modified" } else { "unchanged" };
            if is_modified {
                modified += 1;
            } else {
                unchanged += 1;
            }

            entries.push(SyncEntry {
                path: rel_path.clone(),
                name: rel_path.split('/').last().unwrap_or(rel_path).to_string(),
                is_dir: local_info.is_dir,
                local_size: Some(local_info.size),
                remote_size: Some(remote_info.size),
                local_modified: local_info.modified,
                remote_modified: remote_info.modified,
                status: status.to_string(),
            });
        } else {
            // 只在本地
            added_local += 1;
            entries.push(SyncEntry {
                path: rel_path.clone(),
                name: rel_path.split('/').last().unwrap_or(rel_path).to_string(),
                is_dir: local_info.is_dir,
                local_size: Some(local_info.size),
                remote_size: None,
                local_modified: local_info.modified,
                remote_modified: None,
                status: "added_local".to_string(),
            });
        }
    }

    // 只在远程的文件
    for (rel_path, remote_info) in remote_remaining {
        added_remote += 1;
        entries.push(SyncEntry {
            path: rel_path.clone(),
            name: rel_path.split('/').last().unwrap_or(&rel_path).to_string(),
            is_dir: remote_info.is_dir,
            local_size: None,
            remote_size: Some(remote_info.size),
            local_modified: None,
            remote_modified: remote_info.modified,
            status: "added_remote".to_string(),
        });
    }

    // 按路径排序
    entries.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(SyncDiff {
        entries,
        added_local,
        added_remote,
        modified,
        unchanged,
    })
}

#[derive(Debug, Clone)]
struct FileMetaInfo {
    is_dir: bool,
    size: u64,
    modified: Option<i64>,
}

/// 递归收集本地文件，返回 (相对路径 -> 元信息) 的 HashMap
async fn collect_local_files(
    base_path: &str,
) -> Result<HashMap<String, FileMetaInfo>, std::io::Error> {
    let base = std::path::PathBuf::from(base_path);
    let mut result = HashMap::new();
    collect_local_recursive(&base, &base, &mut result).await?;
    Ok(result)
}

fn collect_local_recursive<'a>(
    base: &'a std::path::Path,
    current: &'a std::path::Path,
    result: &'a mut HashMap<String, FileMetaInfo>,
) -> BoxFuture<'a, Result<(), std::io::Error>> {
    async move {
        let mut entries = tokio::fs::read_dir(current).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let meta = entry.metadata().await?;
            let rel = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");

            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64);

            result.insert(
                rel.clone(),
                FileMetaInfo {
                    is_dir: meta.is_dir(),
                    size: meta.len(),
                    modified,
                },
            );

            if meta.is_dir() {
                collect_local_recursive(base, &path, result).await?;
            }
        }
        Ok(())
    }.boxed()
}

/// 递归收集远程文件，返回 (相对路径 -> 元信息) 的 HashMap
async fn collect_remote_files_map(
    sftp: &Arc<SftpSession>,
    base_path: &str,
) -> Result<HashMap<String, FileMetaInfo>, String> {
    let mut result = HashMap::new();
    collect_remote_recursive(sftp.as_ref(), base_path, base_path, &mut result).await?;
    Ok(result)
}

fn collect_remote_recursive<'a>(
    sftp: &'a SftpSession,
    base_path: &'a str,
    current_path: &'a str,
    result: &'a mut HashMap<String, FileMetaInfo>,
) -> BoxFuture<'a, Result<(), String>> {
    async move {
        let entries = sftp.read_dir(current_path).await
            .map_err(|e| format!("read_dir {} 失败: {}", current_path, e))?;

        for entry in entries {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }

            let full_path = if current_path.ends_with('/') {
                format!("{}{}", current_path, name)
            } else {
                format!("{}/{}", current_path, name)
            };

            let attrs = entry.metadata();
            let file_type = attrs.permissions.unwrap_or(0) & 0o170000;
            let is_dir = file_type == 0o040000;
            let is_symlink = file_type == 0o120000;
            let size = attrs.size.unwrap_or(0);
            let modified = attrs.mtime.map(|m| m as i64);

            // 计算相对路径
            let rel = if base_path.ends_with('/') {
                full_path
                    .strip_prefix(base_path)
                    .unwrap_or(&full_path)
                    .to_string()
            } else {
                full_path
                    .strip_prefix(&format!("{}/", base_path))
                    .unwrap_or(&full_path)
                    .to_string()
            };

            result.insert(
                rel,
                FileMetaInfo {
                    is_dir,
                    size,
                    modified,
                },
            );

            if is_dir && !is_symlink {
                collect_remote_recursive(sftp, base_path, &full_path, result).await?;
            }
        }
        Ok(())
    }.boxed()
}
