/// HTTP 重试工具
///
/// 仅用于"流建立前"的幂等请求：5xx 或连接错自动重试 1-2 次。
/// 流一旦开始（response 已拿到）就不再重试——避免重复 tool_use 或消息重发。
use reqwest::RequestBuilder;
use std::time::Duration;

/// 退避间隔（发送前等待）
const BACKOFF_MS: &[u64] = &[0, 2000, 5000];

/// 最多尝试次数（含首发） = BACKOFF_MS.len()
pub const MAX_ATTEMPTS: usize = 3;

/// 判断 reqwest 错误是否值得重试
fn is_retryable_error(e: &reqwest::Error) -> bool {
    e.is_connect() || e.is_timeout() || e.is_request()
}

/// 发送请求，对网络错 / 5xx 自动退避重试。
/// 4xx / 成功 响应直接返回，不重试。
pub async fn send_with_backoff(
    builder: RequestBuilder,
) -> Result<reqwest::Response, reqwest::Error> {
    let mut last_err: Option<reqwest::Error> = None;

    for (attempt, delay_ms) in BACKOFF_MS.iter().enumerate() {
        if *delay_ms > 0 {
            log::warn!(
                target: "ai.stream",
                "reconnect_attempt n={} after {}ms",
                attempt + 1,
                delay_ms
            );
            tokio::time::sleep(Duration::from_millis(*delay_ms)).await;
        }

        let Some(req) = builder.try_clone() else {
            // RequestBuilder 不可克隆（body 是 stream 等）— 退化为单次发送
            return builder.send().await;
        };

        match req.send().await {
            Ok(resp) => {
                let status = resp.status();
                // 仅 5xx 重试；其他状态（含 4xx）直接返回
                if status.is_server_error() && attempt + 1 < MAX_ATTEMPTS {
                    log::warn!(
                        target: "ai.stream",
                        "server_error_retry status={} attempt={}",
                        status.as_u16(),
                        attempt + 1
                    );
                    continue;
                }
                return Ok(resp);
            }
            Err(e) => {
                if is_retryable_error(&e) && attempt + 1 < MAX_ATTEMPTS {
                    log::warn!(
                        target: "ai.stream",
                        "net_error_retry attempt={} err={}",
                        attempt + 1,
                        e
                    );
                    last_err = Some(e);
                    continue;
                }
                return Err(e);
            }
        }
    }

    Err(last_err.expect("retry loop exited without error"))
}
