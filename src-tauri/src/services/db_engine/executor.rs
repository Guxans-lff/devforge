use std::sync::Arc;
use std::time::{Duration, Instant};
use crate::models::query::{QueryChunk, QueryResult};
use crate::models::connection::{PoolStatus, ReconnectParams, ReconnectResult};
use crate::services::db_drivers::{mysql, postgres, DriverPool};
use crate::utils::error::AppError;
use super::{DbEngine, DEFAULT_QUERY_TIMEOUT_SECS};

impl DbEngine {
    pub async fn execute_query(
        &self,
        connection_id: &str,
        sql: &str,
        timeout_secs: Option<u64>,
    ) -> Result<QueryResult, AppError> {
        let pool = self.get_pool(connection_id).await?;
        let start = Instant::now();
        let trimmed = sql.trim();
        let timeout = timeout_secs.unwrap_or(DEFAULT_QUERY_TIMEOUT_SECS);

        let is_select = is_select_query(trimmed);

        let query_future = async {
            match pool.as_ref() {
                DriverPool::MySql(p) => {
                    if is_select {
                        mysql::execute_select(p, trimmed, start).await
                    } else {
                        mysql::execute_non_select(p, trimmed, start).await
                    }
                }
                DriverPool::Postgres(p) => {
                    if is_select {
                        postgres::execute_select(p, trimmed, start).await
                    } else {
                        postgres::execute_non_select(p, trimmed, start).await
                    }
                }
            }
        };

        match tokio::time::timeout(Duration::from_secs(timeout), query_future).await {
            Ok(result) => result,
            Err(_) => Err(AppError::Other(format!("查询超时：执行时间超过 {} 秒", timeout))),
        }
    }

    /// 在指定数据库上下文中执行查询
    pub async fn execute_query_in_database(
        &self,
        connection_id: &str,
        database: String,
        sql: String,
        timeout_secs: Option<u64>,
    ) -> Result<QueryResult, AppError> {
        let pool = self.get_pool(connection_id).await?;
        let start = Instant::now();
        let trimmed = sql.trim().to_owned();
        let timeout = timeout_secs.unwrap_or(DEFAULT_QUERY_TIMEOUT_SECS);
        let is_select = is_select_query(&trimmed);

        // 提前 clone 出具体驱动池，避免 async 块内持有 Arc<DriverPool> 的引用
        // 使用 tokio::spawn 隔离 Postgres 的生命周期问题
        match pool.as_ref() {
            DriverPool::MySql(p) => {
                let p = p.clone();
                let fut = async move {
                    if is_select {
                        mysql::execute_select_in_database(p, database, trimmed, start).await
                    } else {
                        mysql::execute_non_select_in_database(p, database, trimmed, start).await
                    }
                };
                match tokio::time::timeout(Duration::from_secs(timeout), fut).await {
                    Ok(result) => result,
                    Err(_) => Err(AppError::Other(format!("查询超时：执行时间超过 {} 秒", timeout))),
                }
            }
            DriverPool::Postgres(p) => {
                let p = p.clone();
                let fut = async move {
                    if is_select {
                        postgres::execute_select_in_database(p, database, trimmed, start).await
                    } else {
                        postgres::execute_non_select_in_database(p, database, trimmed, start).await
                    }
                };
                match tokio::time::timeout(Duration::from_secs(timeout), fut).await {
                    Ok(result) => result,
                    Err(_) => Err(AppError::Other(format!("查询超时：执行时间超过 {} 秒", timeout))),
                }
            }
        }
    }

    /// 在指定数据库上下文中流式执行查询
    pub async fn execute_query_stream_in_database(
        &self,
        connection_id: &str,
        database: String,
        sql: String,
        timeout_secs: Option<u64>,
        on_chunk: impl Fn(QueryChunk) -> Result<(), String> + Send + Sync + 'static,
    ) -> Result<(), AppError> {
        let pool = self.get_pool(connection_id).await?;
        let start = Instant::now();
        let timeout = timeout_secs.unwrap_or(DEFAULT_QUERY_TIMEOUT_SECS);

        let on_chunk_arc: Arc<dyn Fn(QueryChunk) -> Result<(), String> + Send + Sync + 'static> = Arc::new(on_chunk);
        let callback = Arc::clone(&on_chunk_arc);
        
        let stream_future = async {
            match pool.as_ref() {
                DriverPool::MySql(p) => {
                    mysql::execute_select_stream_in_database(p.clone(), database, sql, start, callback).await
                }
                DriverPool::Postgres(_) => {
                    Err(AppError::Other("Postgres 流式查询暂未实现".to_string()))
                }
            }
        };

        match tokio::time::timeout(Duration::from_secs(timeout), stream_future).await {
            Ok(result) => result,
            Err(_) => {
                let chunk = QueryChunk::error(0, start.elapsed().as_millis() as u64, format!("查询超时：执行时间超过 {} 秒", timeout));
                let _ = on_chunk_arc(chunk);
                Err(AppError::Other(format!("查询超时：执行时间超过 {} 秒", timeout)))
            }
        }
    }

    pub async fn execute_query_stream(
        &self,
        connection_id: &str,
        sql: &str,
        timeout_secs: Option<u64>,
        on_chunk: impl Fn(QueryChunk) -> Result<(), String>,
    ) -> Result<(), AppError> {
        let pool = self.get_pool(connection_id).await?;
        let start = Instant::now();
        let timeout = timeout_secs.unwrap_or(DEFAULT_QUERY_TIMEOUT_SECS);

        let stream_future = async {
            match pool.as_ref() {
                DriverPool::MySql(p) => mysql::execute_select_stream(p, sql, start, &on_chunk).await,
                DriverPool::Postgres(_) => Err(AppError::Other("PostgreSQL 暂不支持流式查询".into())),
            }
        };

        match tokio::time::timeout(Duration::from_secs(timeout), stream_future).await {
            Ok(result) => result,
            Err(_) => {
                let chunk = QueryChunk::error(0, start.elapsed().as_millis() as u64, format!("查询超时：执行时间超过 {} 秒", timeout));
                let _ = on_chunk(chunk);
                Err(AppError::Other(format!("查询超时：执行时间超过 {} 秒", timeout)))
            }
        }
    }

    pub async fn check_and_reconnect(
        &self,
        connection_id: &str,
        reconnect_params: &ReconnectParams,
    ) -> Result<ReconnectResult, AppError> {
        if self.check_connection_alive(connection_id).await {
            return Ok(ReconnectResult { success: true, attempt: 0, message: "OK".to_string() });
        }

        self.disconnect(connection_id).await;
        let max_retries = 3;
        for attempt in 1..=max_retries {
            let res = self.connect(
                connection_id, &reconnect_params.driver, &reconnect_params.host,
                reconnect_params.port, &reconnect_params.username, &reconnect_params.password,
                reconnect_params.database.as_deref(), reconnect_params.ssl_config.as_ref(),
                reconnect_params.pool_config.as_ref(),
            ).await;

            if res.is_ok() && self.check_connection_alive(connection_id).await {
                return Ok(ReconnectResult { success: true, attempt, message: "重连成功".to_string() });
            }
            if attempt < max_retries { tokio::time::sleep(Duration::from_secs(5)).await; }
        }
        Ok(ReconnectResult { success: false, attempt: max_retries, message: "重连失败".to_string() })
    }

    async fn check_connection_alive(&self, connection_id: &str) -> bool {
        let pool = match self.get_pool(connection_id).await {
            Ok(p) => p,
            Err(_) => return false,
        };
        match pool.as_ref() {
            DriverPool::MySql(p) => sqlx::query("SELECT 1").execute(p).await.is_ok(),
            DriverPool::Postgres(p) => sqlx::query("SELECT 1").execute(p).await.is_ok(),
        }
    }

    pub async fn cancel_query(&self, connection_id: &str) -> Result<(), AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::cancel_running_query(p).await,
            DriverPool::Postgres(p) => postgres::cancel_running_query(p).await,
        }
    }

    pub async fn get_pool_status(&self, connection_id: &str) -> Result<PoolStatus, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => Ok(PoolStatus {
                active_connections: p.size().saturating_sub(p.num_idle() as u32),
                idle_connections: p.num_idle() as u32,
                max_connections: p.options().get_max_connections(),
            }),
            DriverPool::Postgres(p) => Ok(PoolStatus {
                active_connections: p.size().saturating_sub(p.num_idle() as u32),
                idle_connections: p.num_idle() as u32,
                max_connections: p.options().get_max_connections(),
            }),
        }
    }
}


use super::is_select_query;
