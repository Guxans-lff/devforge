use std::time::{Duration, Instant};
use sqlx::mysql::{MySqlConnectOptions, MySqlPool, MySqlPoolOptions, MySqlSslMode};
use crate::models::connection::{PoolConfig, SslConfig, SslMode};
use crate::utils::error::AppError;

/// 建立 MySQL 连接池
pub async fn connect(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    database: Option<&str>,
    ssl_config: Option<&SslConfig>,
    pool_config: Option<&PoolConfig>,
) -> Result<MySqlPool, AppError> {
    if let Some(pc) = pool_config {
        pc.validate().map_err(AppError::Other)?;
    }

    let db_name = database.unwrap_or("");
    let url = format!(
        "mysql://{}:{}@{}:{}/{}?allowMultiQueries=true",
        urlencoding::encode(username),
        urlencoding::encode(password),
        host,
        port,
        db_name
    );

    let mut options: MySqlConnectOptions = url.parse()
        .map_err(|e| AppError::Other(format!("无效的连接 URL: {}", e)))?;

    options = apply_ssl_config(options, ssl_config)?;

    let pool = MySqlPoolOptions::new()
        .min_connections(pool_config.map(|c| c.min_connections).unwrap_or(2))
        .max_connections(pool_config.map(|c| c.max_connections).unwrap_or(10))
        .idle_timeout(Duration::from_secs(
            pool_config.map(|c| c.idle_timeout_secs).unwrap_or(1800)
        ))
        .max_lifetime(Duration::from_secs(3600)) // 连接最长存活 1 小时，防止服务端静默断开
        .acquire_timeout(Duration::from_secs(5))
        .test_before_acquire(true) // 每次取连接前 ping 检活，避免使用已断开的连接
        .connect_with(options)
        .await
        .map_err(|e| AppError::Other(format!("MySQL connection failed: {}", e)))?;

    Ok(pool)
}

/// 测试 MySQL 连接
pub async fn test_connect(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    database: Option<&str>,
    ssl_config: Option<&SslConfig>,
    pool_config: Option<&PoolConfig>,
) -> Result<u64, AppError> {
    if let Some(pc) = pool_config {
        pc.validate().map_err(AppError::Other)?;
    }

    let start = Instant::now();
    let db_name = database.unwrap_or("");
    let url = format!(
        "mysql://{}:{}@{}:{}/{}?allowMultiQueries=true",
        urlencoding::encode(username),
        urlencoding::encode(password),
        host,
        port,
        db_name
    );

    let mut options: MySqlConnectOptions = url.parse()
        .map_err(|e| AppError::Other(format!("无效的连接 URL: {}", e)))?;

    options = apply_ssl_config(options, ssl_config)?;

    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| AppError::Other(format!("{}", e)))?;

    let _: (i32,) = sqlx::query_as("SELECT 1")
        .fetch_one(&pool)
        .await
        .map_err(|e| AppError::Other(format!("{}", e)))?;

    pool.close().await;
    Ok(start.elapsed().as_millis() as u64)
}

/// 根据 SslConfig 配置 MySqlConnectOptions 的 SSL 选项
fn apply_ssl_config(
    mut options: MySqlConnectOptions,
    ssl_config: Option<&SslConfig>,
) -> Result<MySqlConnectOptions, AppError> {
    let config = match ssl_config {
        Some(c) => c,
        None => return Ok(options.ssl_mode(MySqlSslMode::Preferred)),
    };

    let ssl_mode = match config.mode {
        SslMode::Disabled => MySqlSslMode::Disabled,
        SslMode::Preferred => MySqlSslMode::Preferred,
        SslMode::Required => MySqlSslMode::Required,
        SslMode::VerifyCa => MySqlSslMode::VerifyCa,
        SslMode::VerifyIdentity => MySqlSslMode::VerifyIdentity,
    };
    options = options.ssl_mode(ssl_mode);

    if let Some(ref ca_path) = config.ca_cert_path {
        if !ca_path.is_empty() {
            validate_cert_file(ca_path)?;
            options = options.ssl_ca(ca_path);
        }
    }

    if let Some(ref cert_path) = config.client_cert_path {
        if !cert_path.is_empty() {
            validate_cert_file(cert_path)?;
            options = options.ssl_client_cert(cert_path);
        }
    }

    if let Some(ref key_path) = config.client_key_path {
        if !key_path.is_empty() {
            validate_cert_file(key_path)?;
            options = options.ssl_client_key(key_path);
        }
    }

    Ok(options)
}

fn validate_cert_file(path_str: &str) -> Result<(), AppError> {
    let path = std::path::Path::new(path_str);
    if !path.exists() {
        return Err(AppError::Other(format!("证书文件不存在: {}", path_str)));
    }
    if !path.is_file() {
        return Err(AppError::Other(format!("证书路径不是有效文件: {}", path_str)));
    }
    std::fs::read(path).map_err(|e| {
        AppError::Other(format!("无法读取证书文件 '{}': {}", path_str, e))
    })?;
    Ok(())
}
