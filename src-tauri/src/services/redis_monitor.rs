use std::collections::HashMap;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

use redis::Client;
use tauri::Emitter;

use crate::models::redis::RedisMonitorMessage;

/// 单个 MONITOR 会话
struct MonitorSession {
    /// 用于取消后台监控循环
    cancel_token: CancellationToken,
}

/// Redis MONITOR 管理器
///
/// 管理多个连接的 MONITOR 会话。每个会话创建独立的 Redis 连接，
/// 执行 MONITOR 命令后通过 Tauri 事件将实时命令流推送到前端。
pub struct RedisMonitorManager {
    sessions: RwLock<HashMap<String, MonitorSession>>,
}

impl RedisMonitorManager {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }

    /// 构建连接 URL
    fn build_url(
        host: &str,
        port: u16,
        password: Option<&str>,
        use_tls: bool,
    ) -> String {
        let scheme = if use_tls { "rediss" } else { "redis" };
        let auth = match password {
            Some(pw) if !pw.is_empty() => format!(":{}@", urlencoding::encode(pw)),
            _ => String::new(),
        };
        format!("{}://{}{}:{}/0", scheme, auth, host, port)
    }

    /// 启动 MONITOR 会话
    ///
    /// 创建独立 Redis 连接，执行 MONITOR 命令，spawn 后台循环读取输出并通过事件推送。
    pub async fn start(
        &self,
        connection_id: &str,
        host: &str,
        port: u16,
        password: Option<&str>,
        use_tls: bool,
        timeout_secs: u64,
        app_handle: tauri::AppHandle,
    ) -> Result<(), String> {
        // 先停止已有会话
        self.stop(connection_id).await;

        let url = Self::build_url(host, port, password, use_tls);
        let client = Client::open(url.as_str())
            .map_err(|e| format!("创建 MONITOR 客户端失败: {}", e))?;

        let mut conn = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            client.get_multiplexed_async_connection(),
        )
        .await
        .map_err(|_| format!("MONITOR 连接超时（{}秒）", timeout_secs))?
        .map_err(|e| format!("MONITOR 连接失败: {}", e))?;

        // 执行 MONITOR 命令
        redis::cmd("MONITOR")
            .query_async::<()>(&mut conn)
            .await
            .map_err(|e| format!("MONITOR 启动失败: {}", e))?;

        let cancel_token = CancellationToken::new();
        let token_clone = cancel_token.clone();
        let conn_id = connection_id.to_string();

        // spawn 后台循环：从 MONITOR 连接持续读取消息
        // 注意：MONITOR 模式下连接会持续推送数据，使用 recv_response 读取
        tokio::spawn(async move {
            let event_name = format!("redis://monitor/{}", conn_id);

            // MONITOR 通过 MultiplexedConnection 持续推送 push 消息
            loop {
                tokio::select! {
                    _ = token_clone.cancelled() => {
                        log::info!("MONITOR 循环停止: {}", conn_id);
                        break;
                    }
                    // 从连接读取 MONITOR 输出
                    result = async {
                        let mut cmd = redis::cmd("");
                        cmd.query_async::<String>(&mut conn).await
                    } => {
                        match result {
                            Ok(raw) => {
                                let message = Self::parse_monitor_line(&raw);
                                let _ = app_handle.emit(&event_name, &message);
                            }
                            Err(e) => {
                                log::warn!("MONITOR 读取失败: {} — {}", conn_id, e);
                                // 连接断开，退出循环
                                break;
                            }
                        }
                    }
                }
            }
        });

        // 保存会话
        self.sessions.write().await.insert(
            connection_id.to_string(),
            MonitorSession { cancel_token },
        );

        Ok(())
    }

    /// 停止指定连接的 MONITOR
    pub async fn stop(&self, connection_id: &str) {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.remove(connection_id) {
            session.cancel_token.cancel();
        }
    }

    /// 停止所有 MONITOR 会话
    pub async fn stop_all(&self) {
        let mut sessions = self.sessions.write().await;
        for (_, session) in sessions.drain() {
            session.cancel_token.cancel();
        }
    }

    /// 解析 MONITOR 输出行
    ///
    /// 格式: 1691234567.123456 [0 127.0.0.1:6379] "SET" "key" "value"
    fn parse_monitor_line(raw: &str) -> RedisMonitorMessage {
        let raw_trimmed = raw.trim();

        // 提取时间戳
        let mut timestamp: f64 = 0.0;
        let mut rest = raw_trimmed;

        if let Some(space_idx) = raw_trimmed.find(' ') {
            if let Ok(ts) = raw_trimmed[..space_idx].parse::<f64>() {
                timestamp = ts;
                rest = &raw_trimmed[space_idx + 1..];
            }
        }

        // 提取 [db client_addr]
        let mut database = String::new();
        let mut client_addr = String::new();
        let mut command = rest.to_string();

        if rest.starts_with('[') {
            if let Some(close) = rest.find(']') {
                let bracket_content = &rest[1..close];
                let parts: Vec<&str> = bracket_content.splitn(2, ' ').collect();
                if let Some(db) = parts.first() {
                    database = db.to_string();
                }
                if let Some(addr) = parts.get(1) {
                    client_addr = addr.to_string();
                }
                // 跳过 "] " 后的内容即为命令
                command = rest[close + 1..].trim().to_string();
            }
        }

        RedisMonitorMessage {
            timestamp,
            client_addr,
            database,
            command,
            raw: raw_trimmed.to_string(),
        }
    }
}
