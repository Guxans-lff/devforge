use tauri::{command, Manager};

use crate::commands::db::DbEngineState;
use crate::models::table_editor::{DdlResult, TableAlteration, TableDefinition, TableDetail};
use crate::services::table_editor;
use crate::utils::error::AppError;

#[command]
pub fn generate_create_table_sql(
    definition: TableDefinition,
    driver: String,
) -> Result<DdlResult, AppError> {
    table_editor::generate_create_table(&definition, &driver)
        .map_err(|e| AppError::Other(e))
}

#[command]
pub fn generate_alter_table_sql(
    alteration: TableAlteration,
    driver: String,
) -> Result<DdlResult, AppError> {
    table_editor::generate_alter_table(&alteration, &driver)
        .map_err(|e| AppError::Other(e))
}

#[command]
pub async fn execute_ddl(
    app: tauri::AppHandle,
    connection_id: String,
    sql: String,
) -> Result<bool, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.execute_query(connection_id, None, sql, None)
        .await?;
    Ok(true)
}

#[command]
pub async fn get_table_detail(
    app: tauri::AppHandle,
    connection_id: String,
    database: String,
    table: String,
) -> Result<TableDetail, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    let pool = engine.get_pool(connection_id).await?;
    table_editor::get_table_detail(&pool, &database, &table)
        .await
}

#[command]
pub async fn get_table_ddl(
    app: tauri::AppHandle,
    connection_id: String,
    database: String,
    table: String,
) -> Result<String, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    let pool = engine.get_pool(connection_id).await?;
    table_editor::get_table_ddl(&pool, &database, &table)
        .await
}
