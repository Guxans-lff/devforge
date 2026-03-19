//! 审计日志 Tauri 命令

use tauri::{command, AppHandle, Manager};

use crate::commands::connection::StorageState;
use crate::services::audit_log::{self, AuditFilter, AuditLogEntry, AuditStats};
use crate::utils::error::AppError;

/// 查询审计日志
#[command]
pub async fn query_audit_logs(
    app: AppHandle,
    connection_id: Option<String>,
    operation_type: Option<String>,
    database_name: Option<String>,
    search: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<AuditLogEntry>, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let filter = AuditFilter {
        connection_id,
        operation_type,
        database_name,
        search,
        limit: limit.unwrap_or(100),
        offset: offset.unwrap_or(0),
    };
    audit_log::query_logs(&storage, filter).await
}

/// 获取审计统计信息
#[command]
pub async fn get_audit_stats(
    app: AppHandle,
    connection_id: Option<String>,
) -> Result<AuditStats, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    audit_log::get_stats(&storage, connection_id.as_deref()).await
}

/// 清理过期审计日志
#[command]
pub async fn cleanup_audit_logs(
    app: AppHandle,
    retention_days: Option<u32>,
) -> Result<u64, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    audit_log::cleanup(&storage, retention_days.unwrap_or(30)).await
}
