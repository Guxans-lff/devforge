use tauri::{command, Manager};

use crate::commands::connection::StorageState;
use crate::services::storage::QueryHistoryRecord;
use crate::utils::error::AppError;

#[command]
pub async fn save_query_history(
    app: tauri::AppHandle,
    id: String,
    connection_id: String,
    connection_name: Option<String>,
    database_name: Option<String>,
    sql_text: String,
    execution_time_ms: i64,
    is_error: bool,
    error_message: Option<String>,
    affected_rows: i64,
    row_count: Option<i64>,
    executed_at: i64,
) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .save_query_history(
            &id,
            &connection_id,
            connection_name.as_deref(),
            database_name.as_deref(),
            &sql_text,
            execution_time_ms,
            is_error,
            error_message.as_deref(),
            affected_rows,
            row_count,
            executed_at,
        )
        .await
}

#[command]
pub async fn list_query_history(
    app: tauri::AppHandle,
    connection_id: Option<String>,
    search_text: Option<String>,
    limit: u32,
    offset: u32,
) -> Result<Vec<QueryHistoryRecord>, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .list_query_history(
            connection_id.as_deref(),
            search_text.as_deref(),
            limit,
            offset,
        )
        .await
}

#[command]
pub async fn delete_query_history(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .delete_query_history(&id)
        .await
}

#[command]
pub async fn clear_query_history(
    app: tauri::AppHandle,
    connection_id: Option<String>,
) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .clear_query_history(connection_id.as_deref())
        .await
}
