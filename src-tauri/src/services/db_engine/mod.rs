use crate::models::connection::{PoolConfig, PoolStatus, SslConfig, ReconnectParams, ReconnectResult};
use crate::models::query::{QueryChunk, QueryResult};
use crate::services::db_drivers::{mysql, postgres, DriverPool};
use crate::utils::error::AppError;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub const DEFAULT_QUERY_TIMEOUT_SECS: u64 = 600;

pub type StreamCallback = Arc<dyn Fn(QueryChunk) -> Result<(), String> + Send + Sync + 'static>;

pub struct DbEngine {
    mysql_pools: RwLock<HashMap<String, sqlx::MySqlPool>>,
    pg_pools: RwLock<HashMap<String, sqlx::PgPool>>,
    sessions: RwLock<HashMap<String, HashMap<String, DbSession>>>,
    pub transactions: RwLock<HashMap<String, Arc<TransactionConnection>>>,
    pub monitoring_states: RwLock<HashMap<String, MonitoringState>>,
}

#[derive(Clone)]
pub enum DbSession {
    Mysql(Arc<tokio::sync::Mutex<sqlx::pool::PoolConnection<sqlx::MySql>>>),
    Postgres(Arc<tokio::sync::Mutex<sqlx::pool::PoolConnection<sqlx::Postgres>>>),
}

pub enum TransactionConnection {
    MySql(Arc<tokio::sync::Mutex<sqlx::pool::PoolConnection<sqlx::MySql>>>),
    Postgres(Arc<tokio::sync::Mutex<sqlx::pool::PoolConnection<sqlx::Postgres>>>),
}

#[derive(Clone, Default)]
pub struct MonitoringState {
    pub questions: u64,
    pub com_commit: u64,
    pub com_rollback: u64,
    pub uptime: u64,
}

impl DbEngine {
    pub fn new() -> Self {
        Self {
            mysql_pools: RwLock::new(HashMap::new()),
            pg_pools: RwLock::new(HashMap::new()),
            sessions: RwLock::new(HashMap::new()),
            transactions: RwLock::new(HashMap::new()),
            monitoring_states: RwLock::new(HashMap::new()),
        }
    }

    pub async fn get_pool(self: Arc<Self>, connection_id: String) -> Result<Arc<DriverPool>, AppError> {
        let mysql_pools = self.mysql_pools.read().await;
        if let Some(pool) = mysql_pools.get(&connection_id) {
            return Ok(Arc::new(DriverPool::MySql(pool.clone())));
        }
        let pg_pools = self.pg_pools.read().await;
        if let Some(pool) = pg_pools.get(&connection_id) {
            return Ok(Arc::new(DriverPool::Postgres(pool.clone())));
        }
        Err(AppError::ConnectionNotFound(connection_id))
    }

    pub async fn connect(
        self: Arc<Self>,
        connection_id: String,
        driver: String,
        host: String,
        port: u16,
        username: String,
        password: String,
        database: Option<String>,
        ssl_config: Option<SslConfig>,
        pool_config: Option<PoolConfig>,
    ) -> Result<(), AppError> {
        match driver.to_lowercase().as_str() {
            "mysql" | "mariadb" => {
                let pool = mysql::connect(&host, port, &username, &password, database.as_deref(), ssl_config.as_ref(), pool_config.as_ref()).await?;
                self.mysql_pools.write().await.insert(connection_id, pool);
            }
            "postgres" | "postgresql" => {
                let pool = postgres::connect(&host, port, &username, &password, database.as_deref()).await?;
                self.pg_pools.write().await.insert(connection_id, pool);
            }
            _ => return Err(AppError::Other(format!("Unsupported driver: {}", driver))),
        }
        Ok(())
    }

    pub async fn disconnect(self: Arc<Self>, connection_id: String) {
        self.mysql_pools.write().await.remove(&connection_id);
        self.pg_pools.write().await.remove(&connection_id);
    }

    pub async fn is_connected(self: Arc<Self>, connection_id: String) -> bool {
        self.mysql_pools.read().await.contains_key(&connection_id) || self.pg_pools.read().await.contains_key(&connection_id)
    }

    pub async fn get_pool_status(self: Arc<Self>, connection_id: String) -> Result<PoolStatus, AppError> {
        let mysql_pools = self.mysql_pools.read().await;
        if let Some(pool) = mysql_pools.get(&connection_id) {
            return Ok(PoolStatus { active_connections: pool.size() as u32, idle_connections: 0, max_connections: 10 });
        }
        let pg_pools = self.pg_pools.read().await;
        if let Some(pool) = pg_pools.get(&connection_id) {
            return Ok(PoolStatus { active_connections: pool.size() as u32, idle_connections: 0, max_connections: 10 });
        }
        Err(AppError::ConnectionNotFound(connection_id))
    }

    pub async fn acquire_session(self: Arc<Self>, connection_id: String, tab_id: String) -> Result<(), AppError> {
        let pool = self.clone().get_pool(connection_id.clone()).await?;
        let session = match pool.as_ref() {
            DriverPool::MySql(p) => DbSession::Mysql(Arc::new(tokio::sync::Mutex::new(p.acquire().await.map_err(AppError::Database)?))),
            DriverPool::Postgres(p) => DbSession::Postgres(Arc::new(tokio::sync::Mutex::new(p.acquire().await.map_err(AppError::Database)?))),
        };
        self.sessions.write().await.entry(connection_id).or_default().insert(tab_id, session);
        Ok(())
    }

    pub async fn release_session(self: Arc<Self>, connection_id: String, tab_id: String) {
        if let Some(conn_sessions) = self.sessions.write().await.get_mut(&connection_id) {
            conn_sessions.remove(&tab_id);
        }
    }

    pub async fn switch_session_database(self: Arc<Self>, connection_id: String, tab_id: String, database: String) -> Result<(), AppError> {
        let session = {
            let sessions = self.sessions.read().await;
            sessions.get(&connection_id).and_then(|s| s.get(&tab_id)).cloned().ok_or_else(|| AppError::Other("Session not found".into()))?
        };

        match session {
            DbSession::Mysql(conn_mutex) => {
                let mut conn = conn_mutex.lock().await;
                use sqlx::Executor as _;
                // 使用 raw_sql 走文本协议执行 USE，避免 prepared statement 协议下的 error 1295
                let use_sql = format!("USE `{}`", database);
                (&mut **conn).execute(sqlx::raw_sql(&use_sql)).await.map_err(AppError::Database)?;
            }
            DbSession::Postgres(conn_mutex) => { 
                let mut conn = conn_mutex.lock().await;
                use sqlx::Executor;
                let sql = format!("SET search_path TO \"{}\"", database.replace('"', "\"\""));
                sqlx::query(&sql).execute(&mut **conn).await.map_err(AppError::Database)?;
            }
        }
        Ok(())
    }

    pub async fn execute_query(self: Arc<Self>, connection_id: String, database: Option<String>, sql: String, _timeout_secs: Option<u64>) -> Result<QueryResult, AppError> {
        if let Some(db) = database {
            return self.execute_query_in_database(connection_id, db, sql, _timeout_secs).await;
        }
        let pool = {
            let mysql_pools = self.mysql_pools.read().await;
            if let Some(pool) = mysql_pools.get(&connection_id) { 
                Some(DriverPool::MySql(pool.clone()))
            } else {
                let pg_pools = self.pg_pools.read().await;
                pg_pools.get(&connection_id).map(|p| DriverPool::Postgres(p.clone()))
            }
        };

        match pool {
            Some(DriverPool::MySql(p)) => {
                let start = std::time::Instant::now();
                if is_select_query(&sql) { mysql::execute_select(&p, &sql, start).await } else { mysql::execute_non_select(&p, &sql, start).await }
            }
            Some(DriverPool::Postgres(p)) => {
                let start = std::time::Instant::now();
                if is_select_query(&sql) { postgres::execute_select(&p, &sql, start).await } else { postgres::execute_non_select(&p, &sql, start).await }
            }
            _ => Err(AppError::ConnectionNotFound(connection_id)),
        }
    }

    pub async fn execute_query_in_database(self: Arc<Self>, connection_id: String, database: String, sql: String, _timeout_secs: Option<u64>) -> Result<QueryResult, AppError> {
        let pool = self.clone().get_pool(connection_id).await?;
        let start = std::time::Instant::now();
        match pool.as_ref() {
            DriverPool::MySql(p) => {
                if is_select_query(&sql) { mysql::execute_select_in_database(p.clone(), database, sql, start).await }
                else { mysql::execute_non_select_in_database(p.clone(), database, sql, start).await }
            }
            DriverPool::Postgres(p) => {
                if is_select_query(&sql) { postgres::execute_select_in_database(p.clone(), database, sql, start).await }
                else { postgres::execute_non_select_in_database(p.clone(), database, sql, start).await }
            }
        }
    }

    pub async fn execute_query_stream(self: Arc<Self>, connection_id: String, database: Option<String>, sql: String, _timeout_secs: Option<u64>, on_chunk: StreamCallback) -> Result<(), AppError> {
        if let Some(db) = database {
            return self.clone().execute_query_stream_in_database(connection_id, db, sql, _timeout_secs, on_chunk).await;
        }
        let pool = {
            let mysql_pools = self.mysql_pools.read().await;
            mysql_pools.get(&connection_id).cloned()
        };
        if let Some(pool) = pool { 
            let cb = on_chunk.clone();
            return mysql::execute_select_stream(&pool, &sql, std::time::Instant::now(), move |c| cb(c)).await; 
        }
        let pg_pool = {
            let pg_pools = self.pg_pools.read().await;
            pg_pools.get(&connection_id).cloned()
        };
        if let Some(_pool) = pg_pool { return Err(AppError::Other("Postgres 流式查询暂未实现".to_string())); }
        Err(AppError::ConnectionNotFound(connection_id))
    }

    pub async fn execute_query_stream_in_database(self: Arc<Self>, connection_id: String, database: String, sql: String, _timeout_secs: Option<u64>, on_chunk: StreamCallback) -> Result<(), AppError> {
        let pool = self.clone().get_pool(connection_id).await?;
        let start = std::time::Instant::now();
        match pool.as_ref() {
            DriverPool::MySql(p) => {
                mysql::execute_select_stream_in_database(p.clone(), database, sql, start, on_chunk).await 
            }
            DriverPool::Postgres(_) => Err(AppError::Other("Postgres 流式查询暂未实现".to_string())),
        }
    }

    pub async fn execute_query_on_session(self: Arc<Self>, connection_id: String, tab_id: String, database: Option<String>, sql: String, timeout_secs: Option<u64>) -> Result<QueryResult, AppError> {
        let session = {
            let sessions = self.sessions.read().await;
            sessions.get(&connection_id).and_then(|s| s.get(&tab_id)).cloned()
        };
        if let Some(session) = session {
            let start = std::time::Instant::now();
            // 在执行 SQL 前，先切换到指定数据库上下文
            if let Some(ref db) = database {
                Self::ensure_session_database(&session, db).await?;
            }
            return match session {
                DbSession::Mysql(conn_mutex) => {
                    let is_select = is_select_query(&sql);
                    if is_select {
                        mysql::execute_select_on_conn(conn_mutex, sql, start).await
                    } else {
                        mysql::execute_non_select_on_conn(conn_mutex, sql, start).await
                    }
                }
                DbSession::Postgres(conn_mutex) => {
                    let is_select = is_select_query(&sql);
                    if is_select {
                        postgres::execute_select_on_conn(conn_mutex, sql, start).await
                    } else {
                        postgres::execute_non_select_on_conn(conn_mutex, sql, start).await
                    }
                }
            };
        }
        self.clone().execute_query(connection_id, database, sql, timeout_secs).await
    }

    pub async fn execute_query_stream_on_session(self: Arc<Self>, connection_id: String, tab_id: String, database: Option<String>, sql: String, timeout_secs: Option<u64>, on_chunk: StreamCallback) -> Result<(), AppError> {
        let session = {
            let sessions = self.sessions.read().await;
            sessions.get(&connection_id).and_then(|s| s.get(&tab_id)).cloned()
        };
        if let Some(session) = session {
            // 在执行 SQL 前，先切换到指定数据库上下文
            if let Some(ref db) = database {
                Self::ensure_session_database(&session, db).await?;
            }
            return match session {
                DbSession::Mysql(conn_mutex) => {
                    mysql::execute_select_stream_on_conn(conn_mutex, sql, std::time::Instant::now(), on_chunk).await
                }
                DbSession::Postgres(_) => Err(AppError::Other("Postgres 流式查询暂未实现".to_string())),
            };
        }
        self.clone().execute_query_stream(connection_id, database, sql, timeout_secs, on_chunk).await
    }

    pub async fn test_connect(driver: String, host: String, port: u16, username: String, password: String, database: Option<String>, ssl_config: Option<SslConfig>, pool_config: Option<PoolConfig>) -> Result<u64, AppError> {
        match driver.to_lowercase().as_str() {
            "mysql" | "mariadb" => mysql::test_connect(&host, port, &username, &password, database.as_deref(), ssl_config.as_ref(), pool_config.as_ref()).await,
            "postgres" | "postgresql" => postgres::test_connect(&host, port, &username, &password, database.as_deref()).await,
            _ => Err(AppError::Other(format!("Unsupported driver for testing: {}", driver))),
        }
    }

    pub async fn check_and_reconnect(
        self: Arc<Self>,
        connection_id: String,
        reconnect_params: ReconnectParams,
    ) -> Result<ReconnectResult, AppError> {
        if self.clone().is_connected(connection_id.clone()).await && self.clone().check_connection_alive(connection_id.clone()).await {
            return Ok(ReconnectResult { success: true, attempt: 0, message: "OK".to_string() });
        }
        let conn_id = connection_id.clone();
        self.clone().disconnect(connection_id).await;
        for attempt in 1..=3 {
            if self.clone().connect(
                conn_id.clone(),
                reconnect_params.driver.clone(),
                reconnect_params.host.clone(),
                reconnect_params.port,
                reconnect_params.username.clone(),
                reconnect_params.password.clone(),
                reconnect_params.database.clone(),
                reconnect_params.ssl_config.clone(),
                reconnect_params.pool_config.clone()
            ).await.is_ok() && self.clone().check_connection_alive(conn_id.clone()).await {
                return Ok(ReconnectResult { success: true, attempt, message: "重连成功".to_string() });
            }
            if attempt < 3 { tokio::time::sleep(std::time::Duration::from_secs(5)).await; }
        }
        Ok(ReconnectResult { success: false, attempt: 3, message: "重连失败".to_string() })
    }

    async fn check_connection_alive(self: Arc<Self>, connection_id: String) -> bool {
        let pool = match self.clone().get_pool(connection_id).await { Ok(p) => p, Err(_) => return false };
        match pool.as_ref() {
            DriverPool::MySql(p) => { use sqlx::Executor; sqlx::query("SELECT 1").execute(p).await.is_ok() }
            DriverPool::Postgres(p) => { use sqlx::Executor; sqlx::query("SELECT 1").execute(p).await.is_ok() }
        }
    }

    /// 确保 Session 连接已切换到指定数据库上下文
    /// MySQL 执行 USE，PostgreSQL 执行 SET search_path
    async fn ensure_session_database(session: &DbSession, database: &str) -> Result<(), AppError> {
        match session {
            DbSession::Mysql(conn_mutex) => {
                let mut conn = conn_mutex.lock().await;
                use sqlx::Executor as _;
                let use_sql = format!("USE `{}`", database.replace('`', "``"));
                (&mut **conn).execute(sqlx::raw_sql(&use_sql)).await.map_err(|e| {
                    AppError::Other(format!("切换数据库失败: {}", e))
                })?;
            }
            DbSession::Postgres(conn_mutex) => {
                let mut conn = conn_mutex.lock().await;
                use sqlx::Executor as _;
                let sql = format!("SET search_path TO \"{}\"", database.replace('"', "\"\""));
                (&mut **conn).execute(sqlx::raw_sql(&sql)).await.map_err(|e| {
                    AppError::Other(format!("切换数据库失败: {}", e))
                })?;
            }
        }
        Ok(())
    }

    pub async fn cancel_query(self: Arc<Self>, _connection_id: String) -> Result<(), AppError> { Ok(()) }
}

pub mod executor;
pub mod meta;
pub mod tx;
pub mod export;
pub mod import;





static IMPORT_STATES: std::sync::OnceLock<tokio::sync::RwLock<std::collections::HashMap<String, std::sync::Arc<std::sync::atomic::AtomicU8>>>> = std::sync::OnceLock::new();

pub fn get_import_states() -> &'static tokio::sync::RwLock<std::collections::HashMap<String, std::sync::Arc<std::sync::atomic::AtomicU8>>> {
    IMPORT_STATES.get_or_init(|| tokio::sync::RwLock::new(std::collections::HashMap::new()))
}

pub fn is_select_query(sql: &str) -> bool {
    let s = sql.trim().to_uppercase();
    s.starts_with("SELECT") || s.starts_with("SHOW") || s.starts_with("DESC") || s.starts_with("EXPLAIN")
}
