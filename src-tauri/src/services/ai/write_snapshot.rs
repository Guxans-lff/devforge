//! 写文件快照存储 — 用于 Apply / Reject 审核回滚
//!
//! AI 调用 `write_file` 写入磁盘**之前**，把目标文件原内容（不存在则记录"新建"标记）
//! 保存到 `{app_data}/ai-write-snapshots/<session>/<tool_call_id>.snap`。
//!
//! 前端 Reject 时调用 `ai_revert_write_file` 命令：
//! - 快照标记为 "NEW" → 删除文件
//! - 快照含旧字节 → 写回原内容
//! - 快照不存在 → 报错（已被 GC 或从未保存）
//!
//! 文件格式（首行决定行为）：
//! - `NEW\n` 后无内容 → 写入前文件不存在
//! - `OLD\n` 后跟原始字节 → 写入前文件存在

use std::path::{Path, PathBuf};
use tokio::fs;

use crate::utils::error::AppError;

/// 快照根目录
fn root_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("ai-write-snapshots")
}

/// 单个快照文件路径
fn snap_path(app_data_dir: &Path, session_id: &str, tool_call_id: &str) -> PathBuf {
    root_dir(app_data_dir)
        .join(session_id)
        .join(format!("{tool_call_id}.snap"))
}

/// 保存写入前的快照（写文件前调用，失败不致命，仅记录日志）
///
/// - `target_path`: write_file 的目标绝对路径
/// - `existed`: 调用前文件是否存在
pub async fn save_snapshot(
    app_data_dir: &Path,
    session_id: &str,
    tool_call_id: &str,
    target_path: &Path,
    existed: bool,
) -> Result<(), AppError> {
    let snap = snap_path(app_data_dir, session_id, tool_call_id);
    if let Some(parent) = snap.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::Other(format!("创建快照目录失败: {e}")))?;
    }

    if existed {
        let old_bytes = fs::read(target_path)
            .await
            .map_err(|e| AppError::Other(format!("读取原文件失败: {e}")))?;
        let mut header = b"OLD\n".to_vec();
        header.extend_from_slice(&old_bytes);
        fs::write(&snap, &header)
            .await
            .map_err(|e| AppError::Other(format!("写入快照失败: {e}")))?;
    } else {
        fs::write(&snap, b"NEW\n")
            .await
            .map_err(|e| AppError::Other(format!("写入快照失败: {e}")))?;
    }
    Ok(())
}

/// 根据快照回滚（前端 Reject 调用）
///
/// 返回回滚类型描述，供前端展示
pub async fn revert_from_snapshot(
    app_data_dir: &Path,
    session_id: &str,
    tool_call_id: &str,
    target_path: &Path,
) -> Result<String, AppError> {
    let snap = snap_path(app_data_dir, session_id, tool_call_id);
    let bytes = fs::read(&snap)
        .await
        .map_err(|e| AppError::Other(format!("快照不存在或不可读: {e}")))?;

    // 首行 header
    let nl_idx = bytes
        .iter()
        .position(|&b| b == b'\n')
        .ok_or_else(|| AppError::Other("快照格式损坏：缺少首行标记".into()))?;
    let header = std::str::from_utf8(&bytes[..nl_idx]).unwrap_or("");
    let body = &bytes[nl_idx + 1..];

    let result = match header {
        "NEW" => {
            // 写入前不存在 → 删除目标
            if target_path.exists() {
                fs::remove_file(target_path)
                    .await
                    .map_err(|e| AppError::Other(format!("删除文件失败: {e}")))?;
                format!("已删除新建文件 {}", target_path.display())
            } else {
                format!("文件 {} 已不存在，跳过删除", target_path.display())
            }
        }
        "OLD" => {
            fs::write(target_path, body)
                .await
                .map_err(|e| AppError::Other(format!("还原文件失败: {e}")))?;
            format!("已还原 {} ({} 字节)", target_path.display(), body.len())
        }
        other => {
            return Err(AppError::Other(format!("快照标记异常: {other}")));
        }
    };

    // 回滚成功 → 删除快照避免重复执行
    let _ = fs::remove_file(&snap).await;
    Ok(result)
}

/// 清理整个会话的快照（会话删除时可调）
#[allow(dead_code)]
pub async fn cleanup_session(app_data_dir: &Path, session_id: &str) -> Result<(), AppError> {
    let dir = root_dir(app_data_dir).join(session_id);
    if dir.exists() {
        fs::remove_dir_all(&dir)
            .await
            .map_err(|e| AppError::Other(format!("清理快照目录失败: {e}")))?;
    }
    Ok(())
}
