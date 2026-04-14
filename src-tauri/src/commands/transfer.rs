use tauri::{Emitter, Manager};

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

/// 打包传输的文件数阈值：超过此数量时自动使用 tar.gz 打包模式
const ARCHIVE_THRESHOLD: usize = 50;

/// Upload an entire folder recursively
/// 智能选择传输模式：文件数 >= 50 时尝试打包传输（tar.gz + SSH 解压），否则逐文件传输
/// 命令立即返回 task_ids，传输在后台执行
#[tauri::command]
pub async fn upload_folder_recursive(
    app: tauri::AppHandle,
    connection_id: String,
    local_folder: String,
    remote_folder: String,
) -> Result<Vec<String>, String> {
    let sftp_engine = app.state::<SftpEngineState>().inner().clone();

    // 收集本地目录结构（子目录 + 文件）
    let local_base = std::path::Path::new(&local_folder);
    let mut sub_dirs = Vec::new();
    let mut files = Vec::new();
    collect_local_entries(local_base, local_base, &mut sub_dirs, &mut files)
        .await
        .map_err(|e| format!("扫描本地目录失败: {}", e))?;

    let file_count = files.len();
    log::info!(
        "[Transfer] 文件夹上传: {} 个文件, {} 个子目录, 阈值={}",
        file_count, sub_dirs.len(), ARCHIVE_THRESHOLD
    );

    // 文件数超过阈值时，尝试打包传输模式（后台执行）
    if file_count >= ARCHIVE_THRESHOLD {
        // 先检测远程是否有 tar
        let has_tar = match sftp_engine.exec_command(&connection_id, "which tar", 5).await {
            Ok((code, _)) => code == 0,
            Err(_) => false,
        };

        if has_tar {
            let transfer_id = uuid::Uuid::new_v4().to_string();
            let tid = transfer_id.clone();

            // 后台 spawn 打包传输，命令立即返回
            let bg_app = app.clone();
            let bg_engine = sftp_engine.clone();
            let bg_conn = connection_id.clone();
            let bg_local = local_folder.clone();
            let bg_remote = remote_folder.clone();
            let bg_files = files.clone();

            tokio::spawn(async move {
                if let Err(e) = upload_folder_archived(
                    &bg_app, &bg_engine, &bg_conn, &bg_local, &bg_remote, &bg_files, &tid,
                ).await {
                    log::error!("[Transfer] 打包传输失败: {}", e);
                    let _ = bg_app.emit("transfer://error", serde_json::json!({
                        "id": tid,
                        "error": format!("打包传输失败: {}", e),
                    }));
                }
            });

            return Ok(vec![transfer_id]);
        } else {
            log::warn!("[Transfer] 远程没有 tar 命令，降级为逐文件模式");
        }
    }

    // 逐文件传输模式（入队后立即返回）
    upload_folder_individual(
        &app,
        &sftp_engine,
        &connection_id,
        &remote_folder,
        &sub_dirs,
        &files,
    ).await
}

/// 打包传输模式：本地 tar.gz → SFTP 上传 → SSH 解压 → 清理
async fn upload_folder_archived(
    app: &tauri::AppHandle,
    sftp_engine: &SftpEngineState,
    connection_id: &str,
    local_folder: &str,
    remote_folder: &str,
    files: &[(String, String, u64)],
    transfer_id: &str,
) -> Result<Vec<String>, String> {
    // 计算总大小用于进度跟踪
    let total_bytes: u64 = files.iter().map(|(_, _, s)| s).sum();

    // 发送打包阶段进度
    let _ = app.emit("transfer://archive-progress", serde_json::json!({
        "id": transfer_id,
        "phase": "packing",
        "totalBytes": total_bytes,
        "fileCount": files.len(),
    }));

    // 2. 本地 tar.gz 打包（使用临时文件）
    let temp_dir = std::env::temp_dir();
    let archive_name = format!("devforge_upload_{}.tar.gz", uuid::Uuid::new_v4());
    let archive_path = temp_dir.join(&archive_name);

    log::info!("[Transfer] 开始本地打包: {} -> {}", local_folder, archive_path.display());

    create_tar_gz(local_folder, &archive_path)
        .await
        .map_err(|e| format!("本地打包失败: {}", e))?;

    let archive_size = tokio::fs::metadata(&archive_path)
        .await
        .map_err(|e| format!("获取压缩包大小失败: {}", e))?
        .len();

    log::info!(
        "[Transfer] 打包完成: 原始 {} bytes -> 压缩 {} bytes (压缩率 {:.1}%)",
        total_bytes, archive_size,
        (1.0 - archive_size as f64 / total_bytes.max(1) as f64) * 100.0
    );

    // 3. 创建远程目标目录
    let sftp = sftp_engine
        .get_sftp_session(connection_id)
        .await
        .ok_or_else(|| format!("连接 '{}' 未建立", connection_id))?;
    let _ = sftp.create_dir(remote_folder).await;

    // 4. SFTP 上传压缩包到远程临时位置
    let remote_archive = format!("{}/.devforge_upload_{}.tar.gz", remote_folder, uuid::Uuid::new_v4());

    let _ = app.emit("transfer://archive-progress", serde_json::json!({
        "id": &transfer_id,
        "phase": "uploading",
        "archiveSize": archive_size,
    }));

    // 使用现有的传输管理器上传压缩包（用 transfer_id 作为上传任务 ID，
    // 这样前端 archive-progress 任务和 transfer://progress 事件共享同一个 ID，进度能对上）
    let transfer_manager = app.state::<TransferManagerState>().inner().clone();

    let raw_sftp = sftp_engine
        .create_raw_sftp_session(connection_id)
        .await
        .map_err(|e| format!("创建流水线会话失败: {}", e))
        .ok();

    let mgr = transfer_manager.lock().await;
    mgr.start_upload(
        transfer_id.to_string(),
        archive_path.clone(),
        remote_archive.clone(),
        sftp.clone(),
        raw_sftp,
        app.clone(),
    ).await.map_err(|e| format!("上传压缩包失败: {}", e))?;
    drop(mgr);

    // 等待上传完成（轮询任务状态）
    let transfer_manager2 = app.state::<TransferManagerState>().inner().clone();
    let mut none_count = 0u32;
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let mgr = transfer_manager2.lock().await;
        match mgr.get_task_state(transfer_id) {
            Some(crate::services::transfer_manager::TransferState::Completed) => break,
            Some(crate::services::transfer_manager::TransferState::Failed { error }) => {
                let _ = tokio::fs::remove_file(&archive_path).await;
                return Err(format!("上传压缩包失败: {}", error));
            }
            None => {
                // 任务可能已完成并被清理，等几轮确认
                none_count += 1;
                if none_count >= 3 { break; }
            }
            _ => { none_count = 0; continue; }
        }
    }

    // 清理本地临时文件
    let _ = tokio::fs::remove_file(&archive_path).await;

    // 5. SSH 解压（先验证远程文件存在）
    let verify_cmd = format!("test -f '{}' && echo OK", remote_archive.replace('\'', "'\\''"));
    let (_verify_code, verify_out) = sftp_engine
        .exec_command(connection_id, &verify_cmd, 10)
        .await
        .map_err(|e| format!("验证远程文件失败: {}", e))?;

    if !verify_out.contains("OK") {
        return Err(format!("远程压缩包不存在或不可读: {}", remote_archive));
    }

    let _ = app.emit("transfer://archive-progress", serde_json::json!({
        "id": &transfer_id,
        "phase": "extracting",
    }));

    log::info!("[Transfer] 开始远程解压: {}", remote_archive);

    let extract_cmd = format!(
        "cd '{}' && tar xzf '{}' && rm -f '{}'",
        remote_folder.replace('\'', "'\\''"),
        remote_archive.replace('\'', "'\\''"),
        remote_archive.replace('\'', "'\\''"),
    );

    let (exit_code, output) = sftp_engine
        .exec_command(connection_id, &extract_cmd, 300)
        .await
        .map_err(|e| format!("远程解压失败: {}", e))?;

    // exit_code == -1 表示 SSH 服务器未发送 ExitStatus（某些服务器行为），
    // 此时如果 output 无错误内容，视为成功
    if exit_code != 0 && exit_code != -1 {
        // 明确的非零退出码，一定是失败
        let _ = sftp_engine.exec_command(
            connection_id,
            &format!("rm -f '{}'", remote_archive.replace('\'', "'\\''"),),
            10,
        ).await;
        return Err(format!("远程解压失败 (exit={}): {}", exit_code, output));
    }

    if exit_code == -1 {
        // 未收到 ExitStatus，通过检查远程文件是否存在来验证解压结果
        log::warn!("[Transfer] 解压命令未返回退出码，验证解压结果...");
        let verify_extract = format!(
            "ls '{}' | head -1",
            remote_folder.replace('\'', "'\\''")
        );
        let (v_code, v_out) = sftp_engine
            .exec_command(connection_id, &verify_extract, 10)
            .await
            .unwrap_or((-1, String::new()));

        if v_code != 0 && v_out.trim().is_empty() {
            let _ = sftp_engine.exec_command(
                connection_id,
                &format!("rm -f '{}'", remote_archive.replace('\'', "'\\''"),),
                10,
            ).await;
            return Err(format!("远程解压可能失败（未收到退出码）: {}", output));
        }
        log::info!("[Transfer] 解压验证通过（目录非空）");
    }

    let _ = app.emit("transfer://archive-progress", serde_json::json!({
        "id": &transfer_id,
        "phase": "completed",
        "fileCount": files.len(),
        "originalSize": total_bytes,
        "archiveSize": archive_size,
    }));

    log::info!("[Transfer] 打包传输完成: {} 个文件", files.len());

    Ok(vec![transfer_id.to_string()])
}

/// 逐文件传输模式（fallback）
async fn upload_folder_individual(
    app: &tauri::AppHandle,
    sftp_engine: &SftpEngineState,
    connection_id: &str,
    remote_folder: &str,
    sub_dirs: &[String],
    files: &[(String, String, u64)],
) -> Result<Vec<String>, String> {
    let transfer_manager = app.state::<TransferManagerState>().inner().clone();

    let sftp = sftp_engine
        .get_sftp_session(connection_id)
        .await
        .ok_or_else(|| format!("连接 '{}' 未建立", connection_id))?;

    // 创建远程根目录
    let _ = sftp.create_dir(remote_folder).await;

    // 按深度顺序创建所有子目录
    for sub_dir in sub_dirs {
        let remote_dir = if remote_folder.ends_with('/') {
            format!("{}{}", remote_folder, sub_dir.replace('\\', "/"))
        } else {
            format!("{}/{}", remote_folder, sub_dir.replace('\\', "/"))
        };
        let _ = sftp.create_dir(&remote_dir).await;
    }

    if files.is_empty() {
        return Ok(vec![]);
    }

    // 入队所有文件上传任务
    const SMALL_FILE_THRESHOLD: u64 = 1024 * 1024; // 1MB

    let mgr = transfer_manager.lock().await;
    let mut task_ids = Vec::new();

    for (local_path, relative, size) in files {
        let remote_path = if remote_folder.ends_with('/') {
            format!("{}{}", remote_folder, relative.replace('\\', "/"))
        } else {
            format!("{}/{}", remote_folder, relative.replace('\\', "/"))
        };

        let id = uuid::Uuid::new_v4().to_string();

        // 提取文件名用于前端显示
        let file_name = std::path::Path::new(relative)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| relative.clone());

        // 通知前端注册任务到传输面板
        let _ = app.emit("transfer://task-added", serde_json::json!({
            "id": &id,
            "type": "upload",
            "fileName": file_name,
            "localPath": local_path,
            "remotePath": &remote_path,
            "connectionId": connection_id,
            "totalBytes": size,
        }));

        let raw_sftp = if *size >= SMALL_FILE_THRESHOLD {
            sftp_engine
                .create_raw_sftp_session(connection_id)
                .await
                .map_err(|e| format!("创建流水线会话失败: {}", e))
                .ok()
        } else {
            None
        };

        mgr.enqueue_transfer(
            id.clone(),
            TransferType::Upload {
                local_path: PathBuf::from(local_path),
                remote_path,
            },
            connection_id.to_string(),
            sftp.clone(),
            raw_sftp,
            *size,
        );
        task_ids.push(id);
    }

    Ok(task_ids)
}

/// 创建 tar.gz 压缩包（异步，在阻塞线程池中执行）
async fn create_tar_gz(
    source_dir: &str,
    output_path: &std::path::Path,
) -> Result<(), String> {
    let source = source_dir.to_string();
    let output = output_path.to_path_buf();

    tokio::task::spawn_blocking(move || {
        use std::fs::File;
        use std::io::BufWriter;

        let file = File::create(&output)
            .map_err(|e| format!("创建压缩包文件失败: {}", e))?;
        let writer = BufWriter::new(file);
        let encoder = flate2::write::GzEncoder::new(writer, flate2::Compression::fast());
        let mut archive = tar::Builder::new(encoder);

        // 将源目录内容添加到归档中（不包含根目录名）
        let source_path = std::path::Path::new(&source);
        for entry in walkdir::WalkDir::new(&source).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            let relative = path.strip_prefix(source_path).unwrap_or(path);

            if relative.as_os_str().is_empty() {
                continue; // 跳过根目录自身
            }

            // Windows → Linux: 反斜杠转正斜杠，确保 tar 归档内路径是 Unix 格式
            let unix_relative = relative.to_string_lossy().replace('\\', "/");
            let unix_path = std::path::Path::new(&unix_relative);

            if path.is_file() {
                archive.append_path_with_name(path, unix_path)
                    .map_err(|e| format!("添加文件到归档失败 {}: {}", unix_relative, e))?;
            } else if path.is_dir() {
                archive.append_dir(unix_path, path)
                    .map_err(|e| format!("添加目录到归档失败 {}: {}", unix_relative, e))?;
            }
        }

        archive.into_inner()
            .map_err(|e| format!("完成归档失败: {}", e))?
            .finish()
            .map_err(|e| format!("完成压缩失败: {}", e))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("打包任务异常: {}", e))?
}

/// 递归收集本地目录的子目录和文件
fn collect_local_entries<'a>(
    base: &'a std::path::Path,
    dir: &'a std::path::Path,
    sub_dirs: &'a mut Vec<String>,
    files: &'a mut Vec<(String, String, u64)>,  // (绝对路径, 相对路径, 大小)
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), std::io::Error>> + Send + 'a>> {
    Box::pin(async move {
        let mut entries = tokio::fs::read_dir(dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let metadata = entry.metadata().await?;

            if metadata.is_symlink() {
                continue;
            }

            let relative = path.strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();

            if metadata.is_dir() {
                sub_dirs.push(relative);
                collect_local_entries(base, &path, sub_dirs, files).await?;
            } else if metadata.is_file() {
                let abs = path.to_string_lossy().to_string();
                files.push((abs, relative, metadata.len()));
            }
        }
        Ok(())
    })
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

    // 即使文件列表为空，也要创建本地根目录（空文件夹也应下载）
    tokio::fs::create_dir_all(&local_folder)
        .await
        .map_err(|e| format!("Failed to create directory: {}", e))?;

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

        // 提取文件名用于前端显示
        let file_name = std::path::Path::new(&remote_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| remote_path.clone());

        // 通知前端注册任务到传输面板
        let _ = app.emit("transfer://task-added", serde_json::json!({
            "id": &id,
            "type": "download",
            "fileName": file_name,
            "localPath": &local_path,
            "remotePath": &remote_path,
            "connectionId": &connection_id,
            "totalBytes": size,
        }));

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
