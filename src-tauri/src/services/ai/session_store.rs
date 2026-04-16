//! 会话持久化存储
//!
//! 基于 SQLite 的会话和消息 CRUD 操作。

use super::models::{AiMessageRecord, AiSession, DailyUsage, ProviderConfig};
use crate::utils::error::AppError;
use sqlx::SqlitePool;

/// 初始化 AI 相关的 SQLite 表
pub async fn init_tables(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS ai_providers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider_type TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            models TEXT NOT NULL DEFAULT '[]',
            is_default INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            model TEXT NOT NULL,
            system_prompt TEXT,
            message_count INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            estimated_cost REAL DEFAULT 0,
            tags TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            content_type TEXT DEFAULT 'text',
            tokens INTEGER DEFAULT 0,
            cost REAL DEFAULT 0,
            parent_id TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_ai_msg_session ON ai_messages(session_id, created_at);

        CREATE TABLE IF NOT EXISTS ai_usage_daily (
            date TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            model TEXT NOT NULL,
            request_count INTEGER DEFAULT 0,
            prompt_tokens INTEGER DEFAULT 0,
            completion_tokens INTEGER DEFAULT 0,
            estimated_cost REAL DEFAULT 0,
            PRIMARY KEY (date, provider_id, model)
        );
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("初始化 AI 表失败: {e}")))?;

    // 迁移：为旧数据库添加 work_dir 列（忽略"列已存在"错误）
    sqlx::query("ALTER TABLE ai_sessions ADD COLUMN work_dir TEXT")
        .execute(pool)
        .await
        .ok();

    // 迁移：创建 ai_memories 表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS ai_memories (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            type TEXT NOT NULL,
            title TEXT DEFAULT '',
            content TEXT NOT NULL,
            tags TEXT DEFAULT '',
            source_session_id TEXT,
            weight REAL DEFAULT 1.0,
            embedding BLOB,
            last_used_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("创建 ai_memories 表失败: {e}")))?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_ai_mem_ws_type ON ai_memories(workspace_id, type)")
        .execute(pool).await.ok();
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_ai_mem_ws_tags ON ai_memories(workspace_id, tags)")
        .execute(pool).await.ok();

    // 迁移：创建 ai_compactions 表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS ai_compactions (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            summary TEXT NOT NULL,
            original_count INTEGER DEFAULT 0,
            original_tokens INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("创建 ai_compactions 表失败: {e}")))?;

    Ok(())
}

// ─────────────────────────────────── Provider CRUD ───────────────────────────────────

/// 保存 Provider 配置
pub async fn save_provider(pool: &SqlitePool, config: &ProviderConfig) -> Result<(), AppError> {
    let models_json = serde_json::to_string(&config.models)
        .map_err(|e| AppError::Other(format!("序列化模型列表失败: {e}")))?;
    let provider_type = serde_json::to_string(&config.provider_type)
        .map_err(|e| AppError::Other(format!("序列化 provider_type 失败: {e}")))?;
    // 去掉 JSON 字符串的引号
    let provider_type = provider_type.trim_matches('"');

    sqlx::query(
        r#"
        INSERT OR REPLACE INTO ai_providers (id, name, provider_type, endpoint, models, is_default, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&config.id)
    .bind(&config.name)
    .bind(provider_type)
    .bind(&config.endpoint)
    .bind(&models_json)
    .bind(config.is_default as i32)
    .bind(config.created_at)
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("保存 Provider 失败: {e}")))?;

    Ok(())
}

/// 获取所有 Provider 配置
pub async fn list_providers(pool: &SqlitePool) -> Result<Vec<ProviderConfig>, AppError> {
    let rows: Vec<(String, String, String, String, String, i32, i64)> = sqlx::query_as(
        "SELECT id, name, provider_type, endpoint, models, is_default, created_at FROM ai_providers ORDER BY created_at"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("查询 Provider 失败: {e}")))?;

    let mut providers = Vec::new();
    for (id, name, provider_type, endpoint, models_json, is_default, created_at) in rows {
        let models = serde_json::from_str(&models_json).unwrap_or_default();
        let provider_type = serde_json::from_str(&format!("\"{}\"", provider_type))
            .unwrap_or(super::models::ProviderType::OpenaiCompat);

        providers.push(ProviderConfig {
            id,
            name,
            provider_type,
            endpoint,
            models,
            is_default: is_default != 0,
            created_at,
        });
    }

    Ok(providers)
}

/// 删除 Provider
pub async fn delete_provider(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM ai_providers WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| AppError::Other(format!("删除 Provider 失败: {e}")))?;

    Ok(())
}

// ─────────────────────────────────── Session CRUD ───────────────────────────────────

/// 保存会话
pub async fn save_session(pool: &SqlitePool, session: &AiSession) -> Result<(), AppError> {
    let tags_json = session
        .tags
        .as_ref()
        .map(|t| serde_json::to_string(t).unwrap_or_default());

    sqlx::query(
        r#"
        INSERT OR REPLACE INTO ai_sessions
        (id, title, provider_id, model, system_prompt, message_count, total_tokens, estimated_cost, tags, created_at, updated_at, work_dir)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&session.id)
    .bind(&session.title)
    .bind(&session.provider_id)
    .bind(&session.model)
    .bind(&session.system_prompt)
    .bind(session.message_count)
    .bind(session.total_tokens)
    .bind(session.estimated_cost)
    .bind(&tags_json)
    .bind(session.created_at)
    .bind(session.updated_at)
    .bind(&session.work_dir)
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("保存会话失败: {e}")))?;

    Ok(())
}

/// 获取会话列表
pub async fn list_sessions(pool: &SqlitePool) -> Result<Vec<AiSession>, AppError> {
    let rows: Vec<(String, String, String, String, Option<String>, u32, u32, f64, Option<String>, i64, i64, Option<String>)> =
        sqlx::query_as(
            "SELECT id, title, provider_id, model, system_prompt, message_count, total_tokens, estimated_cost, tags, created_at, updated_at, work_dir FROM ai_sessions ORDER BY updated_at DESC"
        )
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Other(format!("查询会话列表失败: {e}")))?;

    let sessions = rows
        .into_iter()
        .map(|(id, title, provider_id, model, system_prompt, message_count, total_tokens, estimated_cost, tags_json, created_at, updated_at, work_dir)| {
            let tags = tags_json.and_then(|j| serde_json::from_str(&j).ok());
            AiSession {
                id, title, provider_id, model, system_prompt,
                message_count, total_tokens, estimated_cost, tags,
                created_at, updated_at, work_dir,
            }
        })
        .collect();

    Ok(sessions)
}

/// 获取单个会话
pub async fn get_session(pool: &SqlitePool, id: &str) -> Result<Option<AiSession>, AppError> {
    let row: Option<(String, String, String, String, Option<String>, u32, u32, f64, Option<String>, i64, i64, Option<String>)> =
        sqlx::query_as(
            "SELECT id, title, provider_id, model, system_prompt, message_count, total_tokens, estimated_cost, tags, created_at, updated_at, work_dir FROM ai_sessions WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::Other(format!("查询会话失败: {e}")))?;

    Ok(row.map(|(id, title, provider_id, model, system_prompt, message_count, total_tokens, estimated_cost, tags_json, created_at, updated_at, work_dir)| {
        let tags = tags_json.and_then(|j| serde_json::from_str(&j).ok());
        AiSession {
            id, title, provider_id, model, system_prompt,
            message_count, total_tokens, estimated_cost, tags,
            created_at, updated_at, work_dir,
        }
    }))
}

/// 删除会话（级联删除消息）
pub async fn delete_session(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    // 先删除消息（SQLite 外键 CASCADE 可能未启用）
    sqlx::query("DELETE FROM ai_messages WHERE session_id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| AppError::Other(format!("删除会话消息失败: {e}")))?;

    sqlx::query("DELETE FROM ai_sessions WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| AppError::Other(format!("删除会话失败: {e}")))?;

    Ok(())
}

// ─────────────────────────────────── Message CRUD ───────────────────────────────────

/// 保存消息
pub async fn save_message(pool: &SqlitePool, msg: &AiMessageRecord) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT OR REPLACE INTO ai_messages
        (id, session_id, role, content, content_type, tokens, cost, parent_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&msg.id)
    .bind(&msg.session_id)
    .bind(&msg.role)
    .bind(&msg.content)
    .bind(&msg.content_type)
    .bind(msg.tokens)
    .bind(msg.cost)
    .bind(&msg.parent_id)
    .bind(msg.created_at)
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("保存消息失败: {e}")))?;

    Ok(())
}

/// 获取会话的所有消息
pub async fn get_messages(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Vec<AiMessageRecord>, AppError> {
    let rows: Vec<(String, String, String, String, String, u32, f64, Option<String>, i64)> =
        sqlx::query_as(
            "SELECT id, session_id, role, content, content_type, tokens, cost, parent_id, created_at FROM ai_messages WHERE session_id = ? ORDER BY created_at"
        )
        .bind(session_id)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Other(format!("查询消息失败: {e}")))?;

    let messages = rows
        .into_iter()
        .map(
            |(id, session_id, role, content, content_type, tokens, cost, parent_id, created_at)| {
                AiMessageRecord {
                    id,
                    session_id,
                    role,
                    content,
                    content_type,
                    tokens,
                    cost,
                    parent_id,
                    created_at,
                }
            },
        )
        .collect();

    Ok(messages)
}

// ─────────────────────────────────── 用量统计 ───────────────────────────────────

/// 更新每日用量统计
pub async fn update_daily_usage(
    pool: &SqlitePool,
    provider_id: &str,
    model: &str,
    prompt_tokens: u32,
    completion_tokens: u32,
    cost: f64,
) -> Result<(), AppError> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    sqlx::query(
        r#"
        INSERT INTO ai_usage_daily (date, provider_id, model, request_count, prompt_tokens, completion_tokens, estimated_cost)
        VALUES (?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(date, provider_id, model) DO UPDATE SET
            request_count = request_count + 1,
            prompt_tokens = prompt_tokens + excluded.prompt_tokens,
            completion_tokens = completion_tokens + excluded.completion_tokens,
            estimated_cost = estimated_cost + excluded.estimated_cost
        "#,
    )
    .bind(&today)
    .bind(provider_id)
    .bind(model)
    .bind(prompt_tokens)
    .bind(completion_tokens)
    .bind(cost)
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("更新用量统计失败: {e}")))?;

    Ok(())
}

/// 查询用量统计
pub async fn get_usage_stats(
    pool: &SqlitePool,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<DailyUsage>, AppError> {
    let rows: Vec<(String, String, String, u32, u32, u32, f64)> = sqlx::query_as(
        "SELECT date, provider_id, model, request_count, prompt_tokens, completion_tokens, estimated_cost FROM ai_usage_daily WHERE date >= ? AND date <= ? ORDER BY date DESC"
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("查询用量统计失败: {e}")))?;

    let usage = rows
        .into_iter()
        .map(
            |(date, provider_id, model, request_count, prompt_tokens, completion_tokens, estimated_cost)| {
                DailyUsage {
                    date,
                    provider_id,
                    model,
                    request_count,
                    prompt_tokens,
                    completion_tokens,
                    estimated_cost,
                }
            },
        )
        .collect();

    Ok(usage)
}
