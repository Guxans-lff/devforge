use serde::{Deserialize, Serialize};

/// 目录条目（单层读取返回）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified: Option<i64>,
}

/// 递归目录条目（带相对路径）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecursiveDirEntry {
    pub relative_path: String,
    pub name: String,
    pub is_dir: bool,
    pub depth: u32,
}

/// 文件变更事件（推送前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    /// 变更类型
    #[serde(rename = "type")]
    pub change_type: String, // "create" | "modify" | "delete" | "rename"
    pub path: String,
    pub new_path: Option<String>,
    pub is_dir: bool,
}

/// Git 文件状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub status: String, // "modified" | "added" | "deleted" | "untracked" | "renamed" | "conflict"
}
