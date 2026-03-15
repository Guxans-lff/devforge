use std::sync::Arc;

use tauri::Manager;

use crate::services::local_shell_engine::LocalShellEngine;
use crate::utils::error::AppError;

/// 内部使用 RwLock，无需外层 Mutex
pub type LocalShellEngineState = Arc<LocalShellEngine>;

#[tauri::command]
pub async fn local_shell_spawn(
    app: tauri::AppHandle,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), AppError> {
    let engine = app.state::<LocalShellEngineState>().inner().clone();
    engine
        .spawn_shell(&app, &session_id, cols as u16, rows as u16)
        .await
}

#[tauri::command]
pub async fn local_shell_write(
    app: tauri::AppHandle,
    session_id: String,
    data: String,
) -> Result<(), AppError> {
    let engine = app.state::<LocalShellEngineState>().inner().clone();
    engine.write_data(&session_id, data.as_bytes()).await
}

#[tauri::command]
pub async fn local_shell_resize(
    app: tauri::AppHandle,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), AppError> {
    let engine = app.state::<LocalShellEngineState>().inner().clone();
    engine.resize(&session_id, cols as u16, rows as u16).await
}

#[tauri::command]
pub async fn local_shell_close(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), AppError> {
    let engine = app.state::<LocalShellEngineState>().inner().clone();
    engine.close_shell(&session_id).await
}
