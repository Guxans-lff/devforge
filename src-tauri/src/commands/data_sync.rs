use tauri::{command, ipc::Channel, AppHandle, Manager};

use crate::commands::db::DbEngineState;
use crate::models::scheduler::{SyncConfig, SyncPreview, SyncProgress};
use crate::services::data_sync;
use crate::utils::error::AppError;

/// 预览同步计划：展示每张表的行数、列信息、主键
#[command]
pub async fn sync_data_preview(
    app: AppHandle,
    source_connection_id: String,
    source_database: String,
    target_connection_id: String,
    target_database: String,
    tables: Vec<String>,
    sync_mode: String,
) -> Result<Vec<SyncPreview>, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();

    let config = SyncConfig {
        source_connection_id,
        source_database,
        target_connection_id,
        target_database,
        tables,
        sync_mode,
        page_size: None,
    };

    data_sync::sync_preview(engine, &config).await
}

/// 执行数据同步，通过 Channel 推送进度
#[command]
pub async fn sync_data_execute(
    app: AppHandle,
    config: SyncConfig,
    on_progress: Channel<SyncProgress>,
) -> Result<String, AppError> {
    let engine = app.state::<DbEngineState>().inner().clone();

    let progress_callback = move |progress: SyncProgress| {
        let _ = on_progress.send(progress);
    };

    data_sync::sync_tables(engine, &config, progress_callback).await
}
