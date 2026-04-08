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

// ── 服务器监控 ──────────────────────────────────────────────────

/// 磁盘分区信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub filesystem: String,
    pub mount_point: String,
    pub total_mb: u64,
    pub used_mb: u64,
    pub available_mb: u64,
    pub use_percent: f64,
}

/// 网络接口信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterface {
    pub name: String,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

/// 服务器采集指标（单次采样）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerMetrics {
    /// CPU 使用率（百分比）
    pub cpu_usage: f64,
    /// CPU 核心数
    pub cpu_cores: u32,
    /// 总内存（MB）
    pub memory_total: u64,
    /// 已用内存（MB）
    pub memory_used: u64,
    /// 可用内存（MB）
    pub memory_available: u64,
    /// Swap 总量（MB）
    pub swap_total: u64,
    /// Swap 已用（MB）
    pub swap_used: u64,
    /// 磁盘分区列表
    pub disks: Vec<DiskInfo>,
    /// 网络接口列表
    pub network: Vec<NetworkInterface>,
    /// 1/5/15 分钟负载均值
    pub load_avg: [f64; 3],
    /// 系统运行时间（秒）
    pub uptime_seconds: u64,
    /// 采集时间戳（毫秒）
    pub timestamp: u64,
}
