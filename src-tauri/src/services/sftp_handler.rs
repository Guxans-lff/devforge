use std::path::PathBuf;
use std::sync::Arc;

use russh_sftp::client::rawsession::RawSftpSession;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::models::transfer::{CompleteEvent, TransferError};
use crate::services::file_chunker::FileChunker;
use crate::services::progress_tracker::ProgressTracker;

/// 预读 channel 容量（实现读写并行的关键：读线程最多提前读 4 个 chunk）
const PREFETCH_BUFFER_SIZE: usize = 4;

/// 流水线并发写请求数（同时在飞的 SSH_FXP_WRITE 请求数量）
/// 32 个并发 × 255KB ≈ 8MB 在飞数据，充分利用 64MB SSH 窗口
const PIPELINE_DEPTH: usize = 32;

/// 单次 SFTP 写入最大长度（russh-sftp 的 MAX_WRITE_LENGTH = 261120 ≈ 255KB）
const MAX_WRITE_LEN: usize = 261120;

/// SFTP 处理器 - 负责分块上传和下载
/// 
/// 设计原则：
/// - 不对单个 chunk 设硬超时，只要连接存活就持续传输（与 Xftp 行为一致）
/// - 连接断开由 SSH 层的 keepalive 和 TCP 超时自动检测
/// - 通过 CancellationToken 支持用户主动取消
/// - 上传使用 RawSftpSession 流水线写入，绕过串行 request-response 瓶颈
pub struct SftpHandler {
    sftp: Arc<SftpSession>,
    /// 用于流水线上传的 RawSftpSession（可选，没有时回退到普通上传）
    raw_sftp: Option<Arc<RawSftpSession>>,
}

impl SftpHandler {
    /// 创建新的 SFTP 处理器
    pub fn new(sftp: Arc<SftpSession>) -> Self {
        Self { sftp, raw_sftp: None }
    }

    /// 创建带流水线能力的 SFTP 处理器
    pub fn with_raw_session(sftp: Arc<SftpSession>, raw_sftp: Arc<RawSftpSession>) -> Self {
        Self { sftp, raw_sftp: Some(raw_sftp) }
    }

    /// 分块上传文件（自动选择流水线或普通模式）
    pub async fn upload_chunked(
        &self,
        local_path: PathBuf,
        remote_path: String,
        chunk_size: usize,
        progress_tracker: Arc<ProgressTracker>,
        cancel_token: CancellationToken,
        app_handle: &AppHandle,
    ) -> Result<(), TransferError> {
        // 如果有 RawSftpSession，使用流水线上传
        if let Some(raw_sftp) = &self.raw_sftp {
            return self.upload_pipelined(
                raw_sftp.clone(),
                local_path,
                remote_path,
                0, // 初始上传从 0 开始
                chunk_size,
                progress_tracker,
                cancel_token,
                app_handle,
            ).await;
        }

        // 回退到普通上传
        self.upload_chunked_legacy(
            local_path, remote_path, chunk_size,
            progress_tracker, cancel_token, app_handle,
        ).await
    }

    /// 流水线上传 — 核心优化方法
    /// 
    /// 原理：绕过 russh-sftp File 的串行 AsyncWrite（每次 write 等待 STATUS 响应），
    /// 直接使用 RawSftpSession::write() 并发发送多个 SSH_FXP_WRITE 请求。
    /// 
    /// 架构：三级流水线
    /// 1. 磁盘读取线程 → piece_tx channel → 切片后的 (offset, data) 小片
    /// 2. 写入调度循环：从 channel 取小片，通过信号量控制并发，spawn 写入任务
    /// 3. 进度收集：写入完成后通过 done_tx 通知主循环更新进度
    /// 
    /// 关键改进：不再按 chunk 批次等待，而是持续保持 PIPELINE_DEPTH 个请求在飞
    #[allow(clippy::too_many_arguments)]
    async fn upload_pipelined(
        &self,
        raw_sftp: Arc<RawSftpSession>,
        local_path: PathBuf,
        remote_path: String,
        offset: u64,
        chunk_size: usize,
        progress_tracker: Arc<ProgressTracker>,
        cancel_token: CancellationToken,
        app_handle: &AppHandle,
    ) -> Result<(), TransferError> {
        // 立即发送首次进度事件
        progress_tracker.emit_progress_force(app_handle)
            .map_err(TransferError::IoError)?;

        // 通过 RawSftpSession 打开远程文件
        // 如果 offset > 0，则使用 APPEND 模式；否则 TRUNCATE
        let flags = if offset > 0 {
            OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::APPEND
        } else {
            OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE
        };

        let handle = raw_sftp
            .open(
                remote_path.clone(),
                flags,
                FileAttributes::default(),
            )
            .await
            .map_err(|e| TransferError::SftpError(format!("打开远程文件失败: {}", e)))?;
        let handle_str = handle.handle;

        // 如果 offset > 0 且使用的不是 APPEND，可能需要显式 seek。
        // 但在大多数 SFTP 服务器上，APPEND 结合 write(offset) 可能有冲突，
        // 建议 offset > 0 时直接 open 并让后续 write 携带 offset。
        // 注意：russh-sftp 的 RawSftpSession::write(handle, offset, data) 是自带 offset 的。

        // piece channel：读取线程切片后直接发送 (offset, data) 小片
        let (piece_tx, piece_rx) = mpsc::channel::<(u64, Vec<u8>)>(PIPELINE_DEPTH * 2);
        let (done_tx, done_rx) = mpsc::channel::<Result<u64, TransferError>>(PIPELINE_DEPTH * 2);

        let read_cancel = cancel_token.clone();
        let read_path = local_path.clone();

        // === 阶段 1：磁盘读取 + 切片线程 ===
        let read_handle = tokio::task::spawn_blocking(move || {
            let mut chunker = FileChunker::new(read_path, chunk_size)
                .map_err(|e| TransferError::IoError(e.to_string()))?;
            
            // 如果从偏移量开始
            if offset > 0 {
                chunker.seek(offset).map_err(|e| TransferError::IoError(e.to_string()))?;
            }

            let mut file_offset: u64 = offset;

            loop {
                if read_cancel.is_cancelled() {
                    return Ok::<(), TransferError>(());
                }
                match chunker.read_next_chunk() {
                    Ok(Some(chunk)) => {
                        // 将大 chunk 切成 ≤MAX_WRITE_LEN 的小片，逐个发送
                        for slice in chunk.chunks(MAX_WRITE_LEN) {
                            if read_cancel.is_cancelled() {
                                return Ok(());
                            }
                            let piece = (file_offset, slice.to_vec());
                            file_offset += slice.len() as u64;
                            if piece_tx.blocking_send(piece).is_err() {
                                return Ok(());
                            }
                        }
                    }
                    Ok(None) => return Ok(()),
                    Err(e) => return Err(TransferError::IoError(e.to_string())),
                }
            }
        });

        // === 阶段 2：写入调度任务 ===
        // 用信号量控制并发深度，持续从 piece_rx 取数据并 spawn 写入
        let write_sftp = raw_sftp.clone();
        let write_handle_str = handle_str.clone();
        let write_cancel = cancel_token.clone();
        let semaphore = Arc::new(tokio::sync::Semaphore::new(PIPELINE_DEPTH));

        let writer_task = tokio::spawn(async move {
            let mut piece_rx = piece_rx;
            while let Some((offset, data)) = piece_rx.recv().await {
                if write_cancel.is_cancelled() {
                    break;
                }

                // 获取信号量许可（等待有空闲槽位）
                let permit = semaphore.clone().acquire_owned().await
                    .map_err(|_| TransferError::IoError("信号量关闭".to_string()));
                let permit = match permit {
                    Ok(p) => p,
                    Err(e) => {
                        let _ = done_tx.send(Err(e)).await;
                        break;
                    }
                };

                let raw = write_sftp.clone();
                let h = write_handle_str.clone();
                let dtx = done_tx.clone();

                tokio::spawn(async move {
                    let len = data.len() as u64;
                    let result = raw.write(h, offset, data).await;
                    // 释放信号量许可
                    drop(permit);

                    let msg = match result {
                        Ok(_) => Ok(len),
                        Err(e) => Err(TransferError::SftpError(format!("流水线写入失败: {}", e))),
                    };
                    let _ = dtx.send(msg).await;
                });
            }
            // writer 结束，drop done_tx 的克隆（原始 done_tx 在这里也 drop）
        });

        // === 阶段 3：进度收集循环 ===
        // done_tx 已经 move 到 writer_task 中，当 writer_task 结束时自动 drop
        // 届时 done_rx.recv() 会返回 None，循环自然结束

        let mut done_rx = done_rx;
        let mut error: Option<TransferError> = None;

        while let Some(result) = done_rx.recv().await {
            match result {
                Ok(written) => {
                    progress_tracker.update(written);
                    // 只有在未取消的情况下才通知前端更新 UI，防止暂停后 UI 继续跳动
                    if !cancel_token.is_cancelled() {
                        progress_tracker.emit_progress(app_handle)
                            .map_err(TransferError::IoError)?;
                    }
                }
                Err(e) => {
                    error = Some(e);
                    cancel_token.cancel();
                    break;
                }
            }
        }

        // 等待写入调度任务完成
        let _ = writer_task.await;

        // 等待读取线程完成
        match read_handle.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                if error.is_none() { error = Some(e); }
            }
            Err(e) => {
                if error.is_none() {
                    error = Some(TransferError::IoError(format!("读取线程异常: {}", e)));
                }
            }
        }

        // 关闭远程文件句柄
        let _ = raw_sftp.close(handle_str).await;
        
        // 如果被取消且不是因为报错，则正常退出，不再删除文件
        if cancel_token.is_cancelled() && error.is_none() {
            return Ok(());
        }
 
        // 如果有错误，清理远程文件并返回
        if let Some(e) = error {
            let _ = raw_sftp.remove(remote_path).await;
            return Err(e);
        }

        // 如果被取消，不再发送完成事件
        if cancel_token.is_cancelled() {
            return Ok(());
        }

        // 发送最终进度和完成事件
        progress_tracker.emit_progress_force(app_handle)
            .map_err(TransferError::IoError)?;

        let _ = app_handle.emit(
            "transfer://complete",
            CompleteEvent { id: progress_tracker.task_id().to_string() },
        );

        Ok(())
    }

    /// 普通分块上传（回退方案，无 RawSftpSession 时使用）
    async fn upload_chunked_legacy(
        &self,
        local_path: PathBuf,
        remote_path: String,
        chunk_size: usize,
        progress_tracker: Arc<ProgressTracker>,
        cancel_token: CancellationToken,
        app_handle: &AppHandle,
    ) -> Result<(), TransferError> {
        progress_tracker.emit_progress_force(app_handle)
            .map_err(TransferError::IoError)?;

        let mut remote_file = self.sftp
            .open_with_flags(
                &remote_path,
                OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE,
            )
            .await
            .map_err(|e| TransferError::SftpError(e.to_string()))?;

        let (tx, mut rx) = mpsc::channel::<Vec<u8>>(PREFETCH_BUFFER_SIZE);
        let read_cancel = cancel_token.clone();
        let read_path = local_path.clone();

        let read_handle = tokio::task::spawn_blocking(move || {
            let mut chunker = FileChunker::new(read_path, chunk_size)
                .map_err(|e| TransferError::IoError(e.to_string()))?;
            loop {
                if read_cancel.is_cancelled() {
                    return Ok::<(), TransferError>(());
                }
                match chunker.read_next_chunk() {
                    Ok(Some(chunk)) => {
                        if tx.blocking_send(chunk).is_err() { return Ok(()); }
                    }
                    Ok(None) => return Ok(()),
                    Err(e) => return Err(TransferError::IoError(e.to_string())),
                }
            }
        });

        while let Some(chunk) = rx.recv().await {
            if cancel_token.is_cancelled() {
                return Ok(());
            }

            let mut offset = 0;
            while offset < chunk.len() {
                if cancel_token.is_cancelled() {
                    return Ok(());
                }
                let written = remote_file.write(&chunk[offset..])
                    .await
                    .map_err(|e| {
                        let sftp = self.sftp.clone();
                        let rp = remote_path.clone();
                        tokio::spawn(async move { let _ = sftp.remove_file(&rp).await; });
                        TransferError::SftpError(e.to_string())
                    })?;

                if written == 0 {
                    return Err(TransferError::SftpError("写入返回 0 字节，连接可能已断开".to_string()));
                }

                offset += written;
                progress_tracker.update(written as u64);
                if !cancel_token.is_cancelled() {
                    progress_tracker.emit_progress(app_handle)
                        .map_err(TransferError::IoError)?;
                }
            }
        }

        match read_handle.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(e),
            Err(e) => return Err(TransferError::IoError(format!("读取线程异常: {}", e))),
        }

        if cancel_token.is_cancelled() {
            return Ok(());
        }

        progress_tracker.emit_progress_force(app_handle)
            .map_err(TransferError::IoError)?;

        let _ = app_handle.emit(
            "transfer://complete",
            CompleteEvent { id: progress_tracker.task_id().to_string() },
        );

        Ok(())
    }

    /// 分块下载文件（首次进度事件）
    pub async fn download_chunked(
        &self,
        remote_path: String,
        local_path: PathBuf,
        chunk_size: usize,
        progress_tracker: Arc<ProgressTracker>,
        cancel_token: CancellationToken,
        app_handle: &AppHandle,
    ) -> Result<(), TransferError> {
        progress_tracker.emit_progress_force(app_handle)
            .map_err(TransferError::IoError)?;

        // 确保本地父目录存在
        if let Some(parent) = local_path.parent() {
            if !parent.exists() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| TransferError::IoError(
                        format!("创建本地目录失败 '{}': {}", parent.display(), e)
                    ))?;
            }
        }

        let mut remote_file = self.sftp
            .open(&remote_path)
            .await
            .map_err(|e| TransferError::SftpError(e.to_string()))?;

        let mut local_file = tokio::fs::File::create(&local_path)
            .await
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::PermissionDenied {
                    TransferError::IoError(
                        format!("无法写入 '{}'：目标目录没有写入权限，请选择其他目录", local_path.display())
                    )
                } else {
                    TransferError::IoError(
                        format!("创建本地文件失败 '{}': {}", local_path.display(), e)
                    )
                }
            })?;

        let mut buffer = vec![0u8; chunk_size];
        loop {
            if cancel_token.is_cancelled() {
                return Ok(());
            }

            let bytes_read = remote_file.read(&mut buffer)
                .await
                .map_err(|e| {
                    TransferError::SftpError(e.to_string())
                })?;

            if bytes_read == 0 {
                break;
            }

            local_file.write_all(&buffer[..bytes_read])
                .await
                .map_err(|e| TransferError::IoError(e.to_string()))?;

            progress_tracker.update(bytes_read as u64);
            if !cancel_token.is_cancelled() {
                progress_tracker.emit_progress(app_handle)
                    .map_err(TransferError::IoError)?;
            }
        }

        if cancel_token.is_cancelled() {
            return Ok(());
        }

        progress_tracker.emit_progress_force(app_handle)
            .map_err(TransferError::IoError)?;

        let _ = app_handle.emit(
            "transfer://complete",
            CompleteEvent { id: progress_tracker.task_id().to_string() },
        );

        Ok(())
    }

    /// 从指定偏移量恢复上传（带读写并行）
    #[allow(clippy::too_many_arguments)]
    pub async fn resume_upload(
        &self,
        local_path: PathBuf,
        remote_path: String,
        offset: u64,
        chunk_size: usize,
        progress_tracker: Arc<ProgressTracker>,
        cancel_token: CancellationToken,
        app_handle: &AppHandle,
    ) -> Result<(), TransferError> {
        // 如果有 RawSftpSession，使用高性能流水线模式恢复
        if let Some(raw_sftp) = &self.raw_sftp {
            return self.upload_pipelined(
                raw_sftp.clone(),
                local_path,
                remote_path,
                offset,
                chunk_size,
                progress_tracker,
                cancel_token,
                app_handle,
            ).await;
        }

        // 回退逻辑：手动打开文件并串行写入
        progress_tracker.emit_progress_force(app_handle)
            .map_err(TransferError::IoError)?;

        let mut remote_file = self.sftp
            .open_with_flags(
                &remote_path,
                OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::APPEND,
            )
            .await
            .map_err(|e| TransferError::SftpError(e.to_string()))?;

        let (tx, mut rx) = mpsc::channel::<Vec<u8>>(PREFETCH_BUFFER_SIZE);
        let read_cancel = cancel_token.clone();
        let read_path = local_path.clone();

        let read_handle = tokio::task::spawn_blocking(move || {
            let mut chunker = FileChunker::new(read_path, chunk_size)
                .map_err(|e| TransferError::IoError(e.to_string()))?;
            chunker.seek(offset)
                .map_err(|e| TransferError::IoError(e.to_string()))?;

            loop {
                if read_cancel.is_cancelled() {
                    return Ok::<(), TransferError>(());
                }
                match chunker.read_next_chunk() {
                    Ok(Some(chunk)) => {
                        if tx.blocking_send(chunk).is_err() { return Ok(()); }
                    }
                    Ok(None) => return Ok(()),
                    Err(e) => return Err(TransferError::IoError(e.to_string())),
                }
            }
        });

        while let Some(chunk) = rx.recv().await {
            if cancel_token.is_cancelled() {
                return Ok(());
            }

            let chunk_len = chunk.len() as u64;

            remote_file.write_all(&chunk)
                .await
                .map_err(|e| TransferError::SftpError(e.to_string()))?;

            progress_tracker.update(chunk_len);
            if !cancel_token.is_cancelled() {
                progress_tracker.emit_progress(app_handle)
                    .map_err(TransferError::IoError)?;
            }
        }

        match read_handle.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(e),
            Err(e) => return Err(TransferError::IoError(format!("读取线程异常: {}", e))),
        }

        if cancel_token.is_cancelled() {
            return Ok(());
        }

        progress_tracker.emit_progress_force(app_handle)
            .map_err(TransferError::IoError)?;

        let _ = app_handle.emit(
            "transfer://complete",
            CompleteEvent { id: progress_tracker.task_id().to_string() },
        );

        Ok(())
    }

    /// 从指定偏移量恢复下载
    #[allow(clippy::too_many_arguments)]
    pub async fn resume_download(
        &self,
        remote_path: String,
        local_path: PathBuf,
        offset: u64,
        chunk_size: usize,
        progress_tracker: Arc<ProgressTracker>,
        cancel_token: CancellationToken,
        app_handle: &AppHandle,
    ) -> Result<(), TransferError> {
        progress_tracker.emit_progress_force(app_handle)
            .map_err(TransferError::IoError)?;

        let mut remote_file = self.sftp
            .open(&remote_path)
            .await
            .map_err(|e| TransferError::SftpError(e.to_string()))?;

        remote_file.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|e| TransferError::IoError(e.to_string()))?;

        let mut local_file = tokio::fs::OpenOptions::new()
            .write(true)
            .append(true)
            .open(&local_path)
            .await
            .map_err(|e| TransferError::IoError(e.to_string()))?;

        let mut buffer = vec![0u8; chunk_size];
        loop {
            if cancel_token.is_cancelled() {
                return Ok(());
            }

            let bytes_read = remote_file.read(&mut buffer)
                .await
                .map_err(|e| TransferError::SftpError(e.to_string()))?;

            if bytes_read == 0 {
                break;
            }

            local_file.write_all(&buffer[..bytes_read])
                .await
                .map_err(|e| TransferError::IoError(e.to_string()))?;

            progress_tracker.update(bytes_read as u64);
            if !cancel_token.is_cancelled() {
                progress_tracker.emit_progress(app_handle)
                    .map_err(TransferError::IoError)?;
            }
        }

        if cancel_token.is_cancelled() {
            return Ok(());
        }

        progress_tracker.emit_progress_force(app_handle)
            .map_err(TransferError::IoError)?;

        let _ = app_handle.emit(
            "transfer://complete",
            CompleteEvent { id: progress_tracker.task_id().to_string() },
        );

        Ok(())
    }
}
