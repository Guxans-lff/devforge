use tauri::{command, Manager};

use crate::commands::connection::StorageState;
use crate::services::storage::SqlSnippetRecord;
use crate::utils::error::AppError;

#[command]
pub async fn list_sql_snippets(
    app: tauri::AppHandle,
    category: Option<String>,
    search: Option<String>,
) -> Result<Vec<SqlSnippetRecord>, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .list_sql_snippets(category.as_deref(), search.as_deref())
        .await
}

#[command]
pub async fn create_sql_snippet(
    app: tauri::AppHandle,
    record: SqlSnippetRecord,
) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .create_sql_snippet(&record)
        .await
}

#[command]
pub async fn update_sql_snippet(
    app: tauri::AppHandle,
    record: SqlSnippetRecord,
) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .update_sql_snippet(&record)
        .await
}

#[command]
pub async fn delete_sql_snippet(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .delete_sql_snippet(&id)
        .await
}
