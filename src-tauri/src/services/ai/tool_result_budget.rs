//! 单轮工具结果累计预算
//!
//! 即便每个工具结果都 ≤ `MAX_RESULT_SIZE_CHARS`，若一次 AI 并行调用产出
//! 的所有工具结果之和过大，仍会撑爆上下文。本模块对"一批工具结果"执行
//! 累计预算检查，挑出最大的若干条落盘并替换为预览。
//!
//! 参考 claude-code `src/utils/toolResultStorage.ts` 的 `enforceToolResultBudget`。
//! 我们的版本不保留 prompt-cache 一致性状态（devforge 无 prompt cache），
//! 只按"从大到小挑选至低于预算"的贪心策略。

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::tool_result_store::{
    self, MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
};
use crate::utils::error::AppError;

/// 前端传入的单条工具结果（带元数据）
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultEntry {
    pub tool_call_id: String,
    pub tool_name: String,
    pub content: String,
}

/// 预算检查并就地替换：超出预算时从 content 最长的开始落盘，直到累计 ≤ limit
pub async fn enforce(
    app_data_dir: &Path,
    session_id: &str,
    mut results: Vec<ToolResultEntry>,
) -> Result<Vec<ToolResultEntry>, AppError> {
    let limit = MAX_TOOL_RESULTS_PER_MESSAGE_CHARS;
    let total: usize = results.iter().map(|r| r.content.chars().count()).sum();
    if total <= limit {
        return Ok(results);
    }
    log::info!(
        target: "ai.budget",
        "enforce session={} total_chars={} limit={} entry_count={}",
        session_id, total, limit, results.len()
    );

    // 已经是落盘预览的结果（含 <persisted-output> 标签）无需再处理
    let is_already_persisted = |c: &str| c.contains(tool_result_store::PERSISTED_OPEN_TAG);

    // 按 content 长度降序索引
    let mut order: Vec<usize> = (0..results.len()).collect();
    order.sort_by(|&a, &b| {
        let la = results[a].content.chars().count();
        let lb = results[b].content.chars().count();
        lb.cmp(&la)
    });

    let mut current = total;
    for idx in order {
        if current <= limit {
            break;
        }
        let r = &results[idx];
        if is_already_persisted(&r.content) {
            continue;
        }
        if !tool_result_store::is_persistable(&r.content) {
            continue;
        }
        let original_len = r.content.chars().count();
        // 太小的不值得落盘
        if original_len < 1_000 {
            continue;
        }

        let tool_call_id = r.tool_call_id.clone();
        let tool_name = r.tool_name.clone();
        let content = std::mem::take(&mut results[idx].content);

        match tool_result_store::persist_and_wrap(
            app_data_dir,
            session_id,
            &tool_call_id,
            &tool_name,
            content,
        )
        .await
        {
            Ok(wrapped) => {
                let new_len = wrapped.chars().count();
                results[idx].content = wrapped;
                current = current.saturating_sub(original_len).saturating_add(new_len);
            }
            Err(e) => {
                log::warn!(
                    target: "ai.budget",
                    "persist_failed session={} tool_call_id={} err={}",
                    session_id, tool_call_id, e
                );
                // 无法落盘时恢复原内容避免丢失
                results[idx].content = format!(
                    "[预算落盘失败，结果已丢弃] original_chars={}",
                    original_len
                );
                current = current.saturating_sub(original_len);
            }
        }
    }

    Ok(results)
}
