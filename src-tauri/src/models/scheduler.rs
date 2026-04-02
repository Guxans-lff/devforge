use serde::{Deserialize, Serialize};

/// 调度任务
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    /// 任务唯一标识（UUID）
    pub id: String,
    /// 任务名称
    pub name: String,
    /// 任务类型（如 "data_sync"）
    pub task_type: String,
    /// cron 表达式（分 时 日 月 周）
    pub cron_expr: String,
    /// 任务配置 JSON（根据 task_type 解析为具体配置）
    pub config_json: String,
    /// 是否启用
    pub enabled: bool,
    /// 上次执行时间（Unix 时间戳毫秒）
    pub last_run: Option<i64>,
    /// 下次执行时间（Unix 时间戳毫秒）
    pub next_run: Option<i64>,
    /// 创建时间（Unix 时间戳毫秒）
    pub created_at: i64,
    /// 更新时间（Unix 时间戳毫秒）
    pub updated_at: i64,
}

/// 任务执行记录
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskExecution {
    /// 记录唯一标识（UUID）
    pub id: String,
    /// 关联的任务 ID
    pub task_id: String,
    /// 执行状态：running | success | failed | cancelled
    pub status: String,
    /// 开始时间（Unix 时间戳毫秒）
    pub started_at: i64,
    /// 结束时间（Unix 时间戳毫秒）
    pub finished_at: Option<i64>,
    /// 执行结果摘要
    pub result_summary: Option<String>,
    /// 错误信息
    pub error: Option<String>,
}

/// 数据同步配置（序列化为 JSON 存储在 ScheduledTask.config_json 中）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    /// 源连接 ID
    pub source_connection_id: String,
    /// 源数据库名
    pub source_database: String,
    /// 目标连接 ID
    pub target_connection_id: String,
    /// 目标数据库名
    pub target_database: String,
    /// 要同步的表列表
    pub tables: Vec<String>,
    /// 同步模式：full（全量 TRUNCATE + INSERT）| upsert
    pub sync_mode: String,
    /// 每页行数（默认 5000）
    pub page_size: Option<usize>,
}

impl SyncConfig {
    /// 获取实际每页行数（默认 5000）
    pub fn effective_page_size(&self) -> usize {
        self.page_size.unwrap_or(5000)
    }
}

/// 数据库备份配置（序列化为 JSON 存储在 ScheduledTask.config_json 中）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupConfig {
    /// 连接 ID
    pub connection_id: String,
    /// 数据库名
    pub database: String,
    /// 要备份的表列表（空表示全部）
    pub tables: Vec<String>,
    /// 是否包含表结构
    pub include_structure: bool,
    /// 是否包含数据
    pub include_data: bool,
    /// 输出目录（文件名自动生成带时间戳）
    pub output_dir: String,
}

/// 同步进度事件（通过 Tauri Channel 推送给前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    /// 当前同步的表名
    pub table: String,
    /// 当前表在列表中的索引（从 0 开始）
    pub table_index: usize,
    /// 表总数
    pub table_count: usize,
    /// 当前表已同步行数
    pub synced_rows: u64,
    /// 当前表总行数
    pub total_rows: u64,
    /// 当前阶段描述
    pub stage: String,
    /// 是否已完成
    pub finished: bool,
    /// 错误信息（仅失败时包含）
    pub error: Option<String>,
}

/// 同步预览信息（展示同步计划）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPreview {
    /// 表名
    pub table: String,
    /// 源表行数
    pub source_rows: u64,
    /// 目标表行数
    pub target_rows: u64,
    /// 列定义列表
    pub columns: Vec<String>,
    /// 主键列（用于 upsert 模式）
    pub primary_keys: Vec<String>,
}
