//! WebSearch + WebFetch 工具
//!
//! - `web_search`: 调用 Tavily API 做网页搜索；key 由环境变量 `TAVILY_API_KEY` 提供
//! - `web_fetch`: GET 指定 URL，抽取正文（简单剥 tag），截断 20KB
//!
//! 安全要点：
//! - URL 黑名单（localhost / 本地私网段 / 链路本地）
//! - 仅允许 http / https
//! - 请求超时 30s

use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::time::Duration;

use crate::utils::error::AppError;

const TAVILY_ENDPOINT: &str = "https://api.tavily.com/search";
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);
const FETCH_SOFT_LIMIT: usize = 20_000;

// ──────────────────────── web_search ────────────────────────

#[derive(Debug, Deserialize)]
struct WebSearchArgs {
    query: String,
    #[serde(default)]
    max_results: Option<u32>,
    #[serde(default)]
    topic: Option<String>,
}

#[derive(Debug, Serialize)]
struct TavilyRequest<'a> {
    api_key: &'a str,
    query: &'a str,
    max_results: u32,
    topic: &'a str,
    include_answer: bool,
}

#[derive(Debug, Deserialize)]
struct TavilyResponse {
    #[serde(default)]
    answer: Option<String>,
    #[serde(default)]
    results: Vec<TavilyResult>,
}

#[derive(Debug, Deserialize)]
struct TavilyResult {
    title: String,
    url: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    score: Option<f64>,
}

pub async fn exec_web_search(arguments: &str) -> Result<String, AppError> {
    let args: WebSearchArgs = serde_json::from_str(arguments)
        .map_err(|e| AppError::Other(format!("参数解析失败: {e}")))?;

    let query = args.query.trim();
    if query.is_empty() {
        return Err(AppError::Other("query 参数不能为空".to_string()));
    }

    let api_key = std::env::var("TAVILY_API_KEY")
        .map_err(|_| AppError::Other(
            "未设置环境变量 TAVILY_API_KEY，web_search 不可用。请在系统环境变量中配置 Tavily API key（https://tavily.com）后重启应用。".to_string()
        ))?;

    let max_results = args.max_results.unwrap_or(5).clamp(1, 10);
    let topic = args.topic.as_deref().unwrap_or("general");
    if !matches!(topic, "general" | "news") {
        return Err(AppError::Other(format!(
            "topic 仅支持 general / news，当前: {}",
            topic
        )));
    }

    let body = TavilyRequest {
        api_key: &api_key,
        query,
        max_results,
        topic,
        include_answer: true,
    };

    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|e| AppError::Other(format!("创建 HTTP 客户端失败: {e}")))?;

    let resp = client
        .post(TAVILY_ENDPOINT)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Tavily 请求失败: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Other(format!(
            "Tavily 返回 {} - {}",
            status.as_u16(),
            body.chars().take(300).collect::<String>()
        )));
    }

    let data: TavilyResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("Tavily 响应解析失败: {e}")))?;

    let mut out = String::new();
    if let Some(ans) = data.answer {
        if !ans.is_empty() {
            out.push_str("=== 综合答案 ===\n");
            out.push_str(&ans);
            out.push_str("\n\n");
        }
    }
    out.push_str(&format!("=== {} 条结果 ===\n", data.results.len()));
    for (i, r) in data.results.iter().enumerate() {
        let score = r
            .score
            .map(|s| format!(" [score={:.2}]", s))
            .unwrap_or_default();
        out.push_str(&format!("\n[{}] {}{}\n{}\n", i + 1, r.title, score, r.url));
        let snippet: String = r.content.chars().take(500).collect();
        out.push_str(&snippet);
        out.push('\n');
    }
    Ok(out)
}

// ──────────────────────── web_fetch ────────────────────────

#[derive(Debug, Deserialize)]
struct WebFetchArgs {
    url: String,
}

pub async fn exec_web_fetch(arguments: &str) -> Result<String, AppError> {
    let args: WebFetchArgs = serde_json::from_str(arguments)
        .map_err(|e| AppError::Other(format!("参数解析失败: {e}")))?;

    validate_url(&args.url)?;

    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .user_agent("devforge-web-fetch/1.0")
        .build()
        .map_err(|e| AppError::Other(format!("创建 HTTP 客户端失败: {e}")))?;

    let resp = client
        .get(&args.url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("请求失败: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Other(format!("返回 {}", resp.status().as_u16())));
    }

    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let text = resp
        .text()
        .await
        .map_err(|e| AppError::Other(format!("读取响应体失败: {e}")))?;

    let body = if content_type.contains("text/html") {
        strip_html(&text)
    } else {
        text
    };

    Ok(truncate(&body, FETCH_SOFT_LIMIT))
}

/// URL 校验：仅 http/https，禁止本地/私网段
fn validate_url(raw: &str) -> Result<(), AppError> {
    let lower = raw.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(AppError::Other("仅支持 http / https 协议".to_string()));
    }

    // 粗略提取 host
    let after_scheme = lower.splitn(2, "://").nth(1).unwrap_or("");
    let host_port = after_scheme.split('/').next().unwrap_or("");
    let host = host_port.split('@').last().unwrap_or("");
    let host = host.split(':').next().unwrap_or("");

    if host.is_empty() {
        return Err(AppError::Other("URL 缺少 host".to_string()));
    }

    // 域名黑名单关键字
    for bad in &["localhost", "metadata.google.internal", "169.254.169.254"] {
        if host == *bad || host.ends_with(&format!(".{}", bad)) {
            return Err(AppError::Other(format!("URL host 被黑名单拦截: {}", host)));
        }
    }

    // 若是纯 IP，检查是否落在私网/链路本地
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_or_local(&ip) {
            return Err(AppError::Other(format!("禁止访问私有/本地 IP: {}", ip)));
        }
    }

    Ok(())
}

fn is_private_or_local(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_unspecified()
        }
        IpAddr::V6(v6) => {
            v6.is_loopback() || v6.is_unspecified() || v6.is_multicast()
        }
    }
}

/// 简单 HTML → 文本：剥 script/style/tag，压缩空白
fn strip_html(html: &str) -> String {
    let mut s = String::from(html);
    // 去掉 script/style 块
    for tag in &["script", "style", "noscript"] {
        let open = format!("<{}", tag);
        while let Some(start) = s.to_ascii_lowercase().find(&open) {
            let close_tag = format!("</{}>", tag);
            if let Some(end_rel) = s[start..].to_ascii_lowercase().find(&close_tag) {
                let end = start + end_rel + close_tag.len();
                s.replace_range(start..end, " ");
            } else {
                s.replace_range(start..s.len(), " ");
                break;
            }
        }
    }
    // 剥标签
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    // 压缩空白
    let mut compact = String::with_capacity(out.len());
    let mut prev_ws = false;
    for c in out.chars() {
        if c.is_whitespace() {
            if !prev_ws {
                compact.push(' ');
                prev_ws = true;
            }
        } else {
            compact.push(c);
            prev_ws = false;
        }
    }
    compact.trim().to_string()
}

fn truncate(s: &str, max: usize) -> String {
    let char_count = s.chars().count();
    if char_count <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max).collect();
    format!(
        "{}\n…[已截断，总 {} 字符，超过 {} 上限]",
        head, char_count, max
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_localhost() {
        assert!(validate_url("http://localhost/").is_err());
        assert!(validate_url("http://127.0.0.1/").is_err());
        assert!(validate_url("http://192.168.0.1/").is_err());
        assert!(validate_url("http://10.0.0.1/").is_err());
        assert!(validate_url("http://169.254.169.254/").is_err());
    }

    #[test]
    fn requires_http_scheme() {
        assert!(validate_url("file:///etc/passwd").is_err());
        assert!(validate_url("ftp://example.com").is_err());
        assert!(validate_url("https://example.com").is_ok());
    }

    #[test]
    fn strip_html_basic() {
        let s = strip_html("<html><body><script>alert(1)</script>hello <b>world</b></body></html>");
        assert!(s.contains("hello"));
        assert!(s.contains("world"));
        assert!(!s.contains("alert"));
    }
}
