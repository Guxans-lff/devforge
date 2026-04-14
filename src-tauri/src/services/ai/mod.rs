//! AI 服务模块
//!
//! 提供 AI 对话功能的核心服务层，包括：
//! - Provider 抽象与注册
//! - OpenAI 兼容协议实现
//! - SSE 流解析
//! - 会话持久化存储

pub mod models;
pub mod openai_compat;
pub mod provider;
pub mod session_store;
pub mod stream_parser;

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{watch, RwLock};

use provider::ProviderRegistry;

/// AI 引擎
///
/// 管理 Provider 注册表和活跃的流式请求（用于中断控制）。
pub struct AiEngine {
    /// Provider 注册表
    pub registry: ProviderRegistry,
    /// 活跃的流式请求中断信号 (session_id -> abort_sender)
    abort_senders: RwLock<HashMap<String, watch::Sender<bool>>>,
}

impl AiEngine {
    pub fn new() -> Self {
        let mut registry = ProviderRegistry::new();

        // 注册内置 Provider
        registry.register(Arc::new(openai_compat::OpenAiCompatProvider::new()));

        Self {
            registry,
            abort_senders: RwLock::new(HashMap::new()),
        }
    }

    /// 创建一个新的中断信号对（用于流式对话）
    pub async fn create_abort_channel(&self, session_id: &str) -> watch::Receiver<bool> {
        let (tx, rx) = watch::channel(false);
        self.abort_senders
            .write()
            .await
            .insert(session_id.to_string(), tx);
        rx
    }

    /// 发送中断信号
    pub async fn abort(&self, session_id: &str) -> bool {
        if let Some(sender) = self.abort_senders.read().await.get(session_id) {
            let _ = sender.send(true);
            true
        } else {
            false
        }
    }

    /// 清理已完成的中断信号
    pub async fn cleanup_abort(&self, session_id: &str) {
        self.abort_senders.write().await.remove(session_id);
    }
}
