use std::path::PathBuf;
use std::sync::Arc;

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

use crate::models::transfer::{CompleteEvent, TransferError};
use crate::services::file_chunker::FileChunker;
use crate::services::progress_tracker::ProgressTracker;

/// SFTP 处理器 - 负责分块上传和下载
pub struct SftpHandler {
    sftp: Arc<SftpSession>,
}

impl SftpHandler {
    /// 创建新的 SFTP 处理器
    pub fn new(sftp: Arc<SftpSession>) -> Self {
        Self { sftp }
    }

    /// 分块上传文件
    pub async fn upload_chunked(
        &self,
        local_path: PathBuf,
        remote_path: String,
        chunk_size: usize,
        progress_tracker: Arc<ProgressTracker>,
        cancel_token: CancellationToken,
        app_handle: &AppHandle,
    ) -> Result<(), TransferError> {
        // 创建文件分块器（同步 I/O，在 spawn_blocking 中使用）
        let chunker = std::sync::Arc::new(std::sync::Mutex::new(
            FileChunker::new(local_path.clone(), chunk_size)
                .map_err(|e| TransferError::IoError(e.to_string()))?,
        ));

        // 打开远程文件（创建并写入模式）
        let mut remote_file = self.sftp
            .open_with_flags(
                &remote_path,
                OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE,
            )
            .await
            .map_err(|e| TransferError::SftpError(e.to_string()))?;

        // 逐块上传
        loop {
            // 在阻塞线程中读取文件块，避免阻塞 tokio 运行时
            let chunker_clone = chunker.clone();
            let chunk = tokio::task::spawn_blocking(move || {
                chunker_clone.lock().expect("chunker mutex poisoned").read_next_chunk()
            })
            .await
            .map_err(|e| TransferError::IoError(e.to_string()))?
            .map_err(|e| TransferError::IoError(e.to_string()))?;

            let Some(chunk) = chunk else { break };

            // 检查是否取消
            if cancel_token.is_cancelled() {
                // 删除不完整的远程文件
                let _ = self.sftp.remove_file(&remote_path).await;
                return Err(TransferError::IoError("Transfer cancelled".to_string()));
            }

            // 写入远程文件
            remote_file.write_all(&chunk)
                .await
                .map_err(|e| TransferError::SftpError(e.to_string()))?;

            // 更新进度
            progress_tracker.update(chunk.len() as u64);
            progress_tracker.emit_progress(app_handle)
                .map_err(TransferError::IoError)?;
        }

        // 强制发送最后的进度事件
        progress_tracker.emit_progress_force(app_handle)
            .map_err(TransferError::IoError)?;

        // 发送完成事件
        let _ = app_handle.emit(
            "transfer://complete",
            CompleteEvent {
                id: progress_tracker.task_id().to_string(),
            },
        );

        Ok(())
    }

    /// 分块下载文件
    pub async fn download_chunked(
        &self,
        remote_path: String,
        local_path: PathBuf,
        chunk_size: usize,
        progress_tracker: Arc<ProgressTracker>,
        cancel_token: CancellationToken,
        app_handle: &AppHandle,
    ) -> Result<(), TransferError> {
        // 打开远程文件
        let mut remote_file = self.sftp
            .open(&remote_path)
            .await
            .map_err(|e| TransferError::SftpError(e.to_string()))?;

        // 创建本地文件
        let mut local_file = tokio::fs::File::create(&local_path)
            .await
            .map_err(|e| TransferError::IoError(e.to_string()))?;

        // 逐块下载
        let mut buffer = vec![0u8; chunk_size];
        loop {
            // 检查是否取消
            if cancel_token.is_cancelled() {
                // 删除不完整的本地文件
                drop(local_file);
                let _ = tokio::fs::remove_file(&local_path).await;
                return Err(TransferError::IoError("Transfer cancelled".to_string()));
            }

            let bytes_read = remote_file.read(&mut buffer)
                .await
                .map_err(|e| TransferError::SftpError(e.to_string()))?;

            if bytes_read == 0 {
                break;
            }

            // 写入本地文件
            local_file.write_all(&buffer[..bytes_read])
                .await
                .map_err(|e| TransferError::IoError(e.to_string()))?;

            // 更新进度
            progress_tracker.update(bytes_read as u64);
            progress_tracker.emit_progress(app_handle)
                .map_err(TransferError::IoError)?;
        }

        // 强制发送最后的进度事件
        progress_tracker.emit_progress_force(app_handle)
            .map_err(TransferError::IoError)?;

        // 发送完成事件
        let _ = app_handle.emit(
            "transfer://complete",
            CompleteEvent {
                id: progress_tracker.task_id().to_string(),
            },
        );

        Ok(())
    }

    /// 从指定偏移量恢复上传
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
        // 创建文件分块器并定位到偏移量
        let mut chunker = FileChunker::new(local_path.clone(), chunk_size)
            .map_err(|e| TransferError::IoError(e.to_string()))?;

        chunker.seek(offset)
            .map_err(|e| TransferError::IoError(e.to_string()))?;

        // 打开远程文件（追加模式）
        let mut remote_file = self.sftp
            .open_with_flags(
                &remote_path,
                OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::APPEND,
            )
            .await
            .map_err(|e| TransferError::SftpError(e.to_string()))?;

        // 逐块上传
        while let Some(chunk) = chunker.read_next_chunk()
            .map_err(|e| TransferError::IoError(e.to_string()))?
        {
            if cancel_token.is_cancelled() {
                return Err(TransferError::IoError("Transfer cancelled".to_string()));
            }

            remote_file.write_all(&chunk)
                .await
                .map_err(|e| TransferError::SftpError(e.to_string()))?;

            progress_tracker.update(chunk.len() as u64);
            progress_tracker.emit_progress(app_handle)
                .map_err(TransferError::IoError)?;
        }

        progress_tracker.emit_progress_force(app_handle)
            .map_err(TransferError::IoError)?;

        let _ = app_handle.emit(
            "transfer://complete",
            CompleteEvent {
                id: progress_tracker.task_id().to_string(),
            },
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
        // 打开远程文件并定位
        let mut remote_file = self.sftp
            .open(&remote_path)
            .await
            .map_err(|e| TransferError::SftpError(e.to_string()))?;

        // 定位到偏移量
        remote_file.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|e| TransferError::IoError(e.to_string()))?;

        // 打开本地文件（追加模式）
        let mut local_file = tokio::fs::OpenOptions::new()
            .write(true)
            .append(true)
            .open(&local_path)
            .await
            .map_err(|e| TransferError::IoError(e.to_string()))?;

        // 继续分块下载
        let mut buffer = vec![0u8; chunk_size];
        loop {
            if cancel_token.is_cancelled() {
                return Err(TransferError::IoError("Transfer cancelled".to_string()));
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
            progress_tracker.emit_progress(app_handle)
                .map_err(TransferError::IoError)?;
        }

        progress_tracker.emit_progress_force(app_handle)
            .map_err(TransferError::IoError)?;

        let _ = app_handle.emit(
            "transfer://complete",
            CompleteEvent {
                id: progress_tracker.task_id().to_string(),
            },
        );

        Ok(())
    }
}
