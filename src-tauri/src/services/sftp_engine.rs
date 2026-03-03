use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use russh::client;
use russh_sftp::client::SftpSession;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::sync::RwLock;

use crate::models::ssh::{AuthConfig, ProxyJumpConfig};
use crate::models::transfer::{FileEntry, FileInfo, TransferProgress, TransferResult};
use crate::services::ssh_auth;
use crate::utils::error::AppError;

/// Minimal SSH client handler for SFTP connections (accepts all host keys).
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

/// An active SFTP session bound to an SSH connection.
struct SftpConnection {
    sftp: Arc<SftpSession>,
    _connection_id: String,
    /// Keep the SSH session alive (dropped when connection is dropped).
    _ssh_session: client::Handle<SftpSshClient>,
    /// Keep proxy session alive if connected via jump host.
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
        // Disconnect existing session for this connection (短暂读锁检查)
        if self.connections.read().await.contains_key(connection_id) {
            self.disconnect(connection_id).await?;
        }

        // 以下 SSH/SFTP 握手过程不持有任何锁
        let config = Arc::new(client::Config::default());
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
                _ssh_session: session,
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

    /// Delete a remote directory.
    pub async fn delete_dir(
        &self,
        connection_id: &str,
        path: &str,
    ) -> Result<(), AppError> {
        let sftp = self.get_sftp(connection_id).await?;
        sftp.remove_dir(path)
            .await
            .map_err(|e| AppError::Other(format!("SFTP rmdir failed: {}", e)))?;
        Ok(())
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

        let mut remote_file = sftp
            .open_with_flags(remote_path, OpenFlags::READ)
            .await
            .map_err(|e| AppError::Other(format!("SFTP open failed: {}", e)))?;

        let mut local_file = tokio::fs::File::create(local_path)
            .await
            .map_err(|e| AppError::Other(format!("Local file create failed: {}", e)))?;

        const CHUNK_SIZE: usize = 256 * 1024; // 256KB 分块
        let mut buf = vec![0u8; CHUNK_SIZE];
        let mut bytes_transferred: u64 = 0;
        let mut last_emit = std::time::Instant::now();

        loop {
            let n = remote_file.read(&mut buf).await
                .map_err(|e| AppError::Other(format!("SFTP read chunk failed: {}", e)))?;
            if n == 0 {
                break;
            }

            local_file.write_all(&buf[..n]).await
                .map_err(|e| AppError::Other(format!("Local write failed: {}", e)))?;

            bytes_transferred += n as u64;

            // 每 200ms 发送一次进度事件，减少前端事件风暴
            if last_emit.elapsed() >= std::time::Duration::from_millis(200) || bytes_transferred >= total_bytes {
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

        const CHUNK_SIZE: usize = 256 * 1024; // 256KB 分块
        let mut buf = vec![0u8; CHUNK_SIZE];
        let mut bytes_transferred: u64 = 0;
        let mut last_emit = std::time::Instant::now();

        loop {
            let n = local_file.read(&mut buf).await
                .map_err(|e| AppError::Other(format!("Local read chunk failed: {}", e)))?;
            if n == 0 {
                break;
            }

            remote_file.write_all(&buf[..n]).await
                .map_err(|e| AppError::Other(format!("SFTP write failed: {}", e)))?;

            bytes_transferred += n as u64;

            // 每 200ms 发送一次进度事件
            if last_emit.elapsed() >= std::time::Duration::from_millis(200) || bytes_transferred >= total_bytes {
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
        self.connections.read().await.get(connection_id).map(|conn| conn.sftp.clone())
    }
}
