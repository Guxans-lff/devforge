//! 元数据查询命令

use tauri::{command, AppHandle, Manager};

use crate::models::query::{
    ColumnInfo, DatabaseInfo, ForeignKeyRelation, QueryResult,
    RoutineInfo, RoutineParameter, SchemaBundle, TableInfo, TriggerInfo, ViewInfo,
};
use crate::utils::error::AppError;
use super::DbEngineState;

#[command]
pub async fn db_get_databases(
    app: AppHandle,
    connection_id: String,
) -> Result<Vec<DatabaseInfo>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_databases(connection_id).await
}

#[command]
pub async fn db_get_tables(
    app: AppHandle,
    connection_id: String,
    database: String,
) -> Result<Vec<TableInfo>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_tables(connection_id, database).await
}

#[command]
pub async fn db_get_tables_light(
    app: AppHandle,
    connection_id: String,
    database: String,
) -> Result<Vec<TableInfo>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_tables_light(connection_id, database).await
}

#[command]
pub async fn db_get_columns(
    app: AppHandle,
    connection_id: String,
    database: String,
    table: String,
) -> Result<Vec<ColumnInfo>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_columns(connection_id, database, table).await
}

#[command]
pub async fn db_get_table_data(
    app: AppHandle,
    connection_id: String,
    database: String,
    table: String,
    page: u32,
    page_size: u32,
    where_clause: Option<String>,
    order_by: Option<String>,
    seek_column: Option<String>,
    seek_value: Option<i64>,
) -> Result<QueryResult, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_table_data(connection_id, database, table, page, page_size, where_clause, order_by, seek_column, seek_value).await
}

#[command]
pub async fn db_get_create_table(
    app: AppHandle,
    connection_id: String,
    database: String,
    table: String,
) -> Result<String, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_create_table(connection_id, database, table).await
}

#[command]
pub async fn db_get_views(
    app: AppHandle,
    connection_id: String,
    database: String,
) -> Result<Vec<ViewInfo>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_views(connection_id, database).await
}

#[command]
pub async fn db_get_procedures(
    app: AppHandle,
    connection_id: String,
    database: String,
) -> Result<Vec<RoutineInfo>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_routines(connection_id, database, "PROCEDURE".to_string()).await
}

#[command]
pub async fn db_get_functions(
    app: AppHandle,
    connection_id: String,
    database: String,
) -> Result<Vec<RoutineInfo>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_routines(connection_id, database, "FUNCTION".to_string()).await
}

#[command]
pub async fn db_get_routine_parameters(
    app: AppHandle,
    connection_id: String,
    database: String,
    routine_name: String,
    routine_type: String,
) -> Result<Vec<RoutineParameter>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_routine_parameters(connection_id, database, routine_name, routine_type).await
}

#[command]
pub async fn db_get_triggers(
    app: AppHandle,
    connection_id: String,
    database: String,
) -> Result<Vec<TriggerInfo>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_triggers(connection_id, database).await
}

#[command]
pub async fn db_get_object_definition(
    app: AppHandle,
    connection_id: String,
    database: String,
    name: String,
    object_type: String,
) -> Result<String, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.clone().get_object_definition(connection_id, database, name, object_type).await
}

/// 获取指定数据库中所有外键关系（用于 SQL 补全 JOIN 推荐）
#[command]
pub async fn db_get_foreign_keys(
    app: AppHandle,
    connection_id: String,
    database: String,
) -> Result<Vec<ForeignKeyRelation>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine
        .get_foreign_keys(connection_id, database)
        .await
}

/// 批量获取指定数据库中所有表的列信息（SQL 补全预加载用）
#[command]
pub async fn db_get_all_columns(
    app: AppHandle,
    connection_id: String,
    database: String,
) -> Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine
        .get_all_columns(connection_id, database)
        .await
}

#[command]
pub async fn db_get_schema_bundle(
    app: AppHandle,
    connection_id: String,
    database: String,
) -> Result<SchemaBundle, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();
    engine.get_schema_bundle(connection_id, database).await
}
