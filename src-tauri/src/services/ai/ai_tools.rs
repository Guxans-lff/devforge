//! AI 工具集 — Function Calling 可用工具
//!
//! 提供 4 个基础文件系统工具供 AI 主动调用：
//! - read_file: 读取文件内容
//! - list_directory: 列出目录
//! - search_files: 搜索文件内容
//! - write_file: 写入/创建文件

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use super::models::{ToolDefinition, ToolFunctionDef};
use crate::utils::error::AppError;

/// 单文件读取上限 10MB
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;

/// 搜索结果最大匹配行数
const MAX_SEARCH_RESULTS: usize = 100;

// ──────────────────────── 路径校验 ────────────────────────

/// 校验路径是否在工作目录范围内
///
/// 使用 dunce::canonicalize 解析真实路径（处理符号链接和 Windows UNC 前缀），
/// 然后检查是否以 work_dir 为前缀。
fn validate_path(path: &str, work_dir: &str) -> Result<PathBuf, AppError> {
    let target = PathBuf::from(path);

    // 如果是相对路径，基于工作目录拼接
    let abs_path = if target.is_relative() {
        PathBuf::from(work_dir).join(&target)
    } else {
        target
    };

    // canonicalize 工作目录
    let canon_work = dunce::canonicalize(work_dir)
        .map_err(|e| AppError::Other(format!("工作目录无效: {e}")))?;

    // 对于不存在的路径（如 write_file 新建），canonicalize 父目录
    let canon_target = if abs_path.exists() {
        dunce::canonicalize(&abs_path)
            .map_err(|e| AppError::Other(format!("路径解析失败: {e}")))?
    } else {
        // 父目录必须存在
        let parent = abs_path.parent()
            .ok_or_else(|| AppError::Other("无效路径：无父目录".to_string()))?;
        let canon_parent = dunce::canonicalize(parent)
            .map_err(|e| AppError::Other(format!("父目录无效: {e}")))?;
        canon_parent.join(abs_path.file_name().unwrap_or_default())
    };

    if !canon_target.starts_with(&canon_work) {
        return Err(AppError::Other(format!(
            "路径不在工作目录范围内: {} (工作目录: {})",
            canon_target.display(),
            canon_work.display()
        )));
    }

    Ok(canon_target)
}

// ──────────────────────── 工具定义（JSON Schema） ────────────────────────

/// 获取所有可用工具定义
pub fn get_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            tool_type: "function".to_string(),
            function: ToolFunctionDef {
                name: "read_file".to_string(),
                description: "读取指定文件的文本内容。支持相对路径（基于工作目录）和绝对路径。".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "文件路径（相对于工作目录或绝对路径）"
                        }
                    },
                    "required": ["path"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: ToolFunctionDef {
                name: "list_directory".to_string(),
                description: "列出指定目录的文件和子目录。默认只列出第一层，可设置递归深度。".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "目录路径（相对于工作目录或绝对路径）"
                        },
                        "recursive": {
                            "type": "boolean",
                            "description": "是否递归列出子目录，默认 false"
                        },
                        "max_depth": {
                            "type": "integer",
                            "description": "递归最大深度，默认 3"
                        }
                    },
                    "required": ["path"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: ToolFunctionDef {
                name: "search_files".to_string(),
                description: "在指定目录中搜索文件内容，返回匹配行及文件路径。类似 grep 功能。".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "directory": {
                            "type": "string",
                            "description": "搜索的目录路径"
                        },
                        "pattern": {
                            "type": "string",
                            "description": "搜索的文本模式（子字符串匹配）"
                        },
                        "case_sensitive": {
                            "type": "boolean",
                            "description": "是否区分大小写，默认 false"
                        }
                    },
                    "required": ["directory", "pattern"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: ToolFunctionDef {
                name: "write_file".to_string(),
                description: "将内容写入指定文件。如果文件不存在则创建，存在则覆盖。可选创建中间目录。".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "文件路径（相对于工作目录或绝对路径）"
                        },
                        "content": {
                            "type": "string",
                            "description": "要写入的文件内容"
                        },
                        "create_dirs": {
                            "type": "boolean",
                            "description": "如果父目录不存在是否自动创建，默认 true"
                        }
                    },
                    "required": ["path", "content"]
                }),
            },
        },
    ]
}

// ──────────────────────── 工具执行 ────────────────────────

/// 工具执行结果
#[derive(Debug, Serialize)]
pub struct ToolExecResult {
    /// 是否成功
    pub success: bool,
    /// 结果内容（成功时为工具输出，失败时为错误信息）
    pub content: String,
}

/// 执行指定工具
///
/// - `name`: 工具名称
/// - `arguments`: JSON 字符串参数
/// - `work_dir`: 工作目录（安全边界）
pub async fn execute_tool(name: &str, arguments: &str, work_dir: &str) -> ToolExecResult {
    let result = match name {
        "read_file" => exec_read_file(arguments, work_dir).await,
        "list_directory" => exec_list_directory(arguments, work_dir).await,
        "search_files" => exec_search_files(arguments, work_dir).await,
        "write_file" => exec_write_file(arguments, work_dir).await,
        _ => Err(AppError::Other(format!("未知工具: {name}"))),
    };

    match result {
        Ok(content) => ToolExecResult { success: true, content },
        Err(e) => ToolExecResult { success: false, content: format!("工具执行失败: {e}") },
    }
}

// ──────────────── read_file ────────────────

#[derive(Deserialize)]
struct ReadFileArgs {
    path: String,
}

async fn exec_read_file(arguments: &str, work_dir: &str) -> Result<String, AppError> {
    let args: ReadFileArgs = serde_json::from_str(arguments)
        .map_err(|e| AppError::Other(format!("参数解析失败: {e}")))?;

    let path = validate_path(&args.path, work_dir)?;

    // 检查文件大小
    let metadata = tokio::fs::metadata(&path).await
        .map_err(|e| AppError::Other(format!("文件不存在或无法访问: {e}")))?;

    if metadata.len() > MAX_FILE_SIZE {
        return Err(AppError::Other(format!(
            "文件过大 ({:.1} MB)，超过 10MB 限制",
            metadata.len() as f64 / 1024.0 / 1024.0
        )));
    }

    if !metadata.is_file() {
        return Err(AppError::Other("指定路径不是文件".to_string()));
    }

    let content = tokio::fs::read_to_string(&path).await
        .map_err(|e| AppError::Other(format!("读取文件失败（可能不是文本文件）: {e}")))?;

    let line_count = content.lines().count();
    Ok(format!("[文件: {} | {} 行 | {:.1} KB]\n{}",
        path.display(),
        line_count,
        metadata.len() as f64 / 1024.0,
        content
    ))
}

// ──────────────── list_directory ────────────────

#[derive(Deserialize)]
struct ListDirArgs {
    path: String,
    #[serde(default)]
    recursive: bool,
    max_depth: Option<u32>,
}

async fn exec_list_directory(arguments: &str, work_dir: &str) -> Result<String, AppError> {
    let args: ListDirArgs = serde_json::from_str(arguments)
        .map_err(|e| AppError::Other(format!("参数解析失败: {e}")))?;

    let path = validate_path(&args.path, work_dir)?;

    if !path.is_dir() {
        return Err(AppError::Other("指定路径不是目录".to_string()));
    }

    let max_depth = if args.recursive { args.max_depth.unwrap_or(3) } else { 1 };
    let mut entries = Vec::new();
    collect_entries(&path, &path, 0, max_depth, &mut entries).await?;

    if entries.is_empty() {
        return Ok("（空目录）".to_string());
    }

    Ok(entries.join("\n"))
}

/// 递归收集目录条目
async fn collect_entries(
    base: &Path,
    dir: &Path,
    depth: u32,
    max_depth: u32,
    out: &mut Vec<String>,
) -> Result<(), AppError> {
    if depth >= max_depth {
        return Ok(());
    }

    let mut read_dir = tokio::fs::read_dir(dir).await
        .map_err(|e| AppError::Other(format!("读取目录失败: {e}")))?;

    let mut items: Vec<(String, bool)> = Vec::new();
    while let Some(entry) = read_dir.next_entry().await
        .map_err(|e| AppError::Other(format!("读取目录条目失败: {e}")))?
    {
        let name = entry.file_name().to_string_lossy().to_string();
        // 跳过隐藏文件和常见无用目录
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" {
            continue;
        }
        let is_dir = entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
        items.push((name, is_dir));
    }

    items.sort_by(|a, b| {
        // 目录在前，文件在后
        b.1.cmp(&a.1).then(a.0.cmp(&b.0))
    });

    let indent = "  ".repeat(depth as usize);
    for (name, is_dir) in &items {
        let rel_path = dir.join(&name);
        if *is_dir {
            out.push(format!("{}{}/", indent, name));
            // 递归限制条目总数
            if out.len() < 500 {
                Box::pin(collect_entries(base, &rel_path, depth + 1, max_depth, out)).await?;
            }
        } else {
            // 显示文件大小
            let size = tokio::fs::metadata(&rel_path).await
                .map(|m| format_size(m.len()))
                .unwrap_or_default();
            out.push(format!("{}{} {}", indent, name, size));
        }
    }

    Ok(())
}

/// 格式化文件大小
fn format_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("({}B)", bytes)
    } else if bytes < 1024 * 1024 {
        format!("({:.1}KB)", bytes as f64 / 1024.0)
    } else {
        format!("({:.1}MB)", bytes as f64 / 1024.0 / 1024.0)
    }
}

// ──────────────── search_files ────────────────

#[derive(Deserialize)]
struct SearchArgs {
    directory: String,
    pattern: String,
    #[serde(default)]
    case_sensitive: bool,
}

async fn exec_search_files(arguments: &str, work_dir: &str) -> Result<String, AppError> {
    let args: SearchArgs = serde_json::from_str(arguments)
        .map_err(|e| AppError::Other(format!("参数解析失败: {e}")))?;

    let dir = validate_path(&args.directory, work_dir)?;

    if !dir.is_dir() {
        return Err(AppError::Other("指定路径不是目录".to_string()));
    }

    let pattern = if args.case_sensitive {
        args.pattern.clone()
    } else {
        args.pattern.to_lowercase()
    };

    let mut results: Vec<String> = Vec::new();
    search_in_dir(&dir, &dir, &pattern, args.case_sensitive, &mut results).await?;

    if results.is_empty() {
        return Ok(format!("未找到匹配 \"{}\" 的结果", args.pattern));
    }

    let total = results.len();
    let truncated = total > MAX_SEARCH_RESULTS;
    if truncated {
        results.truncate(MAX_SEARCH_RESULTS);
    }

    let mut output = results.join("\n");
    if truncated {
        output.push_str(&format!("\n\n... 共 {} 处匹配，仅显示前 {} 条", total, MAX_SEARCH_RESULTS));
    } else {
        output.push_str(&format!("\n\n共 {} 处匹配", total));
    }
    Ok(output)
}

/// 递归搜索目录中的文件内容
async fn search_in_dir(
    base: &Path,
    dir: &Path,
    pattern: &str,
    case_sensitive: bool,
    results: &mut Vec<String>,
) -> Result<(), AppError> {
    let mut read_dir = tokio::fs::read_dir(dir).await
        .map_err(|e| AppError::Other(format!("读取目录失败: {e}")))?;

    while let Some(entry) = read_dir.next_entry().await.unwrap_or(None) {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" || name == "dist" {
            continue;
        }

        let path = entry.path();
        let file_type = entry.file_type().await.unwrap_or(
            std::fs::metadata(&path).map(|m| m.file_type()).unwrap_or(std::fs::metadata(".").unwrap().file_type())
        );

        if file_type.is_dir() {
            if results.len() < MAX_SEARCH_RESULTS * 2 {
                Box::pin(search_in_dir(base, &path, pattern, case_sensitive, results)).await?;
            }
        } else if file_type.is_file() {
            // 跳过大文件和二进制文件
            let meta = tokio::fs::metadata(&path).await;
            if let Ok(m) = meta {
                if m.len() > 1024 * 1024 { continue; } // 跳过 >1MB 的文件
            }

            if let Ok(content) = tokio::fs::read_to_string(&path).await {
                let rel = path.strip_prefix(base).unwrap_or(&path);
                for (line_num, line) in content.lines().enumerate() {
                    let matches = if case_sensitive {
                        line.contains(pattern)
                    } else {
                        line.to_lowercase().contains(pattern)
                    };
                    if matches {
                        results.push(format!("{}:{}: {}", rel.display(), line_num + 1, line.trim()));
                        if results.len() >= MAX_SEARCH_RESULTS * 2 {
                            return Ok(());
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

// ──────────────── write_file ────────────────

#[derive(Deserialize)]
struct WriteFileArgs {
    path: String,
    content: String,
    create_dirs: Option<bool>,
}

async fn exec_write_file(arguments: &str, work_dir: &str) -> Result<String, AppError> {
    let args: WriteFileArgs = serde_json::from_str(arguments)
        .map_err(|e| AppError::Other(format!("参数解析失败: {e}")))?;

    let path = validate_path(&args.path, work_dir)?;

    // 创建中间目录
    let create_dirs = args.create_dirs.unwrap_or(true);
    if create_dirs {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await
                .map_err(|e| AppError::Other(format!("创建目录失败: {e}")))?;
        }
    }

    let existed = path.exists();
    let byte_count = args.content.len();

    tokio::fs::write(&path, &args.content).await
        .map_err(|e| AppError::Other(format!("写入文件失败: {e}")))?;

    let action = if existed { "已更新" } else { "已创建" };
    Ok(format!("{} {} ({} 字节)", action, path.display(), byte_count))
}
