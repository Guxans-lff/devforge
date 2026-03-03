use tauri::{command, State};

use crate::commands::connection::StorageState;
use crate::services::storage::SqlSnippetRecord;

#[command]
pub async fn list_sql_snippets(
    storage: State<'_, StorageState>,
    category: Option<String>,
    search: Option<String>,
) -> Result<Vec<SqlSnippetRecord>, String> {
    storage
        .list_sql_snippets(category.as_deref(), search.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn create_sql_snippet(
    storage: State<'_, StorageState>,
    record: SqlSnippetRecord,
) -> Result<(), String> {
    storage
        .create_sql_snippet(&record)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn update_sql_snippet(
    storage: State<'_, StorageState>,
    record: SqlSnippetRecord,
) -> Result<(), String> {
    storage
        .update_sql_snippet(&record)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn delete_sql_snippet(
    storage: State<'_, StorageState>,
    id: String,
) -> Result<(), String> {
    storage
        .delete_sql_snippet(&id)
        .await
        .map_err(|e| e.to_string())
}
