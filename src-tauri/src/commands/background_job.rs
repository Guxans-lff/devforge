//! 后台 Job Tauri 命令
//!
//! 前端通过 `invoke` 调用，与 `background-job.ts` store 配合。

use tauri::{command, AppHandle, Manager};

use crate::commands::connection::StorageState;
use crate::services::background_job as bg;
use crate::utils::error::AppError;

/// 提交一个后台 Job
#[command]
pub async fn submit_background_job(
    app: AppHandle,
    id: String,
    kind: String,
    session_id: String,
) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let pool = storage.get_pool().await;

    // 同类去重：取消同 session + 同 kind 的活跃 job
    let existing = bg::list_jobs(&*pool, Some(&session_id)).await?;
    for job in existing {
        if job.kind == kind && (job.status == "queued" || job.status == "running") {
            bg::update_status(&*pool, &job.id, "cancelled", 0, None, Some("superseded")).await?;
        }
    }

    let input = bg::BackgroundJobInput { id, kind, session_id };
    bg::insert_job(&*pool, &input).await?;
    Ok(())
}

/// 更新 Job 状态
#[command]
pub async fn update_background_job(
    app: AppHandle,
    id: String,
    status: String,
    progress: i64,
    result: Option<String>,
    error: Option<String>,
) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let pool = storage.get_pool().await;
    bg::update_status(&*pool, &id, &status, progress, result.as_deref(), error.as_deref()).await?;
    Ok(())
}

/// 获取单个 Job
#[command]
pub async fn get_background_job(
    app: AppHandle,
    id: String,
) -> Result<Option<bg::BackgroundJob>, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let pool = storage.get_pool().await;
    bg::get_job(&*pool, &id).await
}

/// 列出 Job（可指定 session_id 筛选）
#[command]
pub async fn list_background_jobs(
    app: AppHandle,
    session_id: Option<String>,
) -> Result<Vec<bg::BackgroundJob>, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let pool = storage.get_pool().await;
    bg::list_jobs(&*pool, session_id.as_deref()).await
}

/// 删除单个 Job
#[command]
pub async fn delete_background_job(app: AppHandle, id: String) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let pool = storage.get_pool().await;
    bg::delete_job(&*pool, &id).await
}

/// 清理已完成的老 Job
#[command]
pub async fn cleanup_background_jobs(
    app: AppHandle,
    retain_hours: i64,
) -> Result<u64, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let pool = storage.get_pool().await;
    bg::cleanup_old_jobs(&*pool, retain_hours).await
}
