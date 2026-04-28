use std::collections::HashMap;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

use futures::StreamExt;
use redis::Client;
use tauri::Emitter;

use crate::models::redis::PubSubMessage;

/// 单个 PubSub 会话的状态
struct PubSubSession {
    /// 用于取消后台消息循环
    cancel_token: CancellationToken,
    /// 已订阅的普通频道
    channels: Vec<String>,
    /// 已订阅的模式
    patterns: Vec<String>,
    /// 连接 URL（用于追加订阅时重建 sink）
    url: String,
}

/// Redis PubSub 管理器
///
/// 管理多个连接的 PubSub 会话。每个连接独立创建 PubSub 连接，
/// 通过 Tauri 事件将消息推送到前端。
pub struct RedisPubSubManager {
    sessions: RwLock<HashMap<String, PubSubSession>>,
}

impl RedisPubSubManager {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }

    /// 构建连接 URL（复用 redis_engine 的逻辑）
    #[allow(dead_code)]
    pub fn build_url(
        host: &str,
        port: u16,
        password: Option<&str>,
        database: u8,
        use_tls: bool,
    ) -> String {
        let scheme = if use_tls { "rediss" } else { "redis" };
        let auth = match password {
            Some(pw) if !pw.is_empty() => format!(":{}@", urlencoding::encode(pw)),
            _ => String::new(),
        };
        format!("{}://{}{}:{}/{}", scheme, auth, host, port, database)
    }

    /// 订阅频道/模式，启动消息循环
    ///
    /// 如果该连接已有 PubSub 会话，先停止旧的，再创建新的。
    pub async fn subscribe(
        &self,
        connection_id: &str,
        url: &str,
        channels: Vec<String>,
        patterns: Vec<String>,
        app_handle: tauri::AppHandle,
    ) -> Result<(), String> {
        // 先停止已有会话
        self.stop(connection_id).await;

        let client = Client::open(url)
            .map_err(|e| format!("创建 PubSub 客户端失败: {}", e))?;

        let mut pubsub = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            client.get_async_pubsub(),
        )
        .await
        .map_err(|_| "PubSub 连接超时（10秒）".to_string())?
        .map_err(|e| format!("PubSub 连接失败: {}", e))?;

        // 订阅频道
        for ch in &channels {
            pubsub.subscribe(ch.as_str()).await
                .map_err(|e| format!("订阅频道 {} 失败: {}", ch, e))?;
        }

        // 订阅模式
        for pat in &patterns {
            pubsub.psubscribe(pat.as_str()).await
                .map_err(|e| format!("订阅模式 {} 失败: {}", pat, e))?;
        }

        let cancel_token = CancellationToken::new();
        let token_clone = cancel_token.clone();
        let conn_id = connection_id.to_string();

        // spawn 消息循环
        let mut stream = pubsub.into_on_message();
        tokio::spawn(async move {
            let event_name = format!("redis://pubsub/{}", conn_id);
            loop {
                tokio::select! {
                    _ = token_clone.cancelled() => {
                        log::info!("PubSub 消息循环停止: {}", conn_id);
                        break;
                    }
                    msg = stream.next() => {
                        match msg {
                            Some(msg) => {
                                let channel = msg.get_channel_name().to_string();
                                // 优先用 get_payload，失败则从原始 bytes 解析
                                let payload: String = msg.get_payload()
                                    .or_else(|_| -> Result<String, redis::RedisError> {
                                        let bytes: Vec<u8> = msg.get_payload()?;
                                        Ok(String::from_utf8_lossy(&bytes).to_string())
                                    })
                                    .unwrap_or_else(|_| "<binary>".to_string());
                                let pattern: Option<String> = msg.get_pattern().ok();
                                let timestamp_ms = chrono::Utc::now().timestamp_millis();

                                let message = PubSubMessage {
                                    channel,
                                    pattern,
                                    payload,
                                    timestamp_ms,
                                };

                                let _ = app_handle.emit(&event_name, &message);
                            }
                            None => {
                                log::info!("PubSub 流结束: {}", conn_id);
                                break;
                            }
                        }
                    }
                }
            }
        });

        // 保存会话信息
        let session = PubSubSession {
            cancel_token,
            channels,
            patterns,
            url: url.to_string(),
        };
        self.sessions.write().await.insert(connection_id.to_string(), session);

        Ok(())
    }

    /// 追加订阅频道/模式
    ///
    /// 实现方式：停止当前会话，合并新频道后重新创建。
    /// （redis-rs 的 `into_on_message()` 消费了 PubSub，无法追加订阅）
    pub async fn add_subscription(
        &self,
        connection_id: &str,
        channels: Vec<String>,
        patterns: Vec<String>,
        app_handle: tauri::AppHandle,
    ) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        let session = sessions.get(connection_id)
            .ok_or_else(|| format!("连接 {} 没有活跃的 PubSub 会话", connection_id))?;

        let mut all_channels = session.channels.clone();
        let mut all_patterns = session.patterns.clone();
        let url = session.url.clone();
        drop(sessions);

        // 合并新频道（去重）
        for ch in channels {
            if !all_channels.contains(&ch) {
                all_channels.push(ch);
            }
        }
        for pat in patterns {
            if !all_patterns.contains(&pat) {
                all_patterns.push(pat);
            }
        }

        self.subscribe(connection_id, &url, all_channels, all_patterns, app_handle).await
    }

    /// 取消订阅指定频道/模式
    ///
    /// 如果取消后没有任何订阅了，停止整个会话。
    pub async fn remove_subscription(
        &self,
        connection_id: &str,
        channels: Vec<String>,
        patterns: Vec<String>,
        app_handle: tauri::AppHandle,
    ) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        let session = sessions.get(connection_id)
            .ok_or_else(|| format!("连接 {} 没有活跃的 PubSub 会话", connection_id))?;

        let remaining_channels: Vec<String> = session.channels.iter()
            .filter(|ch| !channels.contains(ch))
            .cloned()
            .collect();
        let remaining_patterns: Vec<String> = session.patterns.iter()
            .filter(|pat| !patterns.contains(pat))
            .cloned()
            .collect();
        let url = session.url.clone();
        drop(sessions);

        if remaining_channels.is_empty() && remaining_patterns.is_empty() {
            self.stop(connection_id).await;
            return Ok(());
        }

        self.subscribe(connection_id, &url, remaining_channels, remaining_patterns, app_handle).await
    }

    /// 停止连接的所有 PubSub 订阅
    pub async fn stop(&self, connection_id: &str) {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.remove(connection_id) {
            session.cancel_token.cancel();
        }
    }

    /// 获取当前订阅列表
    pub async fn get_subscriptions(&self, connection_id: &str) -> (Vec<String>, Vec<String>) {
        let sessions = self.sessions.read().await;
        match sessions.get(connection_id) {
            Some(session) => (session.channels.clone(), session.patterns.clone()),
            None => (vec![], vec![]),
        }
    }

    /// 通过现有 MultiplexedConnection 发布消息（不需要 PubSub 连接）
    #[allow(dead_code)]
    pub async fn publish(
        &self,
        connection_id: &str,
        channel: &str,
        message: &str,
        redis_engine: &crate::services::redis_engine::RedisEngine,
    ) -> Result<u64, String> {
        redis_engine.publish(connection_id, channel, message).await
    }

    /// 停止所有连接的 PubSub
    #[allow(dead_code)]
    pub async fn stop_all(&self) {
        let mut sessions = self.sessions.write().await;
        for (_, session) in sessions.drain() {
            session.cancel_token.cancel();
        }
    }
}
