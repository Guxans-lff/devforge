use tauri::{command, AppHandle, Manager};

use crate::commands::db::DbEngineState;
use crate::services::data_import::{
    self, ImportConfig, ImportPreview, ImportResult,
};
use crate::utils::error::AppError;

#[command]
pub async fn import_preview(
    file_path: String,
    file_type: String,
) -> Result<ImportPreview, AppError> {
    data_import::preview_file(&file_path, &file_type)
}

#[command]
pub async fn import_data(
    app_handle: AppHandle,
    config: ImportConfig,
) -> Result<ImportResult, AppError> {
    let engine = app_handle.state::<DbEngineState>().inner().clone();
    let pool = engine.clone()
        .get_pool(config.connection_id.clone())
        .await?;

    match config.file_type.as_str() {
        "csv" => data_import::import_csv(&config, &pool, &app_handle).await,
        "json" => data_import::import_json(&config, &pool, &app_handle).await,
        "sql" => data_import::import_sql(&config, &pool, &app_handle).await,
        other => Err(AppError::Validation(format!("Unsupported file type: {}", other))),
    }
}
