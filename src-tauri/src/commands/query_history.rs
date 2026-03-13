use tauri::{command, State, Manager};

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
) -> Result<(), String> {
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
        .map_err(|e| e.to_string())
}

#[command]
pub async fn list_query_history(
    app: tauri::AppHandle,
    connection_id: Option<String>,
    search_text: Option<String>,
    limit: u32,
    offset: u32,
) -> Result<Vec<QueryHistoryRecord>, String> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .list_query_history(
            connection_id.as_deref(),
            search_text.as_deref(),
            limit,
            offset,
        )
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn delete_query_history(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .delete_query_history(&id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn clear_query_history(
    app: tauri::AppHandle,
    connection_id: Option<String>,
) -> Result<(), String> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .clear_query_history(connection_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}
