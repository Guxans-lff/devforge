//! 记忆系统数据模型

use serde::{Deserialize, Serialize};

/// 记忆条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMemory {
    pub id: String,
    pub workspace_id: String,
    #[serde(rename = "type")]
    pub memory_type: String,
    pub title: String,
    pub content: String,
    pub tags: String,
    pub source_session_id: Option<String>,
    pub weight: f64,
    pub last_used_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 压缩记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiCompaction {
    pub id: String,
    pub session_id: String,
    pub summary: String,
    pub original_count: i64,
    pub original_tokens: i64,
    pub created_at: i64,
}
