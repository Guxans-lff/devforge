use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use sqlx::pool::PoolConnection;
use tokio::sync::{Mutex, RwLock};

use crate::models::connection::{PoolConfig, PoolStatus, ReconnectParams, ReconnectResult, SslConfig};
use crate::models::import_export::{ExportFormat, ExportOptions, ExportRequest, ExportResult, ExportSource};
use crate::models::query::{ApplyChangesResult, ChangeType, ColumnInfo, DatabaseInfo, KeyValue, QueryResult, RoutineInfo, RowChange, ScriptOptions, TableInfo, TriggerInfo, ViewInfo, ServerStatus, ServerVariable, ProcessInfo, MysqlUser, CreateUserRequest};
use crate::services::db_drivers::DriverPool;
use crate::services::db_drivers::{mysql, postgres};
use crate::utils::error::AppError;

const DEFAULT_QUERY_TIMEOUT_SECS: u64 = 30;

/// 事务专用连接，持有从连接池 acquire 的独占连接
/// 使用 Mutex 保护，确保事务内操作的串行执行
pub enum TransactionConnection {
    MySql(Mutex<PoolConnection<sqlx::MySql>>),
    Postgres(Mutex<PoolConnection<sqlx::Postgres>>),
}

pub struct DbEngine {
    /// 连接池映射：connection_id -> DriverPool
    connections: RwLock<HashMap<String, Arc<DriverPool>>>,
    /// 事务连接映射：connection_id -> 专用事务连接
    transactions: RwLock<HashMap<String, Arc<TransactionConnection>>>,
    /// 性能监控历史状态：connection_id -> 上一次采样点
    monitoring_states: RwLock<HashMap<String, MonitoringState>>,
}

pub struct MonitoringState {
    pub questions: u64,
    pub com_commit: u64,
    pub com_rollback: u64,
    pub uptime: u64,
}

impl DbEngine {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
            transactions: RwLock::new(HashMap::new()),
            monitoring_states: RwLock::new(HashMap::new()),
        }
    }

    #[allow(clippy::too_many_arguments)]
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
        // 先清理事务连接与监控状态
        self.transactions.write().await.remove(connection_id);
        self.monitoring_states.write().await.remove(connection_id);
        let pool = self.connections.write().await.remove(connection_id);
        if let Some(pool) = pool {
            pool.close().await;
        }
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
        match driver {
            "postgresql" => postgres::test_connect(host, port, username, password, database).await,
            _ => mysql::test_connect(host, port, username, password, database, ssl_config, pool_config).await,
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

    pub async fn execute_query(
        &self,
        connection_id: &str,
        sql: &str,
        timeout_secs: Option<u64>,
    ) -> Result<QueryResult, AppError> {
        let pool = self.get_pool(connection_id).await?;
        let start = Instant::now();
        let trimmed = sql.trim();
        // 使用传入的超时值，未指定时使用默认 30 秒
        let timeout = timeout_secs.unwrap_or(DEFAULT_QUERY_TIMEOUT_SECS);

        let is_select = trimmed
            .split_whitespace()
            .next()
            .map(|w| {
                let upper = w.to_uppercase();
                upper == "SELECT" || upper == "SHOW" || upper == "DESCRIBE" || upper == "EXPLAIN"
            })
            .unwrap_or(false);

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

        match tokio::time::timeout(
            Duration::from_secs(timeout),
            query_future,
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(AppError::Other(format!(
                "查询超时：执行时间超过 {} 秒",
                timeout
            ))),
        }
    }

    /// 在指定数据库上下文中执行查询
    ///
    /// 从连接池获取单个连接，先执行 USE <database> 切换数据库，
    /// 再执行用户 SQL，确保两条语句在同一个连接上执行。
    ///
    /// # 参数
    /// - `connection_id` - 连接 ID
    /// - `database` - 目标数据库名
    /// - `sql` - 用户 SQL 语句
    /// - `timeout_secs` - 可选超时时间（秒）
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

        let is_select = trimmed
            .split_whitespace()
            .next()
            .map(|w| {
                let upper = w.to_uppercase();
                upper == "SELECT" || upper == "SHOW" || upper == "DESCRIBE" || upper == "EXPLAIN"
            })
            .unwrap_or(false);

        // 关键修复：使用 tokio::spawn 隔离 _in_database 的 Future
        // Tauri #[command] 宏要求 async fn 的 Future 满足 Send，
        // 但 _in_database 内部的 PoolConnection deref 引用不满足 Send
        // tokio::spawn 将其隔离到独立任务中，只返回 JoinHandle
        let (mysql_pool, pg_pool) = pool.clone_inner_pools();
        let handle = tokio::task::spawn_blocking(move || {
            tokio::runtime::Handle::current().block_on(async move {
                if let Some(owned_pool) = mysql_pool {
                    if is_select {
                        mysql::execute_select_in_database(owned_pool, database, trimmed, start).await
                    } else {
                        mysql::execute_non_select_in_database(owned_pool, database, trimmed, start).await
                    }
                } else if let Some(owned_pool) = pg_pool {
                    if is_select {
                        postgres::execute_select_in_database(owned_pool, database, trimmed, start).await
                    } else {
                        postgres::execute_non_select_in_database(owned_pool, database, trimmed, start).await
                    }
                } else {
                    Err(AppError::Other("未知的数据库驱动类型".to_string()))
                }
            })
        });

        match tokio::time::timeout(Duration::from_secs(timeout), handle).await {
            Ok(Ok(result)) => result,
            Ok(Err(e)) => Err(AppError::Other(format!("任务执行失败: {}", e))),
            Err(_) => Err(AppError::Other(format!(
                "查询超时：执行时间超过 {} 秒",
                timeout
            ))),
        }
    }

    /// 在指定数据库上下文中流式执行查询
    ///
    /// 与 execute_query_in_database 类似，但使用流式推送结果。
    /// 从连接池获取单个连接，先执行 USE <database>，再流式执行用户 SQL。
    pub async fn execute_query_stream_in_database(
        &self,
        connection_id: &str,
        database: String,
        sql: String,
        timeout_secs: Option<u64>,
        on_chunk: impl Fn(crate::models::query::QueryChunk) -> Result<(), String> + Send + Sync + 'static,
    ) -> Result<(), AppError> {
        let pool = self.get_pool(connection_id).await?;
        let start = Instant::now();
        let timeout = timeout_secs.unwrap_or(DEFAULT_QUERY_TIMEOUT_SECS);

        // 关键修复：使用 tokio::spawn 隔离 Future
        let (mysql_pool, _pg_pool) = pool.clone_inner_pools();
        let on_chunk_arc = Arc::new(on_chunk);
        let on_chunk_clone = Arc::clone(&on_chunk_arc); // Keep cloning from on_chunk_arc for correctness
        let handle = tokio::task::spawn_blocking(move || {
            tokio::runtime::Handle::current().block_on(async move {
                if let Some(owned_pool) = mysql_pool {
                    mysql::execute_select_stream_in_database(owned_pool, database, sql, start, on_chunk_clone).await
                } else {
                    // 目前 Postgres 流式查询暂未实现，直接返回错误
                    Err(AppError::Other("Postgres 流式查询暂未实现".to_string()))
                }
            })
        });

        match tokio::time::timeout(Duration::from_secs(timeout), handle).await {
            Ok(Ok(result)) => result,
            Ok(Err(e)) => Err(AppError::Other(format!("任务执行失败: {}", e))),
            Err(_) => {
                let chunk = crate::models::query::QueryChunk {
                    chunk_index: 0,
                    columns: vec![],
                    rows: vec![],
                    is_last: true,
                    total_time_ms: Some(start.elapsed().as_millis() as u64),
                    error: Some(format!("查询超时：执行时间超过 {} 秒", timeout)),
                };
                let _ = on_chunk_arc(chunk);
                Err(AppError::Other(format!("查询超时：执行时间超过 {} 秒", timeout)))
            }
        }
    }

    /// 流式执行查询，通过 on_chunk 回调逐批推送结果
    pub async fn execute_query_stream(
        &self,
        connection_id: &str,
        sql: &str,
        timeout_secs: Option<u64>,
        on_chunk: impl Fn(crate::models::query::QueryChunk) -> Result<(), String>,
    ) -> Result<(), AppError> {
        let pool = self.get_pool(connection_id).await?;
        let start = Instant::now();
        let timeout = timeout_secs.unwrap_or(DEFAULT_QUERY_TIMEOUT_SECS);

        let stream_future = async {
            match pool.as_ref() {
                DriverPool::MySql(p) => {
                    mysql::execute_select_stream(p, sql, start, &on_chunk).await
                }
                DriverPool::Postgres(_) => {
                    // PostgreSQL 暂不支持流式查询，回退到普通查询
                    Err(AppError::Other("Streaming not yet supported for PostgreSQL".into()))
                }
            }
        };

        match tokio::time::timeout(Duration::from_secs(timeout), stream_future).await {
            Ok(result) => result,
            Err(_) => {
                // 超时时发送错误 chunk
                let chunk = crate::models::query::QueryChunk {
                    chunk_index: 0,
                    columns: vec![],
                    rows: vec![],
                    is_last: true,
                    total_time_ms: Some(start.elapsed().as_millis() as u64),
                    error: Some(format!("查询超时：执行时间超过 {} 秒", timeout)),
                };
                let _ = on_chunk(chunk);
                Err(AppError::Other(format!("查询超时：执行时间超过 {} 秒", timeout)))
            }
        }
    }

    pub async fn get_databases(
        &self,
        connection_id: &str,
    ) -> Result<Vec<DatabaseInfo>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_databases(p).await,
            DriverPool::Postgres(p) => postgres::get_databases(p).await,
        }
    }

    pub async fn get_tables(
        &self,
        connection_id: &str,
        database: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_tables(p, database).await,
            DriverPool::Postgres(p) => postgres::get_tables(p, database).await,
        }
    }

    pub async fn get_columns(
        &self,
        connection_id: &str,
        database: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_columns(p, database, table).await,
            DriverPool::Postgres(p) => postgres::get_columns(p, database, table).await,
        }
    }

    pub async fn get_table_data(
        &self,
        connection_id: &str,
        database: &str,
        table: &str,
        page: u32,
        page_size: u32,
        where_clause: Option<&str>,
        order_by: Option<&str>,
    ) -> Result<QueryResult, AppError> {
        let pool = self.get_pool(connection_id).await?;
        let offset = page.saturating_sub(1) * page_size;

        // 构建分页查询和 COUNT 查询
        let (data_sql, count_sql) = match pool.as_ref() {
            DriverPool::MySql(_) => (
                mysql::build_table_data_sql(database, table, page_size, offset, where_clause, order_by)
                    .map_err(|e| AppError::Other(e))?,
                mysql::build_table_count_sql(database, table, where_clause)
                    .map_err(|e| AppError::Other(e))?,
            ),
            DriverPool::Postgres(_) => (
                postgres::build_table_data_sql(database, table, page_size, offset, where_clause, order_by)
                    .map_err(|e| AppError::Other(e))?,
                postgres::build_table_count_sql(database, table, where_clause)
                    .map_err(|e| AppError::Other(e))?,
            ),
        };

        // 并行执行数据查询和 COUNT 查询
        let (data_result, count_result) = tokio::join!(
            self.execute_query(connection_id, &data_sql, None),
            self.execute_query(connection_id, &count_sql, None)
        );

        let mut result = data_result?;

        // 从 COUNT 结果中提取总行数
        if let Ok(count_res) = count_result {
            if let Some(first_row) = count_res.rows.first() {
                if let Some(val) = first_row.first() {
                    result.total_count = val.as_i64();
                }
            }
        }

        Ok(result)
    }

    pub async fn get_create_table(
        &self,
        connection_id: &str,
        database: &str,
        table: &str,
    ) -> Result<String, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_create_table(p, database, table).await,
            DriverPool::Postgres(p) => postgres::get_create_table(p, database, table).await,
        }
    }

    pub async fn get_views(
        &self,
        connection_id: &str,
        database: &str,
    ) -> Result<Vec<ViewInfo>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_views(p, database).await,
            DriverPool::Postgres(p) => postgres::get_views(p, database).await,
        }
    }

    pub async fn get_routines(
        &self,
        connection_id: &str,
        database: &str,
        routine_type: &str,
    ) -> Result<Vec<RoutineInfo>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_routines(p, database, routine_type).await,
            DriverPool::Postgres(p) => postgres::get_routines(p, database, routine_type).await,
        }
    }

    pub async fn get_triggers(
        &self,
        connection_id: &str,
        database: &str,
    ) -> Result<Vec<TriggerInfo>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_triggers(p, database).await,
            DriverPool::Postgres(p) => postgres::get_triggers(p, database).await,
        }
    }

    pub async fn get_object_definition(
        &self,
        connection_id: &str,
        database: &str,
        name: &str,
        object_type: &str,
    ) -> Result<String, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::get_object_definition(p, database, name, object_type).await,
            DriverPool::Postgres(p) => postgres::get_object_definition(p, database, name, object_type).await,
        }
    }

    /// 取消指定连接上的活跃查询（服务端取消）
    pub async fn cancel_query(&self, connection_id: &str) -> Result<(), AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => mysql::cancel_running_query(p).await,
            DriverPool::Postgres(p) => postgres::cancel_running_query(p).await,
        }
    }

    /// 获取指定连接的连接池状态（活跃/空闲连接数）
    pub async fn get_pool_status(&self, connection_id: &str) -> Result<PoolStatus, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(p) => {
                let size = p.size();
                let idle = p.num_idle();
                let max = p.options().get_max_connections();
                Ok(PoolStatus {
                    active_connections: size.saturating_sub(idle as u32),
                    idle_connections: idle as u32,
                    max_connections: max,
                })
            }
            DriverPool::Postgres(p) => {
                let size = p.size();
                let idle = p.num_idle();
                let max = p.options().get_max_connections();
                Ok(PoolStatus {
                    active_connections: size.saturating_sub(idle as u32),
                    idle_connections: idle as u32,
                    max_connections: max,
                })
            }
        }
    }

    /// 检查连接是否存活，如果断开则尝试自动重连
    ///
    /// 重连逻辑：
    /// 1. 先执行 SELECT 1 检查连接是否存活
    /// 2. 如果连接正常，直接返回成功
    /// 3. 如果连接断开，断开旧连接，尝试重新连接
    /// 4. 最多重试 3 次，每次间隔 5 秒
    /// 5. 返回 ReconnectResult 包含成功/失败状态和尝试次数
    pub async fn check_and_reconnect(
        &self,
        connection_id: &str,
        reconnect_params: &ReconnectParams,
    ) -> Result<ReconnectResult, AppError> {
        // 步骤 1：检查连接是否存活
        let is_alive = self.check_connection_alive(connection_id).await;

        if is_alive {
            return Ok(ReconnectResult {
                success: true,
                attempt: 0,
                message: "连接正常，无需重连".to_string(),
            });
        }

        // 步骤 2：连接已断开，断开旧连接并尝试重连
        log::warn!("连接 {} 已断开，开始自动重连", connection_id);
        self.disconnect(connection_id).await;

        let max_retries: u32 = 3;
        let retry_interval = Duration::from_secs(5);

        for attempt in 1..=max_retries {
            log::info!("连接 {} 重连尝试 {}/{}", connection_id, attempt, max_retries);

            let db_opt = reconnect_params.database.as_deref();
            let result = self.connect(
                connection_id,
                &reconnect_params.driver,
                &reconnect_params.host,
                reconnect_params.port,
                &reconnect_params.username,
                &reconnect_params.password,
                db_opt,
                reconnect_params.ssl_config.as_ref(),
                reconnect_params.pool_config.as_ref(),
            ).await;

            match result {
                Ok(()) => {
                    // 重连成功，验证连接可用
                    if self.check_connection_alive(connection_id).await {
                        log::info!("连接 {} 重连成功（第 {} 次尝试）", connection_id, attempt);
                        return Ok(ReconnectResult {
                            success: true,
                            attempt,
                            message: format!("重连成功（第 {} 次尝试）", attempt),
                        });
                    }
                }
                Err(e) => {
                    log::warn!(
                        "连接 {} 第 {} 次重连失败: {}",
                        connection_id, attempt, e
                    );
                }
            }

            // 非最后一次尝试时等待重试间隔
            if attempt < max_retries {
                tokio::time::sleep(retry_interval).await;
            }
        }

        // 所有重试均失败
        log::error!("连接 {} 自动重连失败，已达最大重试次数 {}", connection_id, max_retries);
        Ok(ReconnectResult {
            success: false,
            attempt: 0,
            message: format!("重连失败：已尝试 {} 次均未成功", max_retries),
        })
    }

    /// 检查指定连接是否存活（通过执行 SELECT 1）
    async fn check_connection_alive(&self, connection_id: &str) -> bool {
        let pool = match self.get_pool(connection_id).await {
            Ok(p) => p,
            Err(_) => return false,
        };

        match pool.as_ref() {
            DriverPool::MySql(p) => {
                sqlx::query("SELECT 1")
                    .execute(p)
                    .await
                    .is_ok()
            }
            DriverPool::Postgres(p) => {
                sqlx::query("SELECT 1")
                    .execute(p)
                    .await
                    .is_ok()
            }
        }
    }

    // ==================== 事务管理 ====================

    /// 开始事务
    ///
    /// 从连接池 acquire 一个专用连接，执行 BEGIN 语句，
    /// 并将该连接存储到 transactions 映射中。
    /// 后续事务内操作将使用该专用连接。
    ///
    /// # 参数
    /// - `connection_id` - 连接 ID
    ///
    /// # 返回
    /// 成功返回 true，如果已有活跃事务则返回错误
    pub async fn begin_transaction(&self, connection_id: &str) -> Result<bool, AppError> {
        // 检查是否已有活跃事务
        if self.transactions.read().await.contains_key(connection_id) {
            return Err(AppError::Other(
                "该连接已有活跃事务，请先提交或回滚".to_string(),
            ));
        }

        let pool = self.get_pool(connection_id).await?;

        let txn_conn = match pool.as_ref() {
            DriverPool::MySql(p) => {
                let mut conn = p.acquire().await.map_err(|e| {
                    AppError::Other(format!("获取专用连接失败: {}", e))
                })?;
                // 在专用连接上执行 BEGIN
                sqlx::query("BEGIN")
                    .execute(&mut *conn)
                    .await
                    .map_err(|e| AppError::Other(format!("BEGIN 执行失败: {}", e)))?;
                TransactionConnection::MySql(Mutex::new(conn))
            }
            DriverPool::Postgres(p) => {
                let mut conn = p.acquire().await.map_err(|e| {
                    AppError::Other(format!("获取专用连接失败: {}", e))
                })?;
                sqlx::query("BEGIN")
                    .execute(&mut *conn)
                    .await
                    .map_err(|e| AppError::Other(format!("BEGIN 执行失败: {}", e)))?;
                TransactionConnection::Postgres(Mutex::new(conn))
            }
        };

        self.transactions
            .write()
            .await
            .insert(connection_id.to_string(), Arc::new(txn_conn));

        log::info!("连接 {} 开始事务", connection_id);
        Ok(true)
    }

    /// 提交事务
    ///
    /// 在专用连接上执行 COMMIT，然后释放连接并清除事务状态。
    ///
    /// # 参数
    /// - `connection_id` - 连接 ID
    ///
    /// # 返回
    /// 成功返回 true，无活跃事务时返回错误
    pub async fn commit_transaction(&self, connection_id: &str) -> Result<bool, AppError> {
        let txn_conn = self
            .transactions
            .write()
            .await
            .remove(connection_id)
            .ok_or_else(|| AppError::Other("该连接没有活跃事务".to_string()))?;

        match txn_conn.as_ref() {
            TransactionConnection::MySql(conn) => {
                let mut guard = conn.lock().await;
                sqlx::query("COMMIT")
                    .execute(&mut *guard as &mut sqlx::MySqlConnection)
                    .await
                    .map_err(|e| AppError::Other(format!("COMMIT 执行失败: {}", e)))?;
            }
            TransactionConnection::Postgres(conn) => {
                let mut guard = conn.lock().await;
                sqlx::query("COMMIT")
                    .execute(&mut *guard as &mut sqlx::PgConnection)
                    .await
                    .map_err(|e| AppError::Other(format!("COMMIT 执行失败: {}", e)))?;
            }
        }
        // txn_conn 被 drop 后，PoolConnection 自动归还连接池

        log::info!("连接 {} 事务已提交", connection_id);
        Ok(true)
    }

    /// 回滚事务
    ///
    /// 在专用连接上执行 ROLLBACK，然后释放连接并清除事务状态。
    ///
    /// # 参数
    /// - `connection_id` - 连接 ID
    ///
    /// # 返回
    /// 成功返回 true，无活跃事务时返回错误
    pub async fn rollback_transaction(&self, connection_id: &str) -> Result<bool, AppError> {
        let txn_conn = self
            .transactions
            .write()
            .await
            .remove(connection_id)
            .ok_or_else(|| AppError::Other("该连接没有活跃事务".to_string()))?;

        match txn_conn.as_ref() {
            TransactionConnection::MySql(conn) => {
                let mut guard = conn.lock().await;
                sqlx::query("ROLLBACK")
                    .execute(&mut *guard as &mut sqlx::MySqlConnection)
                    .await
                    .map_err(|e| AppError::Other(format!("ROLLBACK 执行失败: {}", e)))?;
            }
            TransactionConnection::Postgres(conn) => {
                let mut guard = conn.lock().await;
                sqlx::query("ROLLBACK")
                    .execute(&mut *guard as &mut sqlx::PgConnection)
                    .await
                    .map_err(|e| AppError::Other(format!("ROLLBACK 执行失败: {}", e)))?;
            }
        }

        log::info!("连接 {} 事务已回滚", connection_id);
        Ok(true)
    }

    /// 在事务内执行查询
    ///
    /// 使用事务专用连接执行 SQL，确保查询在同一事务上下文中。
    /// 如果该连接没有活跃事务，则回退到普通连接池执行。
    ///
    /// # 参数
    /// - `connection_id` - 连接 ID
    /// - `sql` - SQL 语句
    ///
    /// # 返回
    /// 查询结果
    pub async fn execute_in_transaction(
        &self,
        connection_id: &str,
        sql: &str,
    ) -> Result<QueryResult, AppError> {
        let txn_conn = {
            self.transactions.read().await.get(connection_id).cloned()
        };

        // 如果没有活跃事务，回退到普通执行
        let txn_conn = match txn_conn {
            Some(c) => c,
            None => return self.execute_query(connection_id, sql, None).await,
        };

        let start = Instant::now();
        let trimmed = sql.trim();

        let is_select = trimmed
            .split_whitespace()
            .next()
            .map(|w| {
                let upper = w.to_uppercase();
                upper == "SELECT" || upper == "SHOW" || upper == "DESCRIBE" || upper == "EXPLAIN"
            })
            .unwrap_or(false);

        let query_future = async {
            match txn_conn.as_ref() {
                TransactionConnection::MySql(conn) => {
                    let mut guard = conn.lock().await;
                    if is_select {
                        mysql::execute_select_on_conn(&mut *guard, trimmed, start).await
                    } else {
                        mysql::execute_non_select_on_conn(&mut *guard, trimmed, start).await
                    }
                }
                TransactionConnection::Postgres(conn) => {
                    let mut guard = conn.lock().await;
                    if is_select {
                        postgres::execute_select_on_conn(&mut *guard, trimmed, start).await
                    } else {
                        postgres::execute_non_select_on_conn(&mut *guard, trimmed, start).await
                    }
                }
            }
        };

        match tokio::time::timeout(
            Duration::from_secs(DEFAULT_QUERY_TIMEOUT_SECS),
            query_future,
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(AppError::Other(format!(
                "事务内查询超时（{}秒）",
                DEFAULT_QUERY_TIMEOUT_SECS
            ))),
        }
    }

    /// 检查指定连接是否有活跃事务
    pub async fn has_active_transaction(&self, connection_id: &str) -> bool {
        self.transactions.read().await.contains_key(connection_id)
    }

    /// 批量应用行数据变更
    ///
    /// 根据 RowChange 列表生成 UPDATE/INSERT/DELETE SQL 语句，
    /// 在一个事务中执行所有变更，任一失败则全部回滚。
    ///
    /// # 参数
    /// - `connection_id` - 连接 ID
    /// - `changes` - 行变更列表
    ///
    /// # 返回
    /// - `ApplyChangesResult` 包含执行结果和生成的 SQL
    pub async fn apply_row_changes(
        &self,
        connection_id: &str,
        changes: Vec<RowChange>,
    ) -> Result<ApplyChangesResult, AppError> {
        if changes.is_empty() {
            return Ok(ApplyChangesResult {
                success: true,
                affected_rows: 0,
                generated_sql: vec![],
                error: None,
            });
        }

        // 生成所有 SQL 语句
        let mut sql_statements: Vec<String> = Vec::new();
        for change in &changes {
            let sql = self.generate_change_sql(change)?;
            sql_statements.push(sql);
        }

        let pool = self.get_pool(connection_id).await?;

        // 在事务中执行所有变更
        let result = match pool.as_ref() {
            DriverPool::MySql(p) => {
                self.execute_changes_in_transaction_mysql(p, &sql_statements).await
            }
            DriverPool::Postgres(p) => {
                self.execute_changes_in_transaction_pg(p, &sql_statements).await
            }
        };

        match result {
            Ok(affected) => Ok(ApplyChangesResult {
                success: true,
                affected_rows: affected,
                generated_sql: sql_statements,
                error: None,
            }),
            Err(e) => Ok(ApplyChangesResult {
                success: false,
                affected_rows: 0,
                generated_sql: sql_statements,
                error: Some(e.to_string()),
            }),
        }
    }

    /// 根据 RowChange 生成对应的 SQL 语句
    fn generate_change_sql(&self, change: &RowChange) -> Result<String, AppError> {
        let table_ref = format!("`{}`.`{}`", change.database, change.table);

        match change.change_type {
            ChangeType::Update => {
                if change.primary_keys.is_empty() {
                    return Err(AppError::Other("UPDATE 操作需要主键".to_string()));
                }
                if change.values.is_empty() {
                    return Err(AppError::Other("UPDATE 操作需要变更值".to_string()));
                }
                let set_clause: Vec<String> = change.values.iter()
                    .map(|cv| format!("`{}` = {}", cv.column, self.value_to_sql(&cv.value)))
                    .collect();
                let where_clause = self.build_where_clause(&change.primary_keys)?;
                Ok(format!("UPDATE {} SET {} WHERE {}", table_ref, set_clause.join(", "), where_clause))
            }
            ChangeType::Insert => {
                if change.values.is_empty() {
                    return Err(AppError::Other("INSERT 操作需要列值".to_string()));
                }
                let columns: Vec<String> = change.values.iter()
                    .map(|cv| format!("`{}`", cv.column))
                    .collect();
                let values: Vec<String> = change.values.iter()
                    .map(|cv| self.value_to_sql(&cv.value))
                    .collect();
                Ok(format!("INSERT INTO {} ({}) VALUES ({})", table_ref, columns.join(", "), values.join(", ")))
            }
            ChangeType::Delete => {
                if change.primary_keys.is_empty() {
                    return Err(AppError::Other("DELETE 操作需要主键".to_string()));
                }
                let where_clause = self.build_where_clause(&change.primary_keys)?;
                Ok(format!("DELETE FROM {} WHERE {}", table_ref, where_clause))
            }
        }
    }

    /// 将 JSON 值转换为 SQL 字面量
    fn value_to_sql(&self, value: &serde_json::Value) -> String {
        match value {
            serde_json::Value::Null => "NULL".to_string(),
            serde_json::Value::Bool(b) => if *b { "1".to_string() } else { "0".to_string() },
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => {
                // 转义单引号，防止 SQL 注入
                let escaped = s.replace('\'', "''");
                format!("'{}'", escaped)
            }
            _ => {
                // 其他类型（数组、对象）序列化为 JSON 字符串
                let escaped = value.to_string().replace('\'', "''");
                format!("'{}'", escaped)
            }
        }
    }

    /// 构建 WHERE 子句
    fn build_where_clause(&self, keys: &[KeyValue]) -> Result<String, AppError> {
        if keys.is_empty() {
            return Err(AppError::Other("WHERE 子句需要至少一个条件".to_string()));
        }
        let conditions: Vec<String> = keys.iter()
            .map(|kv| {
                if kv.value.is_null() {
                    format!("`{}` IS NULL", kv.column)
                } else {
                    format!("`{}` = {}", kv.column, self.value_to_sql(&kv.value))
                }
            })
            .collect();
        Ok(conditions.join(" AND "))
    }

    /// 在 MySQL 事务中执行变更
    async fn execute_changes_in_transaction_mysql(
        &self,
        pool: &sqlx::MySqlPool,
        statements: &[String],
    ) -> Result<u64, AppError> {
        use sqlx::Executor;
        let mut conn = pool.acquire().await.map_err(AppError::Database)?;
        conn.execute("BEGIN").await.map_err(AppError::Database)?;

        let mut total_affected: u64 = 0;
        for sql in statements {
            match conn.execute(sql.as_str()).await {
                Ok(result) => {
                    total_affected += result.rows_affected();
                }
                Err(e) => {
                    // 回滚事务
                    let _ = conn.execute("ROLLBACK").await;
                    return Err(AppError::Other(format!("执行失败，已回滚: {} | SQL: {}", e, sql)));
                }
            }
        }

        conn.execute("COMMIT").await.map_err(AppError::Database)?;
        Ok(total_affected)
    }

    /// 在 PostgreSQL 事务中执行变更
    async fn execute_changes_in_transaction_pg(
        &self,
        pool: &sqlx::PgPool,
        statements: &[String],
    ) -> Result<u64, AppError> {
        use sqlx::Executor;
        let mut conn = pool.acquire().await.map_err(AppError::Database)?;
        conn.execute("BEGIN").await.map_err(AppError::Database)?;

        let mut total_affected: u64 = 0;
        for sql in statements {
            match conn.execute(sql.as_str()).await {
                Ok(result) => {
                    total_affected += result.rows_affected();
                }
                Err(e) => {
                    // 回滚事务
                    let _ = conn.execute("ROLLBACK").await;
                    return Err(AppError::Other(format!("执行失败，已回滚: {} | SQL: {}", e, sql)));
                }
            }
        }

        conn.execute("COMMIT").await.map_err(AppError::Database)?;
        Ok(total_affected)
    }

    // ===== 性能监控方法 =====

    /// 获取服务器状态指标（QPS、TPS、连接数等）
    pub async fn get_server_status(&self, connection_id: &str) -> Result<ServerStatus, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(pool) => {
                use sqlx::Row;
                // 获取 GLOBAL STATUS
                let rows: Vec<sqlx::mysql::MySqlRow> = sqlx::query("SHOW GLOBAL STATUS")
                    .fetch_all(pool)
                    .await
                    .map_err(AppError::Database)?;

                let mut status_map: HashMap<String, String> = HashMap::new();
                for row in &rows {
                    let name: String = row.try_get("Variable_name").unwrap_or_default();
                    let value: String = row.try_get("Value").unwrap_or_default();
                    status_map.insert(name.to_lowercase(), value);
                }

                let raw_status: Vec<ServerVariable> = rows.iter().map(|row| {
                    ServerVariable {
                        name: row.try_get("Variable_name").unwrap_or_default(),
                        value: row.try_get("Value").unwrap_or_default(),
                    }
                }).collect();

                // 解析关键指标
                let questions: u64 = status_map.get("questions").and_then(|v| v.parse().ok()).unwrap_or(0);
                let uptime: u64 = status_map.get("uptime").and_then(|v| v.parse().ok()).unwrap_or(1);
                let com_commit: u64 = status_map.get("com_commit").and_then(|v| v.parse().ok()).unwrap_or(0);
                let com_rollback: u64 = status_map.get("com_rollback").and_then(|v| v.parse().ok()).unwrap_or(0);
                let threads_connected: u64 = status_map.get("threads_connected").and_then(|v| v.parse().ok()).unwrap_or(0);
                let threads_running: u64 = status_map.get("threads_running").and_then(|v| v.parse().ok()).unwrap_or(0);
                let slow_queries: u64 = status_map.get("slow_queries").and_then(|v| v.parse().ok()).unwrap_or(0);
                let bytes_sent: u64 = status_map.get("bytes_sent").and_then(|v| v.parse().ok()).unwrap_or(0);
                let bytes_received: u64 = status_map.get("bytes_received").and_then(|v| v.parse().ok()).unwrap_or(0);

                // 缓冲池使用率 (修正：MySQL 返回的是页面数，计算比例应返回 0.0-1.0)
                let bp_pages_total: f64 = status_map.get("innodb_buffer_pool_pages_total").and_then(|v| v.parse().ok()).unwrap_or(1.0);
                let bp_pages_free: f64 = status_map.get("innodb_buffer_pool_pages_free").and_then(|v| v.parse().ok()).unwrap_or(0.0);
                let buffer_pool_usage = if bp_pages_total > 0.0 {
                    (bp_pages_total - bp_pages_free) / bp_pages_total
                } else {
                    0.0
                };

                // ===== 增量计算瞬时 QPS/TPS =====
                let mut m_states = self.monitoring_states.write().await;
                let last_state = m_states.get(connection_id);
                
                let (qps, tps) = if let Some(last) = last_state {
                    let d_uptime = uptime.saturating_sub(last.uptime);
                    if d_uptime > 0 {
                        let d_questions = questions.saturating_sub(last.questions);
                        let d_tx = (com_commit + com_rollback).saturating_sub(last.com_commit + last.com_rollback);
                        (d_questions as f64 / d_uptime as f64, d_tx as f64 / d_uptime as f64)
                    } else {
                        // 采样时间太短，保持上次（或趋于启动均值）
                        (questions as f64 / uptime as f64, (com_commit + com_rollback) as f64 / uptime as f64)
                    }
                } else {
                    // 首次采样，回退到启动以来的均值
                    (questions as f64 / uptime as f64, (com_commit + com_rollback) as f64 / uptime as f64)
                };

                // 更新历史点
                m_states.insert(connection_id.to_string(), MonitoringState {
                    questions,
                    com_commit,
                    com_rollback,
                    uptime,
                });

                Ok(ServerStatus {
                    qps,
                    tps,
                    active_connections: threads_running,
                    total_connections: threads_connected,
                    buffer_pool_usage,
                    slow_queries,
                    uptime,
                    bytes_sent,
                    bytes_received,
                    raw_status,
                })
            }
            _ => Err(AppError::Other("仅支持 MySQL 的性能监控".to_string())),
        }
    }

    /// 获取进程列表
    pub async fn get_process_list(&self, connection_id: &str) -> Result<Vec<ProcessInfo>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(pool) => {
                use sqlx::{Row, Column};
                let rows: Vec<sqlx::mysql::MySqlRow> = sqlx::query("SHOW FULL PROCESSLIST")
                    .fetch_all(pool)
                    .await
                    .map_err(AppError::Database)?;

                let processes = rows.iter().map(|row| {
                    // 建立列名映射（转小写），防止不同版本 MySQL 字段名大小写不一 (Id vs id)
                    let col_map = row.columns()
                        .iter()
                        .enumerate()
                        .map(|(i, col)| (col.name().to_lowercase(), i))
                        .collect::<HashMap<String, usize>>();

                    let get_val = |key: &str| -> Option<&str> {
                        col_map.get(key).and_then(|&idx| row.try_get::<&str, _>(idx).ok())
                    };
                    
                    let get_id = |key: &str| -> u64 {
                        col_map.get(key).and_then(|&idx| {
                            // 尝试多种数字类型读取，Id 可能是 u64 也可能是 i64 等
                            row.try_get::<u64, _>(idx)
                                .or_else(|_| row.try_get::<i64, _>(idx).map(|v| v as u64))
                                .or_else(|_| row.try_get::<i32, _>(idx).map(|v| v as u64))
                                .ok()
                        }).unwrap_or(0)
                    };

                    let get_time = |key: &str| -> u64 {
                        col_map.get(key).and_then(|&idx| {
                            row.try_get::<u64, _>(idx)
                                .or_else(|_| row.try_get::<i64, _>(idx).map(|v| v as u64))
                                .or_else(|_| row.try_get::<i32, _>(idx).map(|v| v as u64))
                                .ok()
                        }).unwrap_or(0)
                    };

                    ProcessInfo {
                        id: get_id("id"),
                        user: get_val("user").unwrap_or_default().to_string(),
                        host: get_val("host").unwrap_or_default().to_string(),
                        db: get_val("db").map(|v| v.to_string()),
                        command: get_val("command").unwrap_or_default().to_string(),
                        time: get_time("time"),
                        state: get_val("state").map(|v| v.to_string()),
                        info: get_val("info").map(|v| v.to_string()),
                    }
                }).collect();

                Ok(processes)
            }
            _ => Err(AppError::Other("仅支持 MySQL 的进程列表".to_string())),
        }
    }

    /// 终止指定进程
    pub async fn kill_process(&self, connection_id: &str, process_id: u64) -> Result<bool, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(pool) => {
                sqlx::query(&format!("KILL {}", process_id))
                    .execute(pool)
                    .await
                    .map_err(AppError::Database)?;
                Ok(true)
            }
            _ => Err(AppError::Other("仅支持 MySQL 的进程终止".to_string())),
        }
    }

    /// 获取服务器变量
    pub async fn get_server_variables(&self, connection_id: &str) -> Result<Vec<ServerVariable>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(pool) => {
                use sqlx::Row;
                let rows: Vec<sqlx::mysql::MySqlRow> = sqlx::query("SHOW GLOBAL VARIABLES")
                    .fetch_all(pool)
                    .await
                    .map_err(AppError::Database)?;

                let variables = rows.iter().map(|row| {
                    ServerVariable {
                        name: row.try_get("Variable_name").unwrap_or_default(),
                        value: row.try_get("Value").unwrap_or_default(),
                    }
                }).collect();

                Ok(variables)
            }
            _ => Err(AppError::Other("仅支持 MySQL 的服务器变量查询".to_string())),
        }
    }

    // ===== 用户权限管理方法 =====

    /// 获取所有 MySQL 用户
    /// 获取所有 MySQL 用户
    pub async fn get_users(&self, connection_id: &str) -> Result<Vec<MysqlUser>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(pool) => {
                use sqlx::Row;
                let rows: Vec<sqlx::mysql::MySqlRow> = sqlx::query(
                    "SELECT User, Host, authentication_string, plugin, account_locked, password_expired FROM mysql.user ORDER BY User, Host"
                )
                    .fetch_all(pool)
                    .await
                    .map_err(AppError::Database)?;

                let users = rows.iter().map(|row| {
                    // 使用可靠的字符串提取逻辑（处理 VARBINARY）
                    let user = row.try_get::<String, _>("User")
                        .or_else(|_| row.try_get::<Vec<u8>, _>("User").map(|b| String::from_utf8_lossy(&b).to_string()))
                        .unwrap_or_default();
                    let host = row.try_get::<String, _>("Host")
                        .or_else(|_| row.try_get::<Vec<u8>, _>("Host").map(|b| String::from_utf8_lossy(&b).to_string()))
                        .unwrap_or_default();

                    MysqlUser {
                        user,
                        host,
                        authentication_string: row.try_get("authentication_string").ok(),
                        plugin: row.try_get("plugin").ok(),
                        account_locked: row.try_get("account_locked").ok(),
                        password_expired: row.try_get("password_expired").ok(),
                    }
                }).collect();

                Ok(users)
            }
            _ => Err(AppError::Other("仅支持 MySQL 的用户管理".to_string())),
        }
    }

    /// 创建新用户
    pub async fn create_user(&self, connection_id: &str, req: &CreateUserRequest) -> Result<bool, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(pool) => {
                let plugin_clause = if let Some(ref plugin) = req.plugin {
                    format!(" WITH '{}'", plugin)
                } else {
                    String::new()
                };
                // 密码过期策略
                let expire_clause = match req.password_expire_days {
                    Some(days) => format!(" PASSWORD EXPIRE INTERVAL {} DAY", days),
                    None => String::new(),
                };
                let sql = format!(
                    "CREATE USER '{}'@'{}' IDENTIFIED{} BY '{}'{}",
                    req.username.replace('\'', "\\'"),
                    req.host.replace('\'', "\\'"),
                    plugin_clause,
                    req.password.replace('\'', "\\'"),
                    expire_clause,
                );
                sqlx::query(&sql)
                    .execute(pool)
                    .await
                    .map_err(AppError::Database)?;
                Ok(true)
            }
            _ => Err(AppError::Other("仅支持 MySQL 的用户创建".to_string())),
        }
    }

    /// 删除用户
    pub async fn drop_user(&self, connection_id: &str, username: &str, host: &str) -> Result<bool, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(pool) => {
                let sql = format!(
                    "DROP USER '{}'@'{}'",
                    username.replace('\'', "\\'"),
                    host.replace('\'', "\\'"),
                );
                sqlx::query(&sql)
                    .execute(pool)
                    .await
                    .map_err(AppError::Database)?;
                Ok(true)
            }
            _ => Err(AppError::Other("仅支持 MySQL 的用户删除".to_string())),
        }
    }

    /// 获取用户权限
    pub async fn get_user_grants(&self, connection_id: &str, username: &str, host: &str) -> Result<Vec<String>, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(pool) => {
                use sqlx::Row;
                // 增加非空校验防御逻辑
                let username_fixed = if username.is_empty() { "''" } else { username };
                let host_fixed = if host.is_empty() { "%" } else { host };

                let sql = format!(
                    "SHOW GRANTS FOR '{}'@'{}'",
                    username_fixed.replace('\'', "\\'"),
                    host_fixed.replace('\'', "\\'"),
                );
                let rows: Vec<sqlx::mysql::MySqlRow> = sqlx::query(&sql)
                    .fetch_all(pool)
                    .await
                    .map_err(AppError::Database)?;

                let grants: Vec<String> = rows.iter().map(|row| {
                    // SHOW GRANTS 返回的列名是动态的，取第一列
                    row.try_get::<String, _>(0).unwrap_or_default()
                }).collect();

                Ok(grants)
            }
            _ => Err(AppError::Other("仅支持 MySQL 的权限查询".to_string())),
        }
    }

    /// 批量执行 GRANT/REVOKE 语句
    pub async fn apply_grants(&self, connection_id: &str, statements: Vec<String>) -> Result<bool, AppError> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            DriverPool::MySql(pool) => {
                for sql in &statements {
                    sqlx::query(sql)
                        .execute(pool)
                        .await
                        .map_err(|e| AppError::Other(format!("执行权限语句失败: {} | SQL: {}", e, sql)))?;
                }
                // 刷新权限
                sqlx::query("FLUSH PRIVILEGES")
                    .execute(pool)
                    .await
                    .map_err(AppError::Database)?;
                Ok(true)
            }
            _ => Err(AppError::Other("仅支持 MySQL 的权限管理".to_string())),
        }
    }

    // ===== 数据导出方法 =====

    /// 导出数据到文件
    ///
    /// 支持 CSV、JSON、SQL、Excel、Markdown 五种格式。
    /// 大数据量（>100,000 行）使用分批查询流式写入，通过 Tauri 事件发送进度。
    ///
    /// # 参数
    /// - `connection_id` - 连接 ID
    /// - `request` - 导出请求（包含数据来源、格式、文件路径和选项）
    /// - `app` - Tauri AppHandle，用于发送进度事件
    pub async fn export_data(
        &self,
        connection_id: &str,
        request: &ExportRequest,
        app: &tauri::AppHandle,
    ) -> Result<ExportResult, AppError> {
        use tauri::Emitter;

        let pool = self.get_pool(connection_id).await?;

        // 根据数据来源构建查询 SQL 和表名
        let (query_sql, table_name) = match &request.source {
            ExportSource::Query { sql, database } => {
                // 先切换数据库
                if let DriverPool::MySql(p) = pool.as_ref() {
                    let use_sql = format!("USE `{}`", database);
                    sqlx::query(&use_sql).execute(p).await.map_err(AppError::Database)?;
                }
                (sql.clone(), String::from("query_result"))
            }
            ExportSource::Table { database, table } => {
                let sql = format!("SELECT * FROM `{}`.`{}`", database, table);
                (sql, table.clone())
            }
        };

        // 获取有效的表名（SQL 导出时使用）
        let export_table_name = request.options.sql_table_name
            .as_deref()
            .unwrap_or(&table_name);

        // 先查询总行数以决定是否分批
        let count_sql = format!("SELECT COUNT(*) AS cnt FROM ({}) AS _export_sub", &query_sql);
        let total_rows: u64 = match pool.as_ref() {
            DriverPool::MySql(p) => {
                let count_result = mysql::execute_select(p, &count_sql, Instant::now()).await?;
                count_result.rows.first()
                    .and_then(|r| r.first())
                    .and_then(|v| v.as_u64().or_else(|| v.as_i64().map(|i| i as u64)))
                    .unwrap_or(0)
            }
            _ => {
                return Err(AppError::Other("数据导出目前仅支持 MySQL".to_string()));
            }
        };

        // 大数据量阈值
        const BATCH_THRESHOLD: u64 = 100_000;
        const BATCH_SIZE: u64 = 10_000;

        let mysql_pool = match pool.as_ref() {
            DriverPool::MySql(p) => p,
            _ => return Err(AppError::Other("数据导出目前仅支持 MySQL".to_string())),
        };

        // 根据格式执行导出
        if total_rows <= BATCH_THRESHOLD {
            // 小数据量：一次性查询并写入
            let result = mysql::execute_select(mysql_pool, &query_sql, Instant::now()).await?;

            // 发送 100% 进度
            let _ = app.emit("export-progress", serde_json::json!({
                "current": total_rows,
                "total": total_rows,
                "percentage": 100.0
            }));

            self.write_export_file(
                &request.file_path,
                &request.format,
                &request.options,
                &result.columns,
                &result.rows,
                export_table_name,
                mysql_pool,
                &request.source,
            ).await
        } else {
            // 大数据量：分批查询流式写入
            self.export_data_batched(
                mysql_pool,
                &query_sql,
                total_rows,
                BATCH_SIZE,
                &request.file_path,
                &request.format,
                &request.options,
                export_table_name,
                app,
                &request.source,
            ).await
        }
    }

    /// 分批查询并流式写入文件（大数据量场景）
    async fn export_data_batched(
        &self,
        pool: &sqlx::MySqlPool,
        base_sql: &str,
        total_rows: u64,
        batch_size: u64,
        file_path: &str,
        format: &ExportFormat,
        options: &ExportOptions,
        table_name: &str,
        app: &tauri::AppHandle,
        source: &ExportSource,
    ) -> Result<ExportResult, AppError> {
        use tauri::Emitter;
        use std::io::Write;

        let file = std::fs::File::create(file_path)
            .map_err(|e| AppError::Other(format!("创建导出文件失败: {}", e)))?;
        let mut writer = std::io::BufWriter::new(file);

        let mut total_exported: u64 = 0;
        let mut columns_written = false;
        let mut columns_cache: Vec<crate::models::query::ColumnDef> = Vec::new();

        // Excel 导出需要特殊处理（使用 rust_xlsxwriter）
        if matches!(format, ExportFormat::Excel) {
            return self.export_excel_batched(
                pool, base_sql, total_rows, batch_size, file_path, app,
            ).await;
        }

        // JSON 格式写入开头的 [
        if matches!(format, ExportFormat::Json) {
            writer.write_all(b"[\n")
                .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
        }

        // SQL 格式：如果需要 CREATE TABLE，先写入
        if matches!(format, ExportFormat::Sql) {
            if options.sql_include_create.unwrap_or(false) {
                if let ExportSource::Table { database, table } = source {
                    match mysql::get_create_table(pool, database, table).await {
                        Ok(ddl) => {
                            writeln!(writer, "{};", ddl)
                                .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
                            writeln!(writer)
                                .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
                        }
                        Err(_) => {} // 获取 DDL 失败时跳过
                    }
                }
            }
        }

        let total_batches = (total_rows + batch_size - 1) / batch_size;

        for batch_idx in 0..total_batches {
            let offset = batch_idx * batch_size;
            let batch_sql = format!("{} LIMIT {} OFFSET {}", base_sql, batch_size, offset);

            let result = mysql::execute_select(pool, &batch_sql, Instant::now()).await?;

            // 首批时缓存列信息
            if !columns_written {
                columns_cache = result.columns.clone();
                // 写入头部（CSV 列标题、Markdown 表头等）
                self.write_export_header(&mut writer, format, options, &columns_cache)?;
                columns_written = true;
            }

            // 写入数据行
            let rows_in_batch = result.rows.len() as u64;
            self.write_export_rows(
                &mut writer,
                format,
                options,
                &columns_cache,
                &result.rows,
                table_name,
                total_exported > 0, // 是否需要 JSON 逗号分隔
            )?;

            total_exported += rows_in_batch;

            // 发送进度事件
            let percentage = if total_rows > 0 {
                (total_exported as f64 / total_rows as f64 * 100.0).min(100.0)
            } else {
                100.0
            };
            let _ = app.emit("export-progress", serde_json::json!({
                "current": total_exported,
                "total": total_rows,
                "percentage": percentage
            }));
        }

        // JSON 格式写入结尾的 ]
        if matches!(format, ExportFormat::Json) {
            writer.write_all(b"\n]")
                .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
        }

        writer.flush()
            .map_err(|e| AppError::Other(format!("刷新文件缓冲区失败: {}", e)))?;

        // 获取文件大小
        let file_size = std::fs::metadata(file_path)
            .map(|m| m.len())
            .unwrap_or(0);

        Ok(ExportResult {
            success: true,
            row_count: total_exported,
            file_size,
            error: None,
        })
    }

    /// 写入导出文件头部（CSV 列标题、Markdown 表头等）
    fn write_export_header<W: std::io::Write>(
        &self,
        writer: &mut W,
        format: &ExportFormat,
        options: &ExportOptions,
        columns: &[crate::models::query::ColumnDef],
    ) -> Result<(), AppError> {
        match format {
            ExportFormat::Csv => {
                let include_header = options.csv_include_header.unwrap_or(true);
                if include_header {
                    let delimiter = options.csv_delimiter.as_deref().unwrap_or(",");
                    let quote = options.csv_quote_char.as_deref().unwrap_or("\"");
                    let header: Vec<String> = columns.iter()
                        .map(|c| format!("{}{}{}", quote, c.name, quote))
                        .collect();
                    writeln!(writer, "{}", header.join(delimiter))
                        .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
                }
            }
            ExportFormat::Markdown => {
                // 写入 Markdown 表头
                let header = columns.iter()
                    .map(|c| c.name.as_str())
                    .collect::<Vec<_>>()
                    .join(" | ");
                writeln!(writer, "| {} |", header)
                    .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
                // 写入分隔行
                let separator = columns.iter()
                    .map(|_| "---")
                    .collect::<Vec<_>>()
                    .join(" | ");
                writeln!(writer, "| {} |", separator)
                    .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
            }
            _ => {} // JSON、SQL、Excel 不需要单独的头部处理
        }
        Ok(())
    }

    /// 写入导出数据行
    fn write_export_rows<W: std::io::Write>(
        &self,
        writer: &mut W,
        format: &ExportFormat,
        options: &ExportOptions,
        columns: &[crate::models::query::ColumnDef],
        rows: &[Vec<serde_json::Value>],
        table_name: &str,
        has_previous_data: bool,
    ) -> Result<(), AppError> {
        match format {
            ExportFormat::Csv => {
                let delimiter = options.csv_delimiter.as_deref().unwrap_or(",");
                let quote = options.csv_quote_char.as_deref().unwrap_or("\"");
                for row in rows {
                    let values: Vec<String> = row.iter().map(|v| {
                        match v {
                            serde_json::Value::Null => String::new(),
                            serde_json::Value::String(s) => {
                                // 转义文本限定符
                                let escaped = s.replace(quote, &format!("{}{}", quote, quote));
                                format!("{}{}{}", quote, escaped, quote)
                            }
                            other => other.to_string(),
                        }
                    }).collect();
                    writeln!(writer, "{}", values.join(delimiter))
                        .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
                }
            }
            ExportFormat::Json => {
                for (i, row) in rows.iter().enumerate() {
                    // 构建 JSON 对象
                    let mut obj = serde_json::Map::new();
                    for (col_idx, col) in columns.iter().enumerate() {
                        if let Some(val) = row.get(col_idx) {
                            obj.insert(col.name.clone(), val.clone());
                        }
                    }
                    let json_str = serde_json::to_string_pretty(&serde_json::Value::Object(obj))
                        .map_err(|e| AppError::Other(format!("JSON 序列化失败: {}", e)))?;

                    // 首行且无前序数据时不加逗号
                    if has_previous_data || i > 0 {
                        write!(writer, ",\n{}", json_str)
                            .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
                    } else {
                        write!(writer, "{}", json_str)
                            .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
                    }
                }
            }
            ExportFormat::Sql => {
                let batch_size = options.sql_batch_size.unwrap_or(1000) as usize;
                let col_names: Vec<String> = columns.iter()
                    .map(|c| format!("`{}`", c.name))
                    .collect();
                let col_list = col_names.join(", ");

                // 按批次生成 INSERT 语句
                for chunk in rows.chunks(batch_size) {
                    let value_rows: Vec<String> = chunk.iter().map(|row| {
                        let vals: Vec<String> = row.iter().map(|v| {
                            self.json_value_to_sql_literal(v)
                        }).collect();
                        format!("({})", vals.join(", "))
                    }).collect();

                    writeln!(writer, "INSERT INTO `{}` ({}) VALUES", table_name, col_list)
                        .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
                    writeln!(writer, "{};", value_rows.join(",\n"))
                        .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
                    writeln!(writer)
                        .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
                }
            }
            ExportFormat::Markdown => {
                for row in rows {
                    let values: Vec<String> = row.iter().map(|v| {
                        match v {
                            serde_json::Value::Null => String::from("NULL"),
                            serde_json::Value::String(s) => {
                                // 转义 Markdown 管道符
                                s.replace('|', "\\|")
                            }
                            other => other.to_string(),
                        }
                    }).collect();
                    writeln!(writer, "| {} |", values.join(" | "))
                        .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
                }
            }
            ExportFormat::Excel => {
                // Excel 在 export_excel_batched 中处理，此处不应到达
            }
        }
        Ok(())
    }

    /// 将 JSON 值转换为 SQL 字面量
    fn json_value_to_sql_literal(&self, value: &serde_json::Value) -> String {
        match value {
            serde_json::Value::Null => String::from("NULL"),
            serde_json::Value::Bool(b) => if *b { String::from("1") } else { String::from("0") },
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => {
                // 转义单引号
                let escaped = s.replace('\'', "''");
                format!("'{}'", escaped)
            }
            _ => {
                let s = value.to_string().replace('\'', "''");
                format!("'{}'", s)
            }
        }
    }

    /// 一次性写入导出文件（小数据量场景）
    async fn write_export_file(
        &self,
        file_path: &str,
        format: &ExportFormat,
        options: &ExportOptions,
        columns: &[crate::models::query::ColumnDef],
        rows: &[Vec<serde_json::Value>],
        table_name: &str,
        pool: &sqlx::MySqlPool,
        source: &ExportSource,
    ) -> Result<ExportResult, AppError> {
        let row_count = rows.len() as u64;

        match format {
            ExportFormat::Excel => {
                // Excel 使用 rust_xlsxwriter 生成
                self.write_excel_file(file_path, columns, rows)?;
            }
            _ => {
                let file = std::fs::File::create(file_path)
                    .map_err(|e| AppError::Other(format!("创建导出文件失败: {}", e)))?;
                let mut writer = std::io::BufWriter::new(file);

                // JSON 格式写入开头
                if matches!(format, ExportFormat::Json) {
                    use std::io::Write;
                    writer.write_all(b"[\n")
                        .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
                }

                // SQL 格式：如果需要 CREATE TABLE，先写入
                if matches!(format, ExportFormat::Sql) {
                    if options.sql_include_create.unwrap_or(false) {
                        if let ExportSource::Table { database, table } = source {
                            if let Ok(ddl) = mysql::get_create_table(pool, database, table).await {
                                use std::io::Write;
                                writeln!(writer, "{};", ddl)
                                    .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
                                writeln!(writer)
                                    .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
                            }
                        }
                    }
                }

                // 写入头部
                self.write_export_header(&mut writer, format, options, columns)?;

                // 写入数据行
                self.write_export_rows(
                    &mut writer, format, options, columns, rows, table_name, false,
                )?;

                // JSON 格式写入结尾
                if matches!(format, ExportFormat::Json) {
                    use std::io::Write;
                    writer.write_all(b"\n]")
                        .map_err(|e| AppError::Other(format!("写入文件失败: {}", e)))?;
                }

                use std::io::Write;
                writer.flush()
                    .map_err(|e| AppError::Other(format!("刷新文件缓冲区失败: {}", e)))?;
            }
        }

        // 获取文件大小
        let file_size = std::fs::metadata(file_path)
            .map(|m| m.len())
            .unwrap_or(0);

        Ok(ExportResult {
            success: true,
            row_count,
            file_size,
            error: None,
        })
    }

    /// 写入 Excel 文件（小数据量场景）
    fn write_excel_file(
        &self,
        file_path: &str,
        columns: &[crate::models::query::ColumnDef],
        rows: &[Vec<serde_json::Value>],
    ) -> Result<(), AppError> {
        use rust_xlsxwriter::{Workbook, Format};

        let mut workbook = Workbook::new();
        let worksheet = workbook.add_worksheet();

        // 列标题格式：加粗
        let header_format = Format::new().set_bold();

        // 写入列标题
        for (col_idx, col) in columns.iter().enumerate() {
            worksheet.write_string_with_format(0, col_idx as u16, &col.name, &header_format)
                .map_err(|e| AppError::Other(format!("Excel 写入列标题失败: {}", e)))?;
        }

        // 写入数据行
        for (row_idx, row) in rows.iter().enumerate() {
            let excel_row = (row_idx + 1) as u32; // 第 0 行是标题
            for (col_idx, val) in row.iter().enumerate() {
                self.write_excel_cell(worksheet, excel_row, col_idx as u16, val)?;
            }
        }

        workbook.save(file_path)
            .map_err(|e| AppError::Other(format!("保存 Excel 文件失败: {}", e)))?;

        Ok(())
    }

    /// 写入 Excel 单元格值
    fn write_excel_cell(
        &self,
        worksheet: &mut rust_xlsxwriter::Worksheet,
        row: u32,
        col: u16,
        value: &serde_json::Value,
    ) -> Result<(), AppError> {
        match value {
            serde_json::Value::Null => {
                // NULL 值写入空字符串
                worksheet.write_string(row, col, "")
                    .map_err(|e| AppError::Other(format!("Excel 写入失败: {}", e)))?;
            }
            serde_json::Value::Bool(b) => {
                worksheet.write_boolean(row, col, *b)
                    .map_err(|e| AppError::Other(format!("Excel 写入失败: {}", e)))?;
            }
            serde_json::Value::Number(n) => {
                if let Some(f) = n.as_f64() {
                    worksheet.write_number(row, col, f)
                        .map_err(|e| AppError::Other(format!("Excel 写入失败: {}", e)))?;
                } else {
                    worksheet.write_string(row, col, &n.to_string())
                        .map_err(|e| AppError::Other(format!("Excel 写入失败: {}", e)))?;
                }
            }
            serde_json::Value::String(s) => {
                worksheet.write_string(row, col, s)
                    .map_err(|e| AppError::Other(format!("Excel 写入失败: {}", e)))?;
            }
            other => {
                worksheet.write_string(row, col, &other.to_string())
                    .map_err(|e| AppError::Other(format!("Excel 写入失败: {}", e)))?;
            }
        }
        Ok(())
    }

    // ===== DDL 脚本生成 =====

    /// 生成单个数据库对象的脚本
    ///
    /// 支持四种脚本类型：
    /// - "create": 获取完整建表语句，可选添加 IF NOT EXISTS
    /// - "drop": 生成 DROP TABLE 语句，可选添加 IF EXISTS
    /// - "insert-template": 生成 INSERT INTO 模板（列名 + 占位符）
    /// - "select-template": 生成 SELECT 模板（列出所有列名）
    pub async fn generate_script(
        &self,
        connection_id: &str,
        database: &str,
        object_name: &str,
        script_type: &str,
        options: &ScriptOptions,
    ) -> Result<String, AppError> {
        match script_type {
            "create" => {
                // 获取原始建表语句
                let ddl = self.get_create_table(connection_id, database, object_name).await?;
                if options.include_if_not_exists {
                    // 在 CREATE TABLE 后插入 IF NOT EXISTS
                    let result = ddl.replacen("CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1);
                    Ok(result)
                } else {
                    Ok(ddl)
                }
            }
            "drop" => {
                let escaped = object_name.replace('`', "``");
                if options.include_if_exists {
                    Ok(format!("DROP TABLE IF EXISTS `{}`;", escaped))
                } else {
                    Ok(format!("DROP TABLE `{}`;", escaped))
                }
            }
            "insert-template" => {
                // 获取表的所有列信息，生成 INSERT 模板
                let columns = self.get_columns(connection_id, database, object_name).await?;
                if columns.is_empty() {
                    return Err(AppError::Other(format!("表 `{}` 没有列信息", object_name)));
                }
                let escaped_table = object_name.replace('`', "``");
                let col_names: Vec<String> = columns.iter()
                    .map(|c| format!("`{}`", c.name.replace('`', "``")))
                    .collect();
                let placeholders: Vec<&str> = vec!["?"; columns.len()];
                Ok(format!(
                    "INSERT INTO `{}` ({}) VALUES ({});",
                    escaped_table,
                    col_names.join(", "),
                    placeholders.join(", ")
                ))
            }
            "select-template" => {
                // 获取表的所有列信息，生成 SELECT 模板
                let columns = self.get_columns(connection_id, database, object_name).await?;
                if columns.is_empty() {
                    return Err(AppError::Other(format!("表 `{}` 没有列信息", object_name)));
                }
                let escaped_table = object_name.replace('`', "``");
                let col_names: Vec<String> = columns.iter()
                    .map(|c| format!("`{}`", c.name.replace('`', "``")))
                    .collect();
                Ok(format!(
                    "SELECT {} FROM `{}`;",
                    col_names.join(", "),
                    escaped_table
                ))
            }
            _ => Err(AppError::Other(format!("不支持的脚本类型: {}", script_type))),
        }
    }

    /// 导出整个数据库的 DDL 脚本
    ///
    /// 遍历数据库下所有表、视图、存储过程、函数、触发器，
    /// 获取每个对象的 DDL 并拼接为完整的数据库结构脚本。
    pub async fn export_database_ddl(
        &self,
        connection_id: &str,
        database: &str,
        options: &ScriptOptions,
    ) -> Result<String, AppError> {
        let mut parts: Vec<String> = Vec::new();

        // 文件头注释
        parts.push(format!("-- 数据库结构导出: `{}`", database));
        parts.push(format!("-- 导出时间: {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S")));
        parts.push(String::new());

        // 1. 导出所有表的 DDL
        let tables = self.get_tables(connection_id, database).await?;
        // 过滤掉视图，只保留普通表
        let real_tables: Vec<&TableInfo> = tables.iter()
            .filter(|t| t.table_type.to_uppercase() != "VIEW")
            .collect();
        if !real_tables.is_empty() {
            parts.push("-- ----------------------------".to_string());
            parts.push("-- 表结构".to_string());
            parts.push("-- ----------------------------".to_string());
            for table in &real_tables {
                parts.push(format!("\n-- 表: `{}`", table.name));
                // 可选添加 DROP TABLE IF EXISTS
                if options.include_if_exists {
                    let escaped = table.name.replace('`', "``");
                    parts.push(format!("DROP TABLE IF EXISTS `{}`;", escaped));
                }
                match self.get_create_table(connection_id, database, &table.name).await {
                    Ok(ddl) => {
                        let ddl = if options.include_if_not_exists {
                            ddl.replacen("CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1)
                        } else {
                            ddl
                        };
                        parts.push(format!("{};", ddl));
                    }
                    Err(e) => {
                        parts.push(format!("-- 获取表 `{}` DDL 失败: {}", table.name, e));
                    }
                }
            }
            parts.push(String::new());
        }

        // 2. 导出所有视图的 DDL
        let views = self.get_views(connection_id, database).await?;
        if !views.is_empty() {
            parts.push("-- ----------------------------".to_string());
            parts.push("-- 视图".to_string());
            parts.push("-- ----------------------------".to_string());
            for view in &views {
                parts.push(format!("\n-- 视图: `{}`", view.name));
                match self.get_object_definition(connection_id, database, &view.name, "VIEW").await {
                    Ok(ddl) => {
                        parts.push(format!("{};", ddl));
                    }
                    Err(e) => {
                        parts.push(format!("-- 获取视图 `{}` DDL 失败: {}", view.name, e));
                    }
                }
            }
            parts.push(String::new());
        }

        // 3. 导出所有存储过程的 DDL
        let procedures = self.get_routines(connection_id, database, "PROCEDURE").await?;
        if !procedures.is_empty() {
            parts.push("-- ----------------------------".to_string());
            parts.push("-- 存储过程".to_string());
            parts.push("-- ----------------------------".to_string());
            for proc in &procedures {
                parts.push(format!("\n-- 存储过程: `{}`", proc.name));
                parts.push("DELIMITER ;;".to_string());
                match self.get_object_definition(connection_id, database, &proc.name, "PROCEDURE").await {
                    Ok(ddl) => {
                        parts.push(format!("{};;", ddl));
                    }
                    Err(e) => {
                        parts.push(format!("-- 获取存储过程 `{}` DDL 失败: {}", proc.name, e));
                    }
                }
                parts.push("DELIMITER ;".to_string());
            }
            parts.push(String::new());
        }

        // 4. 导出所有函数的 DDL
        let functions = self.get_routines(connection_id, database, "FUNCTION").await?;
        if !functions.is_empty() {
            parts.push("-- ----------------------------".to_string());
            parts.push("-- 函数".to_string());
            parts.push("-- ----------------------------".to_string());
            for func in &functions {
                parts.push(format!("\n-- 函数: `{}`", func.name));
                parts.push("DELIMITER ;;".to_string());
                match self.get_object_definition(connection_id, database, &func.name, "FUNCTION").await {
                    Ok(ddl) => {
                        parts.push(format!("{};;", ddl));
                    }
                    Err(e) => {
                        parts.push(format!("-- 获取函数 `{}` DDL 失败: {}", func.name, e));
                    }
                }
                parts.push("DELIMITER ;".to_string());
            }
            parts.push(String::new());
        }

        // 5. 导出所有触发器的 DDL
        let triggers = self.get_triggers(connection_id, database).await?;
        if !triggers.is_empty() {
            parts.push("-- ----------------------------".to_string());
            parts.push("-- 触发器".to_string());
            parts.push("-- ----------------------------".to_string());
            for trigger in &triggers {
                parts.push(format!("\n-- 触发器: `{}`", trigger.name));
                parts.push("DELIMITER ;;".to_string());
                match self.get_object_definition(connection_id, database, &trigger.name, "TRIGGER").await {
                    Ok(ddl) => {
                        parts.push(format!("{};;", ddl));
                    }
                    Err(e) => {
                        parts.push(format!("-- 获取触发器 `{}` DDL 失败: {}", trigger.name, e));
                    }
                }
                parts.push("DELIMITER ;".to_string());
            }
            parts.push(String::new());
        }

        Ok(parts.join("\n"))
    }

    /// 分批导出 Excel 文件（大数据量场景）
    async fn export_excel_batched(
        &self,
        pool: &sqlx::MySqlPool,
        base_sql: &str,
        total_rows: u64,
        batch_size: u64,
        file_path: &str,
        app: &tauri::AppHandle,
    ) -> Result<ExportResult, AppError> {
        use tauri::Emitter;
        use rust_xlsxwriter::{Workbook, Format};

        let mut workbook = Workbook::new();
        let worksheet = workbook.add_worksheet();
        let header_format = Format::new().set_bold();

        let mut total_exported: u64 = 0;
        let mut header_written = false;
        let total_batches = (total_rows + batch_size - 1) / batch_size;

        for batch_idx in 0..total_batches {
            let offset = batch_idx * batch_size;
            let batch_sql = format!("{} LIMIT {} OFFSET {}", base_sql, batch_size, offset);

            let result = mysql::execute_select(pool, &batch_sql, Instant::now()).await?;

            // 首批写入列标题
            if !header_written {
                for (col_idx, col) in result.columns.iter().enumerate() {
                    worksheet.write_string_with_format(0, col_idx as u16, &col.name, &header_format)
                        .map_err(|e| AppError::Other(format!("Excel 写入列标题失败: {}", e)))?;
                }
                header_written = true;
            }

            // 写入数据行
            for (row_idx, row) in result.rows.iter().enumerate() {
                let excel_row = (total_exported as u32) + (row_idx as u32) + 1;
                for (col_idx, val) in row.iter().enumerate() {
                    self.write_excel_cell(worksheet, excel_row, col_idx as u16, val)?;
                }
            }

            total_exported += result.rows.len() as u64;

            // 发送进度事件
            let percentage = if total_rows > 0 {
                (total_exported as f64 / total_rows as f64 * 100.0).min(100.0)
            } else {
                100.0
            };
            let _ = app.emit("export-progress", serde_json::json!({
                "current": total_exported,
                "total": total_rows,
                "percentage": percentage
            }));
        }

        workbook.save(file_path)
            .map_err(|e| AppError::Other(format!("保存 Excel 文件失败: {}", e)))?;

        let file_size = std::fs::metadata(file_path)
            .map(|m| m.len())
            .unwrap_or(0);

        Ok(ExportResult {
            success: true,
            row_count: total_exported,
            file_size,
            error: None,
        })
    }
}
