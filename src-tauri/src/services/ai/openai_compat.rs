//! OpenAI 兼容 Provider
//!
//! 统一实现 OpenAI Chat Completions API 协议，覆盖：
//! - OpenAI（GPT 系列，GPT-5+ 自动走 Responses API）
//! - DeepSeek
//! - 智普（GLM）
//! - Moonshot（Kimi）
//! - Qwen（通义千问）
//! - 任意 OpenAI 兼容端点

use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tokio::sync::watch;

use super::models::*;
use super::provider::AiProvider;
use super::stream_parser;
use crate::utils::error::AppError;

/// 检测模型是否需要走 OpenAI Responses API（GPT-5 / o3 / o4 系列）
fn is_responses_api_model(model: &str) -> bool {
    let m = model.to_lowercase();
    m.starts_with("gpt-5") || m.starts_with("o3") || m.starts_with("o4")
}

/// OpenAI 兼容 Provider
pub struct OpenAiCompatProvider {
    /// HTTP 客户端；Mutex 包装以便连接池坏死时原地替换（VPN 切换自愈）
    client: Mutex<Client>,
}

fn build_http_client() -> Client {
    Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .read_timeout(std::time::Duration::from_secs(120))
        .build()
        .expect("创建 HTTP 客户端失败")
}

impl OpenAiCompatProvider {
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
                    // 回传 reasoning_content（MiMo / DeepSeek 要求）
                    if let Some(ref rc) = msg.reasoning_content {
                        if !rc.is_empty() {
                            obj["reasoning_content"] = serde_json::json!(rc);
                        }
                    }
                    api_messages.push(obj);
                }
                // User：支持多模态内容块
                MessageRole::User => {
                    if let Some(ref content_blocks) = msg.content_blocks {
                        // OpenAI 格式的内容块
                        let api_content: Vec<serde_json::Value> = content_blocks
                            .iter()
                            .map(|block| match block {
                                ContentBlock::Text { text } => {
                                    serde_json::json!({ "type": "text", "text": text })
                                }
                                ContentBlock::Image { source } => {
                                    serde_json::json!({
                                        "type": "image_url",
                                        "image_url": {
                                            "url": format!("data:{};base64,{}",
                                                source.media_type, source.data)
                                        }
                                    })
                                }
                            })
                            .collect();

                        api_messages.push(serde_json::json!({
                            "role": "user",
                            "content": api_content
                        }));
                    } else {
                        // 保持现有的文本处理逻辑
                        api_messages.push(serde_json::json!({
                            "role": "user",
                            "content": msg.content.as_deref().unwrap_or("")
                        }));
                    }
                }
                // System：普通文本消息
                MessageRole::System => {
                    api_messages.push(serde_json::json!({
                        "role": "system",
                        "content": msg.content.as_deref().unwrap_or("")
                    }));
                }
            }
        }

        let mut body = serde_json::json!({
            "model": config.model,
            "messages": api_messages,
            "max_completion_tokens": config.max_tokens,
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

    /// 构建 OpenAI Responses API 请求体
    ///
    /// Responses API 格式与 Chat Completions 差异：
    /// - URL: /v1/responses
    /// - 字段: input (非 messages), instructions (非 system)
    /// - tool result: { type: "function_call_output", call_id, output }
    /// - tool call (assistant): { type: "function_call", call_id, name, arguments }
    fn build_responses_body(
        &self,
        messages: &[ChatMessage],
        config: &ChatConfig,
    ) -> serde_json::Value {
        let mut input: Vec<serde_json::Value> = Vec::new();

        for msg in messages {
            match msg.role {
                MessageRole::System => {
                    // 系统消息在 Responses API 里通过 instructions 字段传，input 里跳过
                }
                MessageRole::User => {
                    input.push(serde_json::json!({
                        "role": "user",
                        "content": msg.content.as_deref().unwrap_or("")
                    }));
                }
                MessageRole::Assistant => {
                    if let Some(ref tool_calls) = msg.tool_calls {
                        // 每个 tool_call 单独作为一个 function_call 输入项
                        for tc in tool_calls {
                            input.push(serde_json::json!({
                                "type": "function_call",
                                "call_id": tc.id,
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            }));
                        }
                    } else {
                        let content = msg.content.as_deref().unwrap_or("");
                        if !content.is_empty() {
                            input.push(serde_json::json!({
                                "role": "assistant",
                                "content": content
                            }));
                        }
                    }
                }
                MessageRole::Tool => {
                    // tool result → function_call_output
                    input.push(serde_json::json!({
                        "type": "function_call_output",
                        "call_id": msg.tool_call_id.as_deref().unwrap_or(""),
                        "output": msg.content.as_deref().unwrap_or("")
                    }));
                }
            }
        }

        let mut body = serde_json::json!({
            "model": config.model,
            "input": input,
            "max_output_tokens": config.max_tokens,
            "stream": true,
            "store": false,
        });

        // 系统提示词 → instructions
        if let Some(ref sp) = config.system_prompt {
            if !sp.is_empty() {
                body["instructions"] = serde_json::json!(sp);
            }
        }

        // 工具定义（Responses API 格式与 Chat Completions 相同）
        if let Some(ref tools) = config.tools {
            if !tools.is_empty() {
                body["tools"] = serde_json::to_value(tools)
                    .unwrap_or(serde_json::Value::Array(vec![]));
            }
        }
        if config.tools.as_ref().map(|t| !t.is_empty()).unwrap_or(false) {
            body["tool_choice"] = serde_json::json!("auto");
        }

        body
    }

    /// Chat Completions API 流式对话（旧格式，兼容绝大多数模型）
    async fn chat_stream_completions(
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

        let tools_bytes = config
            .tools
            .as_ref()
            .map(|t| serde_json::to_string(t).map(|s| s.len()).unwrap_or(0))
            .unwrap_or(0);
        let body_bytes = serde_json::to_string(&body).map(|s| s.len()).unwrap_or(0);
        log::info!("AI 请求(completions): {} model={} msg_count={} max_tokens={} tools_bytes={} body_bytes={}",
            url, config.model, messages.len(), config.max_tokens, tools_bytes, body_bytes);
        log::debug!("AI 请求体: {}", serde_json::to_string(&body).unwrap_or_default());

        let t_request_start = std::time::Instant::now();

        let response = super::http_retry::send_with_rebuild(
            || {
                self.current_client()
                    .post(&url)
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("Content-Type", "application/json")
                    .json(&body)
            },
            || self.rebuild_client(),
        )
        .await
        .map_err(|e| AppError::Connection(format!("AI API 请求失败: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_body = response.text().await.unwrap_or_else(|_| "无法读取响应体".to_string());
            let readable_msg = serde_json::from_str::<serde_json::Value>(&error_body)
                .ok()
                .and_then(|v| v.get("error")?.get("message")?.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| error_body.chars().take(200).collect());
            let msg = format!("{} ({})", readable_msg, status.as_u16());
            let _ = on_event.send(AiStreamEvent::Error { message: msg.clone(), retryable: status.is_server_error() });
            return Err(AppError::Other(msg));
        }

        let mut event_stream = Box::pin(stream_parser::parse_sse_stream(response).await);
        let mut full_content = String::new();
        let mut full_thinking = String::new();
        let mut prompt_tokens: u32 = 0;
        let mut completion_tokens: u32 = 0;
        let mut finish_reason = String::from("stop");
        let mut t_first_delta: Option<std::time::Instant> = None;

        loop {
            tokio::select! {
                _ = abort_rx.changed() => {
                    if *abort_rx.borrow() {
                        let _ = on_event.send(AiStreamEvent::Done { finish_reason: "abort".to_string() });
                        return Ok(ChatResult { content: full_content, model: config.model.clone(), prompt_tokens, completion_tokens, finish_reason: "abort".to_string() });
                    }
                }
                maybe_events = event_stream.next() => {
                    match maybe_events {
                        Some(events) => {
                            for event in events {
                                match &event {
                                    AiStreamEvent::TextDelta { delta } => { if t_first_delta.is_none() { t_first_delta = Some(std::time::Instant::now()); } full_content.push_str(delta); }
                                    AiStreamEvent::ThinkingDelta { delta } => { if t_first_delta.is_none() { t_first_delta = Some(std::time::Instant::now()); } full_thinking.push_str(delta); }
                                    AiStreamEvent::Usage { prompt_tokens: pt, completion_tokens: ct, .. } => { prompt_tokens = *pt; completion_tokens = *ct; }
                                    AiStreamEvent::Done { finish_reason: fr } => { finish_reason = fr.clone(); }
                                    _ => {}
                                }
                                let _ = on_event.send(event);
                            }
                        }
                        None => break,
                    }
                }
            }
        }

        let elapsed_ms = t_request_start.elapsed().as_millis();
        let ttfb_ms = t_first_delta.map(|t| t.duration_since(t_request_start).as_millis() as i64).unwrap_or(-1);
        let tokens_per_sec = if elapsed_ms > 0 && completion_tokens > 0 { (completion_tokens as f64) * 1000.0 / (elapsed_ms as f64) } else { 0.0 };
        log::info!("AI 流结束(completions): model={} finish_reason={} prompt={} completion={} elapsed_ms={} ttfb_ms={} tps={:.1}",
            config.model, finish_reason, prompt_tokens, completion_tokens, elapsed_ms, ttfb_ms, tokens_per_sec);

        Ok(ChatResult { content: full_content, model: config.model.clone(), prompt_tokens, completion_tokens, finish_reason })
    }

    /// OpenAI Responses API 流式对话（GPT-5 / o3 / o4 系列）
    async fn chat_stream_responses_api(
        &self,
        messages: Vec<ChatMessage>,
        config: &ChatConfig,
        api_key: &str,
        endpoint: &str,
        on_event: &Channel<AiStreamEvent>,
        mut abort_rx: watch::Receiver<bool>,
    ) -> Result<ChatResult, AppError> {
        let body = self.build_responses_body(&messages, config);
        let url = format!("{}/responses", endpoint.trim_end_matches('/'));

        let body_bytes = serde_json::to_string(&body).map(|s| s.len()).unwrap_or(0);
        log::info!("AI 请求(responses): {} model={} input_count={} body_bytes={}",
            url, config.model, messages.len(), body_bytes);
        log::info!("AI Responses 请求体: {}", serde_json::to_string(&body).unwrap_or_default());

        let t_request_start = std::time::Instant::now();

        let response = super::http_retry::send_with_rebuild(
            || {
                self.current_client()
                    .post(&url)
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("Content-Type", "application/json")
                    .json(&body)
            },
            || self.rebuild_client(),
        )
        .await
        .map_err(|e| AppError::Connection(format!("AI Responses API 请求失败: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_body = response.text().await.unwrap_or_else(|_| "无法读取响应体".to_string());
            let readable_msg = serde_json::from_str::<serde_json::Value>(&error_body)
                .ok()
                .and_then(|v| v.get("error")?.get("message")?.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| error_body.chars().take(200).collect());
            let msg = format!("{} ({})", readable_msg, status.as_u16());
            let _ = on_event.send(AiStreamEvent::Error { message: msg.clone(), retryable: status.is_server_error() });
            return Err(AppError::Other(msg));
        }

        // 解析 Responses API SSE 流
        let mut full_content = String::new();
        let mut prompt_tokens: u32 = 0;
        let mut completion_tokens: u32 = 0;
        let mut finish_reason = String::from("stop");
        let mut t_first_delta: Option<std::time::Instant> = None;
        // call_id → (item_id, index, name, arguments)
        let mut pending_tool_calls: std::collections::HashMap<String, (String, u32, String, String)> = std::collections::HashMap::new();
        // item_id → call_id（Responses API delta 事件用 item_id，output_item.added 用 call_id）
        let mut item_id_to_call_id: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        let mut tool_call_index: u32 = 0;

        let mut byte_stream = response.bytes_stream();
        let mut buf = Vec::<u8>::new();

        loop {
            tokio::select! {
                _ = abort_rx.changed() => {
                    if *abort_rx.borrow() {
                        let _ = on_event.send(AiStreamEvent::Done { finish_reason: "abort".to_string() });
                        return Ok(ChatResult { content: full_content, model: config.model.clone(), prompt_tokens, completion_tokens, finish_reason: "abort".to_string() });
                    }
                }
                chunk = byte_stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            buf.extend_from_slice(&bytes);
                            // 按行处理 SSE
                            loop {
                                let newline = match buf.iter().position(|&b| b == b'\n') {
                                    Some(p) => p,
                                    None => break,
                                };
                                let line_bytes: Vec<u8> = buf.drain(..=newline).collect();
                                let end = if line_bytes.len() >= 2 && line_bytes[line_bytes.len()-2] == b'\r' { line_bytes.len()-2 } else { line_bytes.len()-1 };
                                let line = match std::str::from_utf8(&line_bytes[..end]) { Ok(s) => s, Err(_) => continue };
                                if line.is_empty() { continue; }

                                let data = match line.strip_prefix("data: ") { Some(d) => d, None => continue };
                                if data == "[DONE]" { break; }

                                let ev: serde_json::Value = match serde_json::from_str(data) { Ok(v) => v, Err(_) => continue };
                                let ev_type = ev.get("type").and_then(|v| v.as_str()).unwrap_or("");
                                log::info!("Responses SSE: type={} data={}", ev_type, data.chars().take(300).collect::<String>());

                                match ev_type {
                                    // 文本增量
                                    "response.output_text.delta" => {
                                        let delta = ev.get("delta").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                        if !delta.is_empty() {
                                            if t_first_delta.is_none() { t_first_delta = Some(std::time::Instant::now()); }
                                            full_content.push_str(&delta);
                                            let _ = on_event.send(AiStreamEvent::TextDelta { delta });
                                        }
                                    }
                                    // 工具调用项开始
                                    "response.output_item.added" => {
                                        let item = ev.get("item").unwrap_or(&serde_json::Value::Null);
                                        if item.get("type").and_then(|v| v.as_str()) == Some("function_call") {
                                            let item_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            let call_id = item.get("call_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            if !call_id.is_empty() {
                                                let idx = tool_call_index;
                                                tool_call_index += 1;
                                                pending_tool_calls.insert(call_id.clone(), (item_id.clone(), idx, name.clone(), String::new()));
                                                if !item_id.is_empty() {
                                                    item_id_to_call_id.insert(item_id, call_id.clone());
                                                }
                                                let _ = on_event.send(AiStreamEvent::ToolCallDelta {
                                                    index: idx,
                                                    id: Some(call_id),
                                                    name: Some(name),
                                                    arguments_delta: String::new(),
                                                });
                                            }
                                        }
                                    }
                                    // 工具参数增量
                                    "response.function_call_arguments.delta" => {
                                        // delta 事件携带 item_id，需映射到 call_id
                                        let raw_id = ev.get("item_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                        let call_id = item_id_to_call_id.get(&raw_id).cloned().unwrap_or(raw_id);
                                        let delta = ev.get("delta").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                        if !delta.is_empty() {
                                            if let Some(entry) = pending_tool_calls.get_mut(&call_id) {
                                                entry.3.push_str(&delta);
                                                let idx = entry.1;
                                                let _ = on_event.send(AiStreamEvent::ToolCallDelta {
                                                    index: idx,
                                                    id: None,
                                                    name: None,
                                                    arguments_delta: delta,
                                                });
                                            }
                                        }
                                    }
                                    // 工具调用完成
                                    "response.function_call_arguments.done" => {
                                        let raw_id = ev.get("item_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                        let call_id = item_id_to_call_id.get(&raw_id).cloned().unwrap_or(raw_id);
                                        let arguments = ev.get("arguments").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                        if let Some(entry) = pending_tool_calls.get_mut(&call_id) {
                                            if !arguments.is_empty() { entry.3 = arguments.clone(); }
                                            let _ = on_event.send(AiStreamEvent::ToolCall {
                                                id: call_id.clone(),
                                                name: entry.2.clone(),
                                                arguments: entry.3.clone(),
                                            });
                                        }
                                    }
                                    // 完成（含 usage）
                                    "response.completed" => {
                                        if let Some(resp) = ev.get("response") {
                                            if let Some(usage) = resp.get("usage") {
                                                prompt_tokens = usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                                                completion_tokens = usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                                            }
                                            finish_reason = resp.get("status").and_then(|v| v.as_str()).unwrap_or("stop").to_string();
                                            // Responses API status → 标准 finish_reason
                                            // 有挂起的工具调用 → "tool_calls"（让前端触发工具执行循环）
                                            // "completed" → "stop"，"incomplete" → "length"
                                            if !pending_tool_calls.is_empty() {
                                                finish_reason = "tool_calls".to_string();
                                            } else if finish_reason == "completed" {
                                                finish_reason = "stop".to_string();
                                            }
                                        }
                                        let _ = on_event.send(AiStreamEvent::Usage { prompt_tokens, completion_tokens, cache_read_tokens: 0 });
                                        let _ = on_event.send(AiStreamEvent::Done { finish_reason: finish_reason.clone() });
                                    }
                                    // 错误
                                    "error" => {
                                        let msg = ev.get("message").and_then(|v| v.as_str()).unwrap_or("Responses API 错误").to_string();
                                        let _ = on_event.send(AiStreamEvent::Error { message: msg.clone(), retryable: false });
                                        return Err(AppError::Other(msg));
                                    }
                                    _ => {}
                                }
                            }
                        }
                        Some(Err(e)) => {
                            let msg = format!("流式读取失败: {e}");
                            let _ = on_event.send(AiStreamEvent::Error { message: msg.clone(), retryable: true });
                            return Err(AppError::Connection(msg));
                        }
                        None => break,
                    }
                }
            }
        }

        let elapsed_ms = t_request_start.elapsed().as_millis();
        log::info!("AI 流结束(responses): model={} finish_reason={} prompt={} completion={} elapsed_ms={}",
            config.model, finish_reason, prompt_tokens, completion_tokens, elapsed_ms);

        Ok(ChatResult { content: full_content, model: config.model.clone(), prompt_tokens, completion_tokens, finish_reason })
    }
}

#[async_trait]
impl AiProvider for OpenAiCompatProvider {
    fn id(&self) -> &str {
        "openai_compat"
    }

    fn capabilities(&self, _model: &str) -> ModelCapabilities {
        ModelCapabilities::default()
    }

    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        config: &ChatConfig,
        api_key: &str,
        endpoint: &str,
        on_event: &Channel<AiStreamEvent>,
        abort_rx: watch::Receiver<bool>,
    ) -> Result<ChatResult, AppError> {
        if is_responses_api_model(&config.model) {
            self.chat_stream_responses_api(messages, config, api_key, endpoint, on_event, abort_rx).await
        } else {
            self.chat_stream_completions(messages, config, api_key, endpoint, on_event, abort_rx).await
        }
    }
}
