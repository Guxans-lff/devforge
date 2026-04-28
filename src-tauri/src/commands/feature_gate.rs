//! Feature Gate 管理命令
//!
//! 利用 app_state KV 存储，key 前缀为 `feature_gate.`，
//! 提供本地级别的 feature gate 覆盖值读写。

use tauri::{command, AppHandle, Manager};

use crate::commands::connection::StorageState;
use crate::utils::error::AppError;

const FG_PREFIX: &str = "feature_gate.";

/// 读取所有 feature gate 的本地覆盖值
#[command]
pub async fn read_feature_gates(app: AppHandle) -> Result<Vec<FeatureGateEntry>, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let prefix = FG_PREFIX.to_string();
    let records = storage.list_app_state(&prefix).await?;

    let mut entries = Vec::new();
    for r in records {
        let key = r.key.strip_prefix(FG_PREFIX).unwrap_or(&r.key).to_string();
        let enabled: bool = r.value.parse().unwrap_or(false);
        entries.push(FeatureGateEntry { key, enabled });
    }

    Ok(entries)
}

/// 写入单个 feature gate 的本地覆盖值
#[command]
pub async fn write_feature_gate(
    app: AppHandle,
    key: String,
    enabled: bool,
) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let full_key = format!("{}{}", FG_PREFIX, key);
    storage.set_app_state(&full_key, &enabled.to_string(), 1).await
}

/// 删除单个 feature gate 的本地覆盖值（恢复默认值）
#[command]
pub async fn delete_feature_gate(app: AppHandle, key: String) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let full_key = format!("{}{}", FG_PREFIX, key);
    storage.delete_app_state(&full_key).await
}

/// Feature Gate 条目（前端交互格式）
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct FeatureGateEntry {
    pub key: String,
    pub enabled: bool,
}
