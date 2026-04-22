//! 查询执行命令

use tauri::{command, ipc::Channel, AppHandle, Manager};
use std::sync::Arc;

use crate::models::query::{
    QueryChunk, QueryResult, StatementResult,
    detect_statement_type,
};
use crate::services::audit_log;
use crate::utils::error::AppError;
use crate::commands::connection::StorageState;
use super::DbEngineState;

async fn execute_multi_statements(
    app: &AppHandle,
    connection_id: String,
    database: Option<String>,
    error_strategy: Option<String>,
    statements: Vec<String>,
    timeout_secs: Option<u64>,
    run_statement: impl Fn(String, Option<String>, Option<u64>) -> std::pin::Pin<Box<dyn std::future::Future<Output = QueryResult> + Send>>,
) -> Vec<StatementResult> {
    let stop_on_error = match error_strategy.as_deref() {
        Some("continueOnError") => false,
        _ => true,
    };

    let mut results: Vec<StatementResult> = Vec::new();

    for (idx, stmt) in statements.into_iter().enumerate() {
        let trimmed = stmt.trim();
        if trimmed.is_empty() {
            continue;
        }

        let stmt_type = detect_statement_type(trimmed);
        let index = (idx + 1) as u32;
        let query_result = run_statement(trimmed.to_string(), database.clone(), timeout_secs).await;
        let has_error = query_result.is_error;

        if audit_log::classify_operation(trimmed).is_some() {
            let storage = app.state::<StorageState>().inner().clone();
            let sql_clone = trimmed.to_string();
            let cid = connection_id.clone();
            let db = database.clone();
            let is_err = query_result.is_error;
            let err_msg = query_result.error.clone();
            let affected = query_result.affected_rows as i64;
            tokio::spawn(async move {
                let _ = audit_log::record(
                    &storage, &cid, None, db.as_deref(), &sql_clone,
                    affected, 0, is_err, err_msg.as_deref(),
                ).await;
            });
        }

        results.push(StatementResult {
            index,
            sql: trimmed.to_string(),
            statement_type: stmt_type,
            result: query_result,
        });

        if has_error && stop_on_error {
            break;
        }
    }

    results
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
        Err(e) => Ok(QueryResult::error(e.to_string(), 0)),
    }
}

/// 流式执行查询，通过 Tauri Channel 逐批推送 QueryChunk 给前端
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
#[command]
pub async fn db_execute_query_in_database(
    app: AppHandle,
    connection_id: String,
    database: String,
    sql: String,
    timeout_secs: Option<u64>,
) -> Result<QueryResult, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    let start = std::time::Instant::now();
    let result = match engine.execute_query_in_database(connection_id.clone(), database.clone(), sql.clone(), timeout_secs).await {
        Ok(result) => result,
        Err(e) => QueryResult::error(e.to_string(), 0),
    };
    // 异步记录审计日志（不阻塞返回）
    let elapsed = start.elapsed().as_millis() as i64;
    if audit_log::classify_operation(&sql).is_some() {
        let storage = app.state::<StorageState>().inner().clone();
        let sql_clone = sql.clone();
        let cid = connection_id.clone();
        let db = database.clone();
        let is_err = result.is_error;
        let err_msg = result.error.clone();
        let affected = result.affected_rows as i64;
        tokio::spawn(async move {
            let _ = audit_log::record(
                &storage, &cid, None, Some(&db), &sql_clone,
                affected, elapsed, is_err, err_msg.as_deref(),
            ).await;
        });
    }
    Ok(result)
}

/// 在指定数据库上下文中流式执行查询
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
        if trimmed.is_empty() {
            continue;
        }

        match engine.clone().execute_query(connection_id.clone(), None, trimmed, None).await {
            Ok(result) => {
                let has_error = result.is_error;
                results.push(result);
                if has_error {
                    break;
                }
            }
            Err(e) => {
                results.push(QueryResult::error(e.to_string(), 0));
                break;
            }
        }
    }
    Ok(results)
}

/// 多语句智能执行（增强版）
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

    let statements: Vec<String> = sql_splitter::split_sql_statements(&sql).into_iter().map(|s| s.to_string()).collect();
    if statements.is_empty() {
        return Ok(vec![]);
    }

    Ok(execute_multi_statements(
        &app,
        connection_id.clone(),
        database,
        error_strategy,
        statements,
        timeout_secs,
        move |stmt, db, timeout| {
            let engine = engine.clone();
            let connection_id = connection_id.clone();
            Box::pin(async move {
                if let Some(db_name) = db {
                    match engine.execute_query_in_database(connection_id, db_name, stmt, timeout).await {
                        Ok(r) => r,
                        Err(e) => QueryResult::error(e.to_string(), 0),
                    }
                } else {
                    match engine.execute_query(connection_id, None, stmt, timeout).await {
                        Ok(r) => r,
                        Err(e) => QueryResult::error(e.to_string(), 0),
                    }
                }
            })
        },
    ).await)
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
pub async fn db_cancel_query_on_session(
    app: AppHandle,
    connection_id: String,
    tab_id: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().cancel_query_on_session(connection_id, tab_id)
        .await?;
    Ok(true)
}

/// 获取 SQL 执行计划
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
        Err(e) => Ok(QueryResult::error(e.to_string(), 0)),
    }
}

/// 开始事务
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

/// 在 Session 连接上执行查询
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
    let start = std::time::Instant::now();
    let result = match engine.execute_query_on_session(connection_id.clone(), tab_id, database.clone(), sql.clone(), timeout_secs).await {
        Ok(result) => result,
        Err(e) => QueryResult::error(e.to_string(), 0),
    };
    // 异步记录审计日志
    let elapsed = start.elapsed().as_millis() as i64;
    if audit_log::classify_operation(&sql).is_some() {
        let storage = app.state::<StorageState>().inner().clone();
        let sql_clone = sql.clone();
        let cid = connection_id.clone();
        let db = database.clone();
        let is_err = result.is_error;
        let err_msg = result.error.clone();
        let affected = result.affected_rows as i64;
        tokio::spawn(async move {
            let _ = audit_log::record(
                &storage, &cid, None, db.as_deref(), &sql_clone,
                affected, elapsed, is_err, err_msg.as_deref(),
            ).await;
        });
    }
    Ok(result)
}

/// 在 Session 连接上流式执行查询
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

#[command]
pub async fn db_execute_multi_v2_on_session(
    app: AppHandle,
    connection_id: String,
    tab_id: String,
    sql: String,
    database: Option<String>,
    error_strategy: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<Vec<StatementResult>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    use crate::services::sql_splitter;

    let statements: Vec<String> = sql_splitter::split_sql_statements(&sql).into_iter().map(|s| s.to_string()).collect();
    if statements.is_empty() {
        return Ok(vec![]);
    }

    Ok(execute_multi_statements(
        &app,
        connection_id.clone(),
        database,
        error_strategy,
        statements,
        timeout_secs,
        move |stmt, db, timeout| {
            let engine = engine.clone();
            let connection_id = connection_id.clone();
            let tab_id = tab_id.clone();
            Box::pin(async move {
                match engine.execute_query_on_session(connection_id, tab_id, db, stmt, timeout).await {
                    Ok(r) => r,
                    Err(e) => QueryResult::error(e.to_string(), 0),
                }
            })
        },
    ).await)
}
