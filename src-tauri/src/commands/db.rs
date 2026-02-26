use tauri::{command, State};

use crate::commands::connection::StorageState;
use crate::models::query::{ColumnInfo, DatabaseInfo, QueryResult, TableInfo};
use crate::services::credential::CredentialManager;
use crate::services::db_engine::DbEngine;

use std::sync::Arc;
use tokio::sync::Mutex;

pub type DbEngineState = Arc<Mutex<DbEngine>>;

#[command]
pub async fn db_connect(
    storage: State<'_, StorageState>,
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<bool, String> {
    let store = storage.lock().await;
    let conn = store
        .get_connection(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    drop(store);

    let password = match CredentialManager::get(&connection_id) {
        Ok(Some(pw)) => {
            log::info!("db_connect: credential found for '{}' (id={}, password_len={})",
                conn.name, connection_id, pw.len());
            pw
        }
        Ok(None) => {
            log::warn!("db_connect: no credential found for '{}' (id={})", conn.name, connection_id);
            return Err(format!(
                "No password found for connection '{}'. Please edit the connection and re-enter the password.",
                conn.name
            ));
        }
        Err(e) => {
            log::error!("db_connect: credential read error for '{}': {}", conn.name, e);
            return Err(format!("Failed to read credential: {}", e));
        }
    };

    let config: serde_json::Value =
        serde_json::from_str(&conn.config_json).unwrap_or(serde_json::Value::Object(Default::default()));

    let driver = config
        .get("driver")
        .and_then(|v| v.as_str())
        .unwrap_or("mysql");

    let database = config
        .get("database")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let db_opt = if database.is_empty() {
        None
    } else {
        Some(database)
    };

    let mut eng = engine.lock().await;
    eng.connect(
        &connection_id,
        driver,
        &conn.host,
        conn.port,
        &conn.username,
        &password,
        db_opt,
    )
    .await
    .map_err(|e| {
        let err_str = e.to_string();
        let detail = format!("[driver={}, user={}, host={}:{}, password_len={}]",
            driver, conn.username, conn.host, conn.port, password.len());
        if err_str.contains("Access denied") || err_str.contains("password authentication failed") {
            format!("{}\n\nThe stored password may be incorrect. Please edit this connection, re-enter the password, and save.\n{}", err_str, detail)
        } else {
            format!("{}  {}", err_str, detail)
        }
    })?;

    Ok(true)
}

#[command]
pub async fn db_disconnect(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<bool, String> {
    let mut eng = engine.lock().await;
    eng.disconnect(&connection_id).await;
    Ok(true)
}

#[command]
pub async fn db_is_connected(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<bool, String> {
    let eng = engine.lock().await;
    Ok(eng.is_connected(&connection_id))
}

#[command]
pub async fn db_execute_query(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    sql: String,
) -> Result<QueryResult, String> {
    let eng = engine.lock().await;
    match eng.execute_query(&connection_id, &sql).await {
        Ok(result) => Ok(result),
        Err(e) => Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: 0,
            is_error: true,
            error: Some(e.to_string()),
        }),
    }
}

#[command]
pub async fn db_get_databases(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<Vec<DatabaseInfo>, String> {
    let eng = engine.lock().await;
    eng.get_databases(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_tables(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
) -> Result<Vec<TableInfo>, String> {
    let eng = engine.lock().await;
    eng.get_tables(&connection_id, &database)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_columns(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
    table: String,
) -> Result<Vec<ColumnInfo>, String> {
    let eng = engine.lock().await;
    eng.get_columns(&connection_id, &database, &table)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_table_data(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
    table: String,
    page: u32,
    page_size: u32,
) -> Result<QueryResult, String> {
    let eng = engine.lock().await;
    eng.get_table_data(&connection_id, &database, &table, page, page_size)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_create_table(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
    table: String,
) -> Result<String, String> {
    let eng = engine.lock().await;
    eng.get_create_table(&connection_id, &database, &table)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    tokio::fs::write(&path, content.as_bytes())
        .await
        .map_err(|e| format!("Failed to write file: {}", e))
}
