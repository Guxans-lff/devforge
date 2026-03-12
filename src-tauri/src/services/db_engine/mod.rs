use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use sqlx::pool::PoolConnection;

use crate::services::db_drivers::DriverPool;
use crate::utils::error::AppError;
use crate::models::connection::{PoolConfig, SslConfig};

pub mod executor;
pub mod tx;
pub mod meta;
pub mod export;

pub const DEFAULT_QUERY_TIMEOUT_SECS: u64 = 30;

/// 事务专用连接，持有从连接池 acquire 的独占连接
pub enum TransactionConnection {
    MySql(Mutex<PoolConnection<sqlx::MySql>>),
    Postgres(Mutex<PoolConnection<sqlx::Postgres>>),
}

pub struct MonitoringState {
    pub questions: u64,
    pub com_commit: u64,
    pub com_rollback: u64,
    pub uptime: u64,
}

pub struct DbEngine {
    /// 连接池映射：connection_id -> DriverPool
    pub connections: RwLock<HashMap<String, Arc<DriverPool>>>,
    /// 事务连接映射：connection_id -> 专用事务连接
    pub transactions: RwLock<HashMap<String, Arc<TransactionConnection>>>,
    /// 性能监控历史状态：connection_id -> 上一次采样点
    pub monitoring_states: RwLock<HashMap<String, MonitoringState>>,
}

impl DbEngine {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
            transactions: RwLock::new(HashMap::new()),
            monitoring_states: RwLock::new(HashMap::new()),
        }
    }

    pub async fn connect(
        &self,
        connection_id: &str,
        driver: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        database: Option<&str>,
        ssl_config: Option<&SslConfig>,
        pool_config: Option<&PoolConfig>,
    ) -> Result<(), AppError> {
        use crate::services::db_drivers::{mysql, postgres};
        // 先断开已有连接
        self.disconnect(connection_id).await;

        let pool = match driver {
            "postgresql" => {
                let pg_pool = postgres::connect(host, port, username, password, database).await?;
                DriverPool::Postgres(pg_pool)
            }
            _ => {
                let my_pool = mysql::connect(host, port, username, password, database, ssl_config, pool_config).await?;
                DriverPool::MySql(my_pool)
            }
        };

        self.connections
            .write()
            .await
            .insert(connection_id.to_string(), Arc::new(pool));
        Ok(())
    }

    pub async fn disconnect(&self, connection_id: &str) {
        self.transactions.write().await.remove(connection_id);
        self.monitoring_states.write().await.remove(connection_id);
        let pool = self.connections.write().await.remove(connection_id);
        if let Some(pool) = pool {
            pool.close().await;
        }
    }

    pub async fn is_connected(&self, connection_id: &str) -> bool {
        self.connections.read().await.contains_key(connection_id)
    }

    pub async fn get_pool(&self, connection_id: &str) -> Result<Arc<DriverPool>, AppError> {
        self.connections
            .read()
            .await
            .get(connection_id)
            .cloned()
            .ok_or_else(|| AppError::Other(format!("No active connection: {}", connection_id)))
    }

    pub async fn test_connect(
        driver: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        database: Option<&str>,
        ssl_config: Option<&SslConfig>,
        pool_config: Option<&PoolConfig>,
    ) -> Result<u64, AppError> {
        use crate::services::db_drivers::{mysql, postgres};
        let start = std::time::Instant::now();
        match driver {
            "postgresql" => {
                let _ = postgres::connect(host, port, username, password, database).await?;
            }
            _ => {
                let _ = mysql::connect(host, port, username, password, database, ssl_config, pool_config).await?;
            }
        }
        Ok(start.elapsed().as_millis() as u64)
    }
}

impl Default for DbEngine {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) fn is_select_query(sql: &str) -> bool {
    let lower = sql.trim_start().to_uppercase();
    lower.starts_with("SELECT") || lower.starts_with("SHOW") || 
    lower.starts_with("DESCRIBE") || lower.starts_with("EXPLAIN")
}
