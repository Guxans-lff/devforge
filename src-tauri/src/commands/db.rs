use tauri::{command, State};

use crate::commands::connection::StorageState;
use crate::models::query::{ColumnInfo, DatabaseInfo, QueryResult, RoutineInfo, TableInfo, TriggerInfo, ViewInfo};
use crate::services::credential::CredentialManager;
use crate::services::db_engine::DbEngine;

use std::sync::Arc;

pub type DbEngineState = Arc<DbEngine>;

#[command]
pub async fn db_connect(
    storage: State<'_, StorageState>,
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<bool, String> {
    let conn = storage
        .get_connection(&connection_id)
        .await
        .map_err(|e| e.to_string())?;

    let password = match CredentialManager::get(&connection_id) {
        Ok(Some(pw)) => {
            log::info!("db_connect: credential found for '{}' (id={})",
                conn.name, connection_id);
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
        serde_json::from_str(&conn.config_json)
            .map_err(|e| format!("连接配置数据损坏: {}", e))?;

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

    engine.connect(
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
        let detail = format!("[driver={}, user={}, host={}:{}]",
            driver, conn.username, conn.host, conn.port);
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
    engine.disconnect(&connection_id).await;
    Ok(true)
}

#[command]
pub async fn db_is_connected(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<bool, String> {
    Ok(engine.is_connected(&connection_id).await)
}

#[command]
pub async fn db_execute_query(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    sql: String,
) -> Result<QueryResult, String> {
    match engine.execute_query(&connection_id, &sql).await {
        Ok(result) => Ok(result),
        Err(e) => Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: 0,
            is_error: true,
            error: Some(e.to_string()),
            total_count: None,
            truncated: false,
        }),
    }
}

#[command]
pub async fn db_get_databases(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<Vec<DatabaseInfo>, String> {
    engine.get_databases(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_tables(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
) -> Result<Vec<TableInfo>, String> {
    engine.get_tables(&connection_id, &database)
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
    engine.get_columns(&connection_id, &database, &table)
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
    where_clause: Option<String>,
    order_by: Option<String>,
) -> Result<QueryResult, String> {
    engine.get_table_data(&connection_id, &database, &table, page, page_size, where_clause.as_deref(), order_by.as_deref())
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
    engine.get_create_table(&connection_id, &database, &table)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_cancel_query(
    engine: State<'_, DbEngineState>,
    connection_id: String,
) -> Result<bool, String> {
    engine.cancel_query(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[command]
pub async fn db_get_views(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
) -> Result<Vec<ViewInfo>, String> {
    engine.get_views(&connection_id, &database)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_procedures(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
) -> Result<Vec<RoutineInfo>, String> {
    engine.get_routines(&connection_id, &database, "PROCEDURE")
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_functions(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
) -> Result<Vec<RoutineInfo>, String> {
    engine.get_routines(&connection_id, &database, "FUNCTION")
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_triggers(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
) -> Result<Vec<TriggerInfo>, String> {
    engine.get_triggers(&connection_id, &database)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn db_get_object_definition(
    engine: State<'_, DbEngineState>,
    connection_id: String,
    database: String,
    name: String,
    object_type: String,
) -> Result<String, String> {
    engine.get_object_definition(&connection_id, &database, &name, &object_type)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    let raw = std::path::Path::new(&path);

    // 路径必须是绝对路径
    if !raw.is_absolute() {
        return Err("Write denied: path must be absolute".to_string());
    }

    let target = raw
        .canonicalize()
        .map_err(|_| "Write denied: invalid or non-existent parent directory".to_string())?;

    // 限制写入路径到用户文档目录和下载目录
    let allowed = if let Some(dirs) = directories::UserDirs::new() {
        let mut ok = false;
        if let Some(doc) = dirs.document_dir() {
            if target.starts_with(doc) {
                ok = true;
            }
        }
        if let Some(dl) = dirs.download_dir() {
            if target.starts_with(dl) {
                ok = true;
            }
        }
        // 也允许桌面
        if let Some(desktop) = dirs.desktop_dir() {
            if target.starts_with(desktop) {
                ok = true;
            }
        }
        ok
    } else {
        false
    };

    if !allowed {
        return Err("Write denied: path must be within Documents, Downloads, or Desktop directory".to_string());
    }

    tokio::fs::write(&path, content.as_bytes())
        .await
        .map_err(|e| format!("Failed to write file: {}", e))
}
