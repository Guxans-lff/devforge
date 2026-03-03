use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
