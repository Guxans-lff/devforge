//! 工具结果落盘存储
//!
//! 参考 claude-code `src/utils/toolResultStorage.ts` 的设计：
//! 当单个工具结果超过阈值时，将全文落盘，只给模型返回预览 + 文件路径，
//! AI 可按需通过 `read_tool_result` 工具按偏移量读取。
//!
//! 相比"头尾截断"方案：
//! - 保留完整信息，不丢数据
//! - AI 可多次分页读取，context 稳定
//! - 落盘文件跟随会话生命周期，GC 只清理孤儿会话（DB 已删除）

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;

use crate::utils::error::AppError;

/// 单工具结果落盘阈值（字符）：超过即落盘只返回预览
pub const MAX_RESULT_SIZE_CHARS: usize = 30_000;

/// 预览大小（字符）：给模型的文件头部内容
pub const PREVIEW_SIZE_CHARS: usize = 2_000;

/// 单轮累计预算（字符）：所有并行工具结果之和超此值则挑最大的若干条落盘
pub const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS: usize = 100_000;

/// 包装标签（前端用于识别落盘输出）
pub const PERSISTED_OPEN_TAG: &str = "<persisted-output>";
pub const PERSISTED_CLOSE_TAG: &str = "</persisted-output>";

/// 获取落盘根目录：{app_data}/tool-results
pub fn root_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("tool-results")
}

/// 会话子目录：{root}/{session_id}
fn session_dir(app_data_dir: &Path, session_id: &str) -> PathBuf {
    root_dir(app_data_dir).join(session_id)
}

/// 工具结果文件路径：{session_dir}/{tool_call_id}.txt
///
/// 提升为 `pub`，供前端"查看完整"命令直接复用。
pub fn file_path(app_data_dir: &Path, session_id: &str, tool_call_id: &str) -> PathBuf {
    // tool_call_id 通常为 call_xxx / toolu_xxx，净化保险起见
    let safe_id: String = tool_call_id
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    session_dir(app_data_dir, session_id).join(format!("{}.txt", safe_id))
}

/// 判断是否需要落盘
#[inline]
pub fn should_persist(content: &str) -> bool {
    content.chars().count() > MAX_RESULT_SIZE_CHARS
}

/// 判断内容是否可落盘为文本（排除含 NUL 的二进制数据）
#[inline]
pub fn is_persistable(content: &str) -> bool {
    !content.contains('\0')
}

/// 按行对齐的预览生成：先按字符硬切，再退到最后一个换行（如果换行在靠后一半内）
///
/// 返回 (preview, has_more)
fn make_preview_line_aligned(content: &str, max_chars: usize) -> (String, bool) {
    let char_count = content.chars().count();
    if char_count <= max_chars {
        return (content.to_string(), false);
    }
    let truncated: String = content.chars().take(max_chars).collect();
    let cut = match truncated.rfind('\n') {
        Some(pos) if pos > max_chars / 2 => pos,
        _ => truncated.len(),
    };
    (truncated[..cut].to_string(), true)
}

/// 落盘大工具结果，返回包装好的预览字符串（含标签 + 路径 + 总长 + 预览）
///
/// 若 `session_id` 或 `tool_call_id` 为空，则退化为原文（不落盘）。
/// 采用 `create_new` 原子创建，已存在则视为已落盘，幂等跳过。
pub async fn persist_and_wrap(
    app_data_dir: &Path,
    session_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    content: String,
) -> Result<String, AppError> {
    if session_id.is_empty() || tool_call_id.is_empty() {
        return Ok(content);
    }

    let total_chars = content.chars().count();
    let (preview, _has_more) = make_preview_line_aligned(&content, PREVIEW_SIZE_CHARS);
    let path = file_path(app_data_dir, session_id, tool_call_id);

    fs::create_dir_all(session_dir(app_data_dir, session_id))
        .await
        .map_err(|e| AppError::Other(format!("创建工具结果目录失败: {e}")))?;

    // 原子创建：create_new=true 等价于 O_CREAT|O_EXCL，避免 check-then-write 竞态。
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .await
    {
        Ok(mut file) => {
            file.write_all(content.as_bytes())
                .await
                .map_err(|e| AppError::Other(format!("写入工具结果失败: {e}")))?;
            // 结构化埋点：后续可替换为 OTel / Langfuse
            log::info!(
                target: "ai.tool_result",
                "persisted tool_call_id={} tool_name={} original_chars={} preview_chars={} session={}",
                tool_call_id,
                tool_name,
                total_chars,
                PREVIEW_SIZE_CHARS,
                session_id
            );
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            // 已存在，幂等跳过
        }
        Err(e) => {
            return Err(AppError::Other(format!("创建工具结果文件失败: {e}")));
        }
    }

    let file_display = path.display().to_string();
    Ok(format!(
        "{}\n\
         Output too large ({} chars). Full output saved to: {}\n\
         Tool call id: {}\n\
         Preview (first ~{} chars, line-aligned):\n\
         {}\n\
         ...\n\
         Use tool `read_tool_result` with tool_call_id=\"{}\" and offset_line/limit_lines to read more.\n\
         {}",
        PERSISTED_OPEN_TAG,
        total_chars,
        file_display,
        tool_call_id,
        PREVIEW_SIZE_CHARS,
        preview,
        tool_call_id,
        PERSISTED_CLOSE_TAG,
    ))
}

/// 按行读取落盘结果（供 `read_tool_result` 工具使用）
///
/// - `offset_line`：起始行号（0-based，超出返回空）
/// - `limit_lines`：读取行数，调用方负责 clamp 上限
pub async fn read_slice_lines(
    app_data_dir: &Path,
    session_id: &str,
    tool_call_id: &str,
    offset_line: usize,
    limit_lines: usize,
) -> Result<String, AppError> {
    let path = file_path(app_data_dir, session_id, tool_call_id);
    if !path.exists() {
        return Err(AppError::Other(format!(
            "未找到落盘结果文件: tool_call_id={} session_id={}",
            tool_call_id, session_id
        )));
    }

    let content = fs::read_to_string(&path)
        .await
        .map_err(|e| AppError::Other(format!("读取落盘结果失败: {e}")))?;

    let total_lines = content.lines().count();
    let start = offset_line.min(total_lines);
    let end = start.saturating_add(limit_lines).min(total_lines);

    let slice: String = content
        .lines()
        .skip(start)
        .take(end - start)
        .collect::<Vec<_>>()
        .join("\n");

    Ok(format!(
        "[Lines {}..{} of {}]\n{}",
        start, end, total_lines, slice
    ))
}

/// 读取完整落盘结果（供前端"查看完整"使用）
pub async fn read_full(
    app_data_dir: &Path,
    session_id: &str,
    tool_call_id: &str,
) -> Result<String, AppError> {
    let path = file_path(app_data_dir, session_id, tool_call_id);
    if !path.exists() {
        return Err(AppError::Other(format!(
            "未找到落盘结果文件: tool_call_id={} session_id={}",
            tool_call_id, session_id
        )));
    }
    fs::read_to_string(&path)
        .await
        .map_err(|e| AppError::Other(format!("读取落盘结果失败: {e}")))
}

/// 删除会话对应的所有落盘文件
pub async fn cleanup_session(app_data_dir: &Path, session_id: &str) -> Result<(), AppError> {
    let dir = session_dir(app_data_dir, session_id);
    if dir.exists() {
        fs::remove_dir_all(&dir)
            .await
            .map_err(|e| AppError::Other(format!("清理会话工具结果目录失败: {e}")))?;
    }
    Ok(())
}

/// GC：只清理在 `live_session_ids` 中不存在的"孤儿"会话目录
///
/// 替代原 `gc_old_results`（按 mtime）。避免长时间未访问的活跃会话被误删。
pub async fn gc_orphan_results(
    app_data_dir: &Path,
    live_session_ids: &HashSet<String>,
) -> Result<usize, AppError> {
    let root = root_dir(app_data_dir);
    if !root.exists() {
        return Ok(0);
    }

    let mut removed = 0usize;
    let mut read_dir = fs::read_dir(&root)
        .await
        .map_err(|e| AppError::Other(format!("读取工具结果根目录失败: {e}")))?;

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| AppError::Other(format!("遍历工具结果目录失败: {e}")))?
    {
        let meta = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if live_session_ids.contains(&name) {
            continue;
        }
        let path = entry.path();
        if fs::remove_dir_all(&path).await.is_ok() {
            removed += 1;
            log::info!(target: "ai.gc", "removed_orphan session={}", name);
        }
    }

    if removed > 0 {
        log::info!(target: "ai.gc", "done removed={} live={}", removed, live_session_ids.len());
    }
    Ok(removed)
}
