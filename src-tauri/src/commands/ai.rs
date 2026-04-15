//! AI 对话相关 Tauri 命令
//!
//! 提供前端调用的命令接口，包括流式对话、中断、会话管理、Provider 管理、用量统计。

use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::State;

use crate::services::ai::models::*;
use crate::services::ai::{ai_tools, session_store};
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
    on_event: Channel<AiStreamEvent>,
    engine: State<'_, AiEngineState>,
    storage: State<'_, Arc<Storage>>,
) -> Result<ChatResult, AppError> {
    // 工具定义
    let (tools, tool_choice) = if enable_tools.unwrap_or(false) {
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

/// 中断流式生成
#[tauri::command]
pub async fn ai_abort_stream(
    session_id: String,
    engine: State<'_, AiEngineState>,
) -> Result<bool, AppError> {
    Ok(engine.abort(&session_id).await)
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
    storage: State<'_, Arc<Storage>>,
) -> Result<Option<(AiSession, Vec<AiMessageRecord>)>, AppError> {
    let pool = storage.get_pool().await;
    let session = session_store::get_session(&pool, &id).await?;

    match session {
        Some(s) => {
            let messages = session_store::get_messages(&pool, &id).await?;
            Ok(Some((s, messages)))
        }
        None => Ok(None),
    }
}

/// 删除会话
#[tauri::command]
pub async fn ai_delete_session(
    id: String,
    storage: State<'_, Arc<Storage>>,
) -> Result<(), AppError> {
    let pool = storage.get_pool().await;
    session_store::delete_session(&pool, &id).await
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
) -> Result<ai_tools::ToolExecResult, AppError> {
    log::info!("AI 工具调用: {} | 工作目录: {}", name, work_dir);

    // 超时 30 秒
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        ai_tools::execute_tool(&name, &arguments, &work_dir),
    )
    .await;

    match result {
        Ok(exec_result) => Ok(exec_result),
        Err(_) => Ok(ai_tools::ToolExecResult {
            success: false,
            content: format!("工具执行超时（30秒限制）: {}", name),
        }),
    }
}
