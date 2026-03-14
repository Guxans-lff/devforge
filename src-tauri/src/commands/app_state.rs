use tauri::{command, Manager};

use crate::commands::connection::StorageState;
use crate::services::storage::AppStateRecord;
use crate::utils::error::AppError;

/// 获取指定 key 的应用状态
#[command]
pub async fn get_app_state(
    app: tauri::AppHandle,
    key: String,
) -> Result<Option<AppStateRecord>, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage.get_app_state(&key).await
}

/// 设置指定 key 的应用状态（upsert）
#[command]
pub async fn set_app_state(
    app: tauri::AppHandle,
    key: String,
    value: String,
    version: Option<i64>,
) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage.set_app_state(&key, &value, version.unwrap_or(1)).await
}

/// 删除指定 key 的应用状态
#[command]
pub async fn delete_app_state(
    app: tauri::AppHandle,
    key: String,
) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage.delete_app_state(&key).await
}

/// 批量获取匹配前缀的应用状态
#[command]
pub async fn list_app_state(
    app: tauri::AppHandle,
    prefix: String,
) -> Result<Vec<AppStateRecord>, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage.list_app_state(&prefix).await
}
