use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use russh::client;
use russh_sftp::client::SftpSession;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::models::transfer::{FileEntry, FileInfo, TransferProgress, TransferResult};
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
}

pub struct SftpEngine {
    connections: HashMap<String, SftpConnection>,
}

impl SftpEngine {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    /// Connect SFTP to a remote host. Uses its own SSH connection (not shared with terminal).
    pub async fn connect(
        &mut self,
        connection_id: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
    ) -> Result<(), AppError> {
        // Disconnect existing session for this connection
        if self.connections.contains_key(connection_id) {
            self.disconnect(connection_id).await?;
        }

        let config = Arc::new(client::Config::default());
        let handler = SftpSshClient;

        let mut session = client::connect(config, (host, port), handler)
            .await
            .map_err(|e| AppError::Other(format!("SFTP SSH connection failed: {}", e)))?;

        let authenticated = session
            .authenticate_password(username, password)
            .await
            .map_err(|e| AppError::Other(format!("SFTP SSH auth error: {}", e)))?;

        if !authenticated {
            return Err(AppError::Other(
                "Authentication failed: invalid username or password".to_string(),
            ));
        }

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

        self.connections.insert(
            connection_id.to_string(),
            SftpConnection {
                sftp: Arc::new(sftp),
                _connection_id: connection_id.to_string(),
                _ssh_session: session,
            },
        );

        Ok(())
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> Result<(), AppError> {
        // Dropping the SftpConnection will close the channel and SSH session
        self.connections.remove(connection_id);
        Ok(())
    }

    pub fn is_connected(&self, connection_id: &str) -> bool {
        self.connections.contains_key(connection_id)
    }

    /// List entries in a remote directory.
    pub async fn list_dir(
        &self,
        connection_id: &str,
        path: &str,
    ) -> Result<Vec<FileEntry>, AppError> {
        let conn = self.get_conn(connection_id)?;
        let entries = conn
            .sftp
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
        let conn = self.get_conn(connection_id)?;
        let attrs = conn
            .sftp
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
        let conn = self.get_conn(connection_id)?;
        conn.sftp
            .create_dir(path)
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
        let conn = self.get_conn(connection_id)?;
        conn.sftp
            .remove_file(path)
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
        let conn = self.get_conn(connection_id)?;
        conn.sftp
            .remove_dir(path)
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
        let conn = self.get_conn(connection_id)?;
        conn.sftp
            .rename(old_path, new_path)
            .await
            .map_err(|e| AppError::Other(format!("SFTP rename failed: {}", e)))?;
        Ok(())
    }

    /// Download a remote file to a local path, emitting progress events.
    pub async fn download(
        &self,
        connection_id: &str,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        app_handle: &AppHandle,
    ) -> Result<(), AppError> {
        let conn = self.get_conn(connection_id)?;

        // Get file size for progress tracking
        let attrs = conn
            .sftp
            .metadata(remote_path)
            .await
            .map_err(|e| AppError::Other(format!("SFTP stat failed: {}", e)))?;
        let total_bytes = attrs.size.unwrap_or(0);

        // Read file contents
        let data = conn
            .sftp
            .read(remote_path)
            .await
            .map_err(|e| AppError::Other(format!("SFTP read failed: {}", e)))?;

        // Write to local file
        tokio::fs::write(local_path, &data)
            .await
            .map_err(|e| AppError::Other(format!("Local write failed: {}", e)))?;

        let file_name = remote_path
            .rsplit('/')
            .next()
            .unwrap_or(remote_path)
            .to_string();

        // Emit completion progress
        let _ = app_handle.emit(
            &format!("transfer://progress/{}", transfer_id),
            TransferProgress {
                transfer_id: transfer_id.to_string(),
                file_name,
                bytes_transferred: data.len() as u64,
                total_bytes,
                progress: 1.0,
                speed: 0,
            },
        );

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
    pub async fn upload(
        &self,
        connection_id: &str,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        app_handle: &AppHandle,
    ) -> Result<(), AppError> {
        let conn = self.get_conn(connection_id)?;

        // Read local file
        let data = tokio::fs::read(local_path)
            .await
            .map_err(|e| AppError::Other(format!("Local read failed: {}", e)))?;

        let total_bytes = data.len() as u64;

        let file_name = local_path
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(local_path)
            .to_string();

        // 使用 open + write 方式，可以创建文件
        use russh_sftp::protocol::OpenFlags;
        let mut file = conn.sftp
            .open_with_flags(
                remote_path,
                OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE,
            )
            .await
            .map_err(|e| AppError::Other(format!("SFTP open failed: {}", e)))?;

        file.write_all(&data)
            .await
            .map_err(|e| AppError::Other(format!("SFTP write failed: {}", e)))?;

        // Emit completion progress
        let _ = app_handle.emit(
            &format!("transfer://progress/{}", transfer_id),
            TransferProgress {
                transfer_id: transfer_id.to_string(),
                file_name,
                bytes_transferred: total_bytes,
                total_bytes,
                progress: 1.0,
                speed: 0,
            },
        );

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

    fn get_conn(&self, connection_id: &str) -> Result<&SftpConnection, AppError> {
        self.connections
            .get(connection_id)
            .ok_or_else(|| AppError::Other(format!("No SFTP session for connection: {}", connection_id)))
    }
    
    /// 获取 SFTP 会话的 Arc 引用(用于传输管理器)
    pub fn get_sftp_session(&self, connection_id: &str) -> Option<Arc<SftpSession>> {
        self.connections.get(connection_id).map(|conn| conn.sftp.clone())
    }
}
