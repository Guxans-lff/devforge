use tauri::{command, State};

use crate::commands::db::DbEngineState;
use crate::models::table_editor::{DdlResult, TableAlteration, TableDefinition, TableDetail};
use crate::services::table_editor;

#[command]
pub fn generate_create_table_sql(
    definition: TableDefinition,
    driver: String,
) -> Result<DdlResult, String> {
    table_editor::generate_create_table(&definition, &driver)
}

#[command]
pub fn generate_alter_table_sql(
    alteration: TableAlteration,
    driver: String,
) -> Result<DdlResult, String> {
    table_editor::generate_alter_table(&alteration, &driver)
}

#[command]
pub async fn execute_ddl(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    sql: String,
) -> Result<bool, String> {
    let eng = engine.lock().await;
    eng.execute_query(&connection_id, &sql)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[command]
pub async fn get_table_detail(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
    table: String,
) -> Result<TableDetail, String> {
    let eng = engine.lock().await;
    let pool = eng.get_pool(&connection_id).map_err(|e| e.to_string())?;
    table_editor::get_table_detail(pool, &database, &table)
        .await
        .map_err(|e| e.to_string())
}
