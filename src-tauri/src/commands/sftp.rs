use std::sync::Arc;

use tauri::{Emitter, Manager};

use crate::commands::connection::StorageState;
use crate::models::transfer::{FileEntry, FileInfo};
use crate::services::sftp_engine::SftpEngine;
use crate::services::ssh_auth;
use crate::utils::error::AppError;

pub type SftpEngineState = Arc<SftpEngine>;

#[tauri::command]
pub async fn sftp_connect(
    app: tauri::AppHandle,
    connection_id: String,
) -> Result<bool, AppError> {
    let sftp_engine = app.state::<SftpEngineState>().inner().clone();
    let storage = app.state::<StorageState>().inner().clone();
    let conn = storage
        .get_connection(&connection_id)
        .await?;

    let auth = ssh_auth::parse_auth_config(&connection_id, &conn.config_json)?;

    // 解析跳板机配置（resolve_proxy_from_config 已返回 AppError，直接 ? 传播）
    let proxy = crate::commands::ssh::resolve_proxy_from_config(&storage, &conn.config_json).await?;

    sftp_engine
        .connect(
            &connection_id,
            &conn.host,
            conn.port as u16,
            &conn.username,
            &auth,
            proxy.as_ref(),
        )
        .await?;

    Ok(true)
}

#[tauri::command]
pub async fn sftp_disconnect(
    app: tauri::AppHandle,
    connection_id: String,
) -> Result<bool, AppError> {
    let sftp_engine = app.state::<SftpEngineState>().inner().clone();
    sftp_engine
        .disconnect(&connection_id)
        .await?;
    Ok(true)
}

#[tauri::command]
pub async fn sftp_list_dir(
    app: tauri::AppHandle,
    connection_id: String,
    path: String,
) -> Result<Vec<FileEntry>, AppError> {
    let sftp_engine = app.state::<SftpEngineState>().inner().clone();
    sftp_engine
        .list_dir(&connection_id, &path)
        .await
}

#[tauri::command]
pub async fn sftp_stat(
    app: tauri::AppHandle,
    connection_id: String,
    path: String,
) -> Result<FileInfo, AppError> {
    let sftp_engine = app.state::<SftpEngineState>().inner().clone();
    sftp_engine
        .stat(&connection_id, &path)
        .await
}

#[tauri::command]
pub async fn sftp_mkdir(
    app: tauri::AppHandle,
    connection_id: String,
    path: String,
) -> Result<bool, AppError> {
    let sftp_engine = app.state::<SftpEngineState>().inner().clone();
    sftp_engine
        .mkdir(&connection_id, &path)
        .await?;
    Ok(true)
}

#[tauri::command]
pub async fn sftp_delete(
    app: tauri::AppHandle,
    connection_id: String,
    path: String,
    is_dir: bool,
) -> Result<bool, AppError> {
    let sftp_engine = app.state::<SftpEngineState>().inner().clone();

    if is_dir {
        // 目录删除：用 SSH find 快速判断文件数，决定用 SSH rm -rf 还是逐个 SFTP 删除
        const BULK_DELETE_THRESHOLD: usize = 100;

        // 快速统计：SSH find | wc -l，只需要知道是否超过阈值
        // 比 sftp_list_recursive 快几个数量级（不需要完整遍历）
        let file_count = {
            let count_cmd = format!(
                "find '{}' -type f 2>/dev/null | head -{} | wc -l",
                path.replace('\'', "'\\''"),
                BULK_DELETE_THRESHOLD + 1
            );
            match sftp_engine.exec_command(&connection_id, &count_cmd, 15).await {
                Ok((_code, output)) => {
                    output.trim().parse::<usize>().unwrap_or(0)
                }
                Err(_) => {
                    // SSH exec 失败，降级用 SFTP 递归列举
                    match sftp_list_recursive(app.clone(), connection_id.clone(), path.clone()).await {
                        Ok(files) => files.len(),
                        Err(_) => 0,
                    }
                }
            }
        };

        if file_count >= BULK_DELETE_THRESHOLD {
            // 大目录：用 SSH rm -rf 快速删除
            log::info!("[SFTP] 大目录删除 ({} 个文件)，使用 SSH rm -rf: {}", file_count, path);

            let delete_id = uuid::Uuid::new_v4().to_string();
            let _ = app.emit("sftp://delete-progress", serde_json::json!({
                "id": &delete_id,
                "path": &path,
                "fileCount": file_count,
                "phase": "deleting",
            }));

            let rm_cmd = format!("rm -rf '{}'", path.replace('\'', "'\\''"));
            let (exit_code, output) = sftp_engine
                .exec_command(&connection_id, &rm_cmd, 60)
                .await
                .map_err(|e| AppError::Other(format!("SSH 删除失败: {}", e)))?;

            // exit_code == -1 表示 SSH 服务器未发送 ExitStatus，不一定是失败
            if exit_code != 0 && exit_code != -1 {
                let _ = app.emit("sftp://delete-progress", serde_json::json!({
                    "id": &delete_id,
                    "phase": "error",
                    "error": format!("删除失败 (exit={}): {}", exit_code, output),
                }));
                return Err(AppError::Other(format!("删除失败 (exit={}): {}", exit_code, output)));
            }

            let _ = app.emit("sftp://delete-progress", serde_json::json!({
                "id": &delete_id,
                "phase": "completed",
                "fileCount": file_count,
            }));

            log::info!("[SFTP] 删除完成: {}", path);
        } else {
            // 小目录：逐个 SFTP 删除
            sftp_engine.delete_dir(&connection_id, &path).await?;
        }
    } else {
        sftp_engine.delete_file(&connection_id, &path).await?;
    }

    Ok(true)
}

#[tauri::command]
pub async fn sftp_rename(
    app: tauri::AppHandle,
    connection_id: String,
    old_path: String,
    new_path: String,
) -> Result<bool, AppError> {
    let sftp_engine = app.state::<SftpEngineState>().inner().clone();
    sftp_engine
        .rename(&connection_id, &old_path, &new_path)
        .await?;
    Ok(true)
}

#[tauri::command]
pub async fn sftp_download(
    app_handle: tauri::AppHandle,
    connection_id: String,
    remote_path: String,
    local_path: String,
) -> Result<String, AppError> {
    let sftp_engine = app_handle.state::<SftpEngineState>().inner().clone();
    let transfer_id = uuid::Uuid::new_v4().to_string();

    sftp_engine
        .download(
            &connection_id,
            &remote_path,
            &local_path,
            &transfer_id,
            &app_handle,
        )
        .await?;

    Ok(transfer_id)
}

#[tauri::command]
pub async fn sftp_upload(
    app_handle: tauri::AppHandle,
    connection_id: String,
    local_path: String,
    remote_path: String,
) -> Result<String, AppError> {
    let sftp_engine = app_handle.state::<SftpEngineState>().inner().clone();
    let transfer_id = uuid::Uuid::new_v4().to_string();

    sftp_engine
        .upload(
            &connection_id,
            &local_path,
            &remote_path,
            &transfer_id,
            &app_handle,
        )
        .await?;

    Ok(transfer_id)
}

/// 列出本地目录条目（用于本地文件面板）
#[tauri::command]
pub async fn local_list_dir(path: String) -> Result<Vec<FileEntry>, AppError> {
    let mut entries = Vec::new();
    // tokio::fs 返回 std::io::Error，AppError 已有 From<std::io::Error>，直接 ?
    let mut read_dir = tokio::fs::read_dir(&path).await?;

    while let Some(entry) = read_dir.next_entry().await? {
        let metadata = entry.metadata().await?;

        let name = entry.file_name().to_string_lossy().to_string();
        let full_path = entry.path().to_string_lossy().to_string();
        let is_dir = metadata.is_dir();
        let size = if is_dir { 0 } else { metadata.len() };

        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);

        entries.push(FileEntry {
            name,
            path: full_path,
            is_dir,
            size,
            modified,
            permissions: None,
        });
    }

    // 排序：目录在前，然后按名称排序
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub async fn local_mkdir(path: String) -> Result<(), AppError> {
    // std::io::Error 已有 From，直接 ?
    tokio::fs::create_dir_all(&path).await?;
    Ok(())
}

#[tauri::command]
pub async fn local_delete(path: String) -> Result<(), AppError> {
    // std::io::Error 已有 From，直接 ?
    let metadata = tokio::fs::metadata(&path).await?;
    if metadata.is_dir() {
        tokio::fs::remove_dir_all(&path).await?;
    } else {
        tokio::fs::remove_file(&path).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn local_rename(old_path: String, new_path: String) -> Result<(), AppError> {
    // std::io::Error 已有 From，直接 ?
    tokio::fs::rename(&old_path, &new_path).await?;
    Ok(())
}

/// 递归列出本地目录中的所有文件
#[tauri::command]
pub async fn local_list_recursive(path: String) -> Result<Vec<(String, u64)>, AppError> {
    let mut files = Vec::new();
    collect_local_files(std::path::Path::new(&path), &mut files).await?;
    Ok(files)
}

fn collect_local_files<'a>(
    dir: &'a std::path::Path,
    files: &'a mut Vec<(String, u64)>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), AppError>> + Send + 'a>> {
    Box::pin(async move {
        // std::io::Error 已有 From<>，直接 ?
        let mut entries = tokio::fs::read_dir(dir).await?;

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let metadata = entry.metadata().await?;

            // 跳过符号链接以避免无限循环
            if metadata.is_symlink() {
                continue;
            }

            if metadata.is_file() {
                files.push((path.to_string_lossy().to_string(), metadata.len()));
            } else if metadata.is_dir() {
                collect_local_files(&path, files).await?;
            }
        }

        Ok(())
    })
}

/// 递归列出远程目录中的所有文件
#[tauri::command]
pub async fn sftp_list_recursive(
    app: tauri::AppHandle,
    connection_id: String,
    path: String,
) -> Result<Vec<(String, u64)>, AppError> {
    let engine = app.state::<SftpEngineState>().inner().clone();
    // 检查是否已连接
    if !engine.is_connected(&connection_id).await {
        return Err(AppError::ConnectionNotFound(
            format!("No SFTP session for connection: {}", connection_id),
        ));
    }

    let sftp: Arc<russh_sftp::client::SftpSession> = engine
        .get_sftp_session(&connection_id)
        .await
        .ok_or_else(|| AppError::ConnectionNotFound(
            format!("No SFTP session for connection: {}", connection_id),
        ))?;

    let mut files = Vec::new();
    const MAX_RECURSION_DEPTH: u32 = 20;
    collect_remote_files(sftp.as_ref(), &path, &mut files, 0, MAX_RECURSION_DEPTH).await?;
    Ok(files)
}

fn collect_remote_files<'a>(
    sftp: &'a russh_sftp::client::SftpSession,
    dir: &'a str,
    files: &'a mut Vec<(String, u64)>,
    depth: u32,
    max_depth: u32,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), AppError>> + Send + 'a>> {
    Box::pin(async move {
        if depth >= max_depth {
            return Err(AppError::Validation(
                format!("递归深度超过限制 ({})，可能存在循环引用: {}", max_depth, dir),
            ));
        }
        // russh_sftp 的错误包装为 AppError::Connection
        let entries = sftp
            .read_dir(dir)
            .await
            .map_err(|e| AppError::Connection(format!("Failed to read remote directory: {}", e)))?;

        for entry in entries {
            let file_name = entry.file_name();

            // 跳过 . 和 ..
            if file_name == "." || file_name == ".." {
                continue;
            }

            let full_path = if dir.ends_with('/') {
                format!("{}{}", dir, file_name)
            } else {
                format!("{}/{}", dir, file_name)
            };

            let attrs = entry.metadata();

            // 检查是否为目录（使用权限位）
            let is_dir = attrs.permissions.map(|p| p & 0o40000 != 0).unwrap_or(false);

            // 检查是否为符号链接（避免无限循环）
            let is_symlink = attrs.permissions.map(|p| p & 0o120000 != 0).unwrap_or(false);

            if is_symlink {
                continue;
            }

            if !is_dir {
                let size = attrs.size.unwrap_or(0);
                files.push((full_path, size));
            } else {
                collect_remote_files(sftp, &full_path, files, depth + 1, max_depth).await?;
            }
        }

        Ok(())
    })
}

/// 获取 Windows 可用驱动器或 Unix 挂载点
#[tauri::command]
pub async fn get_available_drives() -> Result<Vec<String>, AppError> {
    #[cfg(target_os = "windows")]
    {
        use winapi::um::fileapi::GetLogicalDrives;

        let drives_mask = unsafe { GetLogicalDrives() };
        let mut drives = Vec::new();

        for i in 0..26 {
            if drives_mask & (1 << i) != 0 {
                let drive_letter = (b'A' + i) as char;
                drives.push(format!("{}:", drive_letter));
            }
        }

        Ok(drives)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Unix 类系统返回常见挂载点
        Ok(vec!["/".to_string()])
    }
}
