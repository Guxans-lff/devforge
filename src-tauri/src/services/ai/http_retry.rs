/// HTTP retry helpers for pre-stream request setup only.
///
/// Once a streaming response has started, we do not retry, to avoid duplicating
/// tool calls or assistant turns.
use reqwest::RequestBuilder;
use std::time::Duration;

/// Generic retry delays before each attempt.
const BACKOFF_MS: &[u64] = &[0, 2000, 5000];
/// Maximum number of attempts including the first try.
pub const MAX_ATTEMPTS: usize = 3;

pub fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    status.as_u16() == 429 || status.is_server_error()
}

/// Whether a reqwest error is worth retrying.
fn is_retryable_error(e: &reqwest::Error) -> bool {
    e.is_connect() || e.is_timeout() || e.is_request()
}

/// Whether the connection pool may hold a stale socket and should rebuild the client.
fn is_connection_rotten(e: &reqwest::Error) -> bool {
    e.is_connect() || e.is_request() || e.is_timeout()
}

/// Send a request with optional client rebuilds between retries.
pub async fn send_with_rebuild<B, R>(
    mut make_builder: B,
    mut rebuild: R,
) -> Result<reqwest::Response, reqwest::Error>
where
    B: FnMut() -> RequestBuilder,
    R: FnMut(),
{
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

        if attempt > 0
            && last_err
                .as_ref()
                .map(is_connection_rotten)
                .unwrap_or(false)
        {
            log::warn!(
                target: "ai.stream",
                "rebuild_http_client attempt={} reason=connection_rotten",
                attempt + 1
            );
            rebuild();
        }

        let req = make_builder();
        match req.send().await {
            Ok(resp) => {
                let status = resp.status();
                if status.as_u16() == 429 && attempt + 1 < MAX_ATTEMPTS {
                    log::warn!(
                        target: "ai.stream",
                        "rate_limit_retry status=429 attempt={}",
                        attempt + 1,
                    );
                    continue;
                }
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

/// Send a cloneable request with retry/backoff.
#[allow(dead_code)]
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
            return builder.send().await;
        };

        match req.send().await {
            Ok(resp) => {
                let status = resp.status();
                if status.as_u16() == 429 && attempt + 1 < MAX_ATTEMPTS {
                    log::warn!(
                        target: "ai.stream",
                        "rate_limit_retry status=429 attempt={}",
                        attempt + 1,
                    );
                    continue;
                }
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

#[cfg(test)]
mod tests {
    use super::is_retryable_status;

    #[test]
    fn marks_429_and_5xx_as_retryable_statuses() {
        assert!(is_retryable_status(reqwest::StatusCode::TOO_MANY_REQUESTS));
        assert!(is_retryable_status(reqwest::StatusCode::BAD_GATEWAY));
        assert!(is_retryable_status(reqwest::StatusCode::SERVICE_UNAVAILABLE));
        assert!(is_retryable_status(reqwest::StatusCode::GATEWAY_TIMEOUT));
    }

    #[test]
    fn does_not_mark_regular_4xx_as_retryable_statuses() {
        assert!(!is_retryable_status(reqwest::StatusCode::BAD_REQUEST));
        assert!(!is_retryable_status(reqwest::StatusCode::UNAUTHORIZED));
        assert!(!is_retryable_status(reqwest::StatusCode::FORBIDDEN));
        assert!(!is_retryable_status(reqwest::StatusCode::NOT_FOUND));
    }
}
