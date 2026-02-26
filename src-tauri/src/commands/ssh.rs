use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

use tauri::State;

use crate::commands::connection::{StorageState, TestResult};
use crate::models::ssh::SessionInfo;
use crate::services::credential::CredentialManager;
use crate::services::ssh_engine::SshEngine;

pub type SshEngineState = Arc<Mutex<SshEngine>>;

#[tauri::command]
pub async fn ssh_connect(
    app_handle: tauri::AppHandle,
    ssh_engine: State<'_, SshEngineState>,
    storage: State<'_, StorageState>,
    connection_id: String,
    cols: u32,
    rows: u32,
) -> Result<SessionInfo, String> {
    let storage = storage.lock().await;
    let conn = storage
        .get_connection(&connection_id)
        .await
        .map_err(|e| e.to_string())?;

    let password = match CredentialManager::get(&connection_id) {
        Ok(Some(pw)) => pw,
        Ok(None) => {
            return Err(format!(
                "No password found for connection '{}'. Please edit the connection and set the password.",
                conn.name
            ))
        }
        Err(e) => return Err(format!("Failed to read credential: {}", e)),
    };

    let session_id = uuid::Uuid::new_v4().to_string();

    let mut engine = ssh_engine.lock().await;
    engine
        .connect(
            &app_handle,
            &session_id,
            &connection_id,
            &conn.host,
            conn.port as u16,
            &conn.username,
            &password,
            cols,
            rows,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_disconnect(
    ssh_engine: State<'_, SshEngineState>,
    session_id: String,
) -> Result<bool, String> {
    let mut engine = ssh_engine.lock().await;
    engine
        .disconnect(&session_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn ssh_send_data(
    ssh_engine: State<'_, SshEngineState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let engine = ssh_engine.lock().await;
    engine
        .send_data(&session_id, data.as_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_resize(
    ssh_engine: State<'_, SshEngineState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let engine = ssh_engine.lock().await;
    engine
        .resize(&session_id, cols, rows)
        .map_err(|e| e.to_string())
}

// --- SSH test connection ---

struct TestSshClient;

#[async_trait::async_trait]
impl russh::client::Handler for TestSshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

async fn ssh_test_connect(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
) -> Result<u64, String> {
    let start = Instant::now();
    let config = Arc::new(russh::client::Config::default());

    let mut session = russh::client::connect(config, (host, port), TestSshClient)
        .await
        .map_err(|e| format!("SSH connection failed: {}", e))?;

    let authenticated = session
        .authenticate_password(username, password)
        .await
        .map_err(|e| format!("SSH authentication error: {}", e))?;

    if !authenticated {
        return Err("Authentication failed: invalid username or password".to_string());
    }

    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "")
        .await;

    Ok(start.elapsed().as_millis() as u64)
}

#[tauri::command]
pub async fn ssh_test_connection(
    storage: State<'_, StorageState>,
    id: String,
) -> Result<TestResult, String> {
    let store = storage.lock().await;
    let conn = store
        .get_connection(&id)
        .await
        .map_err(|e| e.to_string())?;
    drop(store);

    let password = match CredentialManager::get(&id) {
        Ok(Some(pw)) => pw,
        Ok(None) => return Ok(TestResult {
            success: false,
            message: format!("No password found for connection '{}'.", conn.name),
            latency_ms: None,
        }),
        Err(e) => return Err(format!("Failed to read credential: {}", e)),
    };

    match ssh_test_connect(&conn.host, conn.port as u16, &conn.username, &password).await {
        Ok(latency) => Ok(TestResult {
            success: true,
            message: format!("Connected to {}:{} ({}ms)", conn.host, conn.port, latency),
            latency_ms: Some(latency),
        }),
        Err(e) => Ok(TestResult {
            success: false,
            message: e,
            latency_ms: None,
        }),
    }
}

#[tauri::command]
pub async fn ssh_test_connection_params(
    host: String,
    port: u16,
    username: String,
    password: String,
) -> Result<TestResult, String> {
    match ssh_test_connect(&host, port, &username, &password).await {
        Ok(latency) => Ok(TestResult {
            success: true,
            message: format!("Connected to {}:{} ({}ms)", host, port, latency),
            latency_ms: Some(latency),
        }),
        Err(e) => Ok(TestResult {
            success: false,
            message: e,
            latency_ms: None,
        }),
    }
}
