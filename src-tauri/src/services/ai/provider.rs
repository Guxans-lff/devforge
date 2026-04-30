//! Provider trait 定义
//!
//! 所有 AI 服务提供商（OpenAI、Anthropic、DeepSeek 等）统一实现此 trait。
//! 添加新 Provider 只需实现 trait + 注册，无需修改已有代码。

use async_trait::async_trait;
use std::sync::Arc;
use tauri::ipc::Channel;
use tokio::sync::watch;

use super::models::{AiStreamEvent, ChatConfig, ChatMessage, ChatResult, ModelCapabilities};
use crate::utils::error::AppError;

/// AI Provider 统一接口
#[async_trait]
pub trait AiProvider: Send + Sync {
    /// Provider 唯一标识
    fn id(&self) -> &str;

    /// 获取指定模型的能力描述
    fn capabilities(&self, model: &str) -> ModelCapabilities;

    /// 流式对话
    ///
    /// - `messages`: 对话消息列表
    /// - `config`: 对话参数（模型、温度等）
    /// - `api_key`: API 密钥
    /// - `endpoint`: API 端点
    /// - `on_event`: Tauri Channel，用于推送流式事件到前端
    /// - `abort_rx`: 中断信号接收器
    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        config: &ChatConfig,
        api_key: &str,
        endpoint: &str,
        on_event: &Channel<AiStreamEvent>,
        abort_rx: watch::Receiver<bool>,
    ) -> Result<ChatResult, AppError>;

    /// 文本补全 / FIM 补全（OpenAI compatible /completions）
    async fn completion(
        &self,
        model: &str,
        prompt: &str,
        suffix: Option<&str>,
        api_key: &str,
        endpoint: &str,
        max_tokens: u32,
        temperature: f64,
        use_beta: bool,
    ) -> Result<super::models::CompletionResult, AppError>;
}

/// Provider 注册表
///
/// 管理所有已注册的 Provider 实例，根据 provider_type 路由请求。
pub struct ProviderRegistry {
    providers: Vec<Arc<dyn AiProvider>>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            providers: Vec::new(),
        }
    }

    /// 注册一个 Provider
    pub fn register(&mut self, provider: Arc<dyn AiProvider>) {
        self.providers.push(provider);
    }

    /// 根据 ID 查找 Provider
    pub fn get(&self, id: &str) -> Option<&Arc<dyn AiProvider>> {
        self.providers.iter().find(|p| p.id() == id)
    }

    /// 获取所有已注册的 Provider ID
    #[allow(dead_code)]
    pub fn list_ids(&self) -> Vec<&str> {
        self.providers.iter().map(|p| p.id()).collect()
    }
}
