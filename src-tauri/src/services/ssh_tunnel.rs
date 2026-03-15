use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use russh::client;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

use crate::models::ssh::{TunnelConfig, TunnelInfo};
use crate::services::ssh_auth;
use crate::utils::error::AppError;

/// Minimal SSH client handler for tunnel connections.
struct TunnelSshClient;

#[async_trait]
impl client::Handler for TunnelSshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // TODO: 实现 known_hosts 验证，当前跳过主机密钥检查（与 ssh_engine.rs 保持一致）
        Ok(true)
    }
}

struct TunnelHandle {
    info: TunnelInfo,
    cancel_token: CancellationToken,
}

/// SSH 隧道引擎 — 内部 RwLock，无需外层 Mutex
pub struct SshTunnelEngine {
    tunnels: RwLock<HashMap<String, TunnelHandle>>,
}

impl SshTunnelEngine {
    pub fn new() -> Self {
        Self {
            tunnels: RwLock::new(HashMap::new()),
        }
    }

    pub async fn open_tunnel(&self, config: TunnelConfig) -> Result<TunnelInfo, AppError> {
        // 先清理已有的同 ID 隧道（单次写锁操作避免 TOCTOU 竞态）
        {
            let mut tunnels = self.tunnels.write().await;
            if let Some(old) = tunnels.remove(&config.tunnel_id) {
                old.cancel_token.cancel();
            }
        }

        let auth = config.to_auth_config();

        // 连接 SSH 服务器
        let ssh_config = ssh_auth::create_ssh_config();
        let mut session =
            client::connect(ssh_config, (&*config.ssh_host, config.ssh_port), TunnelSshClient)
                .await
                .map_err(|e| AppError::Other(format!("SSH tunnel connection failed: {}", e)))?;

        ssh_auth::authenticate(&mut session, &config.ssh_username, &auth).await?;

        let session = Arc::new(tokio::sync::Mutex::new(session));

        // 绑定本地 TCP 监听
        let listener = TcpListener::bind(("127.0.0.1", config.local_port))
            .await
            .map_err(|e| AppError::Other(format!("Failed to bind local port: {}", e)))?;

        let actual_port = listener
            .local_addr()
            .map_err(|e| AppError::Other(format!("Failed to get local addr: {}", e)))?
            .port();

        let cancel_token = CancellationToken::new();
        let token_clone = cancel_token.clone();
        let remote_host = config.remote_host.clone();
        let remote_port = config.remote_port;

        // 启动 TCP accept 循环，通过 SSH 转发连接
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = token_clone.cancelled() => break,
                    accept_result = listener.accept() => {
                        match accept_result {
                            Ok((mut tcp_stream, _)) => {
                                let session = session.clone();
                                let host = remote_host.clone();
                                let token = token_clone.clone();

                                tokio::spawn(async move {
                                    let channel = {
                                        let sess = session.lock().await;
                                        match sess.channel_open_direct_tcpip(
                                            &host,
                                            remote_port as u32,
                                            "127.0.0.1",
                                            0,
                                        ).await {
                                            Ok(ch) => ch,
                                            Err(_) => return,
                                        }
                                    };

                                    let mut stream = channel.into_stream();
                                    let (mut ssh_read, mut ssh_write) = tokio::io::split(&mut stream);
                                    let (mut tcp_read, mut tcp_write) = tcp_stream.split();

                                    tokio::select! {
                                        _ = token.cancelled() => {},
                                        _ = async {
                                            let mut buf1 = vec![0u8; 8192];
                                            let mut buf2 = vec![0u8; 8192];
                                            loop {
                                                tokio::select! {
                                                    result = tcp_read.read(&mut buf1) => {
                                                        match result {
                                                            Ok(0) | Err(_) => break,
                                                            Ok(n) => {
                                                                if ssh_write.write_all(&buf1[..n]).await.is_err() {
                                                                    break;
                                                                }
                                                            }
                                                        }
                                                    }
                                                    result = ssh_read.read(&mut buf2) => {
                                                        match result {
                                                            Ok(0) | Err(_) => break,
                                                            Ok(n) => {
                                                                if tcp_write.write_all(&buf2[..n]).await.is_err() {
                                                                    break;
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        } => {},
                                    }
                                });
                            }
                            Err(_) => break,
                        }
                    }
                }
            }
        });

        let info = TunnelInfo {
            tunnel_id: config.tunnel_id.clone(),
            local_port: actual_port,
            remote_host: config.remote_host,
            remote_port: config.remote_port,
            status: "active".to_string(),
        };

        self.tunnels.write().await.insert(
            config.tunnel_id,
            TunnelHandle {
                info: info.clone(),
                cancel_token,
            },
        );

        Ok(info)
    }

    pub async fn close_tunnel(&self, tunnel_id: &str) -> Result<bool, AppError> {
        if let Some(handle) = self.tunnels.write().await.remove(tunnel_id) {
            handle.cancel_token.cancel();
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub async fn list_tunnels(&self) -> Vec<TunnelInfo> {
        self.tunnels.read().await.values().map(|h| h.info.clone()).collect()
    }
}
