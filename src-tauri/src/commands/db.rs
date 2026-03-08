use tauri::{command, State, ipc::Channel};

use crate::commands::connection::StorageState;
use crate::models::connection::{PoolConfig, PoolStatus, ReconnectParams, ReconnectResult, SslConfig};
use crate::models::import_export::{ExportRequest, ExportResult};
use crate::models::query::{ApplyChangesResult, ColumnInfo, ConnectResult, CreateUserRequest, DatabaseInfo, MysqlUser, ProcessInfo, QueryChunk, QueryResult, RoutineInfo, RowChange, ScriptOptions, ServerStatus, ServerVariable, TableInfo, TriggerInfo, ViewInfo};
use crate::services::credential::CredentialManager;
use crate::services::db_engine::DbEngine;

use std::sync::Arc;

pub type DbEngineState = Arc<DbEngine>;

#[command]
pub async fn db_connect(
    storage: State<'_, StorageState>,
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<ConnectResult, String> {
    let conn = storage
        .get_connection(&connection_id)
        .await
        .map_err(|e| e.to_string())?;

    let password = match CredentialManager::get(&connection_id) {
        Ok(Some(pw)) => {
            log::info!("db_connect: credential found for '{}' (id={})",
                conn.name, connection_id);
            pw
        }
        Ok(None) => {
            log::warn!("db_connect: no credential found for '{}' (id={})", conn.name, connection_id);
            return Err(format!(
                "No password found for connection '{}'. Please edit the connection and re-enter the password.",
                conn.name
            ));
        }
        Err(e) => {
            log::error!("db_connect: credential read error for '{}': {}", conn.name, e);
            return Err(format!("Failed to read credential: {}", e));
        }
    };

    let config: serde_json::Value =
        serde_json::from_str(&conn.config_json)
            .map_err(|e| format!("连接配置数据损坏: {}", e))?;

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
        pc.validate().map_err(|e| e)?;
    }

    engine.connect(
        &connection_id,
        driver,
        &conn.host,
        conn.port,
        &conn.username,
        &password,
        db_opt,
        ssl_config.as_ref(),
        pool_config.as_ref(),
    )
    .await
    .map_err(|e| {
        let err_str = e.to_string();
        let detail = format!("[driver={}, user={}, host={}:{}]",
            driver, conn.username, conn.host, conn.port);
        if err_str.contains("Access denied") || err_str.contains("password authentication failed") {
            format!("{}\n\nThe stored password may be incorrect. Please edit this connection, re-enter the password, and save.\n{}", err_str, detail)
        } else {
            format!("{}  {}", err_str, detail)
        }
    })?;

    // 连接成功后立即预加载数据库列表，减少一次前端 IPC 往返
    let databases = match engine.get_databases(&connection_id).await {
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
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<bool, String> {
    engine.disconnect(&connection_id).await;
    Ok(true)
}

#[command]
pub async fn db_is_connected(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<bool, String> {
    Ok(engine.is_connected(&connection_id).await)
}

#[command]
pub async fn db_execute_query(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    sql: String,
    timeout_secs: Option<u64>,
) -> Result<QueryResult, String> {
    match engine.execute_query(&connection_id, &sql, timeout_secs).await {
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
    engine: State<'_, DbEngineState>,
    connection_id: String,
    sql: String,
    timeout_secs: Option<u64>,
    on_chunk: Channel<QueryChunk>,
) -> Result<(), String> {
    engine
        .execute_query_stream(
            &connection_id,
            &sql,
            timeout_secs,
            |chunk| on_chunk.send(chunk).map_err(|e| e.to_string()),
        )
        .await
        .map_err(|e| e.to_string())
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
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
    sql: String,
    timeout_secs: Option<u64>,
) -> Result<QueryResult, String> {
    match engine.execute_query_in_database(&connection_id, database, sql, timeout_secs).await {
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
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
    sql: String,
    timeout_secs: Option<u64>,
    on_chunk: Channel<QueryChunk>,
) -> Result<(), String> {
    engine
        .execute_query_stream_in_database(
            &connection_id,
            database,
            sql,
            timeout_secs,
            move |chunk| on_chunk.send(chunk).map_err(|e| e.to_string()),
        )
        .await
        .map_err(|e| e.to_string())
}

/// 多语句批量执行
///
/// 接收 SQL 语句数组，按顺序逐条执行，每条语句返回独立的 QueryResult。
/// 如果某条语句执行失败（is_error=true），则停止执行后续语句。
///
/// # 参数
/// - `engine` - 数据库引擎状态
/// - `connection_id` - 连接 ID
/// - `statements` - SQL 语句数组
///
/// # 返回
/// 每条已执行语句的 QueryResult 数组，失败语句之后的语句不会被执行
#[command]
pub async fn db_execute_multi(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    statements: Vec<String>,
) -> Result<Vec<QueryResult>, String> {
    let mut results: Vec<QueryResult> = Vec::new();

    for stmt in &statements {
        let trimmed = stmt.trim();
        // 跳过空语句
        if trimmed.is_empty() {
            continue;
        }

        match engine.execute_query(&connection_id, trimmed, None).await {
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


#[command]
pub async fn db_get_databases(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<Vec<DatabaseInfo>, String> {
    engine.get_databases(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_tables(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
) -> Result<Vec<TableInfo>, String> {
    engine.get_tables(&connection_id, &database)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_columns(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
    table: String,
) -> Result<Vec<ColumnInfo>, String> {
    engine.get_columns(&connection_id, &database, &table)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_table_data(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
    table: String,
    page: u32,
    page_size: u32,
    where_clause: Option<String>,
    order_by: Option<String>,
) -> Result<QueryResult, String> {
    engine.get_table_data(&connection_id, &database, &table, page, page_size, where_clause.as_deref(), order_by.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_create_table(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
    table: String,
) -> Result<String, String> {
    engine.get_create_table(&connection_id, &database, &table)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_cancel_query(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<bool, String> {
    engine.cancel_query(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[command]
pub async fn db_get_views(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
) -> Result<Vec<ViewInfo>, String> {
    engine.get_views(&connection_id, &database)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_procedures(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
) -> Result<Vec<RoutineInfo>, String> {
    engine.get_routines(&connection_id, &database, "PROCEDURE")
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_functions(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
) -> Result<Vec<RoutineInfo>, String> {
    engine.get_routines(&connection_id, &database, "FUNCTION")
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_triggers(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
) -> Result<Vec<TriggerInfo>, String> {
    engine.get_triggers(&connection_id, &database)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_object_definition(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
    name: String,
    object_type: String,
) -> Result<String, String> {
    engine.get_object_definition(&connection_id, &database, &name, &object_type)
        .await
        .map_err(|e| e.to_string())
}

/// 获取连接池状态（活跃/空闲连接数）
#[command]
pub async fn db_get_pool_status(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<PoolStatus, String> {
    engine.get_pool_status(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

/// 检查连接状态并在断开时自动重连
///
/// 先检查连接是否存活（SELECT 1），如果断开则尝试重连，
/// 最多重试 3 次，每次间隔 5 秒。
#[command]
pub async fn db_check_and_reconnect(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    reconnect_params: ReconnectParams,
) -> Result<ReconnectResult, String> {
    engine.check_and_reconnect(&connection_id, &reconnect_params)
        .await
        .map_err(|e| e.to_string())
}

/// 开始事务
///
/// 从连接池获取专用连接，执行 BEGIN 语句，后续事务内操作使用该专用连接。
#[command]
pub async fn db_begin_transaction(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<bool, String> {
    engine
        .begin_transaction(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

/// 提交事务
///
/// 在专用连接上执行 COMMIT，然后释放连接并清除事务状态。
#[command]
pub async fn db_commit(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<bool, String> {
    engine
        .commit_transaction(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

/// 回滚事务
///
/// 在专用连接上执行 ROLLBACK，然后释放连接并清除事务状态。
#[command]
pub async fn db_rollback(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<bool, String> {
    engine
        .rollback_transaction(&connection_id)
        .await
        .map_err(|e| e.to_string())
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
    engine: State<'_, DbEngineState>,
    connection_id: String,
    sql: String,
    format: String,
) -> Result<QueryResult, String> {
    let explain_sql = match format.as_str() {
        "json" => format!("EXPLAIN FORMAT=JSON {}", sql.trim()),
        _ => format!("EXPLAIN {}", sql.trim()),
    };

    match engine.execute_query(&connection_id, &explain_sql, None).await {
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
    engine: State<'_, DbEngineState>,
    connection_id: String,
    changes: Vec<RowChange>,
) -> Result<ApplyChangesResult, String> {
    engine
        .apply_row_changes(&connection_id, changes)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    let raw = std::path::Path::new(&path);

    // 路径必须是绝对路径
    if !raw.is_absolute() {
        return Err("Write denied: path must be absolute".to_string());
    }

    let target = raw
        .canonicalize()
        .map_err(|_| "Write denied: invalid or non-existent parent directory".to_string())?;

    // 限制写入路径到用户文档目录和下载目录
    let allowed = if let Some(dirs) = directories::UserDirs::new() {
        let mut ok = false;
        if let Some(doc) = dirs.document_dir() {
            if target.starts_with(doc) {
                ok = true;
            }
        }
        if let Some(dl) = dirs.download_dir() {
            if target.starts_with(dl) {
                ok = true;
            }
        }
        // 也允许桌面
        if let Some(desktop) = dirs.desktop_dir() {
            if target.starts_with(desktop) {
                ok = true;
            }
        }
        ok
    } else {
        false
    };

    if !allowed {
        return Err("Write denied: path must be within Documents, Downloads, or Desktop directory".to_string());
    }

    tokio::fs::write(&target, content.as_bytes())
        .await
        .map_err(|e| format!("Failed to write file: {}", e))
}

// ===== 性能监控命令 =====

/// 获取服务器状态指标（QPS、TPS、连接数等）
#[command]
pub async fn db_get_server_status(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<ServerStatus, String> {
    engine
        .get_server_status(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

/// 获取进程列表
#[command]
pub async fn db_get_process_list(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<Vec<ProcessInfo>, String> {
    engine
        .get_process_list(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

/// 终止指定进程
#[command]
pub async fn db_kill_process(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    process_id: u64,
) -> Result<bool, String> {
    engine
        .kill_process(&connection_id, process_id)
        .await
        .map_err(|e| e.to_string())
}

/// 获取服务器变量
#[command]
pub async fn db_get_server_variables(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<Vec<ServerVariable>, String> {
    engine
        .get_server_variables(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

// ===== 用户权限管理命令 =====

/// 获取所有 MySQL 用户
#[command]
pub async fn db_get_users(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<Vec<MysqlUser>, String> {
    engine
        .get_users(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

/// 创建新用户
#[command]
pub async fn db_create_user(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    request: CreateUserRequest,
) -> Result<bool, String> {
    engine
        .create_user(&connection_id, &request)
        .await
        .map_err(|e| e.to_string())
}

/// 删除用户
#[command]
pub async fn db_drop_user(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    username: String,
    host: String,
) -> Result<bool, String> {
    engine
        .drop_user(&connection_id, &username, &host)
        .await
        .map_err(|e| e.to_string())
}

/// 获取用户权限
#[command]
pub async fn db_get_user_grants(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    username: String,
    host: String,
) -> Result<Vec<String>, String> {
    engine
        .get_user_grants(&connection_id, &username, &host)
        .await
        .map_err(|e| e.to_string())
}

/// 批量执行 GRANT/REVOKE 语句
#[command]
pub async fn db_apply_grants(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    statements: Vec<String>,
) -> Result<bool, String> {
    engine
        .apply_grants(&connection_id, statements)
        .await
        .map_err(|e| e.to_string())
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
    engine: State<'_, DbEngineState>,
    app: tauri::AppHandle,
    connection_id: String,
    request: ExportRequest,
) -> Result<ExportResult, String> {
    engine
        .export_data(&connection_id, &request, &app)
        .await
        .map_err(|e| e.to_string())
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
/// 生成的 SQL 脚本字符串
#[command]
pub async fn db_generate_script(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
    object_name: String,
    script_type: String,
    options: ScriptOptions,
) -> Result<String, String> {
    engine
        .generate_script(&connection_id, &database, &object_name, &script_type, &options)
        .await
        .map_err(|e| e.to_string())
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
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
    options: ScriptOptions,
) -> Result<String, String> {
    engine
        .export_database_ddl(&connection_id, &database, &options)
        .await
        .map_err(|e| e.to_string())
}
