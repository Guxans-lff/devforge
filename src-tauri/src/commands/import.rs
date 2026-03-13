use tauri::{command, AppHandle, State, Manager};

use crate::commands::db::DbEngineState;
use crate::services::data_import::{
    self, ImportConfig, ImportPreview, ImportResult,
};
use crate::utils::error::AppError;

#[command]
pub async fn import_preview(
    file_path: String,
    file_type: String,
) -> Result<ImportPreview, String> {
    data_import::preview_file(&file_path, &file_type).map_err(|e: AppError| e.to_string())
}

#[command]
pub async fn import_data(
    app_handle: AppHandle,
    config: ImportConfig,
) -> Result<ImportResult, String> {
    let engine = app_handle.state::<DbEngineState>().inner().clone();
    let pool = engine.clone()
        .get_pool(config.connection_id.clone())
        .await
        .map_err(|e: AppError| e.to_string())?;

    let result = match config.file_type.as_str() {
        "csv" => data_import::import_csv(&config, &pool, &app_handle).await,
        "json" => data_import::import_json(&config, &pool, &app_handle).await,
        "sql" => data_import::import_sql(&config, &pool, &app_handle).await,
        other => return Err(format!("Unsupported file type: {}", other)),
    };

    result.map_err(|e: AppError| e.to_string())
}
