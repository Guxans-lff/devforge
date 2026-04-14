//! SSE 流解析器
//!
//! 解析 OpenAI 兼容 API 的 Server-Sent Events 流，
//! 将原始字节流转换为结构化的 AiStreamEvent。

use tokio_util::bytes::Bytes;
use futures::StreamExt;

use super::models::{AiStreamEvent, ChatCompletionChunk};

/// SSE 行解析状态
pub struct SseParser {
    /// 未处理完的缓冲区
    buffer: String,
}

impl SseParser {
    pub fn new() -> Self {
        Self {
            buffer: String::new(),
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
        let text = String::from_utf8_lossy(chunk);
        self.buffer.push_str(&text);

        let mut events = Vec::new();

        // 按行处理
        while let Some(line_end) = self.buffer.find('\n') {
            let line = self.buffer[..line_end].trim_end_matches('\r').to_string();
            self.buffer = self.buffer[line_end + 1..].to_string();

            if line.is_empty() {
                // 空行 = 事件分隔符，忽略
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    events.push(SseEvent::Done);
                } else {
                    match serde_json::from_str::<ChatCompletionChunk>(data) {
                        Ok(chunk) => events.push(SseEvent::Chunk(chunk)),
                        Err(e) => {
                            log::warn!("SSE JSON 解析失败: {e}, 原文: {data}");
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

/// 将 ChatCompletionChunk 转换为 AiStreamEvent 列表
pub fn chunk_to_events(chunk: &ChatCompletionChunk) -> Vec<AiStreamEvent> {
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

        // 结束信号
        if let Some(ref reason) = choice.finish_reason {
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
        });
    }

    events
}

/// 从 reqwest 响应流中解析 SSE 事件
///
/// 这是一个异步流处理器，返回 AiStreamEvent 的迭代器。
pub async fn parse_sse_stream(
    response: reqwest::Response,
) -> impl futures::Stream<Item = Vec<AiStreamEvent>> {
    let mut parser = SseParser::new();
    let byte_stream = response.bytes_stream();

    byte_stream.filter_map(move |result| {
        let events = match result {
            Ok(bytes) => {
                let sse_events = parser.feed(&bytes);
                let mut ai_events = Vec::new();

                for sse_event in sse_events {
                    match sse_event {
                        SseEvent::Chunk(chunk) => {
                            ai_events.extend(chunk_to_events(&chunk));
                        }
                        SseEvent::Done => {
                            // 如果还没有发送 Done 事件，补发一个
                            if !ai_events.iter().any(|e| matches!(e, AiStreamEvent::Done { .. })) {
                                ai_events.push(AiStreamEvent::Done {
                                    finish_reason: "stop".to_string(),
                                });
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
            Err(e) => Some(vec![AiStreamEvent::Error {
                message: format!("流读取失败: {e}"),
                retryable: true,
            }]),
        };

        std::future::ready(events)
    })
}
