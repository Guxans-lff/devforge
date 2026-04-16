//! 记忆系统存储操作

use super::memory_models::{AiCompaction, AiMemory};
use crate::utils::error::AppError;
use sqlx::SqlitePool;

/// 按 workspace_id 查询记忆列表
pub async fn list_memories(pool: &SqlitePool, workspace_id: &str) -> Result<Vec<AiMemory>, AppError> {
    let rows = sqlx::query_as::<_, (String, String, String, String, String, String, Option<String>, f64, Option<i64>, i64, i64)>(
        "SELECT id, workspace_id, type, title, content, tags, source_session_id, weight, last_used_at, created_at, updated_at FROM ai_memories WHERE workspace_id = ? ORDER BY updated_at DESC"
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("查询记忆列表失败: {e}")))?;

    Ok(rows.into_iter().map(|r| AiMemory {
        id: r.0, workspace_id: r.1, memory_type: r.2, title: r.3,
        content: r.4, tags: r.5, source_session_id: r.6, weight: r.7,
        last_used_at: r.8, created_at: r.9, updated_at: r.10,
    }).collect())
}

/// 保存记忆（upsert）
pub async fn save_memory(pool: &SqlitePool, memory: &AiMemory) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT OR REPLACE INTO ai_memories
           (id, workspace_id, type, title, content, tags, source_session_id, weight, last_used_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&memory.id)
    .bind(&memory.workspace_id)
    .bind(&memory.memory_type)
    .bind(&memory.title)
    .bind(&memory.content)
    .bind(&memory.tags)
    .bind(&memory.source_session_id)
    .bind(memory.weight)
    .bind(memory.last_used_at)
    .bind(memory.created_at)
    .bind(memory.updated_at)
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("保存记忆失败: {e}")))?;
    Ok(())
}

/// 删除记忆
pub async fn delete_memory(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM ai_memories WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| AppError::Other(format!("删除记忆失败: {e}")))?;
    Ok(())
}

/// 按关键词搜索记忆（全量加载后 Rust 侧过滤，避免 SQL 注入）
pub async fn search_memories(
    pool: &SqlitePool,
    workspace_id: &str,
    keywords: &[String],
) -> Result<Vec<AiMemory>, AppError> {
    if keywords.is_empty() {
        return list_memories(pool, workspace_id).await;
    }

    let all = list_memories(pool, workspace_id).await?;
    let keywords_lower: Vec<String> = keywords.iter().map(|k| k.to_lowercase()).collect();

    let mut matched: Vec<AiMemory> = all
        .into_iter()
        .filter(|m| {
            keywords_lower.iter().any(|kw| {
                m.tags.to_lowercase().contains(kw)
                    || m.title.to_lowercase().contains(kw)
                    || m.content.to_lowercase().contains(kw)
            })
        })
        .collect();

    // 按 weight 降序排列
    matched.sort_by(|a, b| b.weight.partial_cmp(&a.weight).unwrap_or(std::cmp::Ordering::Equal));
    matched.truncate(20);

    Ok(matched)
}

/// 保存压缩记录
pub async fn save_compaction(pool: &SqlitePool, compaction: &AiCompaction) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT INTO ai_compactions (id, session_id, summary, original_count, original_tokens, created_at)
           VALUES (?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&compaction.id)
    .bind(&compaction.session_id)
    .bind(&compaction.summary)
    .bind(compaction.original_count)
    .bind(compaction.original_tokens)
    .bind(compaction.created_at)
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("保存压缩记录失败: {e}")))?;
    Ok(())
}

/// 查询会话的压缩历史
pub async fn list_compactions(pool: &SqlitePool, session_id: &str) -> Result<Vec<AiCompaction>, AppError> {
    let rows = sqlx::query_as::<_, (String, String, String, i64, i64, i64)>(
        "SELECT id, session_id, summary, original_count, original_tokens, created_at FROM ai_compactions WHERE session_id = ? ORDER BY created_at DESC"
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("查询压缩历史失败: {e}")))?;

    Ok(rows.into_iter().map(|r| AiCompaction {
        id: r.0, session_id: r.1, summary: r.2,
        original_count: r.3, original_tokens: r.4, created_at: r.5,
    }).collect())
}
