//! 会话持久化存储
//!
//! 基于 SQLite 的会话和消息 CRUD 操作。

use super::models::{
    AiMessageRecord, AiSession, AiTranscriptEventQuery, AiTranscriptEventRecord, DailyUsage,
    ProviderConfig,
};
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
            created_at INTEGER NOT NULL,
            security TEXT
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
            success INTEGER,
            tool_name TEXT,
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

        CREATE TABLE IF NOT EXISTS ai_transcript_events (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            turn_id TEXT,
            event_type TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            payload_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ai_transcript_session_time
            ON ai_transcript_events(session_id, timestamp, id);

        CREATE INDEX IF NOT EXISTS idx_ai_transcript_session_type
            ON ai_transcript_events(session_id, event_type, timestamp);
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
    sqlx::query("ALTER TABLE ai_messages ADD COLUMN success INTEGER")
        .execute(pool)
        .await
        .ok();
    sqlx::query("ALTER TABLE ai_messages ADD COLUMN tool_name TEXT")
        .execute(pool)
        .await
        .ok();
    sqlx::query("ALTER TABLE ai_providers ADD COLUMN security TEXT")
        .execute(pool)
        .await
        .ok();
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS ai_transcript_events (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            turn_id TEXT,
            event_type TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            payload_json TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("创建 ai_transcript_events 表失败: {e}")))?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_ai_transcript_session_time ON ai_transcript_events(session_id, timestamp, id)",
    )
    .execute(pool)
    .await
    .ok();
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_ai_transcript_session_type ON ai_transcript_events(session_id, event_type, timestamp)",
    )
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
    let security_json = config
        .security
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| AppError::Other(format!("序列化 Provider 安全策略失败: {e}")))?;

    sqlx::query(
        r#"
        INSERT OR REPLACE INTO ai_providers (id, name, provider_type, endpoint, models, is_default, created_at, security)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&config.id)
    .bind(&config.name)
    .bind(provider_type)
    .bind(&config.endpoint)
    .bind(&models_json)
    .bind(config.is_default as i32)
    .bind(config.created_at)
    .bind(security_json)
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("保存 Provider 失败: {e}")))?;

    Ok(())
}

/// 获取所有 Provider 配置
pub async fn list_providers(pool: &SqlitePool) -> Result<Vec<ProviderConfig>, AppError> {
    let rows: Vec<(String, String, String, String, String, i32, i64, Option<String>)> = sqlx::query_as(
        "SELECT id, name, provider_type, endpoint, models, is_default, created_at, security FROM ai_providers ORDER BY created_at"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("查询 Provider 失败: {e}")))?;

    let mut providers = Vec::new();
    for (id, name, provider_type, endpoint, models_json, is_default, created_at, security_json) in rows {
        let models = serde_json::from_str(&models_json).unwrap_or_default();
        let provider_type = serde_json::from_str(&format!("\"{}\"", provider_type))
            .unwrap_or(super::models::ProviderType::OpenaiCompat);
        let security = security_json
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok());

        providers.push(ProviderConfig {
            id,
            name,
            provider_type,
            endpoint,
            models,
            is_default: is_default != 0,
            created_at,
            security,
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
        INSERT INTO ai_sessions
        (id, title, provider_id, model, system_prompt, message_count, total_tokens, estimated_cost, tags, created_at, updated_at, work_dir)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            provider_id = excluded.provider_id,
            model = excluded.model,
            system_prompt = excluded.system_prompt,
            message_count = excluded.message_count,
            total_tokens = excluded.total_tokens,
            estimated_cost = excluded.estimated_cost,
            tags = excluded.tags,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            work_dir = excluded.work_dir
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

/// 仅查询所有会话 ID（用于 GC 判定孤儿目录）
pub async fn list_session_ids(pool: &SqlitePool) -> Result<Vec<String>, AppError> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT id FROM ai_sessions")
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Other(format!("查询会话 ID 列表失败: {e}")))?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
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
    sqlx::query("DELETE FROM ai_transcript_events WHERE session_id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| AppError::Other(format!("删除会话 Transcript 失败: {e}")))?;

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

// ─────────────────────────────────── Transcript Event Store ───────────────────────────────────

/// 追加 Transcript 事件
pub async fn append_transcript_event(
    pool: &SqlitePool,
    event: &AiTranscriptEventRecord,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO ai_transcript_events
        (id, session_id, turn_id, event_type, timestamp, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&event.id)
    .bind(&event.session_id)
    .bind(&event.turn_id)
    .bind(&event.event_type)
    .bind(event.timestamp)
    .bind(&event.payload_json)
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("追加 Transcript 事件失败: {e}")))?;

    Ok(())
}

/// 查询最近 Transcript 事件
pub async fn list_transcript_events(
    pool: &SqlitePool,
    session_id: &str,
    limit: u32,
) -> Result<Vec<AiTranscriptEventRecord>, AppError> {
    let limit = limit.clamp(1, 2000) as i64;
    let rows: Vec<(String, String, Option<String>, String, i64, String)> = sqlx::query_as(
        r#"
        SELECT id, session_id, turn_id, event_type, timestamp, payload_json
        FROM ai_transcript_events
        WHERE session_id = ?
        ORDER BY timestamp DESC, id DESC
        LIMIT ?
        "#,
    )
    .bind(session_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("查询 Transcript 事件失败: {e}")))?;

    let mut events: Vec<AiTranscriptEventRecord> = rows
        .into_iter()
        .map(|(id, session_id, turn_id, event_type, timestamp, payload_json)| {
            AiTranscriptEventRecord {
                id,
                session_id,
                turn_id,
                event_type,
                timestamp,
                payload_json,
            }
        })
        .collect();

    events.sort_by(|left, right| {
        left.timestamp
            .cmp(&right.timestamp)
            .then_with(|| left.id.cmp(&right.id))
    });

    Ok(events)
}

fn transcript_query_limit(limit: Option<u32>) -> i64 {
    limit.unwrap_or(500).clamp(1, 5000) as i64
}

fn transcript_query_offset(offset: Option<u32>) -> i64 {
    offset.unwrap_or(0) as i64
}

fn validate_transcript_event_types(event_types: &[String]) -> Result<(), AppError> {
    if event_types.len() > 32 {
        return Err(AppError::Validation(
            "Transcript 事件类型过滤数量不能超过 32 个".to_string(),
        ));
    }
    if event_types
        .iter()
        .any(|event_type| event_type.trim().is_empty() || event_type.len() > 80)
    {
        return Err(AppError::Validation(
            "Transcript 事件类型不能为空或超过 80 字符".to_string(),
        ));
    }
    Ok(())
}

fn transcript_record_from_row(
    row: (String, String, Option<String>, String, i64, String),
) -> AiTranscriptEventRecord {
    let (id, session_id, turn_id, event_type, timestamp, payload_json) = row;
    AiTranscriptEventRecord {
        id,
        session_id,
        turn_id,
        event_type,
        timestamp,
        payload_json,
    }
}

/// 按条件查询 Transcript 事件，支持分页和基础过滤
pub async fn query_transcript_events(
    pool: &SqlitePool,
    query: &AiTranscriptEventQuery,
) -> Result<Vec<AiTranscriptEventRecord>, AppError> {
    if query.session_id.trim().is_empty() {
        return Err(AppError::Validation("会话 ID 不能为空".to_string()));
    }
    let event_types = query.event_types.clone().unwrap_or_default();
    validate_transcript_event_types(&event_types)?;

    let limit = transcript_query_limit(query.limit);
    let offset = transcript_query_offset(query.offset);
    let has_types = !event_types.is_empty();
    let type_json = serde_json::to_string(&event_types)?;

    let rows: Vec<(String, String, Option<String>, String, i64, String)> = sqlx::query_as(
        r#"
        SELECT id, session_id, turn_id, event_type, timestamp, payload_json
        FROM ai_transcript_events
        WHERE session_id = ?
          AND (? IS NULL OR turn_id = ?)
          AND (? IS NULL OR timestamp >= ?)
          AND (? IS NULL OR timestamp <= ?)
          AND (? = 0 OR event_type IN (SELECT value FROM json_each(?)))
        ORDER BY timestamp ASC, id ASC
        LIMIT ? OFFSET ?
        "#,
    )
    .bind(&query.session_id)
    .bind(&query.turn_id)
    .bind(&query.turn_id)
    .bind(query.start_time)
    .bind(query.start_time)
    .bind(query.end_time)
    .bind(query.end_time)
    .bind(if has_types { 1 } else { 0 })
    .bind(&type_json)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("查询 Transcript 事件失败: {e}")))?;

    Ok(rows.into_iter().map(transcript_record_from_row).collect())
}

/// 导出完整 Transcript 事件，限制最大数量避免一次性导出过大
pub async fn export_transcript_events(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Vec<AiTranscriptEventRecord>, AppError> {
    let query = AiTranscriptEventQuery {
        session_id: session_id.to_string(),
        limit: Some(20_000),
        offset: Some(0),
        event_types: None,
        turn_id: None,
        start_time: None,
        end_time: None,
    };
    query_transcript_events(pool, &query).await
}

/// 统计 Transcript 事件数量
pub async fn count_transcript_events(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<u32, AppError> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(1) FROM ai_transcript_events WHERE session_id = ?",
    )
    .bind(session_id)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Other(format!("统计 Transcript 事件失败: {e}")))?;

    Ok(count.max(0) as u32)
}

// ─────────────────────────────────── Message CRUD ───────────────────────────────────

/// 保存消息
pub async fn save_message(pool: &SqlitePool, msg: &AiMessageRecord) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT OR REPLACE INTO ai_messages
        (id, session_id, role, content, content_type, tokens, cost, parent_id, success, tool_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    .bind(msg.success.map(|value| if value { 1 } else { 0 }))
    .bind(&msg.tool_name)
    .bind(msg.created_at)
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("保存消息失败: {e}")))?;

    refresh_session_summary(pool, &msg.session_id).await?;

    Ok(())
}

/// 刷新会话列表使用的聚合摘要，避免消息事实源和会话列表长期不一致。
async fn refresh_session_summary(pool: &SqlitePool, session_id: &str) -> Result<(), AppError> {
    sqlx::query(
        r#"
        UPDATE ai_sessions
        SET
            message_count = (
                SELECT COUNT(*)
                FROM ai_messages
                WHERE session_id = ?
                  AND NOT (role = 'tool' AND content_type = 'tool_result')
            ),
            total_tokens = (
                SELECT COALESCE(SUM(tokens), 0)
                FROM ai_messages
                WHERE session_id = ?
            ),
            estimated_cost = (
                SELECT COALESCE(SUM(cost), 0)
                FROM ai_messages
                WHERE session_id = ?
            ),
            updated_at = (
                SELECT COALESCE(MAX(created_at), ai_sessions.updated_at)
                FROM ai_messages
                WHERE session_id = ?
            )
        WHERE id = ?
          AND EXISTS (SELECT 1 FROM ai_messages WHERE session_id = ?)
        "#,
    )
    .bind(session_id)
    .bind(session_id)
    .bind(session_id)
    .bind(session_id)
    .bind(session_id)
    .bind(session_id)
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("refresh session summary failed: {e}")))?;

    Ok(())
}

/// 获取会话的所有消息
pub async fn get_messages(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Vec<AiMessageRecord>, AppError> {
    let rows: Vec<(String, String, String, String, String, u32, f64, Option<String>, Option<i32>, Option<String>, i64)> =
        sqlx::query_as(
            "SELECT id, session_id, role, content, content_type, tokens, cost, parent_id, success, tool_name, created_at FROM ai_messages WHERE session_id = ? ORDER BY created_at, id"
        )
        .bind(session_id)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Other(format!("查询消息失败: {e}")))?;

    let messages = rows
        .into_iter()
        .map(
            |(id, session_id, role, content, content_type, tokens, cost, parent_id, success, tool_name, created_at)| {
                AiMessageRecord {
                    id,
                    session_id,
                    role,
                    content,
                    content_type,
                    tokens,
                    cost,
                    parent_id,
                    success: success.map(|value| value != 0),
                    tool_name,
                    created_at,
                }
            },
        )
        .collect();

    Ok(messages)
}

pub async fn count_messages(pool: &SqlitePool, session_id: &str) -> Result<u32, AppError> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ai_messages WHERE session_id = ?")
        .bind(session_id)
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::Other(format!("查询消息总数失败: {e}")))?;

    Ok(count.max(0) as u32)
}

pub async fn get_messages_recent(
    pool: &SqlitePool,
    session_id: &str,
    limit: usize,
) -> Result<Vec<AiMessageRecord>, AppError> {
    let limit = limit.max(1) as i64;
    let rows: Vec<(String, String, String, String, String, u32, f64, Option<String>, Option<i32>, Option<String>, i64)> =
        sqlx::query_as(
            r#"
            SELECT id, session_id, role, content, content_type, tokens, cost, parent_id, success, tool_name, created_at
            FROM ai_messages
            WHERE session_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            "#,
        )
        .bind(session_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Other(format!("查询最近消息失败: {e}")))?;

    let mut messages: Vec<AiMessageRecord> = rows
        .into_iter()
        .map(
            |(id, session_id, role, content, content_type, tokens, cost, parent_id, success, tool_name, created_at)| {
                AiMessageRecord {
                    id,
                    session_id,
                    role,
                    content,
                    content_type,
                    tokens,
                    cost,
                    parent_id,
                    success: success.map(|value| value != 0),
                    tool_name,
                    created_at,
                }
            },
        )
        .collect();

    messages.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });

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
