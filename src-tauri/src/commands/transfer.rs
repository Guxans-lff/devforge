use tauri::Manager;

use crate::commands::sftp::SftpEngineState;
use crate::services::transfer_manager::{TransferManagerState, TransferType};
use std::path::PathBuf;

/// 开始分块上传文件
#[tauri::command]
pub async fn start_upload_chunked(
    app_handle: tauri::AppHandle,
    id: String,
    local_path: String,
    remote_path: String,
    connection_id: String,
) -> Result<(), String> {
    let transfer_manager = app_handle.state::<TransferManagerState>().inner().clone();
    let sftp_engine = app_handle.state::<SftpEngineState>().inner().clone();
    
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

    // 创建流水线上传用的 RawSftpSession (10s 超时保护)
    let raw_sftp = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        sftp_engine.create_raw_sftp_session(&connection_id)
    ).await
    .map_err(|e| format!("创建会话超时: {}", e))?
    .map_err(|e| format!("创建流水线会话失败: {}", e))
    .ok();

    log::info!("Starting upload task: id={}, connection={}", id, connection_id);

    // 启动上传任务
    let manager = transfer_manager.lock().await;
    manager
        .start_upload(id, local_path.into(), remote_path, sftp, raw_sftp, app_handle)
        .await
}

/// 开始分块下载文件
#[tauri::command]
pub async fn start_download_chunked(
    app_handle: tauri::AppHandle,
    id: String,
    remote_path: String,
    local_path: String,
    connection_id: String,
) -> Result<(), String> {
    let transfer_manager = app_handle.state::<TransferManagerState>().inner().clone();
    let sftp_engine = app_handle.state::<SftpEngineState>().inner().clone();

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

    log::info!("Starting download task: id={}, connection={}", id, connection_id);
    // 启动下载任务
    let manager = transfer_manager.lock().await;
    manager
        .start_download(id, remote_path, local_path.into(), sftp, app_handle)
        .await
}

#[tauri::command]
pub async fn pause_transfer(
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let transfer_manager = app_handle.state::<TransferManagerState>().inner().clone();
    if id.is_empty() {
        return Err("传输 ID 不能为空".to_string());
    }

    log::info!("Pausing task: id={}", id);
    let manager = transfer_manager.lock().await;
    manager.pause_task(&id, &app_handle)
}

/// 恢复传输任务
#[tauri::command]
pub async fn resume_transfer(
    app_handle: tauri::AppHandle,
    id: String,
    connection_id: String,
) -> Result<(), String> {
    let transfer_manager = app_handle.state::<TransferManagerState>().inner().clone();
    let sftp_engine = app_handle.state::<SftpEngineState>().inner().clone();
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

    // 为恢复任务尝试创建流水线会话 (10s 超时保护)
    let raw_sftp = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        sftp_engine.create_raw_sftp_session(&connection_id)
    ).await
    .map_err(|e| format!("创建会话超时: {}", e))?
    .map_err(|e| format!("创建会话失败: {}", e))
    .ok();

    log::info!("Resuming task: id={}, connection={}", id, connection_id);

    // 恢复任务
    let manager = transfer_manager.lock().await;
    manager.resume_task(&id, sftp, raw_sftp, app_handle).await
}

/// 取消传输任务
#[tauri::command]
pub async fn cancel_transfer(
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let transfer_manager = app_handle.state::<TransferManagerState>().inner().clone();
    if id.is_empty() {
        return Err("传输 ID 不能为空".to_string());
    }

    log::info!("Cancelling task: id={}", id);
    let manager = transfer_manager.lock().await;
    manager.cancel_task(&id, &app_handle)
}

/// 批量加入上传任务到队列
#[tauri::command]
pub async fn enqueue_batch_upload(
    app: tauri::AppHandle,
    connection_id: String,
    files: Vec<(String, String, u64)>, // (local_path, remote_path, size)
) -> Result<Vec<String>, String> {
    let transfer_manager = app.state::<TransferManagerState>().inner().clone();
    let sftp_engine = app.state::<SftpEngineState>().inner().clone();
    if connection_id.is_empty() {
        return Err("连接 ID 不能为空".to_string());
    }

    // 获取 SFTP 会话
    let sftp = sftp_engine
        .get_sftp_session(&connection_id)
        .await
        .ok_or_else(|| format!("连接 '{}' 未建立", connection_id))?;

    // 为每个上传任务创建流水线会话
    let mut task_ids = Vec::new();
    let manager = transfer_manager.lock().await;

    for (local_path, remote_path, size) in files {
        let id = uuid::Uuid::new_v4().to_string();

        // 每个上传任务创建独立的 RawSftpSession
        let raw_sftp = sftp_engine
            .create_raw_sftp_session(&connection_id)
            .await
            .map_err(|e| format!("创建流水线会话失败: {}", e))
            .ok();

        manager.enqueue_transfer(
            id.clone(),
            TransferType::Upload {
                local_path: PathBuf::from(local_path),
                remote_path,
            },
            connection_id.clone(),
            sftp.clone(),
            raw_sftp,
            size,
        );
        task_ids.push(id);
    }

    Ok(task_ids)
}

/// 批量加入下载任务到队列
#[tauri::command]
pub async fn enqueue_batch_download(
    app: tauri::AppHandle,
    connection_id: String,
    files: Vec<(String, String, u64)>, // (remote_path, local_path, size)
) -> Result<Vec<String>, String> {
    let transfer_manager = app.state::<TransferManagerState>().inner().clone();
    let sftp_engine = app.state::<SftpEngineState>().inner().clone();
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
            None, // 下载不需要流水线
            size,
        );
        task_ids.push(id);
    }

    Ok(task_ids)
}

/// 获取队列状态
#[tauri::command]
pub async fn get_queue_status(
    app: tauri::AppHandle,
) -> Result<(usize, usize), String> {
    let transfer_manager = app.state::<TransferManagerState>().inner().clone();
    let manager = transfer_manager.lock().await;
    Ok(manager.get_queue_status())
}

/// Upload an entire folder recursively
#[tauri::command]
pub async fn upload_folder_recursive(
    app: tauri::AppHandle,
    connection_id: String,
    local_folder: String,
    remote_folder: String,
) -> Result<Vec<String>, String> {
    let transfer_manager = app.state::<TransferManagerState>().inner().clone();
    let sftp_engine = app.state::<SftpEngineState>().inner().clone();
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

        // 每个上传任务创建独立的 RawSftpSession
        let raw_sftp = sftp_engine
            .create_raw_sftp_session(&connection_id)
            .await
            .map_err(|e| format!("创建流水线会话失败: {}", e))
            .ok();

        mgr.enqueue_transfer(
            id.clone(),
            TransferType::Upload {
                local_path: PathBuf::from(local_path),
                remote_path,
            },
            connection_id.clone(),
            sftp.clone(),
            raw_sftp,
            size,
        );
        task_ids.push(id);
    }

    Ok(task_ids)
}

/// Download an entire folder recursively
#[tauri::command]
pub async fn download_folder_recursive(
    app: tauri::AppHandle,
    connection_id: String,
    remote_folder: String,
    local_folder: String,
) -> Result<Vec<String>, String> {
    let transfer_manager = app.state::<TransferManagerState>().inner().clone();
    let sftp_engine = app.state::<SftpEngineState>().inner().clone();
    // Get all files in remote folder
    let files = crate::commands::sftp::sftp_list_recursive(
        app.clone(),
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
            None, // 下载不需要流水线
            size,
        );
        task_ids.push(id);
    }

    Ok(task_ids)
}
