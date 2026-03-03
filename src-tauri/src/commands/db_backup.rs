use tauri::{command, AppHandle, State};

use crate::commands::db::DbEngineState;
use crate::services::db_backup;

#[command]
pub async fn db_backup_database(
    engine: State<'_, DbEngineState>,
    app_handle: AppHandle,
    connection_id: String,
    database: String,
    tables: Vec<String>,
    include_structure: bool,
    include_data: bool,
    output_path: String,
) -> Result<(), String> {
    db_backup::backup_database(
        &engine,
        &connection_id,
        &database,
        tables,
        include_structure,
        include_data,
        &output_path,
        &app_handle,
    )
    .await
    .map_err(|e| e.to_string())
}

#[command]
pub async fn db_restore_database(
    engine: State<'_, DbEngineState>,
    app_handle: AppHandle,
    connection_id: String,
    database: String,
    file_path: String,
) -> Result<(), String> {
    db_backup::restore_database(
        &engine,
        &connection_id,
        &database,
        &file_path,
        &app_handle,
    )
    .await
    .map_err(|e| e.to_string())
}
