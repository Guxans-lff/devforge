//! 管理操作命令（服务器状态、进程管理、用户权限）

use tauri::{command, AppHandle, Manager};

use crate::models::query::{
    CreateUserRequest, IndexAnalysisResult, IndexSuggestion, InnoDbStatus,
    MysqlUser, ProcessInfo, ServerStatus, ServerVariable, SlowQueryDigest,
};
use crate::utils::error::AppError;
use super::DbEngineState;

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

// ===== 索引分析命令 =====

/// 分析数据库索引（冗余索引 + 未使用索引）
#[command]
pub async fn db_analyze_indexes(
    app: AppHandle,
    connection_id: String,
    database: String,
) -> Result<IndexAnalysisResult, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .analyze_indexes(connection_id, database)
        .await
}

/// 基于 EXPLAIN 为单条 SQL 生成索引建议
#[command]
pub async fn db_suggest_indexes_for_query(
    app: AppHandle,
    connection_id: String,
    database: String,
    sql: String,
) -> Result<Vec<IndexSuggestion>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .suggest_indexes_for_query(connection_id, database, sql)
        .await
}

// ===== 性能诊断命令 =====

/// 获取慢查询 Top N（基于 performance_schema）
#[command]
pub async fn db_get_slow_query_digest(
    app: AppHandle,
    connection_id: String,
    limit: u32,
) -> Result<Vec<SlowQueryDigest>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .get_slow_query_digest(connection_id, limit)
        .await
}

/// 获取 InnoDB 引擎状态
#[command]
pub async fn db_get_innodb_status(
    app: AppHandle,
    connection_id: String,
) -> Result<InnoDbStatus, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone()
        .get_innodb_status(connection_id)
        .await
}
