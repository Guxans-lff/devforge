use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use russh::client;
use russh::{ChannelMsg, Disconnect};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::models::ssh::SessionInfo;
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
}

pub struct SshEngine {
    sessions: HashMap<String, SshSession>,
}

impl SshEngine {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn connect(
        &mut self,
        app_handle: &AppHandle,
        session_id: &str,
        connection_id: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        cols: u32,
        rows: u32,
    ) -> Result<SessionInfo, AppError> {
        // Clean up any existing session with this ID
        if self.sessions.contains_key(session_id) {
            self.disconnect(session_id).await?;
        }

        let config = Arc::new(client::Config::default());
        let handler = SshClient;

        let mut session = client::connect(config, (host, port), handler)
            .await
            .map_err(|e| AppError::Other(format!("SSH connection failed: {}", e)))?;

        let authenticated = session
            .authenticate_password(username, password)
            .await
            .map_err(|e| AppError::Other(format!("SSH authentication error: {}", e)))?;

        if !authenticated {
            return Err(AppError::Other(
                "Authentication failed: invalid username or password".to_string(),
            ));
        }

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

        let sid = session_id.to_string();
        let app = app_handle.clone();

        // Spawn I/O task that owns the channel exclusively
        tokio::spawn(async move {
            let output_event = format!("ssh://output/{}", sid);
            let status_event = format!("ssh://status/{}", sid);

            loop {
                // Drain pending commands first (non-blocking)
                loop {
                    match cmd_rx.try_recv() {
                        Ok(SessionCommand::Data(data)) => {
                            if channel.data(&data[..]).await.is_err() {
                                let _ = app.emit(&status_event, "disconnected");
                                return;
                            }
                        }
                        Ok(SessionCommand::Resize(cols, rows)) => {
                            let _ = channel.window_change(cols, rows, 0, 0).await;
                        }
                        Ok(SessionCommand::Close) => {
                            let _ = channel.close().await;
                            let _ = app.emit(&status_event, "disconnected");
                            return;
                        }
                        Err(mpsc::error::TryRecvError::Empty) => break,
                        Err(mpsc::error::TryRecvError::Disconnected) => {
                            let _ = channel.close().await;
                            let _ = app.emit(&status_event, "disconnected");
                            return;
                        }
                    }
                }

                // Wait for SSH data with a short timeout so we can check commands again
                match tokio::time::timeout(
                    std::time::Duration::from_millis(5),
                    channel.wait(),
                )
                .await
                {
                    Ok(Some(ChannelMsg::Data { data })) => {
                        let _ = app.emit(&output_event, data.to_vec());
                    }
                    Ok(Some(ChannelMsg::ExtendedData { data, .. })) => {
                        // stderr
                        let _ = app.emit(&output_event, data.to_vec());
                    }
                    Ok(Some(ChannelMsg::ExitStatus { .. })) | Ok(None) => {
                        let _ = app.emit(&status_event, "disconnected");
                        break;
                    }
                    Ok(Some(ChannelMsg::Eof)) => {
                        let _ = app.emit(&status_event, "disconnected");
                        break;
                    }
                    Ok(Some(_)) => {} // Other channel messages, ignore
                    Err(_) => {}      // Timeout, loop back to check commands
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

        self.sessions.insert(
            session_id.to_string(),
            SshSession {
                cmd_tx,
                _connection_id: connection_id.to_string(),
            },
        );

        Ok(info)
    }

    pub fn send_data(&self, session_id: &str, data: &[u8]) -> Result<(), AppError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| AppError::Other(format!("No SSH session: {}", session_id)))?;

        session
            .cmd_tx
            .send(SessionCommand::Data(data.to_vec()))
            .map_err(|_| AppError::Other("SSH session closed".to_string()))?;

        Ok(())
    }

    pub fn resize(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), AppError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| AppError::Other(format!("No SSH session: {}", session_id)))?;

        session
            .cmd_tx
            .send(SessionCommand::Resize(cols, rows))
            .map_err(|_| AppError::Other("SSH session closed".to_string()))?;

        Ok(())
    }

    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), AppError> {
        if let Some(session) = self.sessions.remove(session_id) {
            let _ = session.cmd_tx.send(SessionCommand::Close);
        }
        Ok(())
    }

    #[allow(dead_code)]
    pub fn is_connected(&self, session_id: &str) -> bool {
        self.sessions
            .get(session_id)
            .map(|s| !s.cmd_tx.is_closed())
            .unwrap_or(false)
    }
}
