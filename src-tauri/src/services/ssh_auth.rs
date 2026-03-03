use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use russh::client;

use crate::models::ssh::{AuthConfig, ProxyJumpConfig};
use crate::services::credential::CredentialManager;
use crate::utils::error::AppError;

/// 跳板机连接用的 SSH handler
struct ProxyClient;

#[async_trait]
impl client::Handler for ProxyClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// 从 connection 的 config_json 解析认证配置
pub fn parse_auth_config(
    connection_id: &str,
    config_json: &str,
) -> Result<AuthConfig, AppError> {
    let config: serde_json::Value = serde_json::from_str(config_json)
        .unwrap_or_else(|_| serde_json::json!({}));

    let auth_method = config["authMethod"].as_str().unwrap_or("password");

    match auth_method {
        "key" => {
            let key_path = config["privateKeyPath"]
                .as_str()
                .ok_or_else(|| AppError::Other("未配置私钥路径".into()))?
                .to_string();

            // 密码短语从 credential manager 获取
            let passphrase = CredentialManager::get(&format!("{}:passphrase", connection_id))
                .ok()
                .flatten();

            Ok(AuthConfig::PrivateKey { key_path, passphrase })
        }
        _ => {
            let password = CredentialManager::get(connection_id)?
                .ok_or_else(|| AppError::Other("未设置密码".into()))?;
            Ok(AuthConfig::Password { password })
        }
    }
}

/// 对已建立的 SSH 会话执行认证
pub async fn authenticate<H: client::Handler>(
    session: &mut client::Handle<H>,
    username: &str,
    auth: &AuthConfig,
) -> Result<(), AppError> {
    match auth {
        AuthConfig::Password { password } => {
            let ok = session
                .authenticate_password(username, password)
                .await
                .map_err(|e| AppError::Other(format!("密码认证错误: {}", e)))?;
            if !ok {
                return Err(AppError::Other("密码认证失败: 用户名或密码错误".into()));
            }
        }
        AuthConfig::PrivateKey { key_path, passphrase } => {
            let path = Path::new(key_path);
            if !path.exists() {
                return Err(AppError::Other(format!("私钥文件不存在: {}", key_path)));
            }

            let key = ssh_key::PrivateKey::read_openssh_file(path)
                .map_err(|e| AppError::Other(format!("读取私钥失败: {}", e)))?;

            // 如果私钥已加密，尝试解密
            let key = if key.is_encrypted() {
                let phrase = passphrase
                    .as_deref()
                    .ok_or_else(|| AppError::Other("私钥已加密，需要密码短语".into()))?;
                key.decrypt(phrase)
                    .map_err(|e| AppError::Other(format!("私钥解密失败: {}", e)))?
            } else {
                key
            };

            let ok = session
                .authenticate_publickey(username, Arc::new(key))
                .await
                .map_err(|e| AppError::Other(format!("私钥认证错误: {}", e)))?;
            if !ok {
                return Err(AppError::Other("私钥认证失败".into()));
            }
        }
    }
    Ok(())
}

/// 通过跳板机建立到目标主机的 SSH 连接
/// 返回 (目标 session handle, 跳板机 keepalive handle)
/// 调用方需要保持 keepalive handle 存活，否则连接会断开
pub async fn connect_via_proxy<H>(
    proxy: &ProxyJumpConfig,
    target_host: &str,
    target_port: u16,
    target_username: &str,
    target_auth: &AuthConfig,
    target_handler: H,
) -> Result<(client::Handle<H>, Box<dyn std::any::Any + Send + Sync>), AppError>
where
    H: client::Handler + Send + 'static,
    H::Error: std::fmt::Display,
{
    // 1. 连接跳板机
    let proxy_config = Arc::new(client::Config::default());
    let mut proxy_session = client::connect(proxy_config, (&*proxy.host, proxy.port), ProxyClient)
        .await
        .map_err(|e| AppError::Other(format!("跳板机连接失败: {}", e)))?;

    authenticate(&mut proxy_session, &proxy.username, &proxy.auth).await
        .map_err(|e| AppError::Other(format!("跳板机认证失败: {}", e)))?;

    // 2. 通过跳板机打开到目标的 TCP 通道
    let channel = proxy_session
        .channel_open_direct_tcpip(target_host, target_port as u32, "127.0.0.1", 0)
        .await
        .map_err(|e| AppError::Other(format!("跳板机通道打开失败: {}", e)))?;

    let stream = channel.into_stream();

    // 3. 在通道上建立第二层 SSH 连接
    let target_config = Arc::new(client::Config::default());
    let mut target_session = client::connect_stream(target_config, stream, target_handler)
        .await
        .map_err(|e| AppError::Other(format!("通过跳板机连接目标失败: {}", e)))?;

    authenticate(&mut target_session, target_username, target_auth).await?;

    // 类型擦除跳板机 handle，调用方只需保持它存活
    Ok((target_session, Box::new(proxy_session)))
}
