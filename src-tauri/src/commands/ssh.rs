use std::sync::Arc;
use std::time::Instant;

use tauri::State;

use crate::commands::connection::{StorageState, TestResult};
use crate::models::ssh::{AuthConfig, ProxyJumpConfig, SessionInfo};
use crate::services::ssh_auth;
use crate::services::ssh_engine::SshEngine;

pub type SshEngineState = Arc<SshEngine>;

/// 从 connection 的 configJson 解析跳板机配置
pub async fn resolve_proxy_from_config(
    storage: &crate::services::storage::Storage,
    config_json: &str,
) -> Result<Option<ProxyJumpConfig>, String> {
    let config: serde_json::Value = serde_json::from_str(config_json)
        .unwrap_or_else(|_| serde_json::json!({}));

    let proxy_id = match config["proxyJump"]["connectionId"].as_str() {
        Some(id) if !id.is_empty() => id,
        _ => return Ok(None),
    };

    let proxy_conn = storage
        .get_connection(proxy_id)
        .await
        .map_err(|e| format!("获取跳板机连接失败: {}", e))?;

    let proxy_auth = ssh_auth::parse_auth_config(proxy_id, &proxy_conn.config_json)
        .map_err(|e| format!("解析跳板机认证失败: {}", e))?;

    Ok(Some(ProxyJumpConfig {
        host: proxy_conn.host,
        port: proxy_conn.port as u16,
        username: proxy_conn.username,
        auth: proxy_auth,
    }))
}

#[tauri::command]
pub async fn ssh_connect(
    app_handle: tauri::AppHandle,
    ssh_engine: State<'_, SshEngineState>,
    storage: State<'_, StorageState>,
    connection_id: String,
    cols: u32,
    rows: u32,
) -> Result<SessionInfo, String> {
    let conn = storage
        .get_connection(&connection_id)
        .await
        .map_err(|e| e.to_string())?;

    let auth = ssh_auth::parse_auth_config(&connection_id, &conn.config_json)
        .map_err(|e| e.to_string())?;

    let proxy = resolve_proxy_from_config(&storage, &conn.config_json).await?;

    let session_id = uuid::Uuid::new_v4().to_string();

    ssh_engine
        .connect(
            &app_handle,
            &session_id,
            &connection_id,
            &conn.host,
            conn.port as u16,
            &conn.username,
            &auth,
            proxy.as_ref(),
            cols,
            rows,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_disconnect(
    ssh_engine: State<'_, SshEngineState>,
    session_id: String,
) -> Result<bool, String> {
    ssh_engine
        .disconnect(&session_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn ssh_send_data(
    ssh_engine: State<'_, SshEngineState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    ssh_engine
        .send_data(&session_id, data.as_bytes())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_resize(
    ssh_engine: State<'_, SshEngineState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    ssh_engine
        .resize(&session_id, cols, rows)
        .await
        .map_err(|e| e.to_string())
}

/// 通过 connectionId 建立短连接执行单条命令并返回输出
#[tauri::command]
pub async fn ssh_exec_command(
    storage: State<'_, StorageState>,
    connection_id: String,
    command: String,
) -> Result<String, String> {
    let conn = storage
        .get_connection(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    let auth = ssh_auth::parse_auth_config(&connection_id, &conn.config_json)
        .map_err(|e| e.to_string())?;

    let config = Arc::new(russh::client::Config::default());
    let mut session = russh::client::connect(config, (&*conn.host, conn.port as u16), TestSshClient)
        .await
        .map_err(|e| format!("SSH 连接失败: {}", e))?;

    ssh_auth::authenticate(&mut session, &conn.username, &auth)
        .await
        .map_err(|e| e.to_string())?;

    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("打开通道失败: {}", e))?;

    channel
        .exec(true, command.as_bytes())
        .await
        .map_err(|e| format!("执行命令失败: {}", e))?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();

    // 带超时的输出读取（10 秒）
    let result = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            match channel.wait().await {
                Some(russh::ChannelMsg::Data { data }) => {
                    stdout.extend_from_slice(&data);
                }
                Some(russh::ChannelMsg::ExtendedData { data, ext }) if ext == 1 => {
                    stderr.extend_from_slice(&data);
                }
                Some(russh::ChannelMsg::Eof) | None => break,
                _ => {}
            }
        }
    })
    .await;

    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "")
        .await;

    if result.is_err() {
        return Err("命令执行超时（10秒）".to_string());
    }

    if !stderr.is_empty() {
        let err_msg = String::from_utf8_lossy(&stderr);
        if stdout.is_empty() {
            return Err(err_msg.trim().to_string());
        }
    }

    String::from_utf8(stdout)
        .map(|s| s.trim().to_string())
        .map_err(|e| format!("输出解码失败: {}", e))
}

// --- SSH test connection ---

struct TestSshClient;

#[async_trait::async_trait]
impl russh::client::Handler for TestSshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

async fn ssh_test_connect(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthConfig,
) -> Result<u64, String> {
    let start = Instant::now();
    let config = Arc::new(russh::client::Config::default());

    let mut session = russh::client::connect(config, (host, port), TestSshClient)
        .await
        .map_err(|e| format!("SSH connection failed: {}", e))?;

    ssh_auth::authenticate(&mut session, username, auth)
        .await
        .map_err(|e| e.to_string())?;

    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "")
        .await;

    Ok(start.elapsed().as_millis() as u64)
}

#[tauri::command]
pub async fn ssh_test_connection(
    storage: State<'_, StorageState>,
    id: String,
) -> Result<TestResult, String> {
    let conn = storage
        .get_connection(&id)
        .await
        .map_err(|e| e.to_string())?;

    let auth = ssh_auth::parse_auth_config(&id, &conn.config_json)
        .map_err(|e| e.to_string())?;

    match ssh_test_connect(&conn.host, conn.port as u16, &conn.username, &auth).await {
        Ok(latency) => Ok(TestResult {
            success: true,
            message: format!("Connected to {}:{} ({}ms)", conn.host, conn.port, latency),
            latency_ms: Some(latency),
        }),
        Err(e) => Ok(TestResult {
            success: false,
            message: e,
            latency_ms: None,
        }),
    }
}

#[tauri::command]
pub async fn ssh_test_connection_params(
    host: String,
    port: u16,
    username: String,
    password: String,
    auth_method: Option<String>,
    private_key_path: Option<String>,
    passphrase: Option<String>,
) -> Result<TestResult, String> {
    let auth = match auth_method.as_deref() {
        Some("key") => AuthConfig::PrivateKey {
            key_path: private_key_path.unwrap_or_default(),
            passphrase,
        },
        _ => AuthConfig::Password { password },
    };

    match ssh_test_connect(&host, port, &username, &auth).await {
        Ok(latency) => Ok(TestResult {
            success: true,
            message: format!("Connected to {}:{} ({}ms)", host, port, latency),
            latency_ms: Some(latency),
        }),
        Err(e) => Ok(TestResult {
            success: false,
            message: e,
            latency_ms: None,
        }),
    }
}
