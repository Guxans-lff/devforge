//! Anthropic Messages API Provider
//!
//! 实现 Anthropic 原生协议（Claude 系列模型），支持：
//! - POST /v1/messages
//! - x-api-key 认证
//! - SSE 流式响应（content_block_delta 等）
//! - 思考过程（thinking）
//! - 工具调用（tool_use）

use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use tauri::ipc::Channel;
use tokio::sync::watch;

use super::models::*;
use super::provider::AiProvider;
use crate::utils::error::AppError;

/// Anthropic Provider
pub struct AnthropicProvider {
    client: Client,
}

impl AnthropicProvider {
    pub fn new() -> Self {
        let client = Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            .read_timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("创建 HTTP 客户端失败");

        Self { client }
    }

    /// 构建 Anthropic Messages API 请求体
    fn build_request_body(
        &self,
        messages: &[ChatMessage],
        config: &ChatConfig,
    ) -> serde_json::Value {
        let mut api_messages: Vec<serde_json::Value> = Vec::new();

        // 对话消息（Anthropic 不允许 system 角色出现在 messages 中）
        for msg in messages {
            match msg.role {
                MessageRole::System => {
                    // 跳过，system 通过顶级 system 字段传递
                }
                MessageRole::User => {
                    api_messages.push(serde_json::json!({
                        "role": "user",
                        "content": msg.content.as_deref().unwrap_or("")
                    }));
                }
                MessageRole::Assistant => {
                    // Assistant 可能携带 tool_use content blocks
                    if let Some(ref tool_calls) = msg.tool_calls {
                        let mut content_blocks: Vec<serde_json::Value> = Vec::new();
                        // 先加文本（如果有）
                        if let Some(ref text) = msg.content {
                            if !text.is_empty() {
                                content_blocks.push(serde_json::json!({
                                    "type": "text",
                                    "text": text
                                }));
                            }
                        }
                        // 再加 tool_use blocks
                        for tc in tool_calls {
                            let args: serde_json::Value =
                                serde_json::from_str(&tc.function.arguments)
                                    .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
                            content_blocks.push(serde_json::json!({
                                "type": "tool_use",
                                "id": tc.id,
                                "name": tc.function.name,
                                "input": args
                            }));
                        }
                        api_messages.push(serde_json::json!({
                            "role": "assistant",
                            "content": content_blocks
                        }));
                    } else {
                        api_messages.push(serde_json::json!({
                            "role": "assistant",
                            "content": msg.content.as_deref().unwrap_or("")
                        }));
                    }
                }
                MessageRole::Tool => {
                    // Anthropic: tool_result 是 user 角色的 content block
                    api_messages.push(serde_json::json!({
                        "role": "user",
                        "content": [{
                            "type": "tool_result",
                            "tool_use_id": msg.tool_call_id.as_deref().unwrap_or(""),
                            "content": msg.content.as_deref().unwrap_or("")
                        }]
                    }));
                }
            }
        }

        let mut body = serde_json::json!({
            "model": config.model,
            "max_tokens": config.max_tokens,
            "messages": api_messages,
            "stream": true
        });

        // 系统提示词（顶级 system 字段）
        if let Some(ref system_prompt) = config.system_prompt {
            if !system_prompt.is_empty() {
                body["system"] = serde_json::json!(system_prompt);
            }
        }

        // 温度
        if config.temperature > 0.0 {
            body["temperature"] = serde_json::json!(config.temperature);
        }

        // 工具定义（转换为 Anthropic 格式）
        if let Some(ref tools) = config.tools {
            if !tools.is_empty() {
                let anthropic_tools: Vec<serde_json::Value> = tools
                    .iter()
                    .map(|t| {
                        serde_json::json!({
                            "name": t.function.name,
                            "description": t.function.description,
                            "input_schema": t.function.parameters
                        })
                    })
                    .collect();
                body["tools"] = serde_json::json!(anthropic_tools);
            }
        }
        if let Some(ref choice) = config.tool_choice {
            body["tool_choice"] = match choice.as_str() {
                "auto" => serde_json::json!({"type": "auto"}),
                "none" => serde_json::json!({"type": "none"}),
                _ => serde_json::json!({"type": "auto"}),
            };
        }

        body
    }
}

// ─────────────────────── Anthropic SSE 事件解析 ───────────────────────

/// Anthropic SSE 行解析器（复用字节缓冲区策略）
struct AnthropicSseParser {
    byte_buf: Vec<u8>,
    current_event_type: Option<String>,
}

impl AnthropicSseParser {
    fn new() -> Self {
        Self {
            byte_buf: Vec::with_capacity(4096),
            current_event_type: None,
        }
    }

    /// 喂入字节块，返回解析出的 (event_type, data) 对
    fn feed(&mut self, chunk: &[u8]) -> Vec<(String, String)> {
        self.byte_buf.extend_from_slice(chunk);
        let mut events = Vec::new();

        loop {
            let newline_pos = match self.byte_buf.iter().position(|&b| b == b'\n') {
                Some(pos) => pos,
                None => break,
            };

            let line_bytes: Vec<u8> = self.byte_buf.drain(..=newline_pos).collect();
            let line_end = if line_bytes.len() >= 2 && line_bytes[line_bytes.len() - 2] == b'\r' {
                line_bytes.len() - 2
            } else {
                line_bytes.len() - 1
            };
            let line_slice = &line_bytes[..line_end];

            if line_slice.is_empty() {
                continue;
            }

            let line = match std::str::from_utf8(line_slice) {
                Ok(s) => s,
                Err(_) => continue,
            };

            if let Some(event_type) = line.strip_prefix("event: ") {
                self.current_event_type = Some(event_type.to_string());
            } else if let Some(data) = line.strip_prefix("data: ") {
                let event_type = self.current_event_type.take().unwrap_or_default();
                events.push((event_type, data.to_string()));
            }
        }

        events
    }
}

#[async_trait]
impl AiProvider for AnthropicProvider {
    fn id(&self) -> &str {
        "anthropic"
    }

    fn capabilities(&self, _model: &str) -> ModelCapabilities {
        ModelCapabilities {
            streaming: true,
            vision: true,
            thinking: false,
            tool_use: true,
            max_context: 200000,
            max_output: 8192,
            pricing: None,
        }
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
        let url = format!("{}/v1/messages", endpoint.trim_end_matches('/'));

        log::info!("Anthropic 请求: {} model={}", url, config.model);

        let response = self
            .client
            .post(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Connection(format!("Anthropic API 请求失败: {e}")))?;

        // 检查 HTTP 状态码
        if !response.status().is_success() {
            let status = response.status();
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "无法读取响应体".to_string());

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

        // 解析 Anthropic SSE 流
        let mut parser = AnthropicSseParser::new();
        let mut byte_stream = response.bytes_stream();
        let mut full_content = String::new();
        let mut full_thinking = String::new();
        let mut prompt_tokens: u32 = 0;
        let mut completion_tokens: u32 = 0;
        let mut finish_reason = String::from("stop");

        // 工具调用累积
        let mut current_tool_id = String::new();
        let mut current_tool_name = String::new();
        let mut current_tool_input = String::new();
        let mut in_tool_use = false;

        loop {
            tokio::select! {
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
                maybe_bytes = byte_stream.next() => {
                    match maybe_bytes {
                        Some(Ok(bytes)) => {
                            let events = parser.feed(&bytes);

                            for (event_type, data) in events {
                                match event_type.as_str() {
                                    "message_start" => {
                                        // 提取 input_tokens
                                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) {
                                            if let Some(usage) = v.get("message").and_then(|m| m.get("usage")) {
                                                prompt_tokens = usage.get("input_tokens")
                                                    .and_then(|t| t.as_u64())
                                                    .unwrap_or(0) as u32;
                                            }
                                        }
                                    }
                                    "content_block_start" => {
                                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) {
                                            if let Some(cb) = v.get("content_block") {
                                                let block_type = cb.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                                if block_type == "tool_use" {
                                                    in_tool_use = true;
                                                    current_tool_id = cb.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
                                                    current_tool_name = cb.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                                                    current_tool_input.clear();
                                                } else if block_type == "thinking" {
                                                    // thinking block 开始
                                                }
                                            }
                                        }
                                    }
                                    "content_block_delta" => {
                                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) {
                                            if let Some(delta) = v.get("delta") {
                                                let delta_type = delta.get("type").and_then(|t| t.as_str()).unwrap_or("");

                                                match delta_type {
                                                    "text_delta" => {
                                                        if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                                                            full_content.push_str(text);
                                                            let _ = on_event.send(AiStreamEvent::TextDelta {
                                                                delta: text.to_string(),
                                                            });
                                                        }
                                                    }
                                                    "thinking_delta" => {
                                                        if let Some(thinking) = delta.get("thinking").and_then(|t| t.as_str()) {
                                                            full_thinking.push_str(thinking);
                                                            let _ = on_event.send(AiStreamEvent::ThinkingDelta {
                                                                delta: thinking.to_string(),
                                                            });
                                                        }
                                                    }
                                                    "input_json_delta" => {
                                                        if let Some(partial) = delta.get("partial_json").and_then(|p| p.as_str()) {
                                                            current_tool_input.push_str(partial);
                                                        }
                                                    }
                                                    _ => {}
                                                }
                                            }
                                        }
                                    }
                                    "content_block_stop" => {
                                        if in_tool_use {
                                            // 输出完整的 ToolCall 事件
                                            let _ = on_event.send(AiStreamEvent::ToolCall {
                                                id: current_tool_id.clone(),
                                                name: current_tool_name.clone(),
                                                arguments: current_tool_input.clone(),
                                            });
                                            in_tool_use = false;
                                            finish_reason = "tool_calls".to_string();
                                        }
                                    }
                                    "message_delta" => {
                                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) {
                                            if let Some(delta) = v.get("delta") {
                                                if let Some(reason) = delta.get("stop_reason").and_then(|r| r.as_str()) {
                                                    finish_reason = match reason {
                                                        "end_turn" => "stop".to_string(),
                                                        "tool_use" => "tool_calls".to_string(),
                                                        other => other.to_string(),
                                                    };
                                                }
                                            }
                                            if let Some(usage) = v.get("usage") {
                                                completion_tokens = usage.get("output_tokens")
                                                    .and_then(|t| t.as_u64())
                                                    .unwrap_or(0) as u32;
                                                let _ = on_event.send(AiStreamEvent::Usage {
                                                    prompt_tokens,
                                                    completion_tokens,
                                                });
                                            }
                                        }
                                    }
                                    "message_stop" => {
                                        let _ = on_event.send(AiStreamEvent::Done {
                                            finish_reason: finish_reason.clone(),
                                        });
                                    }
                                    "error" => {
                                        let error_msg = serde_json::from_str::<serde_json::Value>(&data)
                                            .ok()
                                            .and_then(|v| v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).map(|s| s.to_string()))
                                            .unwrap_or_else(|| data.clone());
                                        let _ = on_event.send(AiStreamEvent::Error {
                                            message: error_msg.clone(),
                                            retryable: false,
                                        });
                                        let _ = on_event.send(AiStreamEvent::Done {
                                            finish_reason: "error".to_string(),
                                        });
                                        return Err(AppError::Other(error_msg));
                                    }
                                    _ => {} // ping 等忽略
                                }
                            }
                        }
                        Some(Err(e)) => {
                            log::error!("Anthropic SSE 流读取失败: {e}");
                            let _ = on_event.send(AiStreamEvent::Error {
                                message: format!("流读取失败: {e}"),
                                retryable: true,
                            });
                            let _ = on_event.send(AiStreamEvent::Done {
                                finish_reason: "error".to_string(),
                            });
                            break;
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
