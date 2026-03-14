use tauri::{command, ipc::Channel, AppHandle, Manager};

use crate::commands::connection::StorageState;
use crate::models::connection::{PoolConfig, PoolStatus, ReconnectParams, ReconnectResult, SslConfig};
use crate::models::import_export::{ExportRequest, ExportResult};
use crate::models::query::{
    ApplyChangesResult, ColumnInfo, ConnectResult, CreateUserRequest, DatabaseInfo, MysqlUser,
    ProcessInfo, QueryChunk, QueryResult, RoutineInfo, RowChange, ScriptOptions,
    ServerStatus, ServerVariable, StatementResult, TableInfo, TriggerInfo, ViewInfo,
    detect_statement_type, SqlFileProgress, SqlImportOptions, ForeignKeyRelation
};
use crate::services::credential::CredentialManager;
use crate::services::db_engine::DbEngine;
use crate::utils::error::AppError;

use std::sync::Arc;

pub type DbEngineState = Arc<DbEngine>;

#[command]
pub async fn db_connect(
    app: AppHandle,
    connection_id: String,
) -> Result<ConnectResult, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let engine = app.state::<DbEngineState>().inner().clone();

    let conn = storage
        .get_connection(&connection_id)
        .await?;

    let password = match CredentialManager::get(&connection_id) {
        Ok(Some(pw)) => {
            log::info!("db_connect: credential found for '{}' (id={})",
                conn.name, connection_id);
            pw
        }
        Ok(None) => {
            log::warn!("db_connect: no credential found for '{}' (id={})", conn.name, connection_id);
            return Err(AppError::Credential(format!(
                "No password found for connection '{}'. Please edit the connection and re-enter the password.",
                conn.name
            )));
        }
        Err(e) => {
            log::error!("db_connect: credential read error for '{}': {}", conn.name, e);
            return Err(AppError::Credential(format!("Failed to read credential: {}", e)));
        }
    };

    let config: serde_json::Value =
        serde_json::from_str(&conn.config_json)?;

    let driver = config
        .get("driver")
        .and_then(|v| v.as_str())
        .unwrap_or("mysql");

    let database = config
        .get("database")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let db_opt = if database.is_empty() {
        None
    } else {
        Some(database)
    };

    // 从配置中解析 SSL 配置
    let ssl_config: Option<SslConfig> = config.get("ssl")
        .and_then(|v| serde_json::from_value(v.clone()).ok());

    // 从配置中解析连接池配置
    let pool_config: Option<PoolConfig> = config.get("pool")
        .and_then(|v| serde_json::from_value(v.clone()).ok());

    // 校验连接池参数
    if let Some(ref pc) = pool_config {
        pc.validate().map_err(|e| AppError::Validation(e))?;
    }

    engine.clone().connect(
        connection_id.clone(),
        driver.to_string(),
        conn.host.clone(),
        conn.port,
        conn.username.clone(),
        password.clone(),
        db_opt.map(|s| s.to_string()),
        ssl_config,
        pool_config,
    )
    .await
    .map_err(|e| {
        let err_str = e.to_string();
        let detail = format!("[driver={}, user={}, host={}:{}]",
            driver, conn.username, conn.host, conn.port);
        if err_str.contains("Access denied") || err_str.contains("password authentication failed") {
            AppError::Connection(format!("{}\n\nThe stored password may be incorrect. Please edit this connection, re-enter the password, and save.\n{}", err_str, detail))
        } else {
            AppError::Connection(format!("{}  {}", err_str, detail))
        }
    })?;

    // 连接成功后立即预加载数据库列表，减少一次前端 IPC 往返
    let databases = match engine.get_databases(connection_id.clone()).await {
        Ok(dbs) => dbs,
        Err(e) => {
            log::warn!("db_connect: 预加载数据库列表失败: {}", e);
            vec![] // 预加载失败不影响连接结果，前端可回退到手动加载
        }
    };

    Ok(ConnectResult {
        success: true,
        databases,
    })
}

#[command]
pub async fn db_disconnect(
    app: AppHandle,
    connection_id: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.disconnect(connection_id).await;
    Ok(true)
}

#[command]
pub async fn db_is_connected(
    app: AppHandle,
    connection_id: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    Ok(engine.is_connected(connection_id).await)
}

#[command]
pub async fn db_execute_query(
    app: AppHandle,
    connection_id: String,
    sql: String,
    timeout_secs: Option<u64>,
) -> Result<QueryResult, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    match engine.execute_query(connection_id, None, sql, timeout_secs).await {
        Ok(result) => Ok(result),
        Err(e) => Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: 0,
            is_error: true,
            error: Some(e.to_string()),
            total_count: None,
            truncated: false,
        }),
    }
}

/// 流式执行查询，通过 Tauri Channel 逐批推送 QueryChunk 给前端
///
/// 与 db_execute_query 的区别：
/// - 每获取 100 行数据即推送一个 chunk，前端可立即渲染
/// - 适用于大数据量 SELECT 查询的首屏加速
#[command]
pub async fn db_execute_query_stream(
    app: AppHandle,
    connection_id: String,
    sql: String,
    timeout_secs: Option<u64>,
    on_chunk: Channel<QueryChunk>,
) -> Result<(), AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    let on_chunk = Arc::new(std::sync::Mutex::new(on_chunk));
    engine
        .execute_query_stream(
            connection_id,
            None,
            sql,
            timeout_secs,
            Arc::new(move |chunk| {
                let ch = on_chunk.lock().map_err(|e| e.to_string())?;
                ch.send(chunk).map_err(|e| e.to_string())
            }),
        )
        .await
}

/// 在指定数据库上下文中执行查询
///
/// 从连接池获取单个连接，先执行 USE <database> 切换数据库上下文，
/// 再执行用户 SQL，确保两条语句在同一个连接上执行。
///
/// # 参数
/// - `connection_id` - 连接 ID
/// - `database` - 目标数据库名
/// - `sql` - 用户 SQL 语句
/// - `timeout_secs` - 可选超时时间（秒）
#[command]
pub async fn db_execute_query_in_database(
    app: AppHandle,
    connection_id: String,
    database: String,
    sql: String,
    timeout_secs: Option<u64>,
) -> Result<QueryResult, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    match engine.execute_query_in_database(connection_id, database, sql, timeout_secs).await {
        Ok(result) => Ok(result),
        Err(e) => Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: 0,
            is_error: true,
            error: Some(e.to_string()),
            total_count: None,
            truncated: false,
        }),
    }
}

/// 在指定数据库上下文中流式执行查询
///
/// 从连接池获取单个连接，先执行 USE <database>，再流式执行用户 SQL。
#[command]
pub async fn db_execute_query_stream_in_database(
    app: AppHandle,
    connection_id: String,
    database: String,
    sql: String,
    timeout_secs: Option<u64>,
    on_chunk: Channel<QueryChunk>,
) -> Result<(), AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    let on_chunk = Arc::new(std::sync::Mutex::new(on_chunk));
    engine
        .execute_query_stream_in_database(
            connection_id,
            database,
            sql,
            timeout_secs,
            Arc::new(move |chunk| {
                let ch = on_chunk.lock().map_err(|e| e.to_string())?;
                ch.send(chunk).map_err(|e| e.to_string())
            }),
        )
        .await
}

#[command]
pub async fn db_execute_multi(
    app: AppHandle,
    connection_id: String,
    statements: Vec<String>,
) -> Result<Vec<QueryResult>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    let mut results: Vec<QueryResult> = Vec::new();

    for stmt in statements {
        let trimmed = stmt.trim().to_string();
        // 跳过空语句
        if trimmed.is_empty() {
            continue;
        }

        match engine.clone().execute_query(connection_id.clone(), None, trimmed, None).await {
            Ok(result) => {
                let has_error = result.is_error;
                results.push(result);
                // 如果当前语句执行失败，停止执行后续语句
                if has_error {
                    break;
                }
            }
            Err(e) => {
                // 引擎级别错误，构造错误 QueryResult 并停止
                results.push(QueryResult {
                    columns: vec![],
                    rows: vec![],
                    affected_rows: 0,
                    execution_time_ms: 0,
                    is_error: true,
                    error: Some(e.to_string()),
                    total_count: None,
                    truncated: false,
                });
                break;
            }
        }
    }
    Ok(results)
}

/// 多语句智能执行（增强版）
///
/// 接收原始 SQL 文本，后端智能分割后逐条执行。
/// 支持错误策略选择和数据库上下文切换。
///
/// # 参数
/// - `connection_id` - 连接 ID
/// - `sql` - 原始 SQL 文本（后端负责分割）
/// - `database` - 可选数据库上下文（执行前先 USE）
/// - `error_strategy` - 错误策略："stopOnError"（默认）或 "continueOnError"
/// - `timeout_secs` - 可选单条语句超时时间（秒）
///
/// # 返回
/// 每条语句的执行结果列表（含语句序号、类型、SQL 文本和执行结果）
#[command]
pub async fn db_execute_multi_v2(
    app: AppHandle,
    connection_id: String,
    sql: String,
    database: Option<String>,
    error_strategy: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<Vec<StatementResult>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    use crate::services::sql_splitter;

    // 分割 SQL 文本并转换为拥有所有权的 String 列表，避免跨 await 点持有引用
    let statements: Vec<String> = sql_splitter::split_sql_statements(&sql).into_iter().map(|s| s.to_string()).collect();
    if statements.is_empty() {
        return Ok(vec![]);
    }

    // 解析错误策略
    let stop_on_error = match error_strategy.as_deref() {
        Some("continueOnError") => false,
        _ => true, // 默认遇错停止
    };

    let mut results: Vec<StatementResult> = Vec::new();

    for (idx, stmt) in statements.into_iter().enumerate() {
        let trimmed = stmt.trim();
        if trimmed.is_empty() {
            continue;
        }

        let stmt_type = detect_statement_type(trimmed);
        let index = (idx + 1) as u32;

        // 根据是否指定数据库上下文选择执行方式
        let query_result = if let Some(ref db) = database {
            match engine.clone().execute_query_in_database(
                connection_id.clone(),
                db.clone(),
                trimmed.to_string(),
                timeout_secs,
            ).await {
                Ok(r) => r,
                Err(e) => QueryResult::error(e.to_string(), 0),
            }
        } else {
            match engine.clone().execute_query(connection_id.clone(), None, trimmed.to_string(), timeout_secs).await {
                Ok(r) => r,
                Err(e) => QueryResult::error(e.to_string(), 0),
            }
        };

        let has_error = query_result.is_error;

        results.push(StatementResult {
            index,
            sql: trimmed.to_string(),
            statement_type: stmt_type,
            result: query_result,
        });

        // 根据错误策略决定是否继续
        if has_error && stop_on_error {
            break;
        }
    }

    Ok(results)
}



#[command]
pub async fn db_pause_sql_import(app: AppHandle, import_id: String) -> Result<(), AppError> {
    let _engine = app.state::<DbEngineState>(); 
    if let Some(state) = crate::services::db_engine::get_import_states().read().await.get(&import_id) {
        state.store(1, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

#[command]
pub async fn db_resume_sql_import(app: AppHandle, import_id: String) -> Result<(), AppError> {
    let _engine = app.state::<DbEngineState>();
    if let Some(state) = crate::services::db_engine::get_import_states().read().await.get(&import_id) {
        state.store(0, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

#[command]
pub async fn db_cancel_sql_import(app: AppHandle, import_id: String) -> Result<(), AppError> {
    let _engine = app.state::<DbEngineState>();
    if let Some(state) = crate::services::db_engine::get_import_states().read().await.get(&import_id) {
        state.store(2, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

#[command]
pub async fn db_run_sql_file_stream(
    app: AppHandle,
    connection_id: String,
    import_id: String,
    file_path: String,
    options: SqlImportOptions,
    database: Option<String>,
    on_progress: Channel<SqlFileProgress>,
) -> Result<(), AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.run_sql_file_stream(connection_id, import_id, file_path, options, database, on_progress)
        .await
}

#[command]
pub async fn db_get_databases(
    app: AppHandle,
    connection_id: String,
) -> Result<Vec<DatabaseInfo>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_databases(connection_id)
        .await
}

#[command]
pub async fn db_get_tables(
    app: AppHandle,
    connection_id: String,
    database: String,
) -> Result<Vec<TableInfo>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_tables(connection_id, database)
        .await
}

#[command]
pub async fn db_get_columns(
    app: AppHandle,
    connection_id: String,
    database: String,
    table: String,
) -> Result<Vec<ColumnInfo>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_columns(connection_id, database, table)
        .await
}

#[command]
pub async fn db_get_table_data(
    app: AppHandle,
    connection_id: String,
    database: String,
    table: String,
    page: u32,
    page_size: u32,
    where_clause: Option<String>,
    order_by: Option<String>,
) -> Result<QueryResult, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_table_data(connection_id, database, table, page, page_size, where_clause, order_by)
        .await
}

#[command]
pub async fn db_get_create_table(
    app: AppHandle,
    connection_id: String,
    database: String,
    table: String,
) -> Result<String, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_create_table(connection_id, database, table)
        .await
}

#[command]
pub async fn db_cancel_query(
    app: AppHandle,
    connection_id: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().cancel_query(connection_id)
        .await?;
    Ok(true)
}

#[command]
pub async fn db_get_views(
    app: AppHandle,
    connection_id: String,
    database: String,
) -> Result<Vec<ViewInfo>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_views(connection_id, database)
        .await
}

#[command]
pub async fn db_get_procedures(
    app: AppHandle,
    connection_id: String,
    database: String,
) -> Result<Vec<RoutineInfo>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_routines(connection_id, database, "PROCEDURE".to_string())
        .await
}

#[command]
pub async fn db_get_functions(
    app: AppHandle,
    connection_id: String,
    database: String,
) -> Result<Vec<RoutineInfo>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_routines(connection_id, database, "FUNCTION".to_string())
        .await
}

#[command]
pub async fn db_get_triggers(
    app: AppHandle,
    connection_id: String,
    database: String,
) -> Result<Vec<TriggerInfo>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_triggers(connection_id, database)
        .await
}

#[command]
pub async fn db_get_object_definition(
    app: AppHandle,
    connection_id: String,
    database: String,
    name: String,
    object_type: String,
) -> Result<String, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_object_definition(connection_id, database, name, object_type)
        .await
}

/// 获取连接池状态（活跃/空闲连接数）
#[command]
pub async fn db_get_pool_status(
    app: AppHandle,
    connection_id: String,
) -> Result<PoolStatus, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_pool_status(connection_id).await
}

/// 检查连接状态并在断开时自动重连
///
/// 先检查连接是否存活（SELECT 1），如果断开则尝试重连，
/// 最多重试 3 次，每次间隔 5 秒。
#[command]
pub async fn db_check_and_reconnect(
    app: AppHandle,
    connection_id: String,
    reconnect_params: ReconnectParams,
) -> Result<ReconnectResult, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().check_and_reconnect(connection_id, reconnect_params).await
}

/// 开始事务
///
/// 从连接池获取专用连接，执行 BEGIN 语句，后续事务内操作使用该专用连接。
#[command]
pub async fn db_begin_transaction(
    app: AppHandle,
    connection_id: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .begin_transaction(connection_id)
        .await
}

/// 提交事务
///
/// 在专用连接上执行 COMMIT，然后释放连接并清除事务状态。
#[command]
pub async fn db_commit(
    app: AppHandle,
    connection_id: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .commit_transaction(connection_id)
        .await
}

/// 回滚事务
///
/// 在专用连接上执行 ROLLBACK，然后释放连接并清除事务状态。
#[command]
pub async fn db_rollback(
    app: AppHandle,
    connection_id: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .rollback_transaction(connection_id)
        .await
}

/// 获取 SQL 执行计划
///
/// 支持两种格式：
/// - `format="table"` → 执行 `EXPLAIN {sql}`，返回表格形式的执行计划
/// - `format="json"` → 执行 `EXPLAIN FORMAT=JSON {sql}`，返回 JSON 格式的详细成本信息
///
/// # 参数
/// - `connection_id` - 连接 ID
/// - `sql` - 要分析的 SQL 语句
/// - `format` - 输出格式，"table" 或 "json"
#[command]
pub async fn db_explain(
    app: AppHandle,
    connection_id: String,
    sql: String,
    format: String,
) -> Result<QueryResult, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    let explain_sql = match format.as_str() {
        "json" => format!("EXPLAIN FORMAT=JSON {}", sql.trim()),
        _ => format!("EXPLAIN {}", sql.trim()),
    };

    match engine.clone().execute_query(connection_id, None, explain_sql, None).await {
        Ok(result) => Ok(result),
        Err(e) => Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: 0,
            is_error: true,
            error: Some(e.to_string()),
            total_count: None,
            truncated: false,
        }),
    }
}

/// 批量应用行数据变更
///
/// 接收行变更列表，在事务中执行所有 UPDATE/INSERT/DELETE 操作。
/// 任一操作失败则全部回滚，返回生成的 SQL 用于审计。
///
/// # 参数
/// - `connection_id` - 连接 ID
/// - `changes` - 行变更列表
#[command]
pub async fn db_apply_row_changes(
    app: AppHandle,
    connection_id: String,
    changes: Vec<RowChange>,
) -> Result<ApplyChangesResult, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .apply_row_changes(connection_id, changes)
        .await
}

/// 读取文本文件内容（用于运行 SQL 文件等场景）
#[command]
pub async fn read_text_file(path: String) -> Result<String, AppError> {
    let raw = std::path::Path::new(&path);

    if !raw.is_absolute() {
        return Err(AppError::Validation("Read denied: path must be absolute".into()));
    }

    if !raw.exists() {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("File not found: {}", path),
        )));
    }

    tokio::fs::read_to_string(raw)
        .await
        .map_err(AppError::from)
}

#[command]
pub async fn write_text_file(path: String, content: String) -> Result<(), AppError> {
    let raw = std::path::Path::new(&path);

    // 路径必须是绝对路径
    if !raw.is_absolute() {
        return Err(AppError::Validation("Write denied: path must be absolute".into()));
    }

    // 对父目录做 canonicalize（父目录必须存在），而不是对文件本身
    // 因为文件可能还不存在（新建场景）
    let parent = raw.parent()
        .ok_or_else(|| AppError::Validation("Write denied: cannot determine parent directory".into()))?;

    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| AppError::Validation("Write denied: parent directory does not exist".into()))?;

    let file_name = raw.file_name()
        .ok_or_else(|| AppError::Validation("Write denied: invalid file name".into()))?;

    let target = canonical_parent.join(file_name);

    // 限制写入路径到用户常用目录
    // 注意：必须对 directories 返回的路径也做 canonicalize，
    // 因为 Windows 上 canonicalize 会添加 \\?\ UNC 前缀，两边格式必须一致
    let allowed = if let Some(dirs) = directories::UserDirs::new() {
        let mut allowed_dirs: Vec<std::path::PathBuf> = Vec::new();

        if let Some(doc) = dirs.document_dir() {
            if let Ok(p) = doc.canonicalize() { allowed_dirs.push(p); }
        }
        if let Some(dl) = dirs.download_dir() {
            if let Ok(p) = dl.canonicalize() { allowed_dirs.push(p); }
        }
        if let Some(desktop) = dirs.desktop_dir() {
            if let Ok(p) = desktop.canonicalize() { allowed_dirs.push(p); }
        }
        // 也允许用户主目录下的任何位置
        if let Some(home) = dirs.home_dir().canonicalize().ok() {
            allowed_dirs.push(home);
        }

        allowed_dirs.iter().any(|d| canonical_parent.starts_with(d))
    } else {
        false
    };

    if !allowed {
        return Err(AppError::Permission("Write denied: path must be within user home directory".into()));
    }

    tokio::fs::write(&target, content.as_bytes())
        .await
        .map_err(AppError::from)
}

// ===== 性能监控命令 =====

/// 获取服务器状态指标（QPS、TPS、连接数等）
#[command]
pub async fn db_get_server_status(
    app: AppHandle,
    connection_id: String,
) -> Result<ServerStatus, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .get_server_status(connection_id)
        .await
}

/// 获取进程列表
#[command]
pub async fn db_get_process_list(
    app: AppHandle,
    connection_id: String,
) -> Result<Vec<ProcessInfo>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .get_process_list(connection_id)
        .await
}

/// 终止指定进程
#[command]
pub async fn db_kill_process(
    app: AppHandle,
    connection_id: String,
    process_id: u64,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .kill_process(connection_id, process_id)
        .await
}

/// 获取服务器变量
#[command]
pub async fn db_get_server_variables(
    app: AppHandle,
    connection_id: String,
) -> Result<Vec<ServerVariable>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .get_server_variables(connection_id)
        .await
}

// ===== 用户权限管理命令 =====

/// 获取所有 MySQL 用户
#[command]
pub async fn db_get_users(
    app: AppHandle,
    connection_id: String,
) -> Result<Vec<MysqlUser>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .get_users(connection_id)
        .await
}

/// 创建新用户
#[command]
pub async fn db_create_user(
    app: AppHandle,
    connection_id: String,
    request: CreateUserRequest,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .create_user(connection_id, request)
        .await
}

/// 删除用户
#[command]
pub async fn db_drop_user(
    app: AppHandle,
    connection_id: String,
    username: String,
    host: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .drop_user(connection_id, username, host)
        .await
}

/// 获取用户权限
#[command]
pub async fn db_get_user_grants(
    app: AppHandle,
    connection_id: String,
    username: String,
    host: String,
) -> Result<Vec<String>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .get_user_grants(username, host, connection_id)
        .await
}

/// 批量执行 GRANT/REVOKE 语句
#[command]
pub async fn db_apply_grants(
    app: AppHandle,
    connection_id: String,
    statements: Vec<String>,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .apply_grants(statements, connection_id)
        .await
}

// ===== 数据导出命令 =====

/// 多格式数据导出
///
/// 支持将查询结果或表数据导出为 CSV、JSON、SQL、Excel、Markdown 格式。
/// 大数据量（>100,000 行）使用分批查询流式写入，通过 `export-progress` 事件发送进度。
///
/// # 参数
/// - `engine` - 数据库引擎状态
/// - `app` - Tauri AppHandle，用于发送进度事件
/// - `connection_id` - 连接 ID
/// - `request` - 导出请求（包含数据来源、格式、文件路径和选项）
///
/// # 返回
/// 导出结果，包含成功状态、导出行数和文件大小
#[command]
pub async fn db_export_data(
    app: AppHandle,
    connection_id: String,
    request: ExportRequest,
) -> Result<ExportResult, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .export_data(connection_id, request, app)
        .await
}

// ===== DDL 脚本生成命令 =====

/// 生成单个数据库对象的脚本
///
/// 支持四种脚本类型：
/// - "create": 获取完整建表语句，可选添加 IF NOT EXISTS
/// - "drop": 生成 DROP TABLE 语句，可选添加 IF EXISTS
/// - "insert-template": 生成 INSERT INTO 模板
/// - "select-template": 生成 SELECT 模板
///
/// # 参数
/// - `connection_id` - 连接 ID
/// - `database` - 数据库名
/// - `object_name` - 对象名称（表名）
/// - `script_type` - 脚本类型
/// - `options` - 脚本生成选项（IF NOT EXISTS / IF EXISTS）
///
/// # 返回
/// 生成s的 SQL 脚本字符串
#[command]
pub async fn db_generate_script(
    app: AppHandle,
    connection_id: String,
    database: String,
    object_name: String,
    script_type: String,
    options: ScriptOptions,
) -> Result<String, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .generate_script(connection_id, database, object_name, script_type, options)
        .await
}

/// 导出整个数据库的 DDL 结构脚本
///
/// 遍历数据库下所有表、视图、存储过程、函数、触发器，
/// 获取每个对象的 DDL 并拼接为完整的数据库结构脚本。
///
/// # 参数
/// - `connection_id` - 连接 ID
/// - `database` - 数据库名
/// - `options` - 脚本生成选项（IF NOT EXISTS / IF EXISTS）
///
/// # 返回
/// 完整的数据库 DDL 脚本字符串
#[command]
pub async fn db_export_database_ddl(
    app: AppHandle,
    connection_id: String,
    database: String,
    options: ScriptOptions,
) -> Result<String, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .export_database_ddl(connection_id, database, options)
        .await
}

// ===== Session 连接管理（企业级模式） =====

/// 为指定查询 Tab 获取专用 Session 连接
///
/// 前端在打开查询 Tab 时调用，从连接池 acquire 一条独占连接。
/// 每个 Tab 独占一条连接，避免多 Tab 间 USE 语句互相干扰。
#[command]
pub async fn db_acquire_session(
    app: AppHandle,
    connection_id: String,
    tab_id: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .acquire_session(connection_id, tab_id)
        .await?;
    Ok(true)
}

/// 释放指定查询 Tab 的 Session 连接
///
/// 前端在关闭查询 Tab 时调用，将连接归还连接池。
#[command]
pub async fn db_release_session(
    app: AppHandle,
    connection_id: String,
    tab_id: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .release_session(connection_id, tab_id)
        .await;
    Ok(true)
}

/// 在 Session 连接上切换数据库
///
/// 前端在数据库选择下拉框切换时调用。
/// 只有当目标数据库与 session 当前数据库不同时才执行 USE 语句。
#[command]
pub async fn db_switch_database(
    app: AppHandle,
    connection_id: String,
    tab_id: String,
    database: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .switch_session_database(connection_id, tab_id, database)
        .await?;
    Ok(true)
}

/// 在 Session 连接上执行查询（企业级模式）
///
/// 优先使用 Tab 专用的 Session 连接执行 SQL，自动处理数据库上下文。
/// 如果没有 Session 则降级到传统的 pool + USE 模式。
#[command]
pub async fn db_execute_query_on_session(
    app: AppHandle,
    connection_id: String,
    tab_id: String,
    database: Option<String>,
    sql: String,
    timeout_secs: Option<u64>,
) -> Result<QueryResult, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    match engine.execute_query_on_session(connection_id, tab_id, database, sql, timeout_secs).await {
        Ok(result) => Ok(result),
        Err(e) => Ok(QueryResult::error(e.to_string(), 0)),
    }
}

/// 在 Session 连接上流式执行查询（企业级模式）
#[command]
pub async fn db_execute_query_stream_on_session(
    app: AppHandle,
    connection_id: String,
    tab_id: String,
    database: Option<String>,
    sql: String,
    timeout_secs: Option<u64>,
    on_chunk: Channel<QueryChunk>,
) -> Result<(), AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    let on_chunk = Arc::new(std::sync::Mutex::new(on_chunk));

    engine.execute_query_stream_on_session(
        connection_id,
        tab_id,
        database,
        sql,
        timeout_secs,
        Arc::new(move |chunk| {
            let ch = on_chunk.lock().map_err(|e| e.to_string())?;
            ch.send(chunk).map_err(|e| e.to_string())
        }),
    ).await
}

/// 获取指定数据库中所有外键关系（用于 SQL 补全 JOIN 推荐）
#[command]
pub async fn db_get_foreign_keys(
    app: AppHandle,
    connection_id: String,
    database: String,
) -> Result<Vec<ForeignKeyRelation>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine
        .get_foreign_keys(connection_id, database)
        .await
}
