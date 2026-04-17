//! AI 工具集 — Function Calling 可用工具
//!
//! 提供 5 个基础工具供 AI 主动调用：
//! - read_file: 读取文件内容
//! - list_directory: 列出目录
//! - search_files: 搜索文件内容
//! - write_file: 写入/创建文件
//! - read_tool_result: 读取之前落盘的大型工具结果

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use super::models::{ToolDefinition, ToolFunctionDef};
use super::tool_result_store;
use crate::utils::error::AppError;

/// 单文件读取上限 10MB
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;

/// 搜索结果最大匹配行数
const MAX_SEARCH_RESULTS: usize = 100;

/// 工具返回结果最大字符数（防止 context 爆炸）
/// 头 65% + 尾 35% 截断策略，参考 jetbrains-cc-gui 实现
const MAX_TOOL_RESULT_CHARS: usize = 20_000;

/// write_file 单次写入最大字节数（1MB，防 AI 误写巨量内容）
const MAX_WRITE_CONTENT_BYTES: usize = 1024 * 1024;

/// 对工具结果做头尾截断，保留首尾关键信息
fn truncate_result(content: String) -> String {
    // 使用字符数（而非字节）判断，避免切到多字节 UTF-8 中间
    let char_count = content.chars().count();
    if char_count <= MAX_TOOL_RESULT_CHARS {
        return content;
    }

    let head_len = MAX_TOOL_RESULT_CHARS * 65 / 100;
    let tail_len = MAX_TOOL_RESULT_CHARS - head_len;

    let head: String = content.chars().take(head_len).collect();
    let tail: String = content.chars().skip(char_count - tail_len).collect();
    let omitted = char_count - head_len - tail_len;

    format!(
        "{}\n\n...[已省略 {} 字符 | 总长 {} 字符，超过 {} 上限]...\n\n{}",
        head, omitted, char_count, MAX_TOOL_RESULT_CHARS, tail
    )
}

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
                description: "读取指定文件的文本内容。支持相对路径（基于工作目录）和绝对路径。大文件可通过 offset/limit 分页读取以节省上下文。".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "文件路径（相对于工作目录或绝对路径）"
                        },
                        "offset": {
                            "type": "integer",
                            "description": "起始行号（0 基），可选，默认 0"
                        },
                        "limit": {
                            "type": "integer",
                            "description": "最多读取行数，可选；省略则读全文。建议大文件分页（如 500 行）读取"
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
        ToolDefinition {
            tool_type: "function".to_string(),
            function: ToolFunctionDef {
                name: "edit_file".to_string(),
                description: "对已存在文件做精确替换。给定 old_string 必须在文件中唯一出现，会被替换为 new_string。适合小范围修改，比 write_file 重写整文件更节省 token。如 old_string 为空字符串，则视为追加到文件末尾。".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "文件路径（相对于工作目录或绝对路径）"
                        },
                        "old_string": {
                            "type": "string",
                            "description": "要被替换的旧文本。必须在文件中唯一出现，建议包含足够上下文（3-5 行）保证唯一性。空字符串表示追加到末尾。"
                        },
                        "new_string": {
                            "type": "string",
                            "description": "替换后的新文本"
                        },
                        "replace_all": {
                            "type": "boolean",
                            "description": "是否替换所有出现（默认 false，要求唯一匹配）"
                        }
                    },
                    "required": ["path", "old_string", "new_string"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: ToolFunctionDef {
                name: "bash".to_string(),
                description: "在工作目录执行 shell 命令（Windows 用 cmd，其他平台用 bash）。\
                    用于构建、测试、依赖安装等确实需要外部工具的场景。\
                    优先使用 read_file / search_files / list_directory 而非 cat/grep/ls。\
                    已内置安全黑名单拦截破坏性命令（rm -rf /、mkfs、shutdown、管道 sh 等）。"
                    .to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "要执行的完整 shell 命令"
                        },
                        "timeout_seconds": {
                            "type": "integer",
                            "description": "超时秒数（默认 60，上限 300）"
                        },
                        "description": {
                            "type": "string",
                            "description": "简短说明该命令意图（仅用于审计/审批界面，不影响执行）"
                        }
                    },
                    "required": ["command"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: ToolFunctionDef {
                name: "web_search".to_string(),
                description: "使用 Tavily 搜索引擎检索网页内容。\
                    返回综合答案 + 最多 10 条结果（含标题 / URL / 摘要）。\
                    需要环境变量 TAVILY_API_KEY，否则调用会报错指引用户配置。\
                    适用于查文档、查最新 API、补充知识盲区。"
                    .to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "搜索关键词"},
                        "max_results": {
                            "type": "integer",
                            "description": "返回结果数（默认 5，上限 10）"
                        },
                        "topic": {
                            "type": "string",
                            "enum": ["general", "news"],
                            "description": "检索主题，general 通用、news 新闻；默认 general"
                        }
                    },
                    "required": ["query"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: ToolFunctionDef {
                name: "web_fetch".to_string(),
                description: "抓取指定 URL 的正文（自动剥 HTML 标签），截断 20KB。\
                    仅支持 http/https；localhost / 私网段 / 云元数据地址会被拒。"
                    .to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "完整的 http/https URL"}
                    },
                    "required": ["url"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: ToolFunctionDef {
                name: "todo_write".to_string(),
                description: "规划与跟踪多步任务清单。面对 3 步以上的任务，先用它列出步骤再动手；\
                    每完成一项调用此工具把对应 id 的 status 更新为 completed，并把下一个置为 in_progress。\
                    同一时刻只能有一个任务处于 in_progress。工具本身不会真正执行任务，仅用于向用户展示进度。"
                    .to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "todos": {
                            "type": "array",
                            "description": "完整任务清单（每次都传全量，不是增量）",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": {"type": "string", "description": "稳定 id，跨轮次一致"},
                                    "content": {"type": "string", "description": "任务描述（祈使句）"},
                                    "activeForm": {"type": "string", "description": "执行中形式（进行时）"},
                                    "status": {
                                        "type": "string",
                                        "enum": ["pending", "in_progress", "completed"]
                                    }
                                },
                                "required": ["id", "content", "status", "activeForm"]
                            }
                        }
                    },
                    "required": ["todos"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: ToolFunctionDef {
                name: "read_tool_result".to_string(),
                description: "读取之前因过大被持久化到磁盘的工具结果。\
                    当你在响应中看到 <persisted-output> 标签时，说明该工具的完整输出被存到了磁盘，\
                    你只看到了前 2000 字符的行对齐预览。需要更多内容时调用此工具，按行分片读取。"
                    .to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "tool_call_id": {
                            "type": "string",
                            "description": "要读取的落盘结果对应的 tool_call_id（预览中已给出）"
                        },
                        "offset_line": {
                            "type": "integer",
                            "description": "起始行号（0-based），默认 0"
                        },
                        "limit_lines": {
                            "type": "integer",
                            "description": "最多读取的行数，默认 500，单次最大 2000"
                        }
                    },
                    "required": ["tool_call_id"]
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

/// 豁免落盘的工具白名单
///
/// 对这些工具的大结果仅做字符截断兜底，不落盘也不返回 `<persisted-output>`。
/// 原因：
/// - `read_file`: 落盘后 AI 再调 read_tool_result 读的是自己刚读的，会循环
/// - `read_tool_result`: 不能自引用
const PERSIST_SKIP_TOOLS: &[&str] = &["read_file", "read_tool_result"];

/// 执行指定工具
///
/// - `name`: 工具名称
/// - `arguments`: JSON 字符串参数
/// - `work_dir`: 工作目录（安全边界）
/// - `session_id`/`tool_call_id`/`app_data_dir`: 落盘所需上下文；缺失时退化为字符截断
pub async fn execute_tool(
    name: &str,
    arguments: &str,
    work_dir: &str,
    session_id: &str,
    tool_call_id: &str,
    app_data_dir: Option<&Path>,
) -> ToolExecResult {
    let start = std::time::Instant::now();
    let raw_result = match name {
        "read_file" => exec_read_file(arguments, work_dir).await,
        "list_directory" => exec_list_directory(arguments, work_dir).await,
        "search_files" => exec_search_files(arguments, work_dir).await,
        "write_file" => exec_write_file(arguments, work_dir).await,
        "edit_file" => exec_edit_file(arguments, work_dir).await,
        "bash" => super::exec_bash::exec_bash(arguments, work_dir).await,
        "web_search" => super::exec_web::exec_web_search(arguments).await,
        "web_fetch" => super::exec_web::exec_web_fetch(arguments).await,
        "todo_write" => exec_todo_write(arguments).await,
        "read_tool_result" => {
            exec_read_tool_result(arguments, session_id, app_data_dir).await
        }
        _ => Err(AppError::Other(format!("未知工具: {name}"))),
    };

    let exec_result = match raw_result {
        Ok(content) => {
            // 空结果占位：某些模型看到空 tool_result 会提前终止回合（claude-code inc-4586）
            let content = if content.trim().is_empty() {
                format!("({} completed with no output)", name)
            } else {
                content
            };

            let skip_persist = PERSIST_SKIP_TOOLS.contains(&name);
            let persistable = tool_result_store::is_persistable(&content);
            let oversized = tool_result_store::should_persist(&content);

            let final_content = if oversized && !skip_persist && persistable {
                match app_data_dir {
                    Some(dir) => match tool_result_store::persist_and_wrap(
                        dir,
                        session_id,
                        tool_call_id,
                        name,
                        content.clone(),
                    )
                    .await
                    {
                        Ok(wrapped) => wrapped,
                        Err(e) => {
                            log::warn!("工具结果落盘失败，退化为截断: {e}");
                            truncate_result(content)
                        }
                    },
                    None => truncate_result(content),
                }
            } else if oversized {
                // 豁免工具 / 二进制 / 无 app_data_dir 时做兜底截断
                truncate_result(content)
            } else {
                content
            };
            ToolExecResult {
                success: true,
                content: final_content,
            }
        }
        Err(e) => ToolExecResult {
            success: false,
            content: format!("[ERROR:{}] 工具执行失败: {}", classify_error(&e.to_string()), e),
        },
    };

    let elapsed_ms = start.elapsed().as_millis();
    log::info!(
        target: "ai.tool",
        "tool_exec name={} success={} elapsed_ms={} session={}",
        name,
        exec_result.success,
        elapsed_ms,
        session_id
    );
    exec_result
}

/// 根据错误消息关键字分类错误码，便于 AI 识别错误类型
fn classify_error(msg: &str) -> &'static str {
    let lower = msg.to_ascii_lowercase();
    if lower.contains("参数解析") || lower.contains("参数无效") || lower.contains("invalid arg") {
        "invalid_args"
    } else if lower.contains("不存在") || lower.contains("not found") || lower.contains("no such") {
        "not_found"
    } else if lower.contains("权限") || lower.contains("permission") || lower.contains("拒绝") || lower.contains("denied") {
        "permission"
    } else if lower.contains("超出") || lower.contains("过大") || lower.contains("too large") || lower.contains("exceeds") {
        "too_large"
    } else if lower.contains("工作目录") || lower.contains("不在") || lower.contains("out of bound") {
        "out_of_workspace"
    } else if lower.contains("读取") || lower.contains("写入") || lower.contains("io") {
        "io"
    } else {
        "unknown"
    }
}

// ──────────────── read_file ────────────────

#[derive(Deserialize)]
struct ReadFileArgs {
    path: String,
    /// 起始行号（0 基），可选，默认 0
    #[serde(default)]
    offset: Option<usize>,
    /// 最多读取行数，可选，默认全量
    #[serde(default)]
    limit: Option<usize>,
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

    let total_lines = content.lines().count();
    let offset = args.offset.unwrap_or(0);
    let limit = args.limit.unwrap_or(usize::MAX);

    // 无分页参数或越界 → 走全量路径（保持旧行为）
    if offset == 0 && limit == usize::MAX {
        return Ok(format!(
            "[文件: {} | {} 行 | {:.1} KB]\n{}",
            path.display(),
            total_lines,
            metadata.len() as f64 / 1024.0,
            content
        ));
    }

    if offset >= total_lines {
        return Ok(format!(
            "[文件: {} | {} 行 | 已越界 offset={}]\n",
            path.display(),
            total_lines,
            offset
        ));
    }

    let end = offset.saturating_add(limit).min(total_lines);
    let slice: String = content
        .lines()
        .skip(offset)
        .take(end - offset)
        .collect::<Vec<_>>()
        .join("\n");

    Ok(format!(
        "[文件: {} | 总 {} 行 | 切片 {}..{} | {:.1} KB]\n{}",
        path.display(),
        total_lines,
        offset,
        end,
        metadata.len() as f64 / 1024.0,
        slice
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

    // 校验写入大小，防止 AI 误写巨量内容
    if args.content.len() > MAX_WRITE_CONTENT_BYTES {
        return Err(AppError::Other(format!(
            "写入内容过大 ({:.1} MB)，超过 {:.0} KB 单次写入上限",
            args.content.len() as f64 / 1024.0 / 1024.0,
            MAX_WRITE_CONTENT_BYTES as f64 / 1024.0
        )));
    }

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

// ──────────────── edit_file ────────────────

#[derive(Deserialize)]
struct EditFileArgs {
    path: String,
    old_string: String,
    new_string: String,
    #[serde(default)]
    replace_all: Option<bool>,
}

async fn exec_edit_file(arguments: &str, work_dir: &str) -> Result<String, AppError> {
    let args: EditFileArgs = serde_json::from_str(arguments)
        .map_err(|e| AppError::Other(format!("参数解析失败: {e}")))?;

    if args.new_string.len() > MAX_WRITE_CONTENT_BYTES {
        return Err(AppError::Other(format!(
            "新内容过大 ({:.1} MB)，超过 {:.0} KB 上限",
            args.new_string.len() as f64 / 1024.0 / 1024.0,
            MAX_WRITE_CONTENT_BYTES as f64 / 1024.0
        )));
    }

    let path = validate_path(&args.path, work_dir)?;

    if !path.exists() {
        return Err(AppError::Other(format!(
            "文件不存在: {}（edit_file 仅用于已有文件，新建请用 write_file）",
            path.display()
        )));
    }

    let original = tokio::fs::read_to_string(&path).await
        .map_err(|e| AppError::Other(format!("读取文件失败: {e}")))?;

    // old_string 为空 → 追加到末尾
    let updated = if args.old_string.is_empty() {
        let mut s = original.clone();
        if !s.ends_with('\n') && !args.new_string.is_empty() && !args.new_string.starts_with('\n') {
            s.push('\n');
        }
        s.push_str(&args.new_string);
        s
    } else {
        let occurrences = original.matches(&args.old_string).count();
        if occurrences == 0 {
            return Err(AppError::Other(
                "old_string 未在文件中找到。请确认包含完整空白/换行，或改用 read_file 后再 write_file 重写".to_string(),
            ));
        }
        let replace_all = args.replace_all.unwrap_or(false);
        if occurrences > 1 && !replace_all {
            return Err(AppError::Other(format!(
                "old_string 在文件中匹配到 {} 处，请提供更多上下文使其唯一，或设置 replace_all=true",
                occurrences
            )));
        }
        if replace_all {
            original.replace(&args.old_string, &args.new_string)
        } else {
            original.replacen(&args.old_string, &args.new_string, 1)
        }
    };

    if updated == original {
        return Ok(format!("文件未变化: {}（old_string 与 new_string 相同）", path.display()));
    }

    tokio::fs::write(&path, &updated).await
        .map_err(|e| AppError::Other(format!("写入文件失败: {e}")))?;

    let delta = updated.len() as i64 - original.len() as i64;
    let sign = if delta >= 0 { "+" } else { "" };
    Ok(format!("已编辑 {} ({}{} 字节)", path.display(), sign, delta))
}

// ──────────────── read_tool_result ────────────────

#[derive(Deserialize)]
struct ReadToolResultArgs {
    tool_call_id: String,
    #[serde(default, alias = "offset")]
    offset_line: Option<usize>,
    #[serde(default, alias = "limit")]
    limit_lines: Option<usize>,
}

// ──────────────────────── todo_write ────────────────────────

#[derive(Debug, Deserialize)]
struct TodoItem {
    id: String,
    content: String,
    #[serde(rename = "activeForm")]
    active_form: String,
    status: String,
}

#[derive(Debug, Deserialize)]
struct TodoWriteArgs {
    todos: Vec<TodoItem>,
}

/// todo_write 仅用于向 AI / UI 反馈任务编排状态；参数本身就是"结果"。
/// 校验一下 schema（避免模型乱传），然后回显简短摘要给模型作 tool_result。
async fn exec_todo_write(arguments: &str) -> Result<String, AppError> {
    let args: TodoWriteArgs = serde_json::from_str(arguments)
        .map_err(|e| AppError::Other(format!("参数解析失败: {e}")))?;

    if args.todos.is_empty() {
        return Err(AppError::Other("todos 不能为空".to_string()));
    }

    let mut in_progress = 0usize;
    for t in &args.todos {
        match t.status.as_str() {
            "pending" | "in_progress" | "completed" => {}
            other => {
                return Err(AppError::Other(format!(
                    "非法 status: {} (应为 pending/in_progress/completed)",
                    other
                )))
            }
        }
        if t.status == "in_progress" {
            in_progress += 1;
        }
    }
    if in_progress > 1 {
        return Err(AppError::Other(format!(
            "同时只能有 1 个 in_progress 任务（当前 {}）",
            in_progress
        )));
    }

    let summary: Vec<String> = args
        .todos
        .iter()
        .map(|t| {
            let mark = match t.status.as_str() {
                "completed" => "[x]",
                "in_progress" => "[>]",
                _ => "[ ]",
            };
            let label = if t.status == "in_progress" {
                &t.active_form
            } else {
                &t.content
            };
            format!("{} {} — {}", mark, t.id, label)
        })
        .collect();

    Ok(format!(
        "已更新任务清单（{} 项）：\n{}",
        args.todos.len(),
        summary.join("\n")
    ))
}

/// 读取之前落盘的大型工具结果（按行分片）
async fn exec_read_tool_result(
    arguments: &str,
    session_id: &str,
    app_data_dir: Option<&Path>,
) -> Result<String, AppError> {
    let args: ReadToolResultArgs = serde_json::from_str(arguments)
        .map_err(|e| AppError::Other(format!("参数解析失败: {e}")))?;

    let dir = app_data_dir.ok_or_else(|| {
        AppError::Other("应用数据目录不可用，无法读取落盘结果".to_string())
    })?;

    if session_id.is_empty() {
        return Err(AppError::Other("会话上下文缺失".to_string()));
    }

    let offset_line = args.offset_line.unwrap_or(0);
    // 单次最大 2000 行，避免又触发落盘循环
    let limit_lines = args.limit_lines.unwrap_or(500).min(2000);

    tool_result_store::read_slice_lines(
        dir,
        session_id,
        &args.tool_call_id,
        offset_line,
        limit_lines,
    )
    .await
}

// ──────────────── 单元测试 ────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_error_categorizes_known_patterns() {
        assert_eq!(classify_error("参数解析失败: xxx"), "invalid_args");
        assert_eq!(classify_error("file not found"), "not_found");
        assert_eq!(classify_error("permission denied"), "permission");
        assert_eq!(classify_error("文件过大，超过上限"), "too_large");
        assert_eq!(classify_error("路径不在工作目录内"), "out_of_workspace");
        assert_eq!(classify_error("读取文件失败"), "io");
        assert_eq!(classify_error("纯文本未知错误"), "unknown");
    }

    #[test]
    fn truncate_result_keeps_head_and_tail() {
        let long: String = "a".repeat(MAX_TOOL_RESULT_CHARS + 500);
        let truncated = truncate_result(long);
        assert!(truncated.contains("已省略"));
        assert!(truncated.chars().count() < MAX_TOOL_RESULT_CHARS + 200);
    }

    #[tokio::test]
    async fn read_file_pagination_slices_by_line() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        let body = (0..20).map(|i| format!("line{i}")).collect::<Vec<_>>().join("\n");
        tokio::fs::write(&file, &body).await.unwrap();

        let work = dir.path().to_string_lossy().to_string();
        let args = serde_json::json!({ "path": "a.txt", "offset": 5, "limit": 3 });
        let out = exec_read_file(&args.to_string(), &work).await.unwrap();

        assert!(out.contains("切片 5..8"));
        assert!(out.contains("line5"));
        assert!(out.contains("line7"));
        assert!(!out.contains("line8"));
        assert!(!out.contains("line4"));
    }

    #[tokio::test]
    async fn read_file_pagination_offset_out_of_range() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("b.txt");
        tokio::fs::write(&file, "one\ntwo").await.unwrap();

        let work = dir.path().to_string_lossy().to_string();
        let args = serde_json::json!({ "path": "b.txt", "offset": 99, "limit": 5 });
        let out = exec_read_file(&args.to_string(), &work).await.unwrap();

        assert!(out.contains("已越界"));
    }

    #[tokio::test]
    async fn read_file_without_pagination_reads_full() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("c.txt");
        tokio::fs::write(&file, "hello\nworld").await.unwrap();

        let work = dir.path().to_string_lossy().to_string();
        let args = serde_json::json!({ "path": "c.txt" });
        let out = exec_read_file(&args.to_string(), &work).await.unwrap();

        assert!(out.contains("hello"));
        assert!(out.contains("world"));
        assert!(!out.contains("切片"));
    }

    #[tokio::test]
    async fn edit_file_unique_match_replaces() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("e.txt");
        tokio::fs::write(&file, "foo=1\nbar=2\n").await.unwrap();

        let work = dir.path().to_string_lossy().to_string();
        let args = serde_json::json!({
            "path": "e.txt",
            "old_string": "foo=1",
            "new_string": "foo=42",
        });
        exec_edit_file(&args.to_string(), &work).await.unwrap();

        let after = tokio::fs::read_to_string(&file).await.unwrap();
        assert_eq!(after, "foo=42\nbar=2\n");
    }

    #[tokio::test]
    async fn edit_file_empty_old_string_appends() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("app.txt");
        tokio::fs::write(&file, "line1\n").await.unwrap();

        let work = dir.path().to_string_lossy().to_string();
        let args = serde_json::json!({
            "path": "app.txt",
            "old_string": "",
            "new_string": "line2\n",
        });
        exec_edit_file(&args.to_string(), &work).await.unwrap();

        let after = tokio::fs::read_to_string(&file).await.unwrap();
        assert_eq!(after, "line1\nline2\n");
    }

    #[tokio::test]
    async fn edit_file_non_unique_match_errors() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("dup.txt");
        tokio::fs::write(&file, "x\nx\n").await.unwrap();

        let work = dir.path().to_string_lossy().to_string();
        let args = serde_json::json!({
            "path": "dup.txt",
            "old_string": "x",
            "new_string": "y",
        });
        let err = exec_edit_file(&args.to_string(), &work).await;
        assert!(err.is_err(), "非唯一匹配应报错");
    }

    #[tokio::test]
    async fn write_file_rejects_outside_workdir() {
        let dir = tempfile::tempdir().unwrap();
        let work = dir.path().to_string_lossy().to_string();
        // 路径试图通过 .. 跳出工作目录
        let args = serde_json::json!({
            "path": "../escape.txt",
            "content": "bad",
        });
        let res = exec_write_file(&args.to_string(), &work).await;
        assert!(res.is_err(), "越权路径应被 validate_path 拒绝");
    }

    #[tokio::test]
    async fn todo_write_validates_single_in_progress() {
        let args = serde_json::json!({
            "todos": [
                {"id": "1", "content": "a", "activeForm": "doing a", "status": "in_progress"},
                {"id": "2", "content": "b", "activeForm": "doing b", "status": "in_progress"},
            ]
        });
        let err = exec_todo_write(&args.to_string()).await;
        assert!(err.is_err(), "多个 in_progress 应被拒");
    }

    #[tokio::test]
    async fn todo_write_accepts_valid_payload() {
        let args = serde_json::json!({
            "todos": [
                {"id": "1", "content": "a", "activeForm": "doing a", "status": "in_progress"},
                {"id": "2", "content": "b", "activeForm": "doing b", "status": "pending"},
                {"id": "3", "content": "c", "activeForm": "doing c", "status": "completed"},
            ]
        });
        let out = exec_todo_write(&args.to_string()).await.unwrap();
        assert!(out.contains("3 项"));
        assert!(out.contains("[>]"));
        assert!(out.contains("[x]"));
    }
}
