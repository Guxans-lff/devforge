use tauri::{command, State, Manager};

use crate::commands::connection::StorageState;
use crate::services::storage::CommandSnippetRecord;
use crate::utils::error::AppError;

#[command]
pub async fn list_command_snippets(
    app: tauri::AppHandle,
    category: Option<String>,
    search: Option<String>,
) -> Result<Vec<CommandSnippetRecord>, String> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .list_command_snippets(category.as_deref(), search.as_deref())
        .await
        .map_err(|e: AppError| e.to_string())
}

#[command]
pub async fn create_command_snippet(
    app: tauri::AppHandle,
    record: CommandSnippetRecord,
) -> Result<(), String> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .create_command_snippet(&record)
        .await
        .map_err(|e: AppError| e.to_string())
}

#[command]
pub async fn update_command_snippet(
    app: tauri::AppHandle,
    record: CommandSnippetRecord,
) -> Result<(), String> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .update_command_snippet(&record)
        .await
        .map_err(|e: AppError| e.to_string())
}

#[command]
pub async fn delete_command_snippet(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .delete_command_snippet(&id)
        .await
        .map_err(|e: AppError| e.to_string())
}
