use tauri::{command, State};

use crate::commands::connection::StorageState;
use crate::services::storage::CommandSnippetRecord;

#[command]
pub async fn list_command_snippets(
    storage: State<'_, StorageState>,
    category: Option<String>,
    search: Option<String>,
) -> Result<Vec<CommandSnippetRecord>, String> {
    storage
        .list_command_snippets(category.as_deref(), search.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn create_command_snippet(
    storage: State<'_, StorageState>,
    record: CommandSnippetRecord,
) -> Result<(), String> {
    storage
        .create_command_snippet(&record)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn update_command_snippet(
    storage: State<'_, StorageState>,
    record: CommandSnippetRecord,
) -> Result<(), String> {
    storage
        .update_command_snippet(&record)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn delete_command_snippet(
    storage: State<'_, StorageState>,
    id: String,
) -> Result<(), String> {
    storage
        .delete_command_snippet(&id)
        .await
        .map_err(|e| e.to_string())
}
