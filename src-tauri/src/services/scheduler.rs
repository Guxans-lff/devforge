use std::sync::Arc;

use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::connection::StorageState;
use crate::commands::db::DbEngineState;
use crate::models::scheduler::{ScheduledTask, SyncConfig, SyncProgress, TaskExecution};
use crate::services::cron_parser;
use crate::services::data_sync;

/// 调度器状态事件（推送给前端）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SchedulerEvent {
    /// 事件类型：task_started | task_completed | task_failed
    event_type: String,
    /// 关联的任务 ID
    task_id: String,
    /// 任务名称
    task_name: String,
    /// 执行记录 ID
    execution_id: Option<String>,
    /// 错误信息（仅 task_failed）
    error: Option<String>,
    /// 结果摘要（仅 task_completed）
    summary: Option<String>,
}

/// 启动调度循环
/// 在 tokio::spawn 中运行，每 60 秒检查有无到期任务
pub fn start(app_handle: AppHandle) {
    tokio::spawn(async move {
        log::info!("调度器已启动，每 60 秒检查到期任务");

        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;

            if let Err(e) = check_and_run_tasks(&app_handle).await {
                log::error!("调度器检查任务失败: {}", e);
            }
        }
    });
}

/// 检查并执行到期任务
async fn check_and_run_tasks(app_handle: &AppHandle) -> Result<(), String> {
    let storage = app_handle
        .state::<StorageState>()
        .inner()
        .clone();
    let engine = app_handle
        .state::<DbEngineState>()
        .inner()
        .clone();

    let now_ms = Utc::now().timestamp_millis();
    let due_tasks = storage
        .list_due_tasks(now_ms)
        .await
        .map_err(|e| e.to_string())?;

    for task in due_tasks {
        let storage = storage.clone();
        let engine = engine.clone();
        let app_handle = app_handle.clone();

        // 每个任务在独立的 tokio task 中执行，避免阻塞调度循环
        tokio::spawn(async move {
            if let Err(e) = execute_task(&app_handle, storage, engine, &task).await {
                log::error!("任务 {} 执行失败: {}", task.name, e);
            }
        });
    }

    Ok(())
}

/// 执行单个调度任务
async fn execute_task(
    app_handle: &AppHandle,
    storage: Arc<crate::services::storage::Storage>,
    engine: Arc<crate::services::db_engine::DbEngine>,
    task: &ScheduledTask,
) -> Result<(), String> {
    let now = Utc::now();
    let now_ms = now.timestamp_millis();
    let execution_id = uuid::Uuid::new_v4().to_string();

    // 创建执行记录
    let mut execution = TaskExecution {
        id: execution_id.clone(),
        task_id: task.id.clone(),
        status: "running".to_string(),
        started_at: now_ms,
        finished_at: None,
        result_summary: None,
        error: None,
    };
    storage
        .create_task_execution(&execution)
        .await
        .map_err(|e| e.to_string())?;

    // 推送开始事件
    let _ = app_handle.emit(
        "scheduler://task-event",
        SchedulerEvent {
            event_type: "task_started".to_string(),
            task_id: task.id.clone(),
            task_name: task.name.clone(),
            execution_id: Some(execution_id.clone()),
            error: None,
            summary: None,
        },
    );

    // 根据任务类型执行
    let result = match task.task_type.as_str() {
        "data_sync" => execute_data_sync(app_handle, engine, task).await,
        _ => Err(format!("不支持的任务类型: {}", task.task_type)),
    };

    // 更新执行记录
    let finished_at = Utc::now().timestamp_millis();
    match &result {
        Ok(summary) => {
            execution.status = "success".to_string();
            execution.finished_at = Some(finished_at);
            execution.result_summary = Some(summary.clone());

            let _ = app_handle.emit(
                "scheduler://task-event",
                SchedulerEvent {
                    event_type: "task_completed".to_string(),
                    task_id: task.id.clone(),
                    task_name: task.name.clone(),
                    execution_id: Some(execution_id),
                    error: None,
                    summary: Some(summary.clone()),
                },
            );
        }
        Err(e) => {
            execution.status = "failed".to_string();
            execution.finished_at = Some(finished_at);
            execution.error = Some(e.clone());

            let _ = app_handle.emit(
                "scheduler://task-event",
                SchedulerEvent {
                    event_type: "task_failed".to_string(),
                    task_id: task.id.clone(),
                    task_name: task.name.clone(),
                    execution_id: Some(execution_id),
                    error: Some(e.clone()),
                    summary: None,
                },
            );
        }
    }

    let _ = storage.update_task_execution(&execution).await;

    // 更新任务的 last_run 和 next_run
    let next_run = cron_parser::next_occurrence(&task.cron_expr, now)
        .map(|dt| dt.timestamp_millis());

    let mut updated_task = task.clone();
    updated_task.last_run = Some(now_ms);
    updated_task.next_run = next_run;
    updated_task.updated_at = finished_at;
    let _ = storage.update_scheduled_task(&updated_task).await;

    result.map(|_| ())
}

/// 执行数据同步任务
async fn execute_data_sync(
    app_handle: &AppHandle,
    engine: Arc<crate::services::db_engine::DbEngine>,
    task: &ScheduledTask,
) -> Result<String, String> {
    let config: SyncConfig =
        serde_json::from_str(&task.config_json).map_err(|e| format!("解析同步配置失败: {}", e))?;

    let app_handle = app_handle.clone();
    let task_id = task.id.clone();

    // 进度回调：通过 Tauri 事件推送
    let on_progress = move |progress: SyncProgress| {
        let _ = app_handle.emit(
            &format!("scheduler://sync-progress/{}", task_id),
            &progress,
        );
    };

    data_sync::sync_tables(engine, &config, on_progress)
        .await
        .map_err(|e| e.to_string())
}

/// 立即执行指定任务（手动触发，不依赖 cron 调度）
pub async fn run_task_now(
    app_handle: &AppHandle,
    task: &ScheduledTask,
) -> Result<String, String> {
    let storage = app_handle
        .state::<StorageState>()
        .inner()
        .clone();
    let engine = app_handle
        .state::<DbEngineState>()
        .inner()
        .clone();

    execute_task(app_handle, storage, engine, task).await?;
    Ok("任务已触发执行".to_string())
}
