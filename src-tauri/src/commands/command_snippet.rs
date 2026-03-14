use tauri::{command, Manager};

use crate::commands::connection::StorageState;
use crate::services::storage::CommandSnippetRecord;
use crate::utils::error::AppError;

#[command]
pub async fn list_command_snippets(
    app: tauri::AppHandle,
    category: Option<String>,
    search: Option<String>,
) -> Result<Vec<CommandSnippetRecord>, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .list_command_snippets(category.as_deref(), search.as_deref())
        .await
}

#[command]
pub async fn create_command_snippet(
    app: tauri::AppHandle,
    record: CommandSnippetRecord,
) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .create_command_snippet(&record)
        .await
}

#[command]
pub async fn update_command_snippet(
    app: tauri::AppHandle,
    record: CommandSnippetRecord,
) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .update_command_snippet(&record)
        .await
}

#[command]
pub async fn delete_command_snippet(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage
        .delete_command_snippet(&id)
        .await
}
