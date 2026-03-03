use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use russh::client;
use russh::{ChannelMsg, Disconnect};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, RwLock};

use crate::models::ssh::{AuthConfig, ProxyJumpConfig, SessionInfo};
use crate::services::ssh_auth;
use crate::services::terminal_recorder::SharedRecordingWriter;
use crate::utils::error::AppError;

/// Commands sent from Tauri commands to the per-session I/O task.
enum SessionCommand {
    Data(Vec<u8>),
    Resize(u32, u32),
    Close,
}

/// Minimal SSH client handler — accepts all host keys (like StrictHostKeyChecking=no).
struct SshClient;

#[async_trait]
impl client::Handler for SshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// Stored state for an active SSH session.
struct SshSession {
    cmd_tx: mpsc::UnboundedSender<SessionCommand>,
    _connection_id: String,
    recording_writer: SharedRecordingWriter,
}

/// SSH 引擎：内部使用 RwLock<HashMap> 实现 per-connection 级别锁定，
/// 不同连接的操作互不阻塞。
pub struct SshEngine {
    sessions: RwLock<HashMap<String, SshSession>>,
}

impl SshEngine {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn connect(
        &self,
        app_handle: &AppHandle,
        session_id: &str,
        connection_id: &str,
        host: &str,
        port: u16,
        username: &str,
        auth: &AuthConfig,
        proxy: Option<&ProxyJumpConfig>,
        cols: u32,
        rows: u32,
    ) -> Result<SessionInfo, AppError> {
        // Clean up any existing session with this ID (短暂读锁检查)
        if self.sessions.read().await.contains_key(session_id) {
            self.disconnect(session_id).await?;
        }

        // 以下 SSH 握手过程不持有任何锁
        let config = Arc::new(client::Config::default());
        let handler = SshClient;

        let (session, _proxy_handle) = if let Some(proxy) = proxy {
            // 通过跳板机连接
            let (target, proxy_h) = ssh_auth::connect_via_proxy(
                proxy, host, port, username, auth, handler,
            ).await?;
            (target, Some(proxy_h))
        } else {
            // 直连
            let mut sess = client::connect(config, (host, port), handler)
                .await
                .map_err(|e| AppError::Other(format!("SSH connection failed: {}", e)))?;
            ssh_auth::authenticate(&mut sess, username, auth).await?;
            (sess, None)
        };

        let mut channel = session
            .channel_open_session()
            .await
            .map_err(|e| AppError::Other(format!("Failed to open SSH channel: {}", e)))?;

        channel
            .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
            .await
            .map_err(|e| AppError::Other(format!("Failed to request PTY: {}", e)))?;

        channel
            .request_shell(false)
            .await
            .map_err(|e| AppError::Other(format!("Failed to start shell: {}", e)))?;

        // Create command channel for the I/O task
        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();

        // 录制写入器（初始为空，start_recording 时设置）
        let recording_writer: SharedRecordingWriter = Arc::new(tokio::sync::Mutex::new(None));
        let recording_writer_for_task = recording_writer.clone();

        let sid = session_id.to_string();
        let app = app_handle.clone();

        // Spawn I/O task that owns the channel exclusively
        tokio::spawn(async move {
            // 保持跳板机连接存活（如果有的话）
            let _proxy_keepalive = _proxy_handle;

            let output_event = format!("ssh://output/{}", sid);
            let status_event = format!("ssh://status/{}", sid);

            loop {
                tokio::select! {
                    // 等待 SSH 通道数据（零轮询，事件驱动）
                    msg = channel.wait() => {
                        match msg {
                            Some(ChannelMsg::Data { data }) => {
                                if let Some(ref mut writer) = *recording_writer_for_task.lock().await {
                                    writer.write_output(&data);
                                }
                                let _ = app.emit(&output_event, data.to_vec());
                            }
                            Some(ChannelMsg::ExtendedData { data, .. }) => {
                                if let Some(ref mut writer) = *recording_writer_for_task.lock().await {
                                    writer.write_output(&data);
                                }
                                let _ = app.emit(&output_event, data.to_vec());
                            }
                            Some(ChannelMsg::ExitStatus { .. }) | None => {
                                let _ = app.emit(&status_event, "disconnected");
                                break;
                            }
                            Some(ChannelMsg::Eof) => {
                                let _ = app.emit(&status_event, "disconnected");
                                break;
                            }
                            Some(_) => {}
                        }
                    }
                    // 等待用户命令（键盘输入、窗口调整、关闭）
                    cmd = cmd_rx.recv() => {
                        match cmd {
                            Some(SessionCommand::Data(data)) => {
                                if let Some(ref mut writer) = *recording_writer_for_task.lock().await {
                                    writer.write_input(&data);
                                }
                                if let Err(e) = channel.data(&data[..]).await {
                                    log::warn!("SSH session {} data send failed: {}", sid, e);
                                    let _ = app.emit(&status_event, "disconnected");
                                    return;
                                }
                            }
                            Some(SessionCommand::Resize(cols, rows)) => {
                                let _ = channel.window_change(cols, rows, 0, 0).await;
                            }
                            Some(SessionCommand::Close) => {
                                let _ = channel.close().await;
                                let _ = app.emit(&status_event, "disconnected");
                                return;
                            }
                            None => {
                                let _ = channel.close().await;
                                let _ = app.emit(&status_event, "disconnected");
                                return;
                            }
                        }
                    }
                }
            }

            // Disconnect the underlying SSH session
            let _ = session
                .disconnect(Disconnect::ByApplication, "", "")
                .await;
        });

        let info = SessionInfo {
            session_id: session_id.to_string(),
            connection_id: connection_id.to_string(),
            connected_at: chrono::Utc::now().timestamp(),
        };

        // 短暂写锁插入新会话
        self.sessions.write().await.insert(
            session_id.to_string(),
            SshSession {
                cmd_tx,
                _connection_id: connection_id.to_string(),
                recording_writer,
            },
        );

        Ok(info)
    }

    pub async fn send_data(&self, session_id: &str, data: &[u8]) -> Result<(), AppError> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Other(format!("No SSH session: {}", session_id)))?;

        session
            .cmd_tx
            .send(SessionCommand::Data(data.to_vec()))
            .map_err(|_| AppError::Other("SSH session closed".to_string()))?;

        Ok(())
    }

    pub async fn resize(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), AppError> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Other(format!("No SSH session: {}", session_id)))?;

        session
            .cmd_tx
            .send(SessionCommand::Resize(cols, rows))
            .map_err(|_| AppError::Other("SSH session closed".to_string()))?;

        Ok(())
    }

    pub async fn disconnect(&self, session_id: &str) -> Result<(), AppError> {
        if let Some(session) = self.sessions.write().await.remove(session_id) {
            let _ = session.cmd_tx.send(SessionCommand::Close);
        }
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn is_connected(&self, session_id: &str) -> bool {
        self.sessions
            .read()
            .await
            .get(session_id)
            .map(|s| !s.cmd_tx.is_closed())
            .unwrap_or(false)
    }

    /// 获取会话的录制写入器引用（用于 start_recording 时设置）
    pub async fn get_recording_writer(&self, session_id: &str) -> Option<SharedRecordingWriter> {
        self.sessions.read().await.get(session_id).map(|s| s.recording_writer.clone())
    }
}
