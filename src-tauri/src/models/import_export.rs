use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ===== 数据导出相关结构体 =====

/// 数据导出请求
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    /// 数据来源（查询或表）
    pub source: ExportSource,
    /// 导出格式
    pub format: ExportFormat,
    /// 导出文件路径
    pub file_path: String,
    /// 格式特定选项
    pub options: ExportOptions,
}

/// 导出数据来源
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportSource {
    /// 自定义 SQL 查询
    Query { sql: String, database: String },
    /// 整表导出
    Table { database: String, table: String },
}

/// 导出文件格式
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    Csv,
    Json,
    Sql,
    Excel,
    Markdown,
}

/// 导出格式选项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    /// CSV 分隔符（默认逗号）
    pub csv_delimiter: Option<String>,
    /// CSV 文本限定符（默认双引号）
    pub csv_quote_char: Option<String>,
    /// CSV 是否包含列标题（默认 true）
    pub csv_include_header: Option<bool>,
    /// SQL 导出目标表名
    pub sql_table_name: Option<String>,
    /// SQL 导出是否包含 CREATE TABLE 语句
    pub sql_include_create: Option<bool>,
    /// SQL 导出每批 INSERT 的行数（默认 1000）
    pub sql_batch_size: Option<u32>,
    /// 文件编码（默认 UTF-8）
    pub encoding: Option<String>,
}

/// 导出结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    /// 是否成功
    pub success: bool,
    /// 导出行数
    pub row_count: u64,
    /// 文件大小（字节）
    pub file_size: u64,
    /// 错误信息
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionExport {
    pub version: i32,
    pub exported_at: i64,
    pub connections: Vec<ConnectionExportItem>,
    pub groups: Vec<ConnectionGroupExport>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionExportItem {
    pub name: String,
    #[serde(rename = "type")]
    pub conn_type: String,
    pub group_name: Option<String>,
    pub host: String,
    pub port: i32,
    pub username: String,
    pub password: Option<String>,
    pub config: HashMap<String, serde_json::Value>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionGroupExport {
    pub name: String,
    pub parent_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportOptions {
    pub conflict_strategy: ConflictStrategy,
    pub import_passwords: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConflictStrategy {
    Skip,
    Overwrite,
    Rename,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub success: bool,
    pub imported: i32,
    pub skipped: i32,
    pub failed: i32,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportPreview {
    pub connections: Vec<ConnectionExportItem>,
    pub groups: Vec<ConnectionGroupExport>,
    pub conflicts: Vec<String>,
}
