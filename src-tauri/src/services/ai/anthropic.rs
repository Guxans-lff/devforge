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
use std::sync::Mutex;
use tauri::ipc::Channel;
use tokio::sync::watch;

use super::models::*;
use super::provider::AiProvider;
use crate::utils::error::AppError;

fn is_retryable_stream_error_type(error_type: &str) -> bool {
    matches!(error_type, "rate_limit_error" | "overloaded_error" | "api_error")
}

fn should_stop_after_event(event_type: &str) -> bool {
    matches!(event_type, "message_stop")
}

fn build_http_client() -> Client {
    Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .read_timeout(std::time::Duration::from_secs(300))
        .build()
        .expect("创建 HTTP 客户端失败")
}

/// Anthropic Provider
pub struct AnthropicProvider {
    /// Mutex 包装以便连接池坏死时原地替换（VPN 切换自愈）
    client: Mutex<Client>,
}

impl AnthropicProvider {
    pub fn new() -> Self {
        Self {
            client: Mutex::new(build_http_client()),
        }
    }

    /// 取当前 client 的克隆（reqwest::Client 内部是 Arc）
    fn current_client(&self) -> Client {
        self.client.lock().expect("client mutex poisoned").clone()
    }

    /// 丢弃旧 client，换成新 client（清空连接池）
    fn rebuild_client(&self) {
        let mut guard = self.client.lock().expect("client mutex poisoned");
        *guard = build_http_client();
    }

    fn supports_adaptive_thinking(model: &str) -> bool {
        let lower = model.to_lowercase();
        lower.contains("claude-opus-4-7")
            || lower.contains("claude-opus-4.7")
            || lower.contains("claude-opus-4-6")
            || lower.contains("claude-opus-4.6")
            || lower.contains("claude-sonnet-4-6")
            || lower.contains("claude-sonnet-4.6")
    }

    fn uses_opus_47_sampling_rules(model: &str) -> bool {
        let lower = model.to_lowercase();
        lower.contains("claude-opus-4-7") || lower.contains("claude-opus-4.7")
    }

    fn effort_for_thinking_budget(model: &str, budget: u32) -> &'static str {
        let lower = model.to_lowercase();
        let is_opus_47 =
            lower.contains("claude-opus-4-7") || lower.contains("claude-opus-4.7");

        match budget {
            0..=4095 => "low",
            4096..=8191 => "medium",
            8192..=16383 => "high",
            _ if is_opus_47 => "xhigh",
            _ => "max",
        }
    }

    fn summarize_request_messages(body: &serde_json::Value) -> String {
        let Some(messages) = body.get("messages").and_then(|v| v.as_array()) else {
            return "messages=<missing>".to_string();
        };

        messages
            .iter()
            .enumerate()
            .map(|(idx, msg)| {
                let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("?");
                let content = msg.get("content");
                let blocks = match content {
                    Some(serde_json::Value::Array(items)) => items
                        .iter()
                        .map(|item| {
                            let ty = item.get("type").and_then(|v| v.as_str()).unwrap_or("?");
                            match ty {
                                "tool_use" => format!(
                                    "tool_use:{}",
                                    item.get("id").and_then(|v| v.as_str()).unwrap_or("?")
                                ),
                                "tool_result" => format!(
                                    "tool_result:{}",
                                    item.get("tool_use_id").and_then(|v| v.as_str()).unwrap_or("?")
                                ),
                                other => other.to_string(),
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(","),
                    Some(serde_json::Value::String(_)) => "text".to_string(),
                    Some(_) => "other".to_string(),
                    None => "<missing>".to_string(),
                };
                format!("#{idx}:{role}[{blocks}]")
            })
            .collect::<Vec<_>>()
            .join(" | ")
    }

    /// 构建 Anthropic Messages API 请求体
    fn build_request_body(
        &self,
        messages: &[ChatMessage],
        config: &ChatConfig,
    ) -> serde_json::Value {
        let mut api_messages: Vec<serde_json::Value> = Vec::new();

        // 对话消息（Anthropic 不允许 system 角色出现在 messages 中）
        // 对 tool_result 的要求比 OpenAI 更严格：
        // assistant(tool_use) 后必须紧跟一条 user 消息，且该消息聚合同轮全部 tool_result blocks。
        let mut idx = 0usize;
        while idx < messages.len() {
            let msg = &messages[idx];
            match msg.role {
                MessageRole::System => {
                    idx += 1;
                }
                MessageRole::User => {
                    if let Some(ref content_blocks) = msg.content_blocks {
                        let api_blocks: Vec<serde_json::Value> = content_blocks
                            .iter()
                            .map(|block| match block {
                                ContentBlock::Text { text } => {
                                    serde_json::json!({ "type": "text", "text": text })
                                }
                                ContentBlock::Image { source } => {
                                    serde_json::json!({
                                        "type": "image",
                                        "source": {
                                            "type": source.source_type,
                                            "media_type": source.media_type,
                                            "data": source.data
                                        }
                                    })
                                }
                            })
                            .collect();

                        api_messages.push(serde_json::json!({
                            "role": "user",
                            "content": api_blocks
                        }));
                    } else {
                        api_messages.push(serde_json::json!({
                            "role": "user",
                            "content": msg.content.as_deref().unwrap_or("")
                        }));
                    }
                    idx += 1;
                }
                MessageRole::Assistant => {
                    if let Some(ref tool_calls) = msg.tool_calls {
                        let mut content_blocks: Vec<serde_json::Value> = Vec::new();
                        if let Some(ref text) = msg.content {
                            if !text.is_empty() {
                                content_blocks.push(serde_json::json!({
                                    "type": "text",
                                    "text": text
                                }));
                            }
                        }
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
                    idx += 1;
                }
                MessageRole::Tool => {
                    let mut tool_results: Vec<serde_json::Value> = Vec::new();
                    while idx < messages.len() && matches!(messages[idx].role, MessageRole::Tool) {
                        let tool_msg = &messages[idx];
                        tool_results.push(serde_json::json!({
                            "type": "tool_result",
                            "tool_use_id": tool_msg.tool_call_id.as_deref().unwrap_or(""),
                            "content": tool_msg.content.as_deref().unwrap_or("")
                        }));
                        idx += 1;
                    }

                    api_messages.push(serde_json::json!({
                        "role": "user",
                        "content": tool_results
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
        // 打 cache_control 标记：system + tools 整体缓存（Anthropic ephemeral 5 分钟）
        if let Some(ref system_prompt) = config.system_prompt {
            if !system_prompt.is_empty() {
                body["system"] = serde_json::json!([
                    {
                        "type": "text",
                        "text": system_prompt,
                        "cache_control": { "type": "ephemeral" }
                    }
                ]);
            }
        }

        // 温度
        if config.temperature > 0.0 {
            body["temperature"] = serde_json::json!(config.temperature);
        }

        // Extended Thinking（仅当模型支持且配置了预算时启用）
        // 启用时 Anthropic 要求 temperature 必须为 1.0，自动覆盖
        if let Some(budget) = config.thinking_budget {
            if budget >= 1024 {
                let caps = self.capabilities(&config.model);
                if caps.thinking {
                    if Self::supports_adaptive_thinking(&config.model) {
                        body["thinking"] = serde_json::json!({
                            "type": "adaptive"
                        });
                        body["output_config"] = serde_json::json!({
                            "effort": Self::effort_for_thinking_budget(&config.model, budget)
                        });
                        if Self::uses_opus_47_sampling_rules(&config.model) {
                            if let Some(obj) = body.as_object_mut() {
                                obj.remove("temperature");
                            }
                        }
                    } else {
                        body["thinking"] = serde_json::json!({
                            "type": "enabled",
                            "budget_tokens": budget
                        });
                        body["temperature"] = serde_json::json!(1.0);
                    }
                }
            }
        }

        // 工具定义（转换为 Anthropic 格式）
        if let Some(ref tools) = config.tools {
            if !tools.is_empty() {
                let last_idx = tools.len() - 1;
                let anthropic_tools: Vec<serde_json::Value> = tools
                    .iter()
                    .enumerate()
                    .map(|(i, t)| {
                        let mut v = serde_json::json!({
                            "name": t.function.name,
                            "description": t.function.description,
                            "input_schema": t.function.parameters
                        });
                        // 最后一个 tool 标记 cache_control，覆盖整段 tools 数组
                        if i == last_idx {
                            v["cache_control"] = serde_json::json!({ "type": "ephemeral" });
                        }
                        v
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

    fn capabilities(&self, model: &str) -> ModelCapabilities {
        // claude-3.7 / claude-sonnet-4 / claude-opus-4 系列原生支持 Extended Thinking
        let lower = model.to_lowercase();
        let supports_thinking = lower.contains("claude-3-7")
            || lower.contains("claude-3.7")
            || lower.contains("claude-sonnet-4")
            || lower.contains("claude-opus-4")
            || lower.contains("claude-haiku-4");
        ModelCapabilities {
            streaming: true,
            vision: true,
            thinking: supports_thinking,
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
        log::debug!(
            "Anthropic request summary: {}",
            Self::summarize_request_messages(&body)
        );

        let response = super::http_retry::send_with_rebuild(
            || {
                self.current_client()
                    .post(&url)
                    .header("x-api-key", api_key)
                    .header("anthropic-version", "2023-06-01")
                    .header("Content-Type", "application/json")
                    .json(&body)
            },
            || self.rebuild_client(),
        )
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

            log::warn!(
                "Anthropic API error status={} model={} summary={} body={}",
                status.as_u16(),
                config.model,
                Self::summarize_request_messages(&body),
                error_body
            );

            let msg = format!("{} ({})", readable_msg, status.as_u16());
            let _ = on_event.send(AiStreamEvent::Error {
                message: msg.clone(),
                retryable: super::http_retry::is_retryable_status(status),
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
        let mut cache_read_tokens: u32 = 0;
        let mut finish_reason = String::from("stop");

        // 工具调用累积
        let mut current_tool_id = String::new();
        let mut current_tool_name = String::new();
        let mut current_tool_input = String::new();
        let mut in_tool_use = false;
        let mut stream_done = false;

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
                                        // 提取 input_tokens + cache 命中
                                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) {
                                            if let Some(usage) = v.get("message").and_then(|m| m.get("usage")) {
                                                prompt_tokens = usage.get("input_tokens")
                                                    .and_then(|t| t.as_u64())
                                                    .unwrap_or(0) as u32;
                                                cache_read_tokens = usage.get("cache_read_input_tokens")
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
                                                    cache_read_tokens,
                                                });
                                            }
                                        }
                                    }
                                    "message_stop" => {
                                        let _ = on_event.send(AiStreamEvent::Done {
                                            finish_reason: finish_reason.clone(),
                                        });
                                        stream_done = true;
                                    }
                                    "error" => {
                                        let error_payload = serde_json::from_str::<serde_json::Value>(&data).ok();
                                        let error_msg = error_payload
                                            .as_ref()
                                            .and_then(|v| v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).map(|s| s.to_string()))
                                            .unwrap_or_else(|| data.clone());
                                        let retryable = error_payload
                                            .as_ref()
                                            .and_then(|v| v.get("error").and_then(|e| e.get("type")).and_then(|t| t.as_str()))
                                            .map(is_retryable_stream_error_type)
                                            .unwrap_or(false);
                                        let _ = on_event.send(AiStreamEvent::Error {
                                            message: error_msg.clone(),
                                            retryable,
                                        });
                                        let _ = on_event.send(AiStreamEvent::Done {
                                            finish_reason: "error".to_string(),
                                        });
                                        return Err(AppError::Other(error_msg));
                                    }
                                    _ => {} // ping 等忽略
                                }

                                if should_stop_after_event(&event_type) {
                                    break;
                                }
                            }
                            if stream_done {
                                break;
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
            if stream_done {
                break;
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

    async fn completion(
        &self,
        _model: &str,
        _prompt: &str,
        _suffix: Option<&str>,
        _api_key: &str,
        _endpoint: &str,
        _max_tokens: u32,
        _temperature: f64,
        _use_beta: bool,
    ) -> Result<CompletionResult, AppError> {
        Err(AppError::Validation("Anthropic 协议不支持 /completions 补全接口".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::{is_retryable_stream_error_type, should_stop_after_event};

    #[test]
    fn marks_retryable_anthropic_stream_error_types() {
        assert!(is_retryable_stream_error_type("rate_limit_error"));
        assert!(is_retryable_stream_error_type("overloaded_error"));
        assert!(is_retryable_stream_error_type("api_error"));
        assert!(!is_retryable_stream_error_type("invalid_request_error"));
        assert!(!is_retryable_stream_error_type("authentication_error"));
    }

    #[test]
    fn stops_only_after_message_stop_event() {
        assert!(should_stop_after_event("message_stop"));
        assert!(!should_stop_after_event("message_delta"));
        assert!(!should_stop_after_event("content_block_delta"));
    }
}
