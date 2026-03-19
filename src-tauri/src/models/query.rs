use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnDef>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub affected_rows: u64,
    pub execution_time_ms: u64,
    pub is_error: bool,
    pub error: Option<String>,
    pub total_count: Option<i64>,
    pub truncated: bool,
}

impl QueryResult {
    pub fn empty(columns: Vec<ColumnDef>, execution_time_ms: u64) -> Self {
        Self {
            columns,
            rows: vec![],
            affected_rows: 0,
            execution_time_ms,
            is_error: false,
            error: None,
            total_count: Some(0),
            truncated: false,
        }
    }

    pub fn affected(affected_rows: u64, execution_time_ms: u64) -> Self {
        Self {
            columns: vec![],
            rows: vec![],
            affected_rows,
            execution_time_ms,
            is_error: false,
            error: None,
            total_count: None,
            truncated: false,
        }
    }

    pub fn error(error: String, execution_time_ms: u64) -> Self {
        Self {
            columns: vec![],
            rows: vec![],
            affected_rows: 0,
            execution_time_ms,
            is_error: true,
            error: Some(error),
            total_count: None,
            truncated: false,
        }
    }
}

/// 流式查询数据块（通过 Tauri Channel 逐批推送给前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryChunk {
    /// 批次序号（从 0 开始）
    pub chunk_index: u32,
    /// 列定义（仅首批包含，后续批次为空数组）
    pub columns: Vec<ColumnDef>,
    /// 本批数据行
    pub rows: Vec<Vec<serde_json::Value>>,
    /// 是否为最后一批
    pub is_last: bool,
    /// 总耗时（ms），仅最后一批包含
    pub total_time_ms: Option<u64>,
    /// 错误信息（仅在执行失败时包含）
    pub error: Option<String>,
}

impl QueryChunk {
    pub fn error(chunk_index: u32, total_time_ms: u64, error: String) -> Self {
        Self {
            chunk_index,
            columns: vec![],
            rows: vec![],
            is_last: true,
            total_time_ms: Some(total_time_ms),
            error: Some(error),
        }
    }
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    pub table_type: String, // TABLE / VIEW
    pub row_count: Option<i64>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub name: String,
    pub character_set: Option<String>,
    pub collation: Option<String>,
}

/// 连接结果：包含连接状态和预加载的数据库列表
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    /// 连接是否成功
    pub success: bool,
    /// 预加载的数据库列表（连接成功后立即获取，减少一次 IPC 往返）
    pub databases: Vec<DatabaseInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewInfo {
    pub name: String,
    pub definer: Option<String>,
    pub check_option: Option<String>,
    pub is_updatable: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineInfo {
    pub name: String,
    pub routine_type: String,
    pub definer: Option<String>,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub comment: Option<String>,
}

/// 存储过程/函数的参数信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineParameter {
    pub name: String,
    pub data_type: String,
    pub dtd_identifier: String,
    pub mode: String,      // IN / OUT / INOUT
    pub position: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerInfo {
    pub name: String,
    pub event: String,
    pub timing: String,
    pub table_name: String,
    pub statement: Option<String>,
}

// ===== 性能监控相关结构体 =====

/// 服务器状态指标
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    /// 每秒查询数
    pub qps: f64,
    /// 每秒事务数
    pub tps: f64,
    /// 活跃连接数
    pub active_connections: u64,
    /// 总连接数
    pub total_connections: u64,
    /// 缓冲池使用率（百分比）
    pub buffer_pool_usage: f64,
    /// 慢查询数
    pub slow_queries: u64,
    /// 服务器运行时间（秒）
    pub uptime: u64,
    /// 字节发送量
    pub bytes_sent: u64,
    /// 字节接收量
    pub bytes_received: u64,
    /// 原始状态变量（用于前端自定义展示）
    pub raw_status: Vec<ServerVariable>,
}

/// 进程信息（SHOW PROCESSLIST 结果）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub id: u64,
    pub user: String,
    pub host: String,
    pub db: Option<String>,
    pub command: String,
    pub time: u64,
    pub state: Option<String>,
    pub info: Option<String>,
}

/// 服务器变量
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerVariable {
    pub name: String,
    pub value: String,
}

// ===== 用户权限管理相关结构体 =====

/// MySQL 用户信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MysqlUser {
    pub user: String,
    pub host: String,
    pub authentication_string: Option<String>,
    pub plugin: Option<String>,
    pub account_locked: Option<String>,
    pub password_expired: Option<String>,
}

/// 创建用户请求
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserRequest {
    pub username: String,
    pub host: String,
    pub password: String,
    pub plugin: Option<String>,
    /// 密码过期天数，None 表示不设置过期策略
    pub password_expire_days: Option<u32>,
}

/// DDL 脚本生成选项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptOptions {
    /// 是否在 CREATE 语句中包含 IF NOT EXISTS
    pub include_if_not_exists: bool,
    /// 是否在 DROP 语句中包含 IF EXISTS
    pub include_if_exists: bool,
}


// ===== 多语句执行相关类型 =====

/// 单条语句的执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementResult {
    /// 语句序号（从 1 开始）
    pub index: u32,
    /// 原始 SQL 文本
    pub sql: String,
    /// 语句类型（SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER / DROP / OTHER）
    pub statement_type: String,
    /// 执行结果（复用现有 QueryResult）
    pub result: QueryResult,
}

/// 多语句执行的错误策略
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub enum ErrorStrategy {
    /// 遇错停止（默认）
    StopOnError,
    /// 遇错继续
    ContinueOnError,
}

impl Default for ErrorStrategy {
    fn default() -> Self {
        Self::StopOnError
    }
}

/// 检测 SQL 语句类型
pub fn detect_statement_type(sql: &str) -> String {
    let first_word = sql.trim_start()
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_uppercase();
    match first_word.as_str() {
        "SELECT" | "SHOW" | "DESCRIBE" | "EXPLAIN" => first_word,
        "INSERT" | "UPDATE" | "DELETE" | "REPLACE" => first_word,
        "CREATE" | "ALTER" | "DROP" | "TRUNCATE" | "RENAME" => first_word,
        "BEGIN" | "COMMIT" | "ROLLBACK" | "START" => first_word,
        "SET" | "USE" | "GRANT" | "REVOKE" => first_word,
        "CALL" => first_word,
        _ => "OTHER".to_string(),
    }
}
 
 // ===== SQL 导入相关结构体 =====
 
 #[derive(Debug, Clone, Serialize, Deserialize)]
 #[serde(rename_all = "camelCase")]
 pub struct SqlFileProgress {
     pub total_statements: usize,
     pub executed: usize,
     pub success: usize,
     pub fail: usize,
     pub current_sql: String,
     pub is_finished: bool,
     pub error: Option<String>,
 }
 
 #[derive(Debug, Clone, Serialize, Deserialize)]
 #[serde(rename_all = "camelCase")]
 pub struct SqlImportOptions {
     pub continue_on_error: bool,
     pub multiple_queries: bool,
     pub disable_auto_commit: bool,
 }

/// 外键关系信息（用于 SQL 补全的 JOIN 推荐）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyRelation {
    pub table_name: String,
    pub column_name: String,
    pub referenced_table_name: String,
    pub referenced_column_name: String,
}

// ===== 索引分析模型 =====

/// 索引分析综合结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexAnalysisResult {
    /// 冗余索引列表
    pub redundant_indexes: Vec<RedundantIndex>,
    /// 未使用索引列表
    pub unused_indexes: Vec<UnusedIndex>,
    /// 索引建议列表
    pub suggestions: Vec<IndexSuggestion>,
}

/// 冗余索引：被其他索引的前缀完全覆盖
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedundantIndex {
    /// 表名
    pub table_name: String,
    /// 冗余索引名
    pub index_name: String,
    /// 冗余索引的列
    pub index_columns: Vec<String>,
    /// 覆盖此索引的索引名
    pub covered_by: String,
    /// 覆盖索引的列
    pub covered_by_columns: Vec<String>,
    /// 建议的 DROP 语句
    pub drop_sql: String,
}

/// 未使用索引：存在但从未被查询使用过
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnusedIndex {
    /// 表名
    pub table_name: String,
    /// 索引名
    pub index_name: String,
    /// 索引列
    pub index_columns: Vec<String>,
    /// 索引大小（估算）
    pub size_estimate: String,
    /// 建议的 DROP 语句
    pub drop_sql: String,
}

/// 索引创建建议
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexSuggestion {
    /// 表名
    pub table_name: String,
    /// 建议的列
    pub columns: Vec<String>,
    /// 建议原因
    pub reason: String,
    /// 预估改善程度描述
    pub estimated_improvement: String,
    /// 建议的 CREATE INDEX 语句
    pub create_sql: String,
}

// ===== 性能诊断模型 =====

/// 慢查询摘要（来自 performance_schema）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlowQueryDigest {
    /// SQL 摘要文本
    pub digest_text: String,
    /// 执行次数
    pub exec_count: u64,
    /// 平均执行时间（毫秒）
    pub avg_time_ms: f64,
    /// 最大执行时间（毫秒）
    pub max_time_ms: f64,
    /// 总执行时间（毫秒）
    pub total_time_ms: f64,
    /// 扫描行数总计
    pub rows_examined: u64,
    /// 返回行数总计
    pub rows_sent: u64,
    /// 首次出现时间
    pub first_seen: Option<String>,
    /// 最后出现时间
    pub last_seen: Option<String>,
}

/// InnoDB 引擎状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InnoDbStatus {
    /// Buffer Pool 总页数
    pub buffer_pool_pages_total: u64,
    /// Buffer Pool 空闲页数
    pub buffer_pool_pages_free: u64,
    /// Buffer Pool 脏页数
    pub buffer_pool_pages_dirty: u64,
    /// Buffer Pool 命中率
    pub buffer_pool_hit_rate: f64,
    /// 当前行锁等待数
    pub row_lock_current_waits: u64,
    /// 行锁等待平均时间（毫秒）
    pub row_lock_time_avg_ms: f64,
    /// 死锁次数
    pub deadlocks: u64,
    /// Redo Log 写入量（字节）
    pub log_bytes_written: u64,
    /// 待刷新日志量（字节）
    pub log_pending_fsyncs: u64,
    /// 读取行数
    pub rows_read: u64,
    /// 插入行数
    pub rows_inserted: u64,
    /// 更新行数
    pub rows_updated: u64,
    /// 删除行数
    pub rows_deleted: u64,
}
