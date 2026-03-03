use tauri::State;

use crate::commands::sftp::SftpEngineState;
use crate::services::transfer_manager::{TransferManagerState, TransferType};
use std::path::PathBuf;

/// 开始分块上传文件
#[tauri::command]
pub async fn start_upload_chunked(
    id: String,
    local_path: String,
    remote_path: String,
    connection_id: String,
    transfer_manager: State<'_, TransferManagerState>,
    sftp_engine: State<'_, SftpEngineState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // 参数验证
    if id.is_empty() {
        return Err("传输 ID 不能为空".to_string());
    }
    if local_path.is_empty() {
        return Err("本地路径不能为空".to_string());
    }
    if remote_path.is_empty() {
        return Err("远程路径不能为空".to_string());
    }
    if connection_id.is_empty() {
        return Err("连接 ID 不能为空".to_string());
    }

    // 获取 SFTP 会话
    let sftp = sftp_engine
        .get_sftp_session(&connection_id)
        .await
        .ok_or_else(|| format!("连接 '{}' 未建立", connection_id))?;

    // 启动上传任务
    let manager = transfer_manager.lock().await;
    manager
        .start_upload(id, local_path.into(), remote_path, sftp, app_handle)
        .await
}

/// 开始分块下载文件
#[tauri::command]
pub async fn start_download_chunked(
    id: String,
    remote_path: String,
    local_path: String,
    connection_id: String,
    transfer_manager: State<'_, TransferManagerState>,
    sftp_engine: State<'_, SftpEngineState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // 参数验证
    if id.is_empty() {
        return Err("传输 ID 不能为空".to_string());
    }
    if remote_path.is_empty() {
        return Err("远程路径不能为空".to_string());
    }
    if local_path.is_empty() {
        return Err("本地路径不能为空".to_string());
    }
    if connection_id.is_empty() {
        return Err("连接 ID 不能为空".to_string());
    }

    // 获取 SFTP 会话
    let sftp = sftp_engine
        .get_sftp_session(&connection_id)
        .await
        .ok_or_else(|| format!("连接 '{}' 未建立", connection_id))?;

    // 启动下载任务
    let manager = transfer_manager.lock().await;
    manager
        .start_download(id, remote_path, local_path.into(), sftp, app_handle)
        .await
}

/// 暂停传输任务
#[tauri::command]
pub async fn pause_transfer(
    id: String,
    transfer_manager: State<'_, TransferManagerState>,
) -> Result<(), String> {
    if id.is_empty() {
        return Err("传输 ID 不能为空".to_string());
    }

    let manager = transfer_manager.lock().await;
    manager.pause_task(&id)
}

/// 恢复传输任务
#[tauri::command]
pub async fn resume_transfer(
    id: String,
    connection_id: String,
    transfer_manager: State<'_, TransferManagerState>,
    sftp_engine: State<'_, SftpEngineState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    if id.is_empty() {
        return Err("传输 ID 不能为空".to_string());
    }
    if connection_id.is_empty() {
        return Err("连接 ID 不能为空".to_string());
    }

    // 获取 SFTP 会话
    let sftp = sftp_engine
        .get_sftp_session(&connection_id)
        .await
        .ok_or_else(|| format!("连接 '{}' 未建立", connection_id))?;

    // 恢复任务
    let manager = transfer_manager.lock().await;
    manager.resume_task(&id, sftp, app_handle).await
}

/// 取消传输任务
#[tauri::command]
pub async fn cancel_transfer(
    id: String,
    transfer_manager: State<'_, TransferManagerState>,
) -> Result<(), String> {
    if id.is_empty() {
        return Err("传输 ID 不能为空".to_string());
    }

    let manager = transfer_manager.lock().await;
    manager.cancel_task(&id)
}

/// 批量加入上传任务到队列
#[tauri::command]
pub async fn enqueue_batch_upload(
    connection_id: String,
    files: Vec<(String, String, u64)>, // (local_path, remote_path, size)
    transfer_manager: State<'_, TransferManagerState>,
    sftp_engine: State<'_, SftpEngineState>,
) -> Result<Vec<String>, String> {
    if connection_id.is_empty() {
        return Err("连接 ID 不能为空".to_string());
    }

    // 获取 SFTP 会话
    let sftp = sftp_engine
        .get_sftp_session(&connection_id)
        .await
        .ok_or_else(|| format!("连接 '{}' 未建立", connection_id))?;

    let mut task_ids = Vec::new();
    let manager = transfer_manager.lock().await;

    for (local_path, remote_path, size) in files {
        let id = uuid::Uuid::new_v4().to_string();
        manager.enqueue_transfer(
            id.clone(),
            TransferType::Upload {
                local_path: PathBuf::from(local_path),
                remote_path,
            },
            connection_id.clone(),
            sftp.clone(),
            size,
        );
        task_ids.push(id);
    }

    Ok(task_ids)
}

/// 批量加入下载任务到队列
#[tauri::command]
pub async fn enqueue_batch_download(
    connection_id: String,
    files: Vec<(String, String, u64)>, // (remote_path, local_path, size)
    transfer_manager: State<'_, TransferManagerState>,
    sftp_engine: State<'_, SftpEngineState>,
) -> Result<Vec<String>, String> {
    if connection_id.is_empty() {
        return Err("连接 ID 不能为空".to_string());
    }

    // 获取 SFTP 会话
    let sftp = sftp_engine
        .get_sftp_session(&connection_id)
        .await
        .ok_or_else(|| format!("连接 '{}' 未建立", connection_id))?;

    let mut task_ids = Vec::new();
    let manager = transfer_manager.lock().await;

    for (remote_path, local_path, size) in files {
        let id = uuid::Uuid::new_v4().to_string();
        manager.enqueue_transfer(
            id.clone(),
            TransferType::Download {
                remote_path,
                local_path: PathBuf::from(local_path),
            },
            connection_id.clone(),
            sftp.clone(),
            size,
        );
        task_ids.push(id);
    }

    Ok(task_ids)
}

/// 获取队列状态
#[tauri::command]
pub async fn get_queue_status(
    transfer_manager: State<'_, TransferManagerState>,
) -> Result<(usize, usize), String> {
    let manager = transfer_manager.lock().await;
    Ok(manager.get_queue_status())
}

/// Upload an entire folder recursively
#[tauri::command]
pub async fn upload_folder_recursive(
    transfer_manager: State<'_, TransferManagerState>,
    sftp_engine: State<'_, SftpEngineState>,
    connection_id: String,
    local_folder: String,
    remote_folder: String,
) -> Result<Vec<String>, String> {
    // Get all files in local folder
    let files = crate::commands::sftp::local_list_recursive(local_folder.clone()).await?;

    if files.is_empty() {
        return Ok(vec![]);
    }

    // Get SFTP session
    let sftp = sftp_engine
        .get_sftp_session(&connection_id)
        .await
        .ok_or_else(|| format!("连接 '{}' 未建立", connection_id))?;

    // Prepare batch upload
    let local_base = std::path::Path::new(&local_folder);
    let mut batch_files = Vec::new();

    for (local_path, size) in files {
        let local_path_obj = std::path::Path::new(&local_path);

        // Calculate relative path
        let relative = local_path_obj
            .strip_prefix(local_base)
            .map_err(|e| format!("Failed to calculate relative path: {}", e))?;

        // Build remote path (convert Windows backslashes to forward slashes)
        let remote_path = if remote_folder.ends_with('/') {
            format!(
                "{}{}",
                remote_folder,
                relative.to_string_lossy().replace('\\', "/")
            )
        } else {
            format!(
                "{}/{}",
                remote_folder,
                relative.to_string_lossy().replace('\\', "/")
            )
        };

        batch_files.push((local_path, remote_path, size));
    }

    // Enqueue all files
    let mgr = transfer_manager.lock().await;
    let mut task_ids = Vec::new();

    for (local_path, remote_path, size) in batch_files {
        let id = uuid::Uuid::new_v4().to_string();
        mgr.enqueue_transfer(
            id.clone(),
            TransferType::Upload {
                local_path: PathBuf::from(local_path),
                remote_path,
            },
            connection_id.clone(),
            sftp.clone(),
            size,
        );
        task_ids.push(id);
    }

    Ok(task_ids)
}

/// Download an entire folder recursively
#[tauri::command]
pub async fn download_folder_recursive(
    transfer_manager: State<'_, TransferManagerState>,
    sftp_engine: State<'_, SftpEngineState>,
    connection_id: String,
    remote_folder: String,
    local_folder: String,
) -> Result<Vec<String>, String> {
    // Get all files in remote folder
    let files = crate::commands::sftp::sftp_list_recursive(
        sftp_engine.clone(),
        connection_id.clone(),
        remote_folder.clone(),
    )
    .await?;

    if files.is_empty() {
        return Ok(vec![]);
    }

    // Get SFTP session
    let sftp = sftp_engine
        .get_sftp_session(&connection_id)
        .await
        .ok_or_else(|| format!("连接 '{}' 未建立", connection_id))?;

    // Prepare batch download
    let mut batch_files = Vec::new();

    for (remote_path, size) in files {
        // Calculate relative path
        let relative = remote_path
            .strip_prefix(&remote_folder)
            .unwrap_or(&remote_path)
            .trim_start_matches('/');

        // Build local path
        let local_path = std::path::Path::new(&local_folder).join(relative);

        // Create parent directories
        if let Some(parent) = local_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        batch_files.push((remote_path, local_path.to_string_lossy().to_string(), size));
    }

    // Enqueue all files
    let mgr = transfer_manager.lock().await;
    let mut task_ids = Vec::new();

    for (remote_path, local_path, size) in batch_files {
        let id = uuid::Uuid::new_v4().to_string();
        mgr.enqueue_transfer(
            id.clone(),
            TransferType::Download {
                remote_path,
                local_path: PathBuf::from(local_path),
            },
            connection_id.clone(),
            sftp.clone(),
            size,
        );
        task_ids.push(id);
    }

    Ok(task_ids)
}
