use std::sync::Arc;

use tauri::State;

use crate::commands::connection::StorageState;
use crate::models::transfer::{FileEntry, FileInfo};
use crate::services::sftp_engine::SftpEngine;
use crate::services::ssh_auth;

pub type SftpEngineState = Arc<SftpEngine>;

#[tauri::command]
pub async fn sftp_connect(
    sftp_engine: State<'_, SftpEngineState>,
    storage: State<'_, StorageState>,
    connection_id: String,
) -> Result<bool, String> {
    let conn = storage
        .get_connection(&connection_id)
        .await
        .map_err(|e| e.to_string())?;

    let auth = ssh_auth::parse_auth_config(&connection_id, &conn.config_json)
        .map_err(|e| e.to_string())?;

    // 解析跳板机配置
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
        .await
        .map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub async fn sftp_disconnect(
    sftp_engine: State<'_, SftpEngineState>,
    connection_id: String,
) -> Result<bool, String> {
    sftp_engine
        .disconnect(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn sftp_list_dir(
    sftp_engine: State<'_, SftpEngineState>,
    connection_id: String,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    sftp_engine
        .list_dir(&connection_id, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_stat(
    sftp_engine: State<'_, SftpEngineState>,
    connection_id: String,
    path: String,
) -> Result<FileInfo, String> {
    sftp_engine
        .stat(&connection_id, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_mkdir(
    sftp_engine: State<'_, SftpEngineState>,
    connection_id: String,
    path: String,
) -> Result<bool, String> {
    sftp_engine
        .mkdir(&connection_id, &path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn sftp_delete(
    sftp_engine: State<'_, SftpEngineState>,
    connection_id: String,
    path: String,
    is_dir: bool,
) -> Result<bool, String> {
    if is_dir {
        sftp_engine
            .delete_dir(&connection_id, &path)
            .await
            .map_err(|e| e.to_string())?;
    } else {
        sftp_engine
            .delete_file(&connection_id, &path)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
pub async fn sftp_rename(
    sftp_engine: State<'_, SftpEngineState>,
    connection_id: String,
    old_path: String,
    new_path: String,
) -> Result<bool, String> {
    sftp_engine
        .rename(&connection_id, &old_path, &new_path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn sftp_download(
    app_handle: tauri::AppHandle,
    sftp_engine: State<'_, SftpEngineState>,
    connection_id: String,
    remote_path: String,
    local_path: String,
) -> Result<String, String> {
    let transfer_id = uuid::Uuid::new_v4().to_string();

    sftp_engine
        .download(
            &connection_id,
            &remote_path,
            &local_path,
            &transfer_id,
            &app_handle,
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(transfer_id)
}

#[tauri::command]
pub async fn sftp_upload(
    app_handle: tauri::AppHandle,
    sftp_engine: State<'_, SftpEngineState>,
    connection_id: String,
    local_path: String,
    remote_path: String,
) -> Result<String, String> {
    let transfer_id = uuid::Uuid::new_v4().to_string();

    sftp_engine
        .upload(
            &connection_id,
            &local_path,
            &remote_path,
            &transfer_id,
            &app_handle,
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(transfer_id)
}

/// List local directory entries (for the local file pane).
#[tauri::command]
pub async fn local_list_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    let mut read_dir = tokio::fs::read_dir(&path)
        .await
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| format!("Failed to read entry: {}", e))?
    {
        let metadata = entry
            .metadata()
            .await
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

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

    // Sort: directories first, then by name
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub async fn local_mkdir(path: String) -> Result<(), String> {
    tokio::fs::create_dir_all(&path)
        .await
        .map_err(|e| format!("Failed to create directory: {}", e))
}

#[tauri::command]
pub async fn local_delete(path: String) -> Result<(), String> {
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("Failed to read path: {}", e))?;
    if metadata.is_dir() {
        tokio::fs::remove_dir_all(&path)
            .await
            .map_err(|e| format!("Failed to delete directory: {}", e))
    } else {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|e| format!("Failed to delete file: {}", e))
    }
}

#[tauri::command]
pub async fn local_rename(old_path: String, new_path: String) -> Result<(), String> {
    tokio::fs::rename(&old_path, &new_path)
        .await
        .map_err(|e| format!("Failed to rename: {}", e))
}

/// Recursively list all files in a local directory
#[tauri::command]
pub async fn local_list_recursive(path: String) -> Result<Vec<(String, u64)>, String> {
    let mut files = Vec::new();
    collect_local_files(std::path::Path::new(&path), &mut files).await?;
    Ok(files)
}

fn collect_local_files<'a>(
    dir: &'a std::path::Path,
    files: &'a mut Vec<(String, u64)>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        let mut entries = tokio::fs::read_dir(dir)
            .await
            .map_err(|e| format!("Failed to read directory: {}", e))?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| format!("Failed to read entry: {}", e))?
        {
            let path = entry.path();
            let metadata = entry
                .metadata()
                .await
                .map_err(|e| format!("Failed to get metadata: {}", e))?;

            // Skip symbolic links to avoid infinite loops
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

/// Recursively list all files in a remote directory
#[tauri::command]
pub async fn sftp_list_recursive(
    engine: State<'_, SftpEngineState>,
    connection_id: String,
    path: String,
) -> Result<Vec<(String, u64)>, String> {
    // Check if connected
    if !engine.is_connected(&connection_id).await {
        return Err(format!("No SFTP session for connection: {}", connection_id));
    }

    let sftp = engine
        .get_sftp_session(&connection_id)
        .await
        .ok_or_else(|| format!("No SFTP session for connection: {}", connection_id))?;

    let mut files = Vec::new();
    collect_remote_files(sftp.as_ref(), &path, &mut files).await?;
    Ok(files)
}

fn collect_remote_files<'a>(
    sftp: &'a russh_sftp::client::SftpSession,
    dir: &'a str,
    files: &'a mut Vec<(String, u64)>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        let entries = sftp
            .read_dir(dir)
            .await
            .map_err(|e| format!("Failed to read remote directory: {}", e))?;

        for entry in entries {
            let file_name = entry.file_name();

            // Skip . and ..
            if file_name == "." || file_name == ".." {
                continue;
            }

            let full_path = if dir.ends_with('/') {
                format!("{}{}", dir, file_name)
            } else {
                format!("{}/{}", dir, file_name)
            };

            let attrs = entry.metadata();

            // Check if it's a directory (using permission bits)
            let is_dir = attrs.permissions.map(|p| p & 0o40000 != 0).unwrap_or(false);

            // Check if it's a symbolic link (to avoid infinite loops)
            let is_symlink = attrs.permissions.map(|p| p & 0o120000 != 0).unwrap_or(false);

            if is_symlink {
                continue;
            }

            if !is_dir {
                let size = attrs.size.unwrap_or(0);
                files.push((full_path, size));
            } else {
                collect_remote_files(sftp, &full_path, files).await?;
            }
        }

        Ok(())
    })
}

/// Get available drives on Windows or mount points on Unix
#[tauri::command]
pub async fn get_available_drives() -> Result<Vec<String>, String> {
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
        // On Unix-like systems, return common mount points
        Ok(vec!["/".to_string()])
    }
}
