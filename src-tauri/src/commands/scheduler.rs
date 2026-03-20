use chrono::Utc;
use tauri::{command, AppHandle, Manager};

use crate::commands::connection::StorageState;
use crate::models::scheduler::{ScheduledTask, TaskExecution};
use crate::services::{cron_parser, scheduler};
use crate::utils::error::AppError;

/// 列出所有调度任务
#[command]
pub async fn list_scheduled_tasks(app: AppHandle) -> Result<Vec<ScheduledTask>, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage.list_scheduled_tasks().await
}

/// 创建调度任务
#[command]
pub async fn create_scheduled_task(
    app: AppHandle,
    name: String,
    task_type: String,
    cron_expr: String,
    config_json: String,
    enabled: Option<bool>,
) -> Result<ScheduledTask, AppError> {
    // 验证 cron 表达式
    cron_parser::validate_cron(&cron_expr).map_err(AppError::Validation)?;

    let now = Utc::now();
    let now_ms = now.timestamp_millis();
    let enabled = enabled.unwrap_or(true);

    // 计算下次执行时间
    let next_run = if enabled {
        cron_parser::next_occurrence(&cron_expr, now).map(|dt| dt.timestamp_millis())
    } else {
        None
    };

    let task = ScheduledTask {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        task_type,
        cron_expr,
        config_json,
        enabled,
        last_run: None,
        next_run,
        created_at: now_ms,
        updated_at: now_ms,
    };

    let storage = app.state::<StorageState>().inner().clone();
    storage.create_scheduled_task(&task).await?;

    Ok(task)
}

/// 更新调度任务
#[command]
pub async fn update_scheduled_task(
    app: AppHandle,
    id: String,
    name: Option<String>,
    cron_expr: Option<String>,
    config_json: Option<String>,
    enabled: Option<bool>,
) -> Result<ScheduledTask, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let mut task = storage.get_scheduled_task(&id).await?;
    let now = Utc::now();

    if let Some(name) = name {
        task.name = name;
    }
    if let Some(cron_expr) = cron_expr {
        cron_parser::validate_cron(&cron_expr).map_err(AppError::Validation)?;
        task.cron_expr = cron_expr;
    }
    if let Some(config_json) = config_json {
        task.config_json = config_json;
    }
    if let Some(enabled) = enabled {
        task.enabled = enabled;
    }

    // 重新计算下次执行时间
    task.next_run = if task.enabled {
        cron_parser::next_occurrence(&task.cron_expr, now).map(|dt| dt.timestamp_millis())
    } else {
        None
    };
    task.updated_at = now.timestamp_millis();

    storage.update_scheduled_task(&task).await?;

    Ok(task)
}

/// 删除调度任务
#[command]
pub async fn delete_scheduled_task(app: AppHandle, id: String) -> Result<(), AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage.delete_scheduled_task(&id).await
}

/// 启用/禁用调度任务
#[command]
pub async fn toggle_scheduled_task(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<ScheduledTask, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let mut task = storage.get_scheduled_task(&id).await?;
    let now = Utc::now();

    task.enabled = enabled;
    task.next_run = if enabled {
        cron_parser::next_occurrence(&task.cron_expr, now).map(|dt| dt.timestamp_millis())
    } else {
        None
    };
    task.updated_at = now.timestamp_millis();

    storage.update_scheduled_task(&task).await?;

    Ok(task)
}

/// 列出指定任务的执行记录
#[command]
pub async fn list_task_executions(
    app: AppHandle,
    task_id: String,
) -> Result<Vec<TaskExecution>, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    storage.list_task_executions(&task_id).await
}

/// 立即执行指定任务
#[command]
pub async fn run_task_now(app: AppHandle, id: String) -> Result<String, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let task = storage.get_scheduled_task(&id).await?;

    scheduler::run_task_now(&app, &task)
        .await
        .map_err(AppError::Other)
}
