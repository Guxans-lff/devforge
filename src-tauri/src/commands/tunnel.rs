use std::sync::Arc;
use tokio::sync::Mutex;

use serde::Deserialize;
use tauri::Manager;

use crate::models::ssh::{TunnelConfig, TunnelInfo};
use crate::services::ssh_tunnel::SshTunnelEngine;

pub type SshTunnelEngineState = Arc<Mutex<SshTunnelEngine>>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelOpenParams {
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_username: String,
    #[serde(default)]
    pub ssh_password: String,
    #[serde(default)]
    pub auth_method: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub passphrase: Option<String>,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

#[tauri::command]
pub async fn tunnel_open(
    app: tauri::AppHandle,
    params: TunnelOpenParams,
) -> Result<TunnelInfo, String> {
    let tunnel_engine = app.state::<SshTunnelEngineState>().inner().clone();
    let tunnel_id = uuid::Uuid::new_v4().to_string();

    let config = TunnelConfig {
        tunnel_id,
        ssh_host: params.ssh_host,
        ssh_port: params.ssh_port,
        ssh_username: params.ssh_username,
        ssh_password: params.ssh_password,
        auth_method: params.auth_method,
        private_key_path: params.private_key_path,
        passphrase: params.passphrase,
        local_port: params.local_port,
        remote_host: params.remote_host,
        remote_port: params.remote_port,
    };

    let mut engine = tunnel_engine.lock().await;
    engine.open_tunnel(config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tunnel_close(
    app: tauri::AppHandle,
    tunnel_id: String,
) -> Result<bool, String> {
    let tunnel_engine = app.state::<SshTunnelEngineState>().inner().clone();
    let mut engine = tunnel_engine.lock().await;
    engine
        .close_tunnel(&tunnel_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tunnel_list(
    app: tauri::AppHandle,
) -> Result<Vec<TunnelInfo>, String> {
    let tunnel_engine = app.state::<SshTunnelEngineState>().inner().clone();
    let engine = tunnel_engine.lock().await;
    Ok(engine.list_tunnels())
}
