use tauri::Manager;

use crate::commands::connection::{StorageState, TestResult};
use crate::models::ssh::{AuthConfig, ProxyJumpConfig, SessionInfo};
use crate::services::ssh_auth;
use crate::services::ssh_engine::SshEngine;
use crate::utils::error::AppError;
use std::sync::Arc;
use tokio::time::Instant;

pub type SshEngineState = Arc<SshEngine>;

/// 从 connection 的 configJson 解析跳板机配置
pub async fn resolve_proxy_from_config(
    storage: &crate::services::storage::Storage,
    config_json: &str,
) -> Result<Option<ProxyJumpConfig>, AppError> {
    let config: serde_json::Value = serde_json::from_str(config_json)
        .unwrap_or_else(|_| serde_json::json!({}));

    let proxy_id = match config["proxyJump"]["connectionId"].as_str() {
        Some(id) if !id.is_empty() => id,
        _ => return Ok(None),
    };

    // storage.get_connection 返回 Result<_, AppError>，直接 ? 传播
    let proxy_conn = storage
        .get_connection(proxy_id)
        .await?;

    // ssh_auth::parse_auth_config 返回 Result<_, AppError>，直接 ? 传播
    let proxy_auth = ssh_auth::parse_auth_config(proxy_id, &proxy_conn.config_json)?;

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
    connection_id: String,
    cols: u32,
    rows: u32,
) -> Result<SessionInfo, AppError> {
    let ssh_engine = app_handle.state::<SshEngineState>().inner().clone();
    let storage = app_handle.state::<StorageState>().inner().clone();

    let conn = storage
        .get_connection(&connection_id)
        .await?;

    let auth = ssh_auth::parse_auth_config(&connection_id, &conn.config_json)?;

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
}

#[tauri::command]
pub async fn ssh_disconnect(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<bool, AppError> {
    let ssh_engine = app.state::<SshEngineState>().inner().clone();
    ssh_engine
        .disconnect(&session_id)
        .await?;
    Ok(true)
}

#[tauri::command]
pub async fn ssh_send_data(
    app: tauri::AppHandle,
    session_id: String,
    data: String,
) -> Result<(), AppError> {
    let ssh_engine = app.state::<SshEngineState>().inner().clone();
    ssh_engine
        .send_data(&session_id, data.as_bytes())
        .await
}

#[tauri::command]
pub async fn ssh_resize(
    app: tauri::AppHandle,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), AppError> {
    let ssh_engine = app.state::<SshEngineState>().inner().clone();
    ssh_engine
        .resize(&session_id, cols, rows)
        .await
}

#[tauri::command]
pub async fn ssh_flow_ack(
    app: tauri::AppHandle,
    session_id: String,
    bytes: u64,
) -> Result<(), AppError> {
    let ssh_engine = app.state::<SshEngineState>().inner().clone();
    ssh_engine
        .flow_ack(&session_id, bytes)
        .await
}

#[tauri::command]
pub async fn ssh_get_cwd(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<String, AppError> {
    let ssh_engine = app.state::<SshEngineState>().inner().clone();
    ssh_engine
        .get_cwd(&session_id)
        .await
}

#[tauri::command]
pub async fn ssh_exec_command(
    app_handle: tauri::AppHandle,
    connection_id: String,
    command: String,
) -> Result<String, AppError> {
    let storage = app_handle.state::<StorageState>().inner().clone();
    let conn = storage
        .get_connection(&connection_id)
        .await?;

    let auth = ssh_auth::parse_auth_config(&connection_id, &conn.config_json)?;

    let config = crate::services::ssh_auth::create_ssh_config();
    // russh::client::connect 返回 russh::Error，包装为 AppError::Connection
    let mut session = russh::client::connect(config, (&*conn.host, conn.port as u16), TestSshClient)
        .await
        .map_err(|e| AppError::Connection(format!("SSH 连接失败: {}", e)))?;

    // ssh_auth::authenticate 返回 Result<_, AppError>，直接 ? 传播
    ssh_auth::authenticate(&mut session, &conn.username, &auth)
        .await?;

    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| AppError::Connection(format!("打开通道失败: {}", e)))?;

    channel
        .exec(true, command.as_bytes())
        .await
        .map_err(|e| AppError::Connection(format!("执行命令失败: {}", e)))?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();

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
        return Err(AppError::Timeout("命令执行超时（10秒）".to_string()));
    }

    if !stderr.is_empty() {
        let err_msg = String::from_utf8_lossy(&stderr);
        if stdout.is_empty() {
            return Err(AppError::Other(err_msg.trim().to_string()));
        }
    }

    String::from_utf8(stdout)
        .map(|s| s.trim().to_string())
        .map_err(|e| AppError::Other(format!("输出解码失败: {}", e)))
}

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
) -> Result<u64, AppError> {
    let start = Instant::now();
    let config = crate::services::ssh_auth::create_ssh_config();

    // russh::client::connect 返回 russh::Error，包装为 AppError::Connection
    let mut session = russh::client::connect(config, (host, port), TestSshClient)
        .await
        .map_err(|e| AppError::Connection(format!("SSH connection failed: {}", e)))?;

    // ssh_auth::authenticate 返回 Result<_, AppError>，直接 ? 传播
    ssh_auth::authenticate(&mut session, username, auth)
        .await?;

    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "")
        .await;

    Ok(start.elapsed().as_millis() as u64)
}

#[tauri::command]
pub async fn ssh_test_connection(
    app: tauri::AppHandle,
    id: String,
) -> Result<TestResult, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let conn = storage
        .get_connection(&id)
        .await?;

    let auth = ssh_auth::parse_auth_config(&id, &conn.config_json)?;

    // ssh_test_connect 现在返回 AppError，Err(e) 需要 .to_string() 赋值给 message
    match ssh_test_connect(&conn.host, conn.port as u16, &conn.username, &auth).await {
        Ok(latency) => Ok(TestResult {
            success: true,
            message: format!("Connected to {}:{} ({}ms)", conn.host, conn.port, latency),
            latency_ms: Some(latency),
        }),
        Err(e) => Ok(TestResult {
            success: false,
            message: e.to_string(),
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
) -> Result<TestResult, AppError> {
    let auth = match auth_method.as_deref() {
        Some("key") => AuthConfig::PrivateKey {
            key_path: private_key_path.unwrap_or_default(),
            passphrase,
        },
        _ => AuthConfig::Password { password },
    };

    // ssh_test_connect 现在返回 AppError，Err(e) 需要 .to_string() 赋值给 message
    match ssh_test_connect(&host, port, &username, &auth).await {
        Ok(latency) => Ok(TestResult {
            success: true,
            message: format!("Connected to {}:{} ({}ms)", host, port, latency),
            latency_ms: Some(latency),
        }),
        Err(e) => Ok(TestResult {
            success: false,
            message: e.to_string(),
            latency_ms: None,
        }),
    }
}
