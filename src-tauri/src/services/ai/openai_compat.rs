//! OpenAI 兼容 Provider
//!
//! 统一实现 OpenAI Chat Completions API 协议，覆盖：
//! - OpenAI（GPT 系列）
//! - DeepSeek
//! - 智普（GLM）
//! - Moonshot（Kimi）
//! - Qwen（通义千问）
//! - 任意 OpenAI 兼容端点

use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use tauri::ipc::Channel;
use tokio::sync::watch;

use super::models::*;
use super::provider::AiProvider;
use super::stream_parser;
use crate::utils::error::AppError;

/// OpenAI 兼容 Provider
pub struct OpenAiCompatProvider {
    /// HTTP 客户端（复用连接池）
    client: Client,
}

impl OpenAiCompatProvider {
    pub fn new() -> Self {
        let client = Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            .read_timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("创建 HTTP 客户端失败");

        Self { client }
    }

    /// 构建 OpenAI Chat Completions 请求体
    fn build_request_body(
        &self,
        messages: &[ChatMessage],
        config: &ChatConfig,
    ) -> serde_json::Value {
        let mut api_messages: Vec<serde_json::Value> = Vec::new();

        // 系统提示词
        if let Some(ref system_prompt) = config.system_prompt {
            if !system_prompt.is_empty() {
                api_messages.push(serde_json::json!({
                    "role": "system",
                    "content": system_prompt
                }));
            }
        }

        // 对话消息
        for msg in messages {
            let role = match msg.role {
                MessageRole::System => "system",
                MessageRole::User => "user",
                MessageRole::Assistant => "assistant",
                MessageRole::Tool => "tool",
            };

            match msg.role {
                // Tool 角色：必须携带 tool_call_id
                MessageRole::Tool => {
                    let mut obj = serde_json::json!({
                        "role": "tool",
                        "content": msg.content.as_deref().unwrap_or("")
                    });
                    if let Some(ref id) = msg.tool_call_id {
                        obj["tool_call_id"] = serde_json::json!(id);
                    }
                    if let Some(ref name) = msg.name {
                        obj["name"] = serde_json::json!(name);
                    }
                    api_messages.push(obj);
                }
                // Assistant 可能携带 tool_calls（此时 content 可能为 null）
                MessageRole::Assistant => {
                    let mut obj = serde_json::json!({ "role": role });
                    // content 字段：有值则填，无值填 null（OpenAI 要求 assistant 消息必须有 content 字段）
                    match &msg.content {
                        Some(c) => obj["content"] = serde_json::json!(c),
                        None => obj["content"] = serde_json::Value::Null,
                    }
                    if let Some(ref tool_calls) = msg.tool_calls {
                        obj["tool_calls"] = serde_json::to_value(tool_calls)
                            .unwrap_or(serde_json::Value::Array(vec![]));
                    }
                    api_messages.push(obj);
                }
                // System / User：普通消息
                _ => {
                    api_messages.push(serde_json::json!({
                        "role": role,
                        "content": msg.content.as_deref().unwrap_or("")
                    }));
                }
            }
        }

        let mut body = serde_json::json!({
            "model": config.model,
            "messages": api_messages,
            "max_tokens": config.max_tokens,
            "temperature": config.temperature,
            "stream": true,
            "stream_options": { "include_usage": true }
        });

        // 工具定义
        if let Some(ref tools) = config.tools {
            if !tools.is_empty() {
                body["tools"] = serde_json::to_value(tools)
                    .unwrap_or(serde_json::Value::Array(vec![]));
            }
        }
        if let Some(ref choice) = config.tool_choice {
            body["tool_choice"] = serde_json::json!(choice);
        }

        body
    }
}

#[async_trait]
impl AiProvider for OpenAiCompatProvider {
    fn id(&self) -> &str {
        "openai_compat"
    }

    fn capabilities(&self, _model: &str) -> ModelCapabilities {
        // 默认能力，实际应从 ProviderConfig 的 models 中查找
        ModelCapabilities::default()
    }

    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        config: &ChatConfig,
        api_key: &str,
        endpoint: &str,
        on_event: &Channel<AiStreamEvent>,
        mut abort_rx: watch::Receiver<bool>,
    ) -> Result<ChatResult, AppError> {
        let body = self.build_request_body(&messages, config);
        let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));

        log::info!("AI 请求: {} model={}", url, config.model);

        let builder = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body);

        let response = super::http_retry::send_with_backoff(builder)
            .await
            .map_err(|e| AppError::Connection(format!("AI API 请求失败: {e}")))?;

        // 检查 HTTP 状态码
        if !response.status().is_success() {
            let status = response.status();
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "无法读取响应体".to_string());

            // 尝试从 OpenAI 标准错误格式中提取可读消息
            // 格式: {"error": {"message": "...", "type": "...", "code": "..."}, "status": 401}
            let readable_msg = serde_json::from_str::<serde_json::Value>(&error_body)
                .ok()
                .and_then(|v| {
                    v.get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| error_body.chars().take(200).collect());

            let msg = format!("{} ({})", readable_msg, status.as_u16());
            let _ = on_event.send(AiStreamEvent::Error {
                message: msg.clone(),
                retryable: status.is_server_error(),
            });
            return Err(AppError::Other(msg));
        }

        // 解析 SSE 流
        let mut event_stream = Box::pin(stream_parser::parse_sse_stream(response).await);
        let mut full_content = String::new();
        let mut full_thinking = String::new();
        let mut prompt_tokens: u32 = 0;
        let mut completion_tokens: u32 = 0;
        let mut finish_reason = String::from("stop");

        loop {
            tokio::select! {
                // 检查中断信号
                _ = abort_rx.changed() => {
                    if *abort_rx.borrow() {
                        let _ = on_event.send(AiStreamEvent::Done {
                            finish_reason: "abort".to_string(),
                        });
                        return Ok(ChatResult {
                            content: full_content,
                            model: config.model.clone(),
                            prompt_tokens,
                            completion_tokens,
                            finish_reason: "abort".to_string(),
                        });
                    }
                }
                // 处理 SSE 事件
                maybe_events = event_stream.next() => {
                    match maybe_events {
                        Some(events) => {
                            for event in events {
                                match &event {
                                    AiStreamEvent::TextDelta { delta } => {
                                        full_content.push_str(delta);
                                    }
                                    AiStreamEvent::ThinkingDelta { delta } => {
                                        full_thinking.push_str(delta);
                                    }
                                    AiStreamEvent::Usage { prompt_tokens: pt, completion_tokens: ct, .. } => {
                                        prompt_tokens = *pt;
                                        completion_tokens = *ct;
                                    }
                                    AiStreamEvent::Done { finish_reason: fr } => {
                                        finish_reason = fr.clone();
                                    }
                                    _ => {}
                                }
                                // 推送到前端
                                let _ = on_event.send(event);
                            }
                        }
                        None => break, // 流结束
                    }
                }
            }
        }

        Ok(ChatResult {
            content: full_content,
            model: config.model.clone(),
            prompt_tokens,
            completion_tokens,
            finish_reason,
        })
    }
}
