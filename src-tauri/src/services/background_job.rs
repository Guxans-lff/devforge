//! 后台 Job 持久化存储
//!
//! 基于 SQLite 的后台任务 CRUD，与前端 `background-job.ts` store 对应。

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::utils::error::AppError;

// ─────────────────────────── 数据模型 ───────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct BackgroundJob {
    pub id: String,
    pub kind: String,
    pub status: String,
    pub session_id: String,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub progress: i64,
    pub result: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackgroundJobInput {
    pub id: String,
    pub kind: String,
    pub session_id: String,
}

// ─────────────────────────── 表初始化 ───────────────────────────

pub async fn init_table(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS background_jobs (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            session_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            started_at INTEGER,
            finished_at INTEGER,
            progress INTEGER NOT NULL DEFAULT 0,
            result TEXT,
            error TEXT
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("创建 background_jobs 表失败: {e}")))?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_bg_jobs_session ON background_jobs(session_id, kind, status)")
        .execute(pool)
        .await
        .ok();

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_bg_jobs_created ON background_jobs(created_at)")
        .execute(pool)
        .await
        .ok();

    Ok(())
}

// ─────────────────────────── CRUD ───────────────────────────

pub async fn insert_job(pool: &SqlitePool, job: &BackgroundJobInput) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        r#"
        INSERT INTO background_jobs (id, kind, status, session_id, created_at, progress)
        VALUES (?, ?, 'queued', ?, ?, 0)
        "#,
    )
    .bind(&job.id)
    .bind(&job.kind)
    .bind(&job.session_id)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("插入 background_job 失败: {e}")))?;
    Ok(())
}

pub async fn update_status(
    pool: &SqlitePool,
    id: &str,
    status: &str,
    progress: i64,
    result: Option<&str>,
    error: Option<&str>,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp_millis();

    let started_at = if status == "running" { Some(now) } else { None };
    let finished_at = if matches!(status, "succeeded" | "failed" | "cancelled") {
        Some(now)
    } else {
        None
    };

    sqlx::query(
        r#"
        UPDATE background_jobs
        SET status = ?, progress = ?, result = ?, error = ?,
            started_at = COALESCE(?, started_at),
            finished_at = ?
        WHERE id = ?
        "#,
    )
    .bind(status)
    .bind(progress)
    .bind(result)
    .bind(error)
    .bind(started_at)
    .bind(finished_at)
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("更新 background_job 失败: {e}")))?;

    Ok(())
}

pub async fn get_job(pool: &SqlitePool, id: &str) -> Result<Option<BackgroundJob>, AppError> {
    let row: Option<BackgroundJob> = sqlx::query_as(
        "SELECT id, kind, status, session_id, created_at, started_at, finished_at, progress, result, error FROM background_jobs WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Other(format!("查询 background_job 失败: {e}")))?;
    Ok(row)
}

pub async fn list_jobs(pool: &SqlitePool, session_id: Option<&str>) -> Result<Vec<BackgroundJob>, AppError> {
    let rows: Vec<BackgroundJob> = if let Some(sid) = session_id {
        sqlx::query_as(
            "SELECT id, kind, status, session_id, created_at, started_at, finished_at, progress, result, error FROM background_jobs WHERE session_id = ? ORDER BY created_at DESC"
        )
        .bind(sid)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as(
            "SELECT id, kind, status, session_id, created_at, started_at, finished_at, progress, result, error FROM background_jobs ORDER BY created_at DESC LIMIT 200"
        )
        .fetch_all(pool)
        .await
    }
    .map_err(|e| AppError::Other(format!("列出 background_jobs 失败: {e}")))?;

    Ok(rows)
}

pub async fn delete_job(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM background_jobs WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| AppError::Other(format!("删除 background_job 失败: {e}")))?;
    Ok(())
}

/// 清理已完成且超过保留期限的任务
pub async fn cleanup_old_jobs(pool: &SqlitePool, retain_hours: i64) -> Result<u64, AppError> {
    let cutoff = chrono::Utc::now().timestamp_millis() - retain_hours * 3600 * 1000;
    let result = sqlx::query(
        "DELETE FROM background_jobs WHERE finished_at IS NOT NULL AND finished_at < ?"
    )
    .bind(cutoff)
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("清理 background_jobs 失败: {e}")))?;

    Ok(result.rows_affected())
}
