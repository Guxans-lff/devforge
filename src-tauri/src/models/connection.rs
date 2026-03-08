use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub connection_type: String,
    pub group_id: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub config_json: String,
    pub color: Option<String>,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionGroup {
    pub id: String,
    pub name: String,
    pub sort_order: i32,
    pub parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConnectionRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub connection_type: String,
    pub group_id: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub config_json: String,
    pub color: Option<String>,
    pub password: Option<String>,
}

/// SSL/TLS 连接配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SslConfig {
    /// SSL 模式
    pub mode: SslMode,
    /// CA 证书文件路径
    pub ca_cert_path: Option<String>,
    /// 客户端证书文件路径
    pub client_cert_path: Option<String>,
    /// 客户端密钥文件路径
    pub client_key_path: Option<String>,
}

/// SSL 模式枚举
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SslMode {
    /// 禁用 SSL
    Disabled,
    /// 优先使用 SSL（如果服务器支持）
    Preferred,
    /// 必须使用 SSL
    Required,
    /// 验证 CA 证书
    VerifyCa,
    /// 验证服务器身份（CA + 主机名）
    VerifyIdentity,
}

/// 连接池配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolConfig {
    /// 最小连接数（默认 1）
    pub min_connections: u32,
    /// 最大连接数（默认 10）
    pub max_connections: u32,
    /// 空闲连接超时时间（秒，默认 300）
    pub idle_timeout_secs: u64,
}

impl PoolConfig {
    /// 校验连接池参数：最大连接数必须 >= 最小连接数
    pub fn validate(&self) -> Result<(), String> {
        if self.max_connections < self.min_connections {
            return Err(format!(
                "最大连接数({})不能小于最小连接数({})",
                self.max_connections, self.min_connections
            ));
        }
        Ok(())
    }
}

/// 连接池运行状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolStatus {
    /// 活跃连接数
    pub active_connections: u32,
    /// 空闲连接数
    pub idle_connections: u32,
    /// 最大连接数
    pub max_connections: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConnectionRequest {
    pub name: Option<String>,
    pub group_id: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub config_json: Option<String>,
    pub color: Option<String>,
    pub password: Option<String>,
}

/// 自动重连参数
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectParams {
    /// 数据库驱动类型（如 "mysql"、"postgresql"）
    pub driver: String,
    /// 主机地址
    pub host: String,
    /// 端口号
    pub port: u16,
    /// 用户名
    pub username: String,
    /// 密码
    pub password: String,
    /// 数据库名（可选）
    pub database: Option<String>,
    /// SSL/TLS 配置（可选）
    pub ssl_config: Option<SslConfig>,
    /// 连接池配置（可选）
    pub pool_config: Option<PoolConfig>,
}

/// 自动重连结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectResult {
    /// 重连是否成功
    pub success: bool,
    /// 第几次尝试成功（0 表示全部失败）
    pub attempt: u32,
    /// 结果描述信息
    pub message: String,
}

