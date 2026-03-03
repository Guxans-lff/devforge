use chrono::Utc;
use tauri::{command, State};
use uuid::Uuid;

use crate::models::connection::{
    Connection, ConnectionGroup, CreateConnectionRequest, UpdateConnectionRequest,
};
use crate::services::credential::CredentialManager;
use crate::services::db_engine::DbEngine;
use crate::services::storage::Storage;

use std::sync::Arc;

/// Storage 内部使用 SqlitePool（本身线程安全且支持并发），无需外层 Mutex
pub type StorageState = Arc<Storage>;

// --- Connection CRUD ---

#[command]
pub async fn create_connection(
    storage: State<'_, StorageState>,
    req: CreateConnectionRequest,
) -> Result<Connection, String> {
    let now = Utc::now().timestamp_millis();
    let id = Uuid::new_v4().to_string();

    let conn = Connection {
        id: id.clone(),
        name: req.name,
        connection_type: req.connection_type,
        group_id: req.group_id,
        host: req.host,
        port: req.port,
        username: req.username,
        config_json: req.config_json,
        color: req.color,
        sort_order: 0,
        created_at: now,
        updated_at: now,
    };

    storage.create_connection(&conn).await.map_err(|e| e.to_string())?;

    if let Some(password) = req.password {
        if !password.is_empty() {
            CredentialManager::save(&id, &password).map_err(|e| e.to_string())?;
            // Verify credential was stored correctly
            let stored = CredentialManager::get(&id).map_err(|e| e.to_string())?;
            if stored.as_deref() != Some(password.as_str()) {
                log::warn!("Credential verification failed for new connection {}: stored_len={:?}, expected_len={}",
                    id, stored.as_ref().map(|s| s.len()), password.len());
            } else {
                log::info!("Credential saved and verified for connection {} (len={})", id, password.len());
            }
        }
    }

    Ok(conn)
}

#[command]
pub async fn update_connection(
    storage: State<'_, StorageState>,
    id: String,
    req: UpdateConnectionRequest,
) -> Result<Connection, String> {
    let mut conn = storage.get_connection(&id).await.map_err(|e| e.to_string())?;

    if let Some(name) = req.name {
        conn.name = name;
    }
    if let Some(group_id) = req.group_id {
        conn.group_id = Some(group_id);
    }
    if let Some(host) = req.host {
        conn.host = host;
    }
    if let Some(port) = req.port {
        conn.port = port;
    }
    if let Some(username) = req.username {
        conn.username = username;
    }
    if let Some(config_json) = req.config_json {
        conn.config_json = config_json;
    }
    if let Some(color) = req.color {
        conn.color = Some(color);
    }

    conn.updated_at = Utc::now().timestamp_millis();
    storage.update_connection(&conn).await.map_err(|e| e.to_string())?;

    if let Some(password) = req.password {
        if password.is_empty() {
            let _ = CredentialManager::delete(&id);
        } else {
            CredentialManager::save(&id, &password).map_err(|e| e.to_string())?;
            // Verify credential was stored correctly
            let stored = CredentialManager::get(&id).map_err(|e| e.to_string())?;
            if stored.as_deref() != Some(password.as_str()) {
                log::warn!("Credential verification failed for connection {}: stored_len={:?}, expected_len={}",
                    id, stored.as_ref().map(|s| s.len()), password.len());
            } else {
                log::info!("Credential updated and verified for connection {} (len={})", id, password.len());
            }
        }
    }

    Ok(conn)
}

#[command]
pub async fn delete_connection(
    storage: State<'_, StorageState>,
    id: String,
) -> Result<bool, String> {
    storage.delete_connection(&id).await.map_err(|e| e.to_string())?;
    let _ = CredentialManager::delete(&id);
    Ok(true)
}

#[command]
pub async fn list_connections(
    storage: State<'_, StorageState>,
) -> Result<Vec<Connection>, String> {
    storage.list_connections().await.map_err(|e| e.to_string())
}

#[command]
pub async fn get_connection_by_id(
    storage: State<'_, StorageState>,
    id: String,
) -> Result<Connection, String> {
    storage.get_connection(&id).await.map_err(|e| e.to_string())
}

#[command]
pub async fn reorder_connections(
    storage: State<'_, StorageState>,
    ids: Vec<String>,
) -> Result<bool, String> {
    storage.reorder_connections(&ids).await.map_err(|e| e.to_string())?;
    Ok(true)
}

#[command]
pub async fn test_connection(
    storage: State<'_, StorageState>,
    id: String,
) -> Result<TestResult, String> {
    let conn = storage.get_connection(&id).await.map_err(|e| e.to_string())?;

    let password = CredentialManager::get(&id)
        .map_err(|e| e.to_string())?
        .unwrap_or_default();

    let config: serde_json::Value =
        serde_json::from_str(&conn.config_json).unwrap_or_default();
    let driver = config.get("driver").and_then(|v| v.as_str()).unwrap_or("mysql");
    let database = config.get("database").and_then(|v| v.as_str()).unwrap_or("");
    let db_opt = if database.is_empty() { None } else { Some(database) };

    match DbEngine::test_connect(driver, &conn.host, conn.port, &conn.username, &password, db_opt).await {
        Ok(latency) => Ok(TestResult {
            success: true,
            message: format!("Connected to {}:{} ({}ms)", conn.host, conn.port, latency),
            latency_ms: Some(latency),
        }),
        Err(e) => Ok(TestResult {
            success: false,
            message: e.to_string(),
            latency_ms: None,
        }),
    }
}

#[command]
pub async fn test_connection_params(
    host: String,
    port: u16,
    username: String,
    password: String,
    database: Option<String>,
    driver: Option<String>,
) -> Result<TestResult, String> {
    let drv = driver.as_deref().unwrap_or("mysql");
    let db_opt = database.as_deref().filter(|d| !d.is_empty());

    match DbEngine::test_connect(drv, &host, port, &username, &password, db_opt).await {
        Ok(latency) => Ok(TestResult {
            success: true,
            message: format!("Connected to {}:{} ({}ms)", host, port, latency),
            latency_ms: Some(latency),
        }),
        Err(e) => Ok(TestResult {
            success: false,
            message: e.to_string(),
            latency_ms: None,
        }),
    }
}

// --- Groups ---

#[command]
pub async fn list_groups(
    storage: State<'_, StorageState>,
) -> Result<Vec<ConnectionGroup>, String> {
    storage.list_groups().await.map_err(|e| e.to_string())
}

#[command]
pub async fn create_group(
    storage: State<'_, StorageState>,
    name: String,
) -> Result<ConnectionGroup, String> {
    let group = ConnectionGroup {
        id: Uuid::new_v4().to_string(),
        name,
        sort_order: 0,
        parent_id: None,
    };

    storage.create_group(&group).await.map_err(|e| e.to_string())?;
    Ok(group)
}

#[command]
pub async fn delete_group(
    storage: State<'_, StorageState>,
    id: String,
) -> Result<bool, String> {
    storage.delete_group(&id).await.map_err(|e| e.to_string())?;
    Ok(true)
}

// --- Credential ---

#[command]
pub async fn get_credential(id: String) -> Result<Option<String>, String> {
    CredentialManager::get(&id).map_err(|e| e.to_string())
}

#[command]
pub async fn save_credential(id: String, password: String) -> Result<bool, String> {
    CredentialManager::save(&id, &password).map_err(|e| e.to_string())?;
    Ok(true)
}

#[command]
pub async fn delete_credential(id: String) -> Result<bool, String> {
    CredentialManager::delete(&id).map_err(|e| e.to_string())?;
    Ok(true)
}

// --- App ---

#[command]
pub async fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// --- Types ---

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub success: bool,
    pub message: String,
    pub latency_ms: Option<u64>,
}
