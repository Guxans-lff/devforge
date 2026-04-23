//! AI 对话相关 Tauri 命令
//!
//! 提供前端调用的命令接口，包括流式对话、中断、会话管理、Provider 管理、用量统计。

use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{Manager, State};

use crate::services::ai::models::*;
use crate::services::ai::{ai_tools, session_store, tool_result_budget, tool_result_store};
use crate::services::ai::{memory_models, memory_store};
use crate::services::ai::AiEngine;
use crate::services::storage::Storage;
use crate::utils::error::AppError;

/// AI 引擎状态类型
pub type AiEngineState = Arc<AiEngine>;

// ─────────────────────────────────── 流式对话 ───────────────────────────────────

/// 流式对话
///
/// 通过 Tauri Channel 将 AI 回复增量推送到前端。
#[tauri::command]
pub async fn ai_chat_stream(
    session_id: String,
    messages: Vec<ChatMessage>,
    provider_type: String,
    model: String,
    api_key: String,
    endpoint: String,
    max_tokens: Option<u32>,
    temperature: Option<f64>,
    system_prompt: Option<String>,
    enable_tools: Option<bool>,
    thinking_budget: Option<u32>,
    on_event: Channel<AiStreamEvent>,
    engine: State<'_, AiEngineState>,
    storage: State<'_, Arc<Storage>>,
) -> Result<ChatResult, AppError> {
    let tools_enabled = enable_tools.unwrap_or(false);
    let messages = sanitize_messages_for_request(messages, tools_enabled);

    log::info!(
        target: "ai.stream",
        "stream_start session={} model={} provider={} msg_count={} tools={}",
        session_id,
        model,
        provider_type,
        messages.len(),
        tools_enabled
    );
    // 工具定义
    let (tools, tool_choice) = if tools_enabled {
        (Some(ai_tools::get_tool_definitions()), Some("auto".to_string()))
    } else {
        (None, None)
    };

    let config = ChatConfig {
        model: model.clone(),
        max_tokens: max_tokens.unwrap_or(4096),
        temperature: temperature.unwrap_or(0.7),
        system_prompt,
        tools,
        tool_choice,
        thinking_budget,
    };

    // 查找 Provider
    let provider_id = if provider_type == "anthropic" {
        "anthropic"
    } else {
        "openai_compat"
    };

    let provider = engine
        .registry
        .get(provider_id)
        .ok_or_else(|| AppError::Other(format!("未找到 Provider: {provider_id}")))?;

    // 创建中断通道
    let abort_rx = engine.create_abort_channel(&session_id).await;

    // 执行流式对话
    let result = provider
        .chat_stream(messages, &config, &api_key, &endpoint, &on_event, abort_rx)
        .await;

    // 清理中断通道
    engine.cleanup_abort(&session_id).await;

    // 记录用量统计
    if let Ok(ref chat_result) = result {
        log::info!(
            target: "ai.stream",
            "stream_done session={} model={} prompt_tokens={} completion_tokens={} finish_reason={}",
            session_id,
            model,
            chat_result.prompt_tokens,
            chat_result.completion_tokens,
            chat_result.finish_reason,
        );
        let pool = storage.get_pool().await;
        // 计算费用（简单估算，后续可根据模型定价精确计算）
        let cost = 0.0; // V2 增加精确费用计算
        let _ = session_store::update_daily_usage(
            &pool,
            provider_id,
            &model,
            chat_result.prompt_tokens,
            chat_result.completion_tokens,
            cost,
        )
        .await;
    }

    result
}

fn sanitize_messages_for_request(messages: Vec<ChatMessage>, tools_enabled: bool) -> Vec<ChatMessage> {
    if tools_enabled {
        return messages;
    }

    messages
        .into_iter()
        .filter_map(|mut message| {
            if message.role == MessageRole::Tool {
                return None;
            }

            if message.role == MessageRole::Assistant {
                message.tool_calls = None;
            }

            Some(message)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::sanitize_messages_for_request;
    use crate::services::ai::models::{ChatMessage, MessageRole, ToolCallFunction, ToolCallRecord};

    #[test]
    fn strips_tool_context_when_tools_are_disabled() {
        let messages = vec![
            ChatMessage {
                role: MessageRole::User,
                content: Some("hello".to_string()),
                content_blocks: None,
                name: None,
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            },
            ChatMessage {
                role: MessageRole::Assistant,
                content: Some("I checked the file.".to_string()),
                content_blocks: None,
                name: None,
                tool_calls: Some(vec![ToolCallRecord {
                    id: "tool-1".to_string(),
                    call_type: "function".to_string(),
                    function: ToolCallFunction {
                        name: "read_file".to_string(),
                        arguments: "{\"path\":\"src/main.ts\"}".to_string(),
                    },
                }]),
                tool_call_id: None,
                reasoning_content: Some("thinking".to_string()),
            },
            ChatMessage {
                role: MessageRole::Tool,
                content: Some("file content".to_string()),
                content_blocks: None,
                name: Some("read_file".to_string()),
                tool_calls: None,
                tool_call_id: Some("tool-1".to_string()),
                reasoning_content: None,
            },
        ];

        let sanitized = sanitize_messages_for_request(messages, false);

        assert_eq!(sanitized.len(), 2);
        assert_eq!(sanitized[0].role, MessageRole::User);
        assert_eq!(sanitized[1].role, MessageRole::Assistant);
        assert!(sanitized[1].tool_calls.is_none());
        assert_eq!(sanitized[1].content.as_deref(), Some("I checked the file."));
        assert_eq!(sanitized[1].reasoning_content.as_deref(), Some("thinking"));
    }

    #[test]
    fn keeps_tool_context_when_tools_are_enabled() {
        let messages = vec![
            ChatMessage {
                role: MessageRole::Assistant,
                content: None,
                content_blocks: None,
                name: None,
                tool_calls: Some(vec![ToolCallRecord {
                    id: "tool-1".to_string(),
                    call_type: "function".to_string(),
                    function: ToolCallFunction {
                        name: "read_file".to_string(),
                        arguments: "{\"path\":\"src/main.ts\"}".to_string(),
                    },
                }]),
                tool_call_id: None,
                reasoning_content: None,
            },
            ChatMessage {
                role: MessageRole::Tool,
                content: Some("file content".to_string()),
                content_blocks: None,
                name: Some("read_file".to_string()),
                tool_calls: None,
                tool_call_id: Some("tool-1".to_string()),
                reasoning_content: None,
            },
        ];

        let sanitized = sanitize_messages_for_request(messages, true);

        assert_eq!(sanitized.len(), 2);
        assert!(sanitized[0].tool_calls.is_some());
        assert_eq!(sanitized[1].role, MessageRole::Tool);
    }
}

/// 中断流式生成
#[tauri::command]
pub async fn ai_abort_stream(
    session_id: String,
    engine: State<'_, AiEngineState>,
) -> Result<bool, AppError> {
    let aborted = engine.abort(&session_id).await;
    log::info!(target: "ai.stream", "stream_abort session={} hit={}", session_id, aborted);
    Ok(aborted)
}

// ─────────────────────────────────── Provider 管理 ───────────────────────────────────

/// 获取已配置的 Provider 列表
#[tauri::command]
pub async fn ai_list_providers(
    storage: State<'_, Arc<Storage>>,
) -> Result<Vec<ProviderConfig>, AppError> {
    let pool = storage.get_pool().await;
    session_store::list_providers(&pool).await
}

/// 保存 Provider 配置
#[tauri::command]
pub async fn ai_save_provider(
    config: ProviderConfig,
    storage: State<'_, Arc<Storage>>,
) -> Result<(), AppError> {
    let pool = storage.get_pool().await;
    session_store::save_provider(&pool, &config).await
}

/// 删除 Provider
#[tauri::command]
pub async fn ai_delete_provider(
    id: String,
    storage: State<'_, Arc<Storage>>,
) -> Result<(), AppError> {
    let pool = storage.get_pool().await;
    session_store::delete_provider(&pool, &id).await
}

// ─────────────────────────────────── 会话管理 ───────────────────────────────────

/// 保存会话
#[tauri::command]
pub async fn ai_save_session(
    session: AiSession,
    storage: State<'_, Arc<Storage>>,
) -> Result<(), AppError> {
    let pool = storage.get_pool().await;
    session_store::save_session(&pool, &session).await
}

/// 获取会话列表
#[tauri::command]
pub async fn ai_list_sessions(
    storage: State<'_, Arc<Storage>>,
) -> Result<Vec<AiSession>, AppError> {
    let pool = storage.get_pool().await;
    session_store::list_sessions(&pool).await
}

/// 获取单个会话（含消息）
#[tauri::command]
pub async fn ai_get_session(
    id: String,
    message_limit: Option<u32>,
    storage: State<'_, Arc<Storage>>,
) -> Result<Option<AiSessionDetail>, AppError> {
    let pool = storage.get_pool().await;
    let session = session_store::get_session(&pool, &id).await?;
    let total_records = session_store::count_messages(&pool, &id).await?;
    let requested_limit = message_limit
        .map(|value| value.max(1) as usize)
        .unwrap_or(0);

    match session {
        Some(s) => {
            let messages = if requested_limit > 0 {
                session_store::get_messages_recent(&pool, &id, requested_limit).await?
            } else {
                session_store::get_messages(&pool, &id).await?
            };
            let loaded_records = messages.len() as u32;
            Ok(Some(AiSessionDetail {
                session: s,
                messages,
                total_records,
                loaded_records,
                truncated: total_records > loaded_records,
            }))
        }
        None => {
            let messages = session_store::get_messages(&pool, &id).await?;
            if messages.is_empty() {
                return Ok(None);
            }
            let first_ts = messages.first().map(|m| m.created_at).unwrap_or_else(|| {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64
            });
            let last_ts = messages.last().map(|m| m.created_at).unwrap_or(first_ts);
            let title = messages
                .iter()
                .find(|m| m.role == "user")
                .map(|m| m.content.chars().take(20).collect::<String>())
                .unwrap_or_else(|| "Recovered Session".to_string());
            let skeleton = AiSession {
                id: id.clone(),
                title,
                provider_id: String::new(),
                model: String::new(),
                system_prompt: None,
                message_count: messages.len() as u32,
                total_tokens: 0,
                estimated_cost: 0.0,
                tags: None,
                created_at: first_ts,
                updated_at: last_ts,
                work_dir: None,
            };
            let _ = session_store::save_session(&pool, &skeleton).await;
            let loaded_messages = if requested_limit > 0 {
                session_store::get_messages_recent(&pool, &id, requested_limit).await?
            } else {
                messages
            };
            let loaded_records = loaded_messages.len() as u32;
            Ok(Some(AiSessionDetail {
                session: skeleton,
                messages: loaded_messages,
                total_records,
                loaded_records,
                truncated: total_records > loaded_records,
            }))
        }
    }
}

/// 删除会话
#[tauri::command]
pub async fn ai_delete_session(
    id: String,
    storage: State<'_, Arc<Storage>>,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let pool = storage.get_pool().await;
    session_store::delete_session(&pool, &id).await?;

    // 同步清理该会话产生的落盘工具结果
    if let Ok(dir) = app.path().app_data_dir() {
        if let Err(e) = tool_result_store::cleanup_session(&dir, &id).await {
            log::warn!("清理落盘工具结果失败（不影响删除）: {e}");
        }
    }
    Ok(())
}

/// 保存消息
#[tauri::command]
pub async fn ai_save_message(
    message: AiMessageRecord,
    storage: State<'_, Arc<Storage>>,
) -> Result<(), AppError> {
    let pool = storage.get_pool().await;
    session_store::save_message(&pool, &message).await
}

// ─────────────────────────────────── 用量统计 ───────────────────────────────────

/// 获取用量统计
#[tauri::command]
pub async fn ai_get_usage_stats(
    start_date: String,
    end_date: String,
    storage: State<'_, Arc<Storage>>,
) -> Result<Vec<DailyUsage>, AppError> {
    let pool = storage.get_pool().await;
    session_store::get_usage_stats(&pool, &start_date, &end_date).await
}

// ─────────────────────────────────── Tool Use ───────────────────────────────────

/// 获取可用工具定义列表
///
/// 前端用于判断是否启用 Tool Use 和构建 UI。
#[tauri::command]
pub async fn ai_get_tools() -> Vec<ToolDefinition> {
    ai_tools::get_tool_definitions()
}

/// 执行指定工具
///
/// 前端在 AI 返回 tool_calls 后调用此命令执行工具。
#[tauri::command]
pub async fn ai_execute_tool(
    name: String,
    arguments: String,
    work_dir: String,
    session_id: String,
    tool_call_id: String,
    app: tauri::AppHandle,
) -> Result<ai_tools::ToolExecResult, AppError> {
    log::info!(
        target: "ai.tool",
        "execute name={} session={} tool_call={} work_dir={}",
        name,
        session_id,
        tool_call_id,
        work_dir,
    );

    let app_data_dir = app.path().app_data_dir().ok();

    // 超时 30 秒
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        ai_tools::execute_tool(
            &name,
            &arguments,
            &work_dir,
            &session_id,
            &tool_call_id,
            app_data_dir.as_deref(),
        ),
    )
    .await;

    match result {
        Ok(exec_result) => Ok(exec_result),
        Err(_) => {
            log::warn!(target: "ai.tool", "timeout name={} session={} tool_call={}", name, session_id, tool_call_id);
            Ok(ai_tools::ToolExecResult {
                success: false,
                content: format!("工具执行超时（30秒限制）: {}", name),
            })
        }
    }
}

/// 对单轮并行工具结果执行累计预算检查
///
/// 前端在 `executeToolCalls` 完成后、将结果追加到消息链之前调用此命令。
/// 超出 `MAX_TOOL_RESULTS_PER_MESSAGE_CHARS` 时，从最大的开始落盘替换。
#[tauri::command]
pub async fn ai_enforce_tool_result_budget(
    session_id: String,
    results: Vec<tool_result_budget::ToolResultEntry>,
    app: tauri::AppHandle,
) -> Result<Vec<tool_result_budget::ToolResultEntry>, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("应用数据目录不可用: {e}")))?;
    tool_result_budget::enforce(&dir, &session_id, results).await
}

/// 读取完整落盘工具结果（供前端"查看完整"使用）
#[tauri::command]
pub async fn ai_read_tool_result_file(
    session_id: String,
    tool_call_id: String,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("应用数据目录不可用: {e}")))?;
    tool_result_store::read_full(&dir, &session_id, &tool_call_id).await
}

/// 回滚 write_file 工具调用（前端 Reject）
///
/// 使用 `write_snapshot` 模块保存的写入前快照恢复磁盘原状态：
/// - 原文件不存在 → 删除新写入的文件
/// - 原文件存在 → 写回原始字节
#[tauri::command]
pub async fn ai_revert_write_file(
    session_id: String,
    tool_call_id: String,
    target_path: String,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("应用数据目录不可用: {e}")))?;
    let path = std::path::PathBuf::from(&target_path);
    crate::services::ai::write_snapshot::revert_from_snapshot(
        &dir,
        &session_id,
        &tool_call_id,
        &path,
    )
    .await
}

// ─────────────────────────────────── 记忆系统 ───────────────────────────────────

#[tauri::command]
pub async fn ai_list_memories(
    storage: State<'_, Arc<Storage>>,
    workspace_id: String,
) -> Result<Vec<memory_models::AiMemory>, AppError> {
    let pool = storage.get_pool().await;
    memory_store::list_memories(&pool, &workspace_id).await
}

#[tauri::command]
pub async fn ai_save_memory(
    storage: State<'_, Arc<Storage>>,
    memory: memory_models::AiMemory,
) -> Result<(), AppError> {
    let pool = storage.get_pool().await;
    memory_store::save_memory(&pool, &memory).await
}

#[tauri::command]
pub async fn ai_delete_memory(
    storage: State<'_, Arc<Storage>>,
    id: String,
) -> Result<(), AppError> {
    let pool = storage.get_pool().await;
    memory_store::delete_memory(&pool, &id).await
}

#[tauri::command]
pub async fn ai_search_memories(
    storage: State<'_, Arc<Storage>>,
    workspace_id: String,
    keywords: Vec<String>,
) -> Result<Vec<memory_models::AiMemory>, AppError> {
    let pool = storage.get_pool().await;
    memory_store::search_memories(&pool, &workspace_id, &keywords).await
}

#[tauri::command]
pub async fn ai_save_compaction(
    storage: State<'_, Arc<Storage>>,
    compaction: memory_models::AiCompaction,
) -> Result<(), AppError> {
    let pool = storage.get_pool().await;
    memory_store::save_compaction(&pool, &compaction).await
}

#[tauri::command]
pub async fn ai_list_compactions(
    storage: State<'_, Arc<Storage>>,
    session_id: String,
) -> Result<Vec<memory_models::AiCompaction>, AppError> {
    let pool = storage.get_pool().await;
    memory_store::list_compactions(&pool, &session_id).await
}

// ─────────────────────────────────── Workspace 配置 ───────────────────────────────────

/// 读取工作区 .devforge/config.json
///
/// 返回 JSON 字符串；文件不存在时返回 None。
#[tauri::command]
pub async fn ai_read_workspace_config(root: String) -> Option<String> {
    let path = std::path::PathBuf::from(&root).join(".devforge").join("config.json");
    tokio::fs::read_to_string(&path).await.ok()
}

/// 写入工作区 .devforge/config.json（自动创建目录）
#[tauri::command]
pub async fn ai_write_workspace_config(root: String, content: String) -> Result<(), AppError> {
    let dir = std::path::PathBuf::from(&root).join(".devforge");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::Other(format!("创建 .devforge 目录失败: {e}")))?;
    tokio::fs::write(dir.join("config.json"), content.as_bytes())
        .await
        .map_err(|e| AppError::Other(format!("写入 config.json 失败: {e}")))
}

/// 读取工作区文件内容（供上下文注入使用）
///
/// 路径可以是绝对路径或相对于 root 的相对路径。截断到前 max_lines 行（默认 200）。
#[tauri::command]
pub async fn ai_read_context_file(
    root: String,
    path: String,
    max_lines: Option<usize>,
) -> Result<String, AppError> {
    let full_path = {
        let p = std::path::PathBuf::from(&path);
        if p.is_absolute() { p } else { std::path::PathBuf::from(&root).join(p) }
    };
    let content = tokio::fs::read_to_string(&full_path)
        .await
        .map_err(|e| AppError::Other(format!("读取上下文文件失败 {path}: {e}")))?;
    let limit = max_lines.unwrap_or(200);
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() > limit {
        Ok(format!("{}\n[已截断，共 {} 行]", lines[..limit].join("\n"), lines.len()))
    } else {
        Ok(content)
    }
}

/// 更新会话日志 .devforge/journal.md 中指定标记区间
///
/// 找到 `<!-- @@@auto:marker -->...<!-- @@@end:marker -->` 区间并替换内容。
/// 若文件不存在则创建；若标记不存在则追加。
#[tauri::command]
pub async fn ai_update_journal_section(
    root: String,
    marker: String,
    content: String,
) -> Result<(), AppError> {
    let dir = std::path::PathBuf::from(&root).join(".devforge");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::Other(format!("创建 .devforge 目录失败: {e}")))?;
    let journal_path = dir.join("journal.md");

    let existing = tokio::fs::read_to_string(&journal_path).await.unwrap_or_default();
    let open_tag = format!("<!-- @@@auto:{} -->", marker);
    let close_tag = format!("<!-- @@@end:{} -->", marker);

    let new_section = format!("{}\n{}\n{}", open_tag, content, close_tag);
    let new_content = if existing.contains(&open_tag) {
        // 替换现有区间
        let start = existing.find(&open_tag).unwrap();
        let end = existing.find(&close_tag).map(|i| i + close_tag.len()).unwrap_or(existing.len());
        format!("{}{}{}", &existing[..start], new_section, &existing[end..])
    } else {
        // 追加
        if existing.is_empty() {
            new_section
        } else {
            format!("{}\n\n{}", existing.trim_end(), new_section)
        }
    };

    tokio::fs::write(&journal_path, new_content.as_bytes())
        .await
        .map_err(|e| AppError::Other(format!("写入 journal.md 失败: {e}")))
}

/// 创建独立 AI 对话窗口
///
/// 每个窗口加载 /ai-standalone 路由，拥有独立 JS context。
/// 上限 5 个 AI 窗口。
#[tauri::command]
pub async fn create_ai_window(app: tauri::AppHandle) -> Result<String, String> {
    let ai_count = app
        .webview_windows()
        .keys()
        .filter(|k| k.starts_with("ai-"))
        .count();
    if ai_count >= 5 {
        return Err("最多同时打开 5 个 AI 窗口".into());
    }

    let window_id = format!("ai-{}", chrono::Utc::now().timestamp_millis());
    let url = format!("/ai-standalone?windowId={}", window_id);

    tauri::WebviewWindowBuilder::new(
        &app,
        &window_id,
        tauri::WebviewUrl::App(url.into()),
    )
    .title("AI 对话")
    .inner_size(800.0, 700.0)
    .min_inner_size(480.0, 400.0)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(window_id)
}
