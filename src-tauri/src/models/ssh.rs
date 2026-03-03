use serde::{Deserialize, Serialize};

/// SSH 认证配置
#[derive(Debug, Clone)]
pub enum AuthConfig {
    Password { password: String },
    PrivateKey { key_path: String, passphrase: Option<String> },
}

/// 跳板机配置
#[derive(Debug, Clone)]
pub struct ProxyJumpConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: String,
    pub connection_id: String,
    pub connected_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelConfig {
    pub tunnel_id: String,
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_username: String,
    #[serde(default)]
    pub ssh_password: String,
    #[serde(default)]
    pub auth_method: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub passphrase: Option<String>,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

impl TunnelConfig {
    /// 从隧道配置构建认证信息
    pub fn to_auth_config(&self) -> AuthConfig {
        match self.auth_method.as_deref() {
            Some("key") => AuthConfig::PrivateKey {
                key_path: self.private_key_path.clone().unwrap_or_default(),
                passphrase: self.passphrase.clone(),
            },
            _ => AuthConfig::Password {
                password: self.ssh_password.clone(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelInfo {
    pub tunnel_id: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub status: String,
}
