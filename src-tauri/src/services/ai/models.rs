//! AI 模块数据模型定义
//!
//! 包含 Provider 配置、流式事件、会话/消息、模型能力描述等核心类型。

use serde::{Deserialize, Serialize};

// ─────────────────────────────────── 多模态内容块 ───────────────────────────────────

/// 多模态内容块
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ContentBlock {
    Text { text: String },
    Image { source: ImageSource },
}

/// 图片源数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSource {
    #[serde(rename = "type")]
    pub source_type: String,  // "base64"
    pub media_type: String,   // "image/png", "image/jpeg", etc.
    pub data: String,         // base64 数据
}

// ─────────────────────────────────── Provider 配置 ───────────────────────────────────

/// Provider 类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderType {
    /// OpenAI 兼容协议（覆盖 GPT/DeepSeek/智普/Moonshot/Qwen 等）
    OpenaiCompat,
    /// Anthropic 原生协议（Claude 直连）
    Anthropic,
}

/// 模型定价信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricing {
    /// 每百万输入 token 价格
    pub input_per_1m: f64,
    /// 每百万输出 token 价格
    pub output_per_1m: f64,
    /// 币种（如 "USD"、"CNY"）
    pub currency: String,
}

/// 模型能力描述
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilities {
    /// 是否支持流式输出
    pub streaming: bool,
    /// 是否支持图片输入（Vision）
    pub vision: bool,
    /// 是否支持思考过程（Thinking/Reasoning）
    pub thinking: bool,
    /// 是否支持工具调用（Function Calling / Tool Use）
    pub tool_use: bool,
    /// 最大上下文 token 数
    pub max_context: u32,
    /// 最大输出 token 数
    pub max_output: u32,
    /// 定价信息（可选）
    pub pricing: Option<ModelPricing>,
}

impl Default for ModelCapabilities {
    fn default() -> Self {
        Self {
            streaming: true,
            vision: false,
            thinking: false,
            tool_use: false,
            max_context: 8192,
            max_output: 4096,
            pricing: None,
        }
    }
}

/// 单个模型配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    /// 模型 ID（API 调用使用）
    pub id: String,
    /// 模型显示名称
    pub name: String,
    /// 模型能力
    pub capabilities: ModelCapabilities,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_effort: Option<String>,
}

/// Provider 配置（持久化到 SQLite）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    /// 唯一标识
    pub id: String,
    /// 显示名称
    pub name: String,
    /// Provider 类型
    pub provider_type: ProviderType,
    /// API 端点
    pub endpoint: String,
    /// 支持的模型列表
    pub models: Vec<ModelConfig>,
    /// 是否为默认 Provider
    pub is_default: bool,
    /// 创建时间戳（毫秒）
    pub created_at: i64,
}

// ─────────────────────────────────── 对话请求 ───────────────────────────────────

/// 对话消息角色
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    System,
    User,
    Assistant,
    Tool,
}

/// 对话消息（发送给 API）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: MessageRole,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// 新增：结构化内容块支持（多模态）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_blocks: Option<Vec<ContentBlock>>,
    /// 工具名称（tool 角色消息，部分 API 如 OpenAI 要求）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 工具调用列表（assistant 角色携带）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallRecord>>,
    /// 工具调用 ID（tool 角色必须）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// Reasoning 模型工作记忆回传（MiMo / DeepSeek-R 系，assistant 角色携带）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
}

/// 工具调用记录（完整）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallRecord {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: ToolCallFunction,
}

/// 工具调用函数信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallFunction {
    pub name: String,
    pub arguments: String,
}

/// 工具定义（发送给 API）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: ToolFunctionDef,
}

/// 工具函数定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolFunctionDef {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// 对话配置参数
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatConfig {
    /// 模型 ID
    pub model: String,
    /// 最大输出 token 数
    pub max_tokens: u32,
    /// 温度（0.0 ~ 2.0）
    pub temperature: f64,
    /// 系统提示词（可选）
    pub system_prompt: Option<String>,
    /// 工具定义列表（可选）
    pub tools: Option<Vec<ToolDefinition>>,
    /// 工具选择策略（"auto" | "none"）
    pub tool_choice: Option<String>,
    /// Thinking/Extended thinking 预算（token 数）。
    /// - `None` 或 `Some(0)` 表示关闭
    /// - Anthropic: 启用时会在请求体加 `thinking: { type: "enabled", budget_tokens: N }`
    /// - 仅支持 thinking 能力的模型生效
    #[serde(default)]
    pub thinking_budget: Option<u32>,
}

impl Default for ChatConfig {
    fn default() -> Self {
        Self {
            model: "gpt-4o-mini".to_string(),
            max_tokens: 4096,
            temperature: 0.7,
            system_prompt: None,
            tools: None,
            tool_choice: None,
            thinking_budget: None,
        }
    }
}

// ─────────────────────────────────── 流式事件 ───────────────────────────────────

/// AI 流式事件（通过 Tauri Channel 推送到前端）
///
/// 使用 tagged union 设计，前端根据 `type` 字段区分事件类型。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum AiStreamEvent {
    /// 文本增量
    TextDelta { delta: String },
    /// 思考过程增量（V2 预留）
    ThinkingDelta { delta: String },
    /// 工具调用（V4 预留）
    ToolCall {
        id: String,
        name: String,
        arguments: String,
    },
    /// 工具调用参数增量（流式累积进度，用于 UI 实时反馈）
    ToolCallDelta {
        index: u32,
        /// 首次出现时携带
        id: Option<String>,
        /// 首次出现时携带
        name: Option<String>,
        /// 本次增量片段（前端自行累加）
        arguments_delta: String,
    },
    /// 用量统计（流结束时发送）
    Usage {
        prompt_tokens: u32,
        completion_tokens: u32,
        /// 缓存命中的 token 数（Anthropic cache_read_input_tokens / DeepSeek prompt_cache_hit_tokens）
        /// 未启用缓存或 Provider 不报时为 0
        #[serde(default)]
        cache_read_tokens: u32,
    },
    /// 完成信号
    Done { finish_reason: String },
    /// 错误
    Error { message: String, retryable: bool },
}

// ─────────────────────────────────── 对话结果 ───────────────────────────────────

/// 单次对话调用结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResult {
    /// 完整回复文本
    pub content: String,
    /// 使用的模型
    pub model: String,
    /// 输入 token 数
    pub prompt_tokens: u32,
    /// 输出 token 数
    pub completion_tokens: u32,
    /// 结束原因
    pub finish_reason: String,
}

// ─────────────────────────────────── 会话持久化 ───────────────────────────────────

/// AI 会话（持久化）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSession {
    pub id: String,
    pub title: String,
    pub provider_id: String,
    pub model: String,
    pub system_prompt: Option<String>,
    pub message_count: u32,
    pub total_tokens: u32,
    pub estimated_cost: f64,
    pub tags: Option<Vec<String>>,
    pub created_at: i64,
    pub updated_at: i64,
    /// 工作目录（Tool Use 安全边界）
    pub work_dir: Option<String>,
}

/// AI 消息（持久化）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessageRecord {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub content_type: String,
    pub tokens: u32,
    pub cost: f64,
    pub parent_id: Option<String>,
    pub success: Option<bool>,
    pub tool_name: Option<String>,
    pub created_at: i64,
}

/// 单个会话及其历史消息载荷
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionDetail {
    pub session: AiSession,
    pub messages: Vec<AiMessageRecord>,
    pub total_records: u32,
    pub loaded_records: u32,
    pub truncated: bool,
}

/// 每日用量统计
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    pub date: String,
    pub provider_id: String,
    pub model: String,
    pub request_count: u32,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub estimated_cost: f64,
}

// ─────────────────────────────────── OpenAI 兼容 API 响应 ───────────────────────────────────

/// OpenAI Chat Completions 流式 chunk 响应
#[derive(Debug, Deserialize)]
pub struct ChatCompletionChunk {
    pub id: String,
    pub choices: Vec<ChunkChoice>,
    pub model: String,
    pub usage: Option<ChunkUsage>,
}

#[derive(Debug, Deserialize)]
pub struct ChunkChoice {
    pub index: u32,
    pub delta: ChunkDelta,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ChunkDelta {
    pub role: Option<String>,
    pub content: Option<String>,
    /// DeepSeek reasoning_content 字段（V2 思考过程）
    pub reasoning_content: Option<String>,
    /// 工具调用增量（流式 SSE）
    pub tool_calls: Option<Vec<ChunkToolCall>>,
}

/// SSE 流式 chunk 中的增量工具调用
#[derive(Debug, Deserialize)]
pub struct ChunkToolCall {
    pub index: u32,
    pub id: Option<String>,
    pub function: Option<ChunkToolCallFunction>,
}

/// SSE chunk 中的增量工具调用函数
#[derive(Debug, Deserialize)]
pub struct ChunkToolCallFunction {
    pub name: Option<String>,
    pub arguments: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ChunkUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    /// DeepSeek 自动缓存命中数（部分 Provider 会返回）
    #[serde(default)]
    pub prompt_cache_hit_tokens: Option<u32>,
}
