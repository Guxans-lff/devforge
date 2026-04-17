//! SSE 流解析器
//!
//! 解析 OpenAI 兼容 API 的 Server-Sent Events 流，
//! 将原始字节流转换为结构化的 AiStreamEvent。
//!
//! 关键设计：
//! - 使用原始字节缓冲区处理跨 chunk 的 UTF-8 多字节字符（如中文）
//! - 流错误时立即终止并发送 Error + Done 事件，防止卡死
//! - ToolCallAccumulator 在后端完成增量拼接，前端无需处理碎片

use std::collections::HashMap;
use tokio_util::bytes::Bytes;
use futures::StreamExt;

use super::models::{AiStreamEvent, ChatCompletionChunk, ChunkToolCall, ToolCallRecord, ToolCallFunction};

/// SSE 行解析状态
///
/// 使用原始字节缓冲区，避免 `String::from_utf8_lossy` 在 chunk 边界
/// 截断多字节 UTF-8 字符（如中文被拆到两个 chunk 中间）。
pub struct SseParser {
    /// 原始字节缓冲区
    byte_buf: Vec<u8>,
}

impl SseParser {
    pub fn new() -> Self {
        Self {
            byte_buf: Vec::with_capacity(4096),
        }
    }

    /// 处理新收到的字节块，返回解析出的事件列表
    ///
    /// SSE 格式：
    /// ```text
    /// data: {"id":"...","choices":[...]}\n
    /// \n
    /// data: [DONE]\n
    /// ```
    pub fn feed(&mut self, chunk: &Bytes) -> Vec<SseEvent> {
        self.byte_buf.extend_from_slice(chunk);

        let mut events = Vec::new();

        // 按 \n 分行处理，但只消费完整行（有 \n 结尾的）
        loop {
            let newline_pos = match self.byte_buf.iter().position(|&b| b == b'\n') {
                Some(pos) => pos,
                None => break, // 没有完整行，等待更多数据
            };

            // 取出这一行（不含 \n）
            let line_bytes: Vec<u8> = self.byte_buf.drain(..=newline_pos).collect();
            // 去掉尾部 \n 和可能的 \r
            let line_end = if line_bytes.len() >= 2 && line_bytes[line_bytes.len() - 2] == b'\r' {
                line_bytes.len() - 2
            } else {
                line_bytes.len() - 1
            };
            let line_slice = &line_bytes[..line_end];

            // 空行 = SSE 事件分隔符
            if line_slice.is_empty() {
                continue;
            }

            // 尝试转为 UTF-8 字符串
            let line = match std::str::from_utf8(line_slice) {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("SSE 行 UTF-8 解码失败: {e}");
                    continue;
                }
            };

            // 解析 data: 前缀
            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    events.push(SseEvent::Done);
                } else {
                    match serde_json::from_str::<ChatCompletionChunk>(data) {
                        Ok(chunk) => events.push(SseEvent::Chunk(chunk)),
                        Err(e) => {
                            log::warn!("SSE JSON 解析失败: {e}, 原文长度: {}", data.len());
                        }
                    }
                }
            }
            // 忽略非 data 行（如 event:, id:, retry: 等）
        }

        events
    }
}

/// SSE 解析出的事件
pub enum SseEvent {
    /// 数据块
    Chunk(ChatCompletionChunk),
    /// 流结束
    Done,
}

// ─────────────────────── 工具调用增量拼接器 ───────────────────────

/// 按 index 拼接碎片化的 tool_calls delta
pub struct ToolCallAccumulator {
    /// index → (id, name, arguments)
    calls: HashMap<u32, (String, String, String)>,
}

impl ToolCallAccumulator {
    pub fn new() -> Self {
        Self {
            calls: HashMap::new(),
        }
    }

    /// 累积一个增量 tool_call chunk
    pub fn accumulate(&mut self, chunk: &ChunkToolCall) {
        let entry = self
            .calls
            .entry(chunk.index)
            .or_insert_with(|| (String::new(), String::new(), String::new()));

        if let Some(ref id) = chunk.id {
            entry.0 = id.clone();
        }
        if let Some(ref f) = chunk.function {
            if let Some(ref name) = f.name {
                entry.1 = name.clone();
            }
            if let Some(ref args) = f.arguments {
                entry.2.push_str(args);
            }
        }
    }

    /// 是否有累积的工具调用
    pub fn has_calls(&self) -> bool {
        !self.calls.is_empty()
    }

    /// 完成拼接，返回完整的 ToolCallRecord 列表
    pub fn finish(&mut self) -> Vec<ToolCallRecord> {
        let result: Vec<ToolCallRecord> = self
            .calls
            .drain()
            .map(|(_, (id, name, args))| ToolCallRecord {
                id,
                call_type: "function".to_string(),
                function: ToolCallFunction {
                    name,
                    arguments: args,
                },
            })
            .collect();
        result
    }
}

/// 将 ChatCompletionChunk 转换为 AiStreamEvent 列表
///
/// `accumulator` 用于拼接增量 tool_calls，在 finish_reason == "tool_calls" 时输出完整的 ToolCall 事件
pub fn chunk_to_events(
    chunk: &ChatCompletionChunk,
    accumulator: &mut ToolCallAccumulator,
) -> Vec<AiStreamEvent> {
    let mut events = Vec::new();

    for choice in &chunk.choices {
        // 思考过程（DeepSeek reasoning_content）
        if let Some(ref reasoning) = choice.delta.reasoning_content {
            if !reasoning.is_empty() {
                events.push(AiStreamEvent::ThinkingDelta {
                    delta: reasoning.clone(),
                });
            }
        }

        // 文本内容
        if let Some(ref content) = choice.delta.content {
            if !content.is_empty() {
                events.push(AiStreamEvent::TextDelta {
                    delta: content.clone(),
                });
            }
        }

        // 工具调用增量 → 累积到 accumulator
        if let Some(ref tool_calls) = choice.delta.tool_calls {
            for tc in tool_calls {
                accumulator.accumulate(tc);
            }
        }

        // 结束信号
        if let Some(ref reason) = choice.finish_reason {
            // 如果 finish_reason == "tool_calls"，先输出完整的 ToolCall 事件
            if reason == "tool_calls" && accumulator.has_calls() {
                let records = accumulator.finish();
                for record in records {
                    events.push(AiStreamEvent::ToolCall {
                        id: record.id,
                        name: record.function.name,
                        arguments: record.function.arguments,
                    });
                }
            }
            events.push(AiStreamEvent::Done {
                finish_reason: reason.clone(),
            });
        }
    }

    // 用量统计（通常在最后一个 chunk 中）
    if let Some(ref usage) = chunk.usage {
        events.push(AiStreamEvent::Usage {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            cache_read_tokens: usage.prompt_cache_hit_tokens.unwrap_or(0),
        });
    }

    events
}

/// 从 reqwest 响应流中解析 SSE 事件
///
/// 关键：流错误时立即终止并发送 Error + Done，防止卡死。
pub async fn parse_sse_stream(
    response: reqwest::Response,
) -> impl futures::Stream<Item = Vec<AiStreamEvent>> {
    let mut parser = SseParser::new();
    let mut accumulator = ToolCallAccumulator::new();
    let mut errored = false; // 标记流是否已出错
    let mut done_sent = false; // 标记是否已发送过 Done 事件（跨批次）
    let byte_stream = response.bytes_stream();

    byte_stream.filter_map(move |result| {
        // 流已出错，后续 chunk 全部忽略
        if errored {
            return std::future::ready(None);
        }

        let events = match result {
            Ok(bytes) => {
                let sse_events = parser.feed(&bytes);
                let mut ai_events = Vec::new();

                for sse_event in sse_events {
                    match sse_event {
                        SseEvent::Chunk(chunk) => {
                            let events = chunk_to_events(&chunk, &mut accumulator);
                            // 检查本批次是否包含 Done 事件
                            if events.iter().any(|e| matches!(e, AiStreamEvent::Done { .. })) {
                                done_sent = true;
                            }
                            ai_events.extend(events);
                        }
                        SseEvent::Done => {
                            // 仅在整个流从未发送过 Done 时补发（跨批次检查）
                            if !done_sent && !ai_events.iter().any(|e| matches!(e, AiStreamEvent::Done { .. })) {
                                ai_events.push(AiStreamEvent::Done {
                                    finish_reason: "stop".to_string(),
                                });
                                done_sent = true;
                            }
                        }
                    }
                }

                if ai_events.is_empty() {
                    None
                } else {
                    Some(ai_events)
                }
            }
            Err(e) => {
                // 标记出错，终止流
                errored = true;
                log::error!("SSE 流读取失败: {e}");
                Some(vec![
                    AiStreamEvent::Error {
                        message: format!("流读取失败: {e}"),
                        retryable: true,
                    },
                    // 立即发送 Done 事件，让前端正确结束流式状态
                    AiStreamEvent::Done {
                        finish_reason: "error".to_string(),
                    },
                ])
            }
        };

        std::future::ready(events)
    })
}
