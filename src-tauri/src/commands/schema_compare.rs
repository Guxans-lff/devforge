use tauri::{command, State, Manager};

use crate::commands::db::DbEngineState;
use crate::services::schema_compare::{self, SchemaDiff};
use crate::utils::error::AppError;

#[command]
pub async fn schema_compare(
    app: tauri::AppHandle,
    source_connection_id: String,
    source_database: String,
    target_connection_id: String,
    target_database: String,
) -> Result<SchemaDiff, String> {
    let engine = app.state::<DbEngineState>().inner().clone();
    schema_compare::compare_schemas(
        engine,
        &source_connection_id,
        &source_database,
        &target_connection_id,
        &target_database,
    )
    .await
    .map_err(|e| e.to_string())
}

#[command]
pub async fn generate_migration_sql(
    app: tauri::AppHandle,
    diff: SchemaDiff,
    driver: String,
    source_connection_id: String,
    source_database: String,
    target_database: String,
) -> Result<String, String> {
    let engine = app.state::<DbEngineState>().inner().clone();
    schema_compare::generate_migration_sql(
        engine,
        &diff,
        &driver,
        &source_connection_id,
        &source_database,
        &target_database,
    )
    .await
    .map_err(|e| e.to_string())
}
