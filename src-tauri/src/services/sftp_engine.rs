use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use russh::client;
use russh_sftp::client::rawsession::RawSftpSession;
use russh_sftp::client::SftpSession;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::sync::RwLock;

use crate::models::ssh::{AuthConfig, ProxyJumpConfig};
use crate::models::transfer::{FileEntry, FileInfo, TransferProgress, TransferResult};
use crate::services::ssh_auth;
use crate::utils::error::AppError;

/// Minimal SSH client handler for SFTP connections (accepts all host keys).
#[derive(Clone)]
struct SftpSshClient;

#[async_trait]
impl client::Handler for SftpSshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// 活跃的 SFTP 连接，绑定到一个 SSH 会话
struct SftpConnection {
    sftp: Arc<SftpSession>,
    _connection_id: String,
    /// SSH 会话句柄（保持连接存活，同时用于创建新的 SFTP channel）
    ssh_session: client::Handle<SftpSshClient>,
    /// 跳板机会话（保持存活，否则连接断开）
    _proxy_session: Option<Box<dyn std::any::Any + Send + Sync>>,
}

/// SFTP 引擎：内部使用 RwLock<HashMap> 实现 per-connection 级别锁定，
/// 不同连接的操作互不阻塞。
pub struct SftpEngine {
    connections: RwLock<HashMap<String, SftpConnection>>,
}

impl SftpEngine {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
        }
    }

    /// Connect SFTP to a remote host. Uses its own SSH connection (not shared with terminal).
    pub async fn connect(
        &self,
        connection_id: &str,
        host: &str,
        port: u16,
        username: &str,
        auth: &AuthConfig,
        proxy: Option<&ProxyJumpConfig>,
    ) -> Result<(), AppError> {
        // 清理已存在的同 ID 连接（原子写锁移除，避免 read+disconnect 竞态）
        // Dropping SftpConnection 会自动关闭 channel 和 SSH session
        self.connections.write().await.remove(connection_id);

        // 以下 SSH/SFTP 握手过程不持有任何锁
        let config = ssh_auth::create_ssh_config();
        let handler = SftpSshClient;

        let (session, proxy_handle): (client::Handle<SftpSshClient>, Option<Box<dyn std::any::Any + Send + Sync>>) =
            if let Some(proxy) = proxy {
                let (target, proxy_h) = ssh_auth::connect_via_proxy(
                    proxy, host, port, username, auth, handler,
                ).await?;
                (target, Some(Box::new(proxy_h)))
            } else {
                let mut sess = client::connect(config, (host, port), handler)
                    .await
                    .map_err(|e| AppError::Other(format!("SFTP SSH connection failed: {}", e)))?;
                ssh_auth::authenticate(&mut sess, username, auth).await?;
                (sess, None)
            };

        let channel = session
            .channel_open_session()
            .await
            .map_err(|e| AppError::Other(format!("Failed to open SFTP channel: {}", e)))?;

        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| AppError::Other(format!("Failed to request SFTP subsystem: {}", e)))?;

        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| AppError::Other(format!("Failed to init SFTP session: {}", e)))?;

        // 短暂写锁插入新连接
        self.connections.write().await.insert(
            connection_id.to_string(),
            SftpConnection {
                sftp: Arc::new(sftp),
                _connection_id: connection_id.to_string(),
                ssh_session: session,
                _proxy_session: proxy_handle,
            },
        );

        Ok(())
    }

    pub async fn disconnect(&self, connection_id: &str) -> Result<(), AppError> {
        // Dropping the SftpConnection will close the channel and SSH session
        self.connections.write().await.remove(connection_id);
        Ok(())
    }

    pub async fn is_connected(&self, connection_id: &str) -> bool {
        self.connections.read().await.contains_key(connection_id)
    }

    /// 获取连接的 SFTP 会话 Arc（短暂持有读锁后释放）
    async fn get_sftp(&self, connection_id: &str) -> Result<Arc<SftpSession>, AppError> {
        self.connections
            .read()
            .await
            .get(connection_id)
            .map(|conn| conn.sftp.clone())
            .ok_or_else(|| AppError::Other(format!("No SFTP session for connection: {}", connection_id)))
    }

    /// List entries in a remote directory.
    pub async fn list_dir(
        &self,
        connection_id: &str,
        path: &str,
    ) -> Result<Vec<FileEntry>, AppError> {
        let sftp = self.get_sftp(connection_id).await?;
        let entries = sftp
            .read_dir(path)
            .await
            .map_err(|e| AppError::Other(format!("SFTP read_dir failed: {}", e)))?;

        let mut result: Vec<FileEntry> = Vec::new();
        for entry in entries {
            let name = entry.file_name();
            let attrs = entry.metadata();

            // Skip . and ..
            if name == "." || name == ".." {
                continue;
            }

            let full_path = if path.ends_with('/') {
                format!("{}{}", path, name)
            } else {
                format!("{}/{}", path, name)
            };

            let is_dir = attrs.permissions.map(|p| p & 0o40000 != 0).unwrap_or(false);
            let size = attrs.size.unwrap_or(0);
            let modified = attrs.mtime.map(|m| m as i64);
            let permissions = attrs.permissions;

            result.push(FileEntry {
                name,
                path: full_path,
                is_dir,
                size,
                modified,
                permissions,
            });
        }

        // Sort: directories first, then by name
        result.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(result)
    }

    /// Get file/directory metadata.
    pub async fn stat(
        &self,
        connection_id: &str,
        path: &str,
    ) -> Result<FileInfo, AppError> {
        let sftp = self.get_sftp(connection_id).await?;
        let attrs = sftp
            .metadata(path)
            .await
            .map_err(|e| AppError::Other(format!("SFTP stat failed: {}", e)))?;

        let name = path
            .rsplit('/')
            .next()
            .unwrap_or(path)
            .to_string();

        let is_dir = attrs.permissions.map(|p| p & 0o40000 != 0).unwrap_or(false);

        Ok(FileInfo {
            name,
            path: path.to_string(),
            is_dir,
            size: attrs.size.unwrap_or(0),
            modified: attrs.mtime.map(|m| m as i64),
            permissions: attrs.permissions,
            owner: attrs.uid.map(|u| u.to_string()),
            group: attrs.gid.map(|g| g.to_string()),
        })
    }

    /// Create a remote directory.
    pub async fn mkdir(
        &self,
        connection_id: &str,
        path: &str,
    ) -> Result<(), AppError> {
        let sftp = self.get_sftp(connection_id).await?;
        sftp.create_dir(path)
            .await
            .map_err(|e| AppError::Other(format!("SFTP mkdir failed: {}", e)))?;
        Ok(())
    }

    /// 在远程创建空文件（touch）
    pub async fn touch(
        &self,
        connection_id: &str,
        path: &str,
    ) -> Result<(), AppError> {
        let sftp = self.get_sftp(connection_id).await?;
        // 创建文件后自动 drop 关闭
        let _file = sftp
            .create(path)
            .await
            .map_err(|e| AppError::Other(format!("SFTP touch failed: {}", e)))?;
        Ok(())
    }

    /// Delete a remote file.
    pub async fn delete_file(
        &self,
        connection_id: &str,
        path: &str,
    ) -> Result<(), AppError> {
        let sftp = self.get_sftp(connection_id).await?;
        sftp.remove_file(path)
            .await
            .map_err(|e| AppError::Other(format!("SFTP delete failed: {}", e)))?;
        Ok(())
    }

    /// 递归删除远程目录（先删除所有子文件和子目录，再删除自身）
    pub async fn delete_dir(
        &self,
        connection_id: &str,
        path: &str,
    ) -> Result<(), AppError> {
        let sftp = self.get_sftp(connection_id).await?;
        Self::remove_dir_recursive(&sftp, path).await
    }

    /// 递归删除远程目录的内部实现
    fn remove_dir_recursive<'a>(
        sftp: &'a SftpSession,
        path: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move {
            // 列出目录内容
            let entries = sftp.read_dir(path).await
                .map_err(|e| AppError::Other(format!("SFTP readdir failed: {}", e)))?;

            for entry in entries {
                let name = entry.file_name();
                if name == "." || name == ".." {
                    continue;
                }

                let full_path = if path.ends_with('/') {
                    format!("{}{}", path, name)
                } else {
                    format!("{}/{}", path, name)
                };

                let attrs = entry.metadata();
                let is_dir = attrs.permissions.map(|p| p & 0o40000 != 0).unwrap_or(false);

                if is_dir {
                    // 递归删除子目录
                    Self::remove_dir_recursive(sftp, &full_path).await?;
                } else {
                    // 删除文件
                    sftp.remove_file(&full_path).await
                        .map_err(|e| AppError::Other(format!("SFTP delete file failed: {}", e)))?;
                }
            }

            // 目录已清空，删除空目录
            sftp.remove_dir(path).await
                .map_err(|e| AppError::Other(format!("SFTP rmdir failed: {}", e)))?;
            Ok(())
        })
    }

    /// Rename a remote file or directory.
    pub async fn rename(
        &self,
        connection_id: &str,
        old_path: &str,
        new_path: &str,
    ) -> Result<(), AppError> {
        let sftp = self.get_sftp(connection_id).await?;
        sftp.rename(old_path, new_path)
            .await
            .map_err(|e| AppError::Other(format!("SFTP rename failed: {}", e)))?;
        Ok(())
    }

    /// Download a remote file to a local path, emitting progress events.
    /// 使用分块流式读取，避免大文件整体读入内存导致 OOM。
    pub async fn download(
        &self,
        connection_id: &str,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        app_handle: &AppHandle,
    ) -> Result<(), AppError> {
        let sftp = self.get_sftp(connection_id).await?;

        // 获取文件大小用于进度跟踪
        let attrs = sftp
            .metadata(remote_path)
            .await
            .map_err(|e| AppError::Other(format!("SFTP stat failed: {}", e)))?;
        let total_bytes = attrs.size.unwrap_or(0);

        let file_name = remote_path
            .rsplit('/')
            .next()
            .unwrap_or(remote_path)
            .to_string();

        // 使用流式分块读取，避免大文件 OOM
        use russh_sftp::protocol::OpenFlags;
        use tokio::io::AsyncReadExt;

        let download_result: Result<(), AppError> = async {
            let mut remote_file = sftp
                .open_with_flags(remote_path, OpenFlags::READ)
                .await
                .map_err(|e| AppError::Other(format!("SFTP open failed: {}", e)))?;

            let mut local_file = tokio::fs::File::create(local_path)
                .await
                .map_err(|e| AppError::Other(format!("Local file create failed: {}", e)))?;

            // 4MB 分块 — 配合 64MB SSH 窗口，充分利用带宽
            const CHUNK_SIZE: usize = 4 * 1024 * 1024;
            let mut buf = vec![0u8; CHUNK_SIZE];
            let mut bytes_transferred: u64 = 0;
            let mut last_emit = std::time::Instant::now();

            // 立即发送首次进度事件（0%）
            let _ = app_handle.emit(
                &format!("transfer://progress/{}", transfer_id),
                TransferProgress {
                    transfer_id: transfer_id.to_string(),
                    file_name: file_name.clone(),
                    bytes_transferred: 0,
                    total_bytes,
                    progress: 0.0,
                    speed: 0,
                },
            );

            loop {
                // 读取远程文件（不设硬超时）
                let n = remote_file.read(&mut buf).await
                    .map_err(|e| AppError::Other(format!("SFTP read chunk failed: {}", e)))?;
                if n == 0 {
                    break;
                }

                local_file.write_all(&buf[..n]).await
                    .map_err(|e| AppError::Other(format!("Local write failed: {}", e)))?;

                bytes_transferred += n as u64;

                // 每 100ms 发送一次进度事件
                if last_emit.elapsed() >= std::time::Duration::from_millis(100) || bytes_transferred >= total_bytes {
                    let progress = if total_bytes > 0 {
                        bytes_transferred as f64 / total_bytes as f64
                    } else {
                        0.0
                    };
                    let _ = app_handle.emit(
                        &format!("transfer://progress/{}", transfer_id),
                        TransferProgress {
                            transfer_id: transfer_id.to_string(),
                            file_name: file_name.clone(),
                            bytes_transferred,
                            total_bytes,
                            progress,
                            speed: 0,
                        },
                    );
                    last_emit = std::time::Instant::now();
                }
            }

            local_file.flush().await
                .map_err(|e| AppError::Other(format!("Local file flush failed: {}", e)))?;

            Ok(())
        }.await;

        // 下载失败时清理已创建的本地文件
        if let Err(ref _e) = download_result {
            let _ = tokio::fs::remove_file(local_path).await;
        }

        download_result?;

        let _ = app_handle.emit(
            &format!("transfer://complete/{}", transfer_id),
            TransferResult {
                transfer_id: transfer_id.to_string(),
                success: true,
                error: None,
            },
        );

        Ok(())
    }

    /// Upload a local file to a remote path, emitting progress events.
    /// 使用分块流式写入，避免大文件整体读入内存导致 OOM。
    pub async fn upload(
        &self,
        connection_id: &str,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        app_handle: &AppHandle,
    ) -> Result<(), AppError> {
        let sftp = self.get_sftp(connection_id).await?;

        // 获取本地文件大小
        let metadata = tokio::fs::metadata(local_path)
            .await
            .map_err(|e| AppError::Other(format!("Local file stat failed: {}", e)))?;
        let total_bytes = metadata.len();

        let file_name = local_path
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(local_path)
            .to_string();

        // 使用流式分块读取本地文件并写入远程
        use russh_sftp::protocol::OpenFlags;
        use tokio::io::AsyncReadExt;

        let mut local_file = tokio::fs::File::open(local_path)
            .await
            .map_err(|e| AppError::Other(format!("Local file open failed: {}", e)))?;

        let mut remote_file = sftp
            .open_with_flags(
                remote_path,
                OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE,
            )
            .await
            .map_err(|e| AppError::Other(format!("SFTP open failed: {}", e)))?;

        // 4MB 磁盘读取块 — 配合 64MB SSH 窗口
        const CHUNK_SIZE: usize = 4 * 1024 * 1024;
        let mut buf = vec![0u8; CHUNK_SIZE];
        let mut bytes_transferred: u64 = 0;
        let mut last_emit = std::time::Instant::now();

        // 立即发送首次进度事件（0%），让前端知道传输已开始
        let _ = app_handle.emit(
            &format!("transfer://progress/{}", transfer_id),
            TransferProgress {
                transfer_id: transfer_id.to_string(),
                file_name: file_name.clone(),
                bytes_transferred: 0,
                total_bytes,
                progress: 0.0,
                speed: 0,
            },
        );

        loop {
            let n = local_file.read(&mut buf).await
                .map_err(|e| AppError::Other(format!("Local read chunk failed: {}", e)))?;
            if n == 0 {
                break;
            }

            // 使用 write（非 write_all）获取每次实际写入字节数
            // 底层按 SSH 窗口/包大小自动分片，不增加 SFTP 协议开销
            let mut offset = 0;
            while offset < n {
                use tokio::io::AsyncWriteExt;
                let written = remote_file.write(&buf[offset..n]).await
                    .map_err(|e| AppError::Other(format!("SFTP write failed: {}", e)))?;

                if written == 0 {
                    return Err(AppError::Other("写入返回 0 字节，连接可能已断开".to_string()));
                }

                offset += written;
                bytes_transferred += written as u64;

                // 每 100ms 发送一次进度事件，或传输完成时强制发送
                if last_emit.elapsed() >= std::time::Duration::from_millis(100) || bytes_transferred >= total_bytes {
                    let progress = if total_bytes > 0 {
                        bytes_transferred as f64 / total_bytes as f64
                    } else {
                        0.0
                    };
                    let _ = app_handle.emit(
                        &format!("transfer://progress/{}", transfer_id),
                        TransferProgress {
                            transfer_id: transfer_id.to_string(),
                            file_name: file_name.clone(),
                            bytes_transferred,
                            total_bytes,
                            progress,
                            speed: 0,
                        },
                    );
                    last_emit = std::time::Instant::now();
                }
            }
        }

        remote_file.flush().await
            .map_err(|e| AppError::Other(format!("SFTP flush failed: {}", e)))?;

        let _ = app_handle.emit(
            &format!("transfer://complete/{}", transfer_id),
            TransferResult {
                transfer_id: transfer_id.to_string(),
                success: true,
                error: None,
            },
        );

        Ok(())
    }

    /// 获取 SFTP 会话的 Arc 引用(用于传输管理器)
    pub async fn get_sftp_session(&self, connection_id: &str) -> Option<Arc<SftpSession>> {
        let connections = self.connections.read().await;
        connections.get(connection_id).map(|conn| conn.sftp.clone())
    }

    /// 在同一 SSH 连接上创建新的 RawSftpSession（用于流水线上传）
    /// 
    /// 通过复用已有 SSH 连接打开新的 SFTP channel，避免额外的 TCP/SSH 握手开销。
    /// RawSftpSession 支持并发 write() 调用，实现流水线写入。
    pub async fn create_raw_sftp_session(&self, connection_id: &str) -> Result<Arc<RawSftpSession>, AppError> {
        let (channel, start) = {
            let connections = self.connections.read().await;
            let conn = connections.get(connection_id)
                .ok_or_else(|| AppError::Other(format!("连接不存在: {}", connection_id)))?;
            
            let start = std::time::Instant::now();
            log::debug!("[SFTP] Opening new channel for connection: {}", connection_id);

            // 在同一 SSH 会话上打开新的 channel
            let channel = conn.ssh_session
                .channel_open_session()
                .await
                .map_err(|e| AppError::Other(format!("打开 SFTP channel 失败: {}", e)))?;
            (channel, start)
        };

        log::debug!("[SFTP] Channel opened in {}ms", start.elapsed().as_millis());

        let sub_start = std::time::Instant::now();
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| AppError::Other(format!("请求 SFTP 子系统失败: {}", e)))?;
        log::debug!("[SFTP] Subsystem requested in {}ms", sub_start.elapsed().as_millis());

        let init_start = std::time::Instant::now();
        let raw_session = RawSftpSession::new(channel.into_stream());

        // 初始化 SFTP 协议
        raw_session.init().await
            .map_err(|e| AppError::Other(format!("SFTP 协议初始化失败: {}", e)))?;
        log::debug!("[SFTP] Protocol initialized in {}ms", init_start.elapsed().as_millis());
        log::debug!("[SFTP] Total create_raw_sftp_session took {}ms", start.elapsed().as_millis());

        // 设置超时为 3600 秒
        raw_session.set_timeout(3600).await;

        Ok(Arc::new(raw_session))
    }

    /// 在 SFTP 连接的 SSH 会话上执行远程命令（用于打包传输的解压等操作）
    pub async fn exec_command(
        &self,
        connection_id: &str,
        command: &str,
        timeout_secs: u64,
    ) -> Result<(i32, String), AppError> {
        let mut channel = {
            let connections = self.connections.read().await;
            let conn = connections.get(connection_id)
                .ok_or_else(|| AppError::Other(format!("连接不存在: {}", connection_id)))?;

            conn.ssh_session
                .channel_open_session()
                .await
                .map_err(|e| AppError::Other(format!("打开 exec channel 失败: {}", e)))?
        };

        // 执行命令
        channel.exec(true, command.as_bytes())
            .await
            .map_err(|e| AppError::Other(format!("执行远程命令失败: {}", e)))?;

        // 收集输出
        let mut output = String::new();
        let mut exit_code: i32 = -1;
        let mut got_eof = false;

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            async {
                loop {
                    match channel.wait().await {
                        Some(russh::ChannelMsg::Data { data }) => {
                            output.push_str(&String::from_utf8_lossy(&data));
                        }
                        Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                            output.push_str(&String::from_utf8_lossy(&data));
                        }
                        Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                            exit_code = exit_status as i32;
                            // ExitStatus 到了且 Eof 也到了，可以退出
                            if got_eof { break; }
                        }
                        Some(russh::ChannelMsg::Eof) => {
                            got_eof = true;
                            // 如果已经收到 ExitStatus，直接退出
                            if exit_code != -1 { break; }
                            // 否则继续等 ExitStatus（可能紧随 Eof 之后）
                        }
                        None => break, // channel 关闭，真正退出
                        _ => {}
                    }
                }
            }
        ).await;

        let _ = channel.close().await;

        if result.is_err() {
            return Err(AppError::Other(format!("远程命令执行超时 ({}s): {}", timeout_secs, command)));
        }

        Ok((exit_code, output))
    }
}
