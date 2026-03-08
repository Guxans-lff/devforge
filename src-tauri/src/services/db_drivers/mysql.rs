use std::sync::Arc;
use std::time::{Duration, Instant};

use sqlx::mysql::{MySqlColumn, MySqlConnectOptions, MySqlConnection, MySqlPool, MySqlPoolOptions, MySqlRow, MySqlSslMode};
use sqlx::pool::PoolConnection;
use sqlx::{Column, Executor, Row, TypeInfo};

use crate::models::connection::{PoolConfig, SslConfig, SslMode};
use crate::models::query::{ColumnDef, ColumnInfo, DatabaseInfo, QueryChunk, QueryResult, RoutineInfo, TableInfo, TriggerInfo, ViewInfo};
use crate::utils::error::AppError;
use super::{escape_mysql_ident, validate_sql_clause};
use urlencoding;

/// 取消当前用户在此连接池上的活跃查询（仅限当前用户，防止越权）
pub async fn cancel_running_query(pool: &MySqlPool) -> Result<(), AppError> {
    // 仅获取当前用户的活跃查询（排除 Sleep 和当前 PROCESSLIST 查询本身）
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT ID FROM information_schema.PROCESSLIST WHERE COMMAND != 'Sleep' AND INFO IS NOT NULL AND INFO NOT LIKE '%PROCESSLIST%' AND USER = CURRENT_USER()"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to get process list: {}", e)))?;

    for row in &rows {
        if let Ok(Some(id)) = row.try_get::<Option<i64>, _>("ID") {
            // 使用参数化查询（KILL 不支持参数化，但 id 来自 i64 类型安全）
            let _ = sqlx::query(&format!("KILL QUERY {}", id))
                .execute(pool)
                .await;
        }
    }
    Ok(())
}

/// 根据 SslConfig 配置 MySqlConnectOptions 的 SSL 选项
///
/// 将 SslMode 映射到 sqlx 的 MySqlSslMode，并设置证书路径。
/// 当证书文件无效或不可读时返回包含具体错误信息的 AppError。
fn apply_ssl_config(
    mut options: MySqlConnectOptions,
    ssl_config: Option<&SslConfig>,
) -> Result<MySqlConnectOptions, AppError> {
    let config = match ssl_config {
        Some(c) => c,
        None => {
            // 未提供 SSL 配置时使用默认的 Preferred 模式
            return Ok(options.ssl_mode(MySqlSslMode::Preferred));
        }
    };

    // 映射 SSL 模式
    let ssl_mode = match config.mode {
        SslMode::Disabled => MySqlSslMode::Disabled,
        SslMode::Preferred => MySqlSslMode::Preferred,
        SslMode::Required => MySqlSslMode::Required,
        SslMode::VerifyCa => MySqlSslMode::VerifyCa,
        SslMode::VerifyIdentity => MySqlSslMode::VerifyIdentity,
    };
    options = options.ssl_mode(ssl_mode);

    // 设置 CA 证书路径
    if let Some(ref ca_path) = config.ca_cert_path {
        if !ca_path.is_empty() {
            let path = std::path::Path::new(ca_path);
            if !path.exists() {
                return Err(AppError::Other(format!(
                    "CA 证书文件不存在: {}", ca_path
                )));
            }
            if !path.is_file() {
                return Err(AppError::Other(format!(
                    "CA 证书路径不是有效文件: {}", ca_path
                )));
            }
            // 尝试读取以验证可读性
            std::fs::read(path).map_err(|e| {
                AppError::Other(format!("无法读取 CA 证书文件 '{}': {}", ca_path, e))
            })?;
            options = options.ssl_ca(ca_path);
        }
    }

    // 设置客户端证书路径
    if let Some(ref cert_path) = config.client_cert_path {
        if !cert_path.is_empty() {
            let path = std::path::Path::new(cert_path);
            if !path.exists() {
                return Err(AppError::Other(format!(
                    "客户端证书文件不存在: {}", cert_path
                )));
            }
            if !path.is_file() {
                return Err(AppError::Other(format!(
                    "客户端证书路径不是有效文件: {}", cert_path
                )));
            }
            std::fs::read(path).map_err(|e| {
                AppError::Other(format!("无法读取客户端证书文件 '{}': {}", cert_path, e))
            })?;
            options = options.ssl_client_cert(cert_path);
        }
    }

    // 设置客户端密钥路径
    if let Some(ref key_path) = config.client_key_path {
        if !key_path.is_empty() {
            let path = std::path::Path::new(key_path);
            if !path.exists() {
                return Err(AppError::Other(format!(
                    "客户端密钥文件不存在: {}", key_path
                )));
            }
            if !path.is_file() {
                return Err(AppError::Other(format!(
                    "客户端密钥路径不是有效文件: {}", key_path
                )));
            }
            std::fs::read(path).map_err(|e| {
                AppError::Other(format!("无法读取客户端密钥文件 '{}': {}", key_path, e))
            })?;
            options = options.ssl_client_key(key_path);
        }
    }

    Ok(options)
}

/// 建立 MySQL 连接池
///
/// # 参数
/// - `host`: 主机地址
/// - `port`: 端口号
/// - `username`: 用户名
/// - `password`: 密码
/// - `database`: 可选的数据库名
/// - `ssl_config`: 可选的 SSL/TLS 配置
/// - `pool_config`: 可选的连接池配置
pub async fn connect(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    database: Option<&str>,
    ssl_config: Option<&SslConfig>,
    pool_config: Option<&PoolConfig>,
) -> Result<MySqlPool, AppError> {
    // 校验连接池参数
    if let Some(pc) = pool_config {
        pc.validate().map_err(|e| AppError::Other(e))?;
    }

    // 关键：通过 URL 方式确保 allowMultiQueries=true
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

    // 应用 SSL 配置
    options = apply_ssl_config(options, ssl_config)?;

    // 根据连接池配置构建 MySqlPoolOptions
    let pool = MySqlPoolOptions::new()
        .min_connections(pool_config.map(|c| c.min_connections).unwrap_or(2))
        .max_connections(pool_config.map(|c| c.max_connections).unwrap_or(10))
        .idle_timeout(Duration::from_secs(
            pool_config.map(|c| c.idle_timeout_secs).unwrap_or(1800)
        ))
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(options)
        .await
        .map_err(|e| AppError::Other(format!("MySQL connection failed: {}", e)))?;

    Ok(pool)
}

/// 测试 MySQL 连接
///
/// 建立连接并执行 `SELECT 1` 验证连通性，返回连接耗时（毫秒）。
///
/// # 参数
/// - `host`: 主机地址
/// - `port`: 端口号
/// - `username`: 用户名
/// - `password`: 密码
/// - `database`: 可选的数据库名
/// - `ssl_config`: 可选的 SSL/TLS 配置
/// - `pool_config`: 可选的连接池配置
pub async fn test_connect(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    database: Option<&str>,
    ssl_config: Option<&SslConfig>,
    pool_config: Option<&PoolConfig>,
) -> Result<u64, AppError> {
    // 校验连接池参数
    if let Some(pc) = pool_config {
        pc.validate().map_err(|e| AppError::Other(e))?;
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

    // 应用 SSL 配置
    options = apply_ssl_config(options, ssl_config)?;

    // 测试连接使用最小连接池
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

/// 在指定数据库上下文中执行 SELECT 查询
///
/// 关键修复：接收 owned MySqlPool（内部是 Arc，clone 廉价），
/// 使整个函数的 Future 满足 Send + 'static，可安全用于 tokio::spawn。
pub async fn execute_select_in_database(
    pool: MySqlPool,
    database: String,
    sql: String,
    start: Instant,
) -> Result<QueryResult, AppError> {
    let mut conn = pool.acquire().await.map_err(AppError::Database)?;

    // USE 不支持 prepared statement 协议，用 raw_sql 走文本协议（COM_QUERY）
    let use_sql = format!("USE `{}`", database.replace('`', "``"));
    {
        let c: &mut sqlx::MySqlConnection = &mut *conn;
        sqlx::raw_sql(&use_sql).execute(&mut *c).await.map_err(|e| {
            AppError::Other(format!("切换数据库失败: {}", e))
        })?;
    }

    // 在同一连接上执行用户 SQL —— 统一使用 raw_sql 以支持脚本模式（多语句）
    let rows: Vec<MySqlRow> = {
        let c: &mut MySqlConnection = &mut *conn;
        sqlx::raw_sql(&sql)
            .fetch_all(c)
            .await
            .map_err(|e| AppError::Other(format!("Query failed: {}", e)))?
    };

    let elapsed = start.elapsed().as_millis() as u64;

    if rows.is_empty() {
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: elapsed,
            is_error: false,
            error: None,
            total_count: Some(0),
            truncated: false,
        });
    }

    let columns: Vec<ColumnDef> = rows[0]
        .columns()
        .iter()
        .map(|col: &MySqlColumn| ColumnDef {
            name: col.name().to_string(),
            data_type: col.type_info().name().to_string(),
            nullable: true,
        })
        .collect();

    let data_rows: Vec<Vec<serde_json::Value>> = rows
        .iter()
        .map(|row: &MySqlRow| {
            row.columns()
                .iter()
                .enumerate()
                .map(|(i, col)| mysql_value_to_json(row, i, col.type_info().name()))
                .collect()
        })
        .collect();

    Ok(QueryResult {
        columns,
        rows: data_rows,
        affected_rows: 0,
        execution_time_ms: elapsed,
        is_error: false,
        error: None,
        total_count: None,
        truncated: false,
    })
}

/// 在指定数据库上下文中执行非 SELECT 语句
///
/// 接收 owned MySqlPool，使 Future 满足 Send + 'static。
/// 完全自包含：acquire + USE + execute 全在一个函数体内完成。
pub async fn execute_non_select_in_database(
    pool: MySqlPool,
    database: String,
    sql: String,
    start: Instant,
) -> Result<QueryResult, AppError> {
    let mut conn = pool.acquire().await.map_err(AppError::Database)?;

    // USE 语句走 raw_sql 文本协议（COM_QUERY）
    let use_sql = format!("USE `{}`", database.replace('`', "``"));
    {
        let c: &mut sqlx::MySqlConnection = &mut *conn;
        sqlx::raw_sql(&use_sql).execute(&mut *c).await.map_err(|e| {
            AppError::Other(format!("切换数据库失败: {}", e))
        })?;
    }

    // 检查是否需要文本协议（USE/SET/BEGIN 等不支持 prepared statement）
    let upper = sql.trim_start().to_uppercase();
    let needs_raw = upper.starts_with("USE ")
        || upper.starts_with("SET ")
        || upper == "BEGIN"
        || upper == "COMMIT"
        || upper == "ROLLBACK";

    if needs_raw {
        {
            let c: &mut sqlx::MySqlConnection = &mut *conn;
            sqlx::raw_sql(&sql).execute(&mut *c).await.map_err(|e| {
                AppError::Other(format!("Execute failed: {}", e))
            })?;
        }
        let elapsed = start.elapsed().as_millis() as u64;
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: elapsed,
            is_error: false,
            error: None,
            total_count: None,
            truncated: false,
        });
    }

    let result: sqlx::mysql::MySqlQueryResult = {
        let c: &mut MySqlConnection = &mut *conn;
        sqlx::raw_sql(&sql)
            .execute(c)
            .await
            .map_err(|e| AppError::Other(format!("Execute failed: {}", e)))?
    };

    let elapsed = start.elapsed().as_millis() as u64;

    Ok(QueryResult {
        columns: vec![],
        rows: vec![],
        affected_rows: result.rows_affected(),
        execution_time_ms: elapsed,
        is_error: false,
        error: None,
        total_count: None,
        truncated: false,
    })
}

/// 在指定数据库上下文中流式执行 SELECT 查询
///
/// 接收 owned MySqlPool，使 Future 满足 Send + 'static。
/// 完全自包含：acquire + USE + stream 全在一个函数体内完成。
pub async fn execute_select_stream_in_database(
    pool: MySqlPool,
    database: String,
    sql: String,
    start: Instant,
    on_chunk: Arc<dyn Fn(QueryChunk) -> Result<(), String> + Send + Sync>,
) -> Result<(), AppError> {
    use futures::StreamExt;

    let mut conn = pool.acquire().await.map_err(AppError::Database)?;

    // USE 语句走 raw_sql 文本协议（COM_QUERY）
    let use_sql = format!("USE `{}`", database.replace('`', "``"));
    {
        let c: &mut sqlx::MySqlConnection = &mut *conn;
        sqlx::raw_sql(&use_sql).execute(&mut *c).await.map_err(|e| {
            AppError::Other(format!("切换数据库失败: {}", e))
        })?;
    }

    // 完全内联流式逻辑 —— 统一使用 raw_sql 以支持多语句脚本
    let mut stream = {
        let c: &mut MySqlConnection = &mut *conn;
        sqlx::raw_sql(&sql).fetch(c)
    };
    let mut columns_sent = false;
    let mut chunk_index: u32 = 0;
    let mut buffer: Vec<Vec<serde_json::Value>> = Vec::with_capacity(STREAM_CHUNK_SIZE);
    let mut col_defs: Vec<ColumnDef> = vec![];

    while let Some(row_result) = stream.next().await {
        match row_result {
            Ok(row) => {
                if !columns_sent {
                    col_defs = row.columns().iter().map(|col: &MySqlColumn| ColumnDef {
                        name: col.name().to_string(),
                        data_type: col.type_info().name().to_string(),
                        nullable: true,
                    }).collect();
                }

                let row_data: Vec<serde_json::Value> = row.columns().iter().enumerate()
                    .map(|(i, col)| mysql_value_to_json(&row, i, col.type_info().name()))
                    .collect();
                buffer.push(row_data);

                if buffer.len() >= STREAM_CHUNK_SIZE {
                    let chunk = QueryChunk {
                        chunk_index,
                        columns: if !columns_sent { std::mem::take(&mut col_defs) } else { vec![] },
                        rows: std::mem::take(&mut buffer),
                        is_last: false,
                        total_time_ms: None,
                        error: None,
                    };
                    columns_sent = true;
                    on_chunk(chunk).map_err(|e| AppError::Other(format!("Channel send error: {}", e)))?;
                    chunk_index += 1;
                    buffer = Vec::with_capacity(STREAM_CHUNK_SIZE);
                }
            }
            Err(e) => {
                let chunk = QueryChunk {
                    chunk_index,
                    columns: vec![],
                    rows: vec![],
                    is_last: true,
                    total_time_ms: Some(start.elapsed().as_millis() as u64),
                    error: Some(format!("Query stream error: {}", e)),
                };
                let _ = on_chunk(chunk);
                return Err(AppError::Other(format!("Query stream error: {}", e)));
            }
        }
    }

    let elapsed = start.elapsed().as_millis() as u64;
    let final_chunk = QueryChunk {
        chunk_index,
        columns: if !columns_sent { col_defs } else { vec![] },
        rows: buffer,
        is_last: true,
        total_time_ms: Some(elapsed),
        error: None,
    };
    on_chunk(final_chunk).map_err(|e| AppError::Other(format!("Channel send error: {}", e)))?;

    Ok(())
}

pub async fn execute_select(
    pool: &MySqlPool,
    sql: &str,
    start: Instant,
) -> Result<QueryResult, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(sql)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Other(format!("Query failed: {}", e)))?;

    let elapsed = start.elapsed().as_millis() as u64;

    if rows.is_empty() {
        // 空结果时通过 describe 获取列定义，确保前端能渲染空表格
        let columns = match pool.describe(sql).await {
            Ok(desc) => desc.columns().iter().map(|col| ColumnDef {
                name: col.name().to_string(),
                data_type: col.type_info().name().to_string(),
                nullable: true,
            }).collect(),
            Err(_) => vec![],
        };
        return Ok(QueryResult {
            columns,
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: elapsed,
            is_error: false,
            error: None,
            total_count: Some(0),
            truncated: false,
        });
    }

    let columns: Vec<ColumnDef> = rows[0]
        .columns()
        .iter()
        .map(|col: &MySqlColumn| ColumnDef {
            name: col.name().to_string(),
            data_type: col.type_info().name().to_string(),
            nullable: true,
        })
        .collect();

    let data_rows: Vec<Vec<serde_json::Value>> = rows
        .iter()
        .map(|row: &MySqlRow| {
            row.columns()
                .iter()
                .enumerate()
                .map(|(i, col)| mysql_value_to_json(row, i, col.type_info().name()))
                .collect()
        })
        .collect();

    Ok(QueryResult {
        columns,
        rows: data_rows,
        affected_rows: 0,
        execution_time_ms: elapsed,
        is_error: false,
        error: None,
        total_count: None,
        truncated: false,
    })
}

/// 流式执行 SELECT 查询，每 STREAM_CHUNK_SIZE 行通过回调推送给前端
const STREAM_CHUNK_SIZE: usize = 100;

pub async fn execute_select_stream(
    pool: &MySqlPool,
    sql: &str,
    start: Instant,
    on_chunk: impl Fn(QueryChunk) -> Result<(), String>,
) -> Result<(), AppError> {
    use futures::StreamExt;

    let mut stream = sqlx::query(sql).fetch(pool);
    let mut columns_sent = false;
    let mut chunk_index: u32 = 0;
    let mut buffer: Vec<Vec<serde_json::Value>> = Vec::with_capacity(STREAM_CHUNK_SIZE);
    
    // 关键优化：提前尝试获取列定义，确保空结果也能渲染表头
    let mut col_defs: Vec<ColumnDef> = match pool.describe(sql).await {
        Ok(desc) => {
            println!("[DEBUG] SQL 流式探测到 {} 列", desc.columns().len());
            desc.columns().iter().map(|col| ColumnDef {
                name: col.name().to_string(),
                data_type: col.type_info().name().to_string(),
                nullable: true,
            }).collect()
        }
        Err(e) => {
            println!("[DEBUG] SQL 探测列属性失败（非致命）：{}", e);
            vec![]
        }
    };

    println!("[DEBUG] 开始执行流式 SQL: {}", sql.chars().take(50).collect::<String>());

    while let Some(row_result) = stream.next().await {
        match row_result {
            Ok(row) => {
                // 首行获取列定义
                if !columns_sent {
                    col_defs = row.columns().iter().map(|col: &MySqlColumn| ColumnDef {
                        name: col.name().to_string(),
                        data_type: col.type_info().name().to_string(),
                        nullable: true,
                    }).collect();
                }

                // 转换行数据
                let row_data: Vec<serde_json::Value> = row.columns().iter().enumerate()
                    .map(|(i, col)| mysql_value_to_json(&row, i, col.type_info().name()))
                    .collect();
                buffer.push(row_data);

                // 达到 chunk 大小时推送
                if buffer.len() >= STREAM_CHUNK_SIZE {
                    let chunk = QueryChunk {
                        chunk_index,
                        columns: if !columns_sent { std::mem::take(&mut col_defs) } else { vec![] },
                        rows: std::mem::take(&mut buffer),
                        is_last: false,
                        total_time_ms: None,
                        error: None,
                    };
                    columns_sent = true;
                    on_chunk(chunk).map_err(|e| AppError::Other(format!("Channel send error: {}", e)))?;
                    chunk_index += 1;
                    buffer = Vec::with_capacity(STREAM_CHUNK_SIZE);
                }
            }
            Err(e) => {
                let chunk = QueryChunk {
                    chunk_index,
                    columns: vec![],
                    rows: vec![],
                    is_last: true,
                    total_time_ms: Some(start.elapsed().as_millis() as u64),
                    error: Some(format!("Query stream error: {}", e)),
                };
                let _ = on_chunk(chunk);
                return Err(AppError::Other(format!("Query stream error: {}", e)));
            }
        }
    }

    // 发送最后一批（可能为空，表示查询完毕）
    let elapsed = start.elapsed().as_millis() as u64;
    let final_chunk = QueryChunk {
        chunk_index,
        columns: if !columns_sent { col_defs } else { vec![] },
        rows: buffer,
        is_last: true,
        total_time_ms: Some(elapsed),
        error: None,
    };
    on_chunk(final_chunk).map_err(|e| AppError::Other(format!("Channel send error: {}", e)))?;

    Ok(())
}

pub async fn execute_non_select(
    pool: &MySqlPool,
    sql: &str,
    start: Instant,
) -> Result<QueryResult, AppError> {
    // MySQL prepared statement 协议不支持 USE/SET/BEGIN 等语句，
    // 对这些语句使用 raw_sql 走文本协议（COM_QUERY）
    let upper = sql.trim_start().to_uppercase();
    let needs_raw = upper.starts_with("USE ")
        || upper.starts_with("SET ")
        || upper == "BEGIN"
        || upper == "COMMIT"
        || upper == "ROLLBACK";

    let result = if needs_raw {
        sqlx::raw_sql(sql)
            .execute(pool)
            .await
            .map_err(|e| AppError::Other(format!("Execute failed: {}", e)))?
    } else {
        sqlx::query(sql)
            .execute(pool)
            .await
            .map_err(|e| AppError::Other(format!("Execute failed: {}", e)))?
    };

    let elapsed = start.elapsed().as_millis() as u64;

    Ok(QueryResult {
        columns: vec![],
        rows: vec![],
        affected_rows: result.rows_affected(),
        execution_time_ms: elapsed,
        is_error: false,
        error: None,
        total_count: None,
        truncated: false,
    })
}

/// 在专用连接上执行 SELECT 查询（用于事务内操作）
///
/// 与 execute_select 逻辑相同，但使用 PoolConnection 而非连接池
pub async fn execute_select_on_conn(
    conn: &mut PoolConnection<sqlx::MySql>,
    sql: &str,
    start: Instant,
) -> Result<QueryResult, AppError> {
    let rows: Vec<MySqlRow> = {
        let c: &mut MySqlConnection = &mut *conn;
        sqlx::raw_sql(sql)
            .fetch_all(c)
            .await
            .map_err(|e| AppError::Other(format!("Query failed: {}", e)))?
    };

    let elapsed = start.elapsed().as_millis() as u64;

    if rows.is_empty() {
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: elapsed,
            is_error: false,
            error: None,
            total_count: Some(0),
            truncated: false,
        });
    }

    let columns: Vec<ColumnDef> = rows[0]
        .columns()
        .iter()
        .map(|col: &MySqlColumn| ColumnDef {
            name: col.name().to_string(),
            data_type: col.type_info().name().to_string(),
            nullable: true,
        })
        .collect();

    let data_rows: Vec<Vec<serde_json::Value>> = rows
        .iter()
        .map(|row: &MySqlRow| {
            row.columns()
                .iter()
                .enumerate()
                .map(|(i, col)| mysql_value_to_json(row, i, col.type_info().name()))
                .collect()
        })
        .collect();

    Ok(QueryResult {
        columns,
        rows: data_rows,
        affected_rows: 0,
        execution_time_ms: elapsed,
        is_error: false,
        error: None,
        total_count: None,
        truncated: false,
    })
}

/// 在专用连接上执行非 SELECT 语句（用于事务内操作）
///
/// 与 execute_non_select 逻辑相同，但使用 PoolConnection 而非连接池
pub async fn execute_non_select_on_conn(
    conn: &mut PoolConnection<sqlx::MySql>,
    sql: &str,
    start: Instant,
) -> Result<QueryResult, AppError> {
    // MySQL prepared statement 协议不支持 USE/SET/BEGIN 等语句，
    // 对这些语句使用 execute_raw_on_conn 走文本协议（COM_QUERY）
    let upper = sql.trim_start().to_uppercase();
    let needs_raw = upper.starts_with("USE ")
        || upper.starts_with("SET ")
        || upper == "BEGIN"
        || upper == "COMMIT"
        || upper == "ROLLBACK";

    if needs_raw {
        {
            let c: &mut sqlx::MySqlConnection = &mut *conn;
            sqlx::raw_sql(sql).execute(&mut *c).await.map_err(|e| {
                AppError::Other(format!("Execute failed: {}", e))
            })?;
        }
        let elapsed = start.elapsed().as_millis() as u64;
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: elapsed,
            is_error: false,
            error: None,
            total_count: None,
            truncated: false,
        });
    }

    let result: sqlx::mysql::MySqlQueryResult = {
        let c: &mut MySqlConnection = &mut *conn;
        sqlx::raw_sql(sql)
            .execute(c)
            .await
            .map_err(|e| AppError::Other(format!("Execute failed: {}", e)))?
    };

    let elapsed = start.elapsed().as_millis() as u64;

    Ok(QueryResult {
        columns: vec![],
        rows: vec![],
        affected_rows: result.rows_affected(),
        execution_time_ms: elapsed,
        is_error: false,
        error: None,
        total_count: None,
        truncated: false,
    })
}

/// 在专用连接上流式执行 SELECT 查询
///
/// 与 execute_select_stream 逻辑相同，但使用 PoolConnection 而非连接池，
/// 用于需要在同一连接上先执行 USE <database> 再流式查询的场景。
pub async fn execute_select_stream_on_conn(
    conn: &mut PoolConnection<sqlx::MySql>,
    sql: &str,
    start: Instant,
    on_chunk: impl Fn(QueryChunk) -> Result<(), String>,
) -> Result<(), AppError> {
    use futures::StreamExt;

    let mut stream = sqlx::query(sql).fetch(&mut **conn);
    let mut columns_sent = false;
    let mut chunk_index: u32 = 0;
    let mut buffer: Vec<Vec<serde_json::Value>> = Vec::with_capacity(STREAM_CHUNK_SIZE);
    let mut col_defs: Vec<ColumnDef> = vec![];

    while let Some(row_result) = stream.next().await {
        match row_result {
            Ok(row) => {
                if !columns_sent {
                    col_defs = row.columns().iter().map(|col: &MySqlColumn| ColumnDef {
                        name: col.name().to_string(),
                        data_type: col.type_info().name().to_string(),
                        nullable: true,
                    }).collect();
                }

                let row_data: Vec<serde_json::Value> = row.columns().iter().enumerate()
                    .map(|(i, col)| mysql_value_to_json(&row, i, col.type_info().name()))
                    .collect();
                buffer.push(row_data);

                if buffer.len() >= STREAM_CHUNK_SIZE {
                    let chunk = QueryChunk {
                        chunk_index,
                        columns: if !columns_sent { std::mem::take(&mut col_defs) } else { vec![] },
                        rows: std::mem::take(&mut buffer),
                        is_last: false,
                        total_time_ms: None,
                        error: None,
                    };
                    columns_sent = true;
                    on_chunk(chunk).map_err(|e| AppError::Other(format!("Channel send error: {}", e)))?;
                    chunk_index += 1;
                    buffer = Vec::with_capacity(STREAM_CHUNK_SIZE);
                }
            }
            Err(e) => {
                let chunk = QueryChunk {
                    chunk_index,
                    columns: vec![],
                    rows: vec![],
                    is_last: true,
                    total_time_ms: Some(start.elapsed().as_millis() as u64),
                    error: Some(format!("Query stream error: {}", e)),
                };
                let _ = on_chunk(chunk);
                return Err(AppError::Other(format!("Query stream error: {}", e)));
            }
        }
    }

    let elapsed = start.elapsed().as_millis() as u64;
    let final_chunk = QueryChunk {
        chunk_index,
        columns: if !columns_sent { col_defs } else { vec![] },
        rows: buffer,
        is_last: true,
        total_time_ms: Some(elapsed),
        error: None,
    };
    on_chunk(final_chunk).map_err(|e| AppError::Other(format!("Channel send error: {}", e)))?;

    Ok(())
}

pub async fn get_databases(pool: &MySqlPool) -> Result<Vec<DatabaseInfo>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(SCHEMA_NAME AS CHAR) as name,
                CAST(DEFAULT_CHARACTER_SET_NAME AS CHAR) as charset,
                CAST(DEFAULT_COLLATION_NAME AS CHAR) as collation
         FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list databases: {}", e)))?;

    let databases = rows
        .iter()
        .map(|row| DatabaseInfo {
            name: get_string(row, "name"),
            character_set: get_opt_string(row, "charset"),
            collation: get_opt_string(row, "collation"),
        })
        .collect();

    Ok(databases)
}

pub async fn get_tables(
    pool: &MySqlPool,
    database: &str,
) -> Result<Vec<TableInfo>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(TABLE_NAME AS CHAR) as name,
                CAST(TABLE_TYPE AS CHAR) as table_type,
                CAST(TABLE_ROWS AS SIGNED) as row_count,
                CAST(TABLE_COMMENT AS CHAR) as comment
         FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list tables: {}", e)))?;

    let tables = rows
        .iter()
        .map(|row| TableInfo {
            name: get_string(row, "name"),
            table_type: get_string(row, "table_type"),
            row_count: row
                .try_get::<Option<i64>, _>("row_count")
                .or_else(|_| row.try_get::<Option<u64>, _>("row_count").map(|v| v.map(|n| n as i64)))
                .unwrap_or(None),
            comment: get_opt_string(row, "comment"),
        })
        .collect();

    Ok(tables)
}

pub async fn get_columns(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(COLUMN_NAME AS CHAR) as name,
                CAST(COLUMN_TYPE AS CHAR) as data_type,
                CAST(IS_NULLABLE AS CHAR) as nullable,
                CAST(COLUMN_DEFAULT AS CHAR) as default_value,
                CAST(COLUMN_KEY AS CHAR) as column_key,
                CAST(COLUMN_COMMENT AS CHAR) as comment
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION",
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list columns: {}", e)))?;

    let columns = rows
        .iter()
        .map(|row: &MySqlRow| {
            let nullable_str = get_string(row, "nullable");
            let key = get_string(row, "column_key");
            ColumnInfo {
                name: get_string(row, "name"),
                data_type: get_string(row, "data_type"),
                nullable: nullable_str == "YES",
                default_value: get_opt_string(row, "default_value"),
                is_primary_key: key == "PRI",
                comment: get_opt_string(row, "comment"),
            }
        })
        .collect();

    Ok(columns)
}

pub async fn get_create_table(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<String, AppError> {
    let sql = format!("SHOW CREATE TABLE `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(table));
    let row: MySqlRow = sqlx::query(&sql)
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::Other(format!("Failed to get DDL: {}", e)))?;

    let ddl: String = row
        .try_get::<String, _>(1)
        .or_else(|_| {
            row.try_get::<Vec<u8>, _>(1)
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        })
        .unwrap_or_default();
    Ok(ddl)
}

pub async fn get_views(
    pool: &MySqlPool,
    database: &str,
) -> Result<Vec<ViewInfo>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(TABLE_NAME AS CHAR) as name,
                CAST(DEFINER AS CHAR) as definer,
                CAST(CHECK_OPTION AS CHAR) as check_option,
                CAST(IS_UPDATABLE AS CHAR) as is_updatable
         FROM information_schema.VIEWS
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list views: {}", e)))?;

    Ok(rows.iter().map(|row| ViewInfo {
        name: get_string(row, "name"),
        definer: get_opt_string(row, "definer"),
        check_option: get_opt_string(row, "check_option"),
        is_updatable: get_opt_string(row, "is_updatable"),
    }).collect())
}

pub async fn get_routines(
    pool: &MySqlPool,
    database: &str,
    routine_type: &str,
) -> Result<Vec<RoutineInfo>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(ROUTINE_NAME AS CHAR) as name,
                CAST(ROUTINE_TYPE AS CHAR) as routine_type,
                CAST(DEFINER AS CHAR) as definer,
                CAST(CREATED AS CHAR) as created,
                CAST(LAST_ALTERED AS CHAR) as modified,
                CAST(ROUTINE_COMMENT AS CHAR) as comment
         FROM information_schema.ROUTINES
         WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = ?
         ORDER BY ROUTINE_NAME",
    )
    .bind(database)
    .bind(routine_type)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list routines: {}", e)))?;

    Ok(rows.iter().map(|row| RoutineInfo {
        name: get_string(row, "name"),
        routine_type: get_string(row, "routine_type"),
        definer: get_opt_string(row, "definer"),
        created: get_opt_string(row, "created"),
        modified: get_opt_string(row, "modified"),
        comment: get_opt_string(row, "comment"),
    }).collect())
}

pub async fn get_triggers(
    pool: &MySqlPool,
    database: &str,
) -> Result<Vec<TriggerInfo>, AppError> {
    let rows: Vec<MySqlRow> = sqlx::query(
        "SELECT CAST(TRIGGER_NAME AS CHAR) as name,
                CAST(EVENT_MANIPULATION AS CHAR) as event,
                CAST(ACTION_TIMING AS CHAR) as timing,
                CAST(EVENT_OBJECT_TABLE AS CHAR) as table_name,
                CAST(ACTION_STATEMENT AS CHAR) as statement
         FROM information_schema.TRIGGERS
         WHERE TRIGGER_SCHEMA = ?
         ORDER BY TRIGGER_NAME",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("Failed to list triggers: {}", e)))?;

    Ok(rows.iter().map(|row| TriggerInfo {
        name: get_string(row, "name"),
        event: get_string(row, "event"),
        timing: get_string(row, "timing"),
        table_name: get_string(row, "table_name"),
        statement: get_opt_string(row, "statement"),
    }).collect())
}

pub async fn get_object_definition(
    pool: &MySqlPool,
    database: &str,
    name: &str,
    object_type: &str,
) -> Result<String, AppError> {
    let sql = match object_type {
        "VIEW" => format!("SHOW CREATE VIEW `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(name)),
        "PROCEDURE" => format!("SHOW CREATE PROCEDURE `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(name)),
        "FUNCTION" => format!("SHOW CREATE FUNCTION `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(name)),
        "TRIGGER" => format!("SHOW CREATE TRIGGER `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(name)),
        _ => return Err(AppError::Other(format!("Unknown object type: {}", object_type))),
    };

    let row: MySqlRow = sqlx::query(&sql)
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::Other(format!("Failed to get definition: {}", e)))?;

    // SHOW CREATE xxx 结果列位置：
    // VIEW: [View, Create View, ...]  → index 1
    // PROCEDURE: [Procedure, sql_mode, Create Procedure, ...]  → index 2
    // FUNCTION: [Function, sql_mode, Create Function, ...]  → index 2
    // TRIGGER: [Trigger, sql_mode, SQL Original Statement, ...]  → index 2
    let col_index = if object_type == "VIEW" { 1 } else { 2 };
    let ddl: String = row
        .try_get::<String, _>(col_index)
        .or_else(|_| {
            row.try_get::<Vec<u8>, _>(col_index)
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        })
        .unwrap_or_default();
    Ok(ddl)
}

pub fn build_table_data_sql(database: &str, table: &str, page_size: u32, offset: u32, where_clause: Option<&str>, order_by: Option<&str>) -> Result<String, String> {
    let mut sql = format!("SELECT * FROM `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(table));
    if let Some(w) = where_clause {
        let w = w.trim();
        if !w.is_empty() {
            validate_sql_clause(w)?;
            sql.push_str(&format!(" WHERE {}", w));
        }
    }
    if let Some(o) = order_by {
        let o = o.trim();
        if !o.is_empty() {
            validate_sql_clause(o)?;
            sql.push_str(&format!(" ORDER BY {}", o));
        }
    }
    sql.push_str(&format!(" LIMIT {} OFFSET {}", page_size, offset));
    Ok(sql)
}

pub fn build_table_count_sql(database: &str, table: &str, where_clause: Option<&str>) -> Result<String, String> {
    let mut sql = format!("SELECT COUNT(*) AS cnt FROM `{}`.`{}`", escape_mysql_ident(database), escape_mysql_ident(table));
    if let Some(w) = where_clause {
        let w = w.trim();
        if !w.is_empty() {
            validate_sql_clause(w)?;
            sql.push_str(&format!(" WHERE {}", w));
        }
    }
    Ok(sql)
}

/// Safely extract a String from a MySQL row column.
/// MySQL 8.0 information_schema returns VARBINARY instead of VARCHAR for many columns.
fn get_string(row: &MySqlRow, col: &str) -> String {
    row.try_get::<String, _>(col)
        .or_else(|_| {
            row.try_get::<Vec<u8>, _>(col)
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        })
        .unwrap_or_default()
}

fn get_opt_string(row: &MySqlRow, col: &str) -> Option<String> {
    row.try_get::<Option<String>, _>(col)
        .or_else(|_| {
            row.try_get::<Option<Vec<u8>>, _>(col)
                .map(|opt| opt.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()))
        })
        .unwrap_or(None)
}

fn mysql_value_to_json(
    row: &MySqlRow,
    index: usize,
    type_name: &str,
) -> serde_json::Value {
    match type_name {
        "BOOLEAN" | "TINYINT(1)" => row
            .try_get::<Option<bool>, _>(index)
            .ok()
            .flatten()
            .map(serde_json::Value::Bool)
            .unwrap_or(serde_json::Value::Null),

        "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "INTEGER" => row
            .try_get::<Option<i32>, _>(index)
            .ok()
            .flatten()
            .map(|v| serde_json::Value::Number(v.into()))
            .unwrap_or(serde_json::Value::Null),

        "BIGINT" | "BIGINT UNSIGNED" => row
            .try_get::<Option<i64>, _>(index)
            .or_else(|_| row.try_get::<Option<u64>, _>(index).map(|v| v.map(|n| n as i64)))
            .ok()
            .flatten()
            .map(|v| serde_json::Value::Number(v.into()))
            .unwrap_or(serde_json::Value::Null),

        "FLOAT" | "DOUBLE" | "DECIMAL" => row
            .try_get::<Option<f64>, _>(index)
            .ok()
            .flatten()
            .and_then(serde_json::Number::from_f64)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),

        _ => row
            .try_get::<Option<String>, _>(index)
            .or_else(|_| {
                row.try_get::<Option<Vec<u8>>, _>(index)
                    .map(|opt| opt.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()))
            })
            .ok()
            .flatten()
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
    }
}
