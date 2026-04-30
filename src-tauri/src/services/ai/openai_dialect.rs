//! OpenAI compatible Provider 方言层
//!
//! 统一保留 OpenAI compatible 主链路，把 DeepSeek / Kimi / MiMo 等服务商差异集中在这里。

use super::models::ChatConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenAiDialectKind {
    Generic,
    DeepSeek,
    Kimi,
    MiMo,
}

#[derive(Debug, Clone, Copy)]
pub struct OpenAiDialect {
    pub kind: OpenAiDialectKind,
    pub supports_reasoning_content_replay: bool,
    pub uses_beta_for_prefix_completion: bool,
    pub uses_beta_for_fim_completion: bool,
    pub supports_json_mode: bool,
    pub supports_parallel_tool_calls: bool,
    pub requires_tool_choice_auto_for_tools: bool,
    pub uses_max_completion_tokens: bool,
    pub sends_legacy_max_tokens: bool,
    pub supports_thinking_control: bool,
}

impl OpenAiDialect {
    pub fn resolve(endpoint: &str, model: &str) -> Self {
        let lower_endpoint = endpoint.to_lowercase();
        let lower_model = model.to_lowercase();

        if lower_endpoint.contains("api.deepseek.com") || lower_model.starts_with("deepseek-") {
            return Self {
                kind: OpenAiDialectKind::DeepSeek,
                supports_reasoning_content_replay: true,
                uses_beta_for_prefix_completion: true,
                uses_beta_for_fim_completion: true,
                supports_json_mode: true,
                supports_parallel_tool_calls: true,
                requires_tool_choice_auto_for_tools: false,
                uses_max_completion_tokens: true,
                sends_legacy_max_tokens: true,
                supports_thinking_control: false,
            };
        }

        if lower_endpoint.contains("api.kimi.com")
            || lower_model.contains("kimi-for-coding")
            || lower_model.contains("kimi-code")
        {
            return Self {
                kind: OpenAiDialectKind::Kimi,
                supports_reasoning_content_replay: false,
                uses_beta_for_prefix_completion: false,
                uses_beta_for_fim_completion: false,
                supports_json_mode: true,
                supports_parallel_tool_calls: true,
                requires_tool_choice_auto_for_tools: true,
                uses_max_completion_tokens: true,
                sends_legacy_max_tokens: true,
                supports_thinking_control: false,
            };
        }

        if lower_model.contains("kimi") {
            return Self {
                kind: OpenAiDialectKind::Kimi,
                supports_reasoning_content_replay: false,
                uses_beta_for_prefix_completion: false,
                uses_beta_for_fim_completion: false,
                supports_json_mode: true,
                supports_parallel_tool_calls: true,
                requires_tool_choice_auto_for_tools: true,
                uses_max_completion_tokens: true,
                sends_legacy_max_tokens: true,
                supports_thinking_control: false,
            };
        }

        if lower_endpoint.contains("api.xiaomimimo.com")
            || lower_endpoint.contains("xiaomimimo.com")
            || lower_model.contains("mimo")
        {
            return Self {
                kind: OpenAiDialectKind::MiMo,
                supports_reasoning_content_replay: true,
                uses_beta_for_prefix_completion: false,
                uses_beta_for_fim_completion: false,
                supports_json_mode: true,
                supports_parallel_tool_calls: true,
                requires_tool_choice_auto_for_tools: false,
                uses_max_completion_tokens: true,
                sends_legacy_max_tokens: false,
                supports_thinking_control: true,
            };
        }

        Self {
            kind: OpenAiDialectKind::Generic,
            supports_reasoning_content_replay: false,
            uses_beta_for_prefix_completion: false,
            uses_beta_for_fim_completion: false,
            supports_json_mode: true,
            supports_parallel_tool_calls: true,
            requires_tool_choice_auto_for_tools: false,
            uses_max_completion_tokens: true,
            sends_legacy_max_tokens: true,
            supports_thinking_control: false,
        }
    }

    pub fn should_send_response_format(&self, config: &ChatConfig) -> bool {
        self.supports_json_mode && config.response_format.as_deref() == Some("json_object")
    }

    pub fn should_use_beta_chat_completions(&self, config: &ChatConfig) -> bool {
        self.uses_beta_for_prefix_completion && config.prefix_completion.unwrap_or(false)
    }

    pub fn should_use_beta_completion(&self, requested_beta: bool) -> bool {
        requested_beta && self.uses_beta_for_fim_completion
    }

    pub fn normalize_tool_choice<'a>(&self, requested: Option<&'a str>, has_tools: bool) -> Option<&'a str> {
        if !has_tools {
            return requested;
        }
        if self.requires_tool_choice_auto_for_tools {
            return Some("auto");
        }
        requested
    }

    pub fn apply_token_budget(&self, body: &mut serde_json::Value, max_tokens: u32) {
        if self.uses_max_completion_tokens {
            body["max_completion_tokens"] = serde_json::json!(max_tokens);
        }
        if self.sends_legacy_max_tokens {
            body["max_tokens"] = serde_json::json!(max_tokens);
        } else if let Some(object) = body.as_object_mut() {
            object.remove("max_tokens");
        }
    }

    pub fn apply_thinking_control(&self, body: &mut serde_json::Value, thinking_budget: Option<u32>) {
        if !self.supports_thinking_control {
            return;
        }
        body["thinking"] = serde_json::json!({
            "type": if thinking_budget.unwrap_or(0) > 0 { "enabled" } else { "disabled" }
        });
    }

    pub fn is_retryable_error_code(&self, code: &str) -> bool {
        let normalized = code.to_ascii_lowercase();
        matches!(
            normalized.as_str(),
            "rate_limit_exceeded"
                | "rate_limit_reached"
                | "rate_limit_reached_error"
                | "server_error"
                | "temporarily_unavailable"
                | "service_unavailable"
                | "overloaded"
                | "overloaded_error"
                | "internal_error"
                | "timeout"
                | "request_timeout"
        )
    }

    pub fn name(&self) -> &'static str {
        match self.kind {
            OpenAiDialectKind::Generic => "generic",
            OpenAiDialectKind::DeepSeek => "deepseek",
            OpenAiDialectKind::Kimi => "kimi",
            OpenAiDialectKind::MiMo => "mimo",
        }
    }
}

pub fn completion_base_url(endpoint: &str, beta: bool) -> String {
    let trimmed = endpoint.trim_end_matches('/');
    if !beta || trimmed.ends_with("/beta") {
        return trimmed.to_string();
    }
    format!("{trimmed}/beta")
}

#[cfg(test)]
mod tests {
    use super::{completion_base_url, OpenAiDialect, OpenAiDialectKind};
    use crate::services::ai::models::ChatConfig;

    #[test]
    fn resolves_deepseek_dialect_from_endpoint_or_model() {
        let by_endpoint = OpenAiDialect::resolve("https://api.deepseek.com", "x");
        let by_model = OpenAiDialect::resolve("https://example.com", "deepseek-v4-pro");

        assert_eq!(by_endpoint.kind, OpenAiDialectKind::DeepSeek);
        assert_eq!(by_model.kind, OpenAiDialectKind::DeepSeek);
        assert!(by_endpoint.supports_reasoning_content_replay);
        assert!(by_endpoint.uses_beta_for_prefix_completion);
        assert!(by_endpoint.uses_beta_for_fim_completion);
    }

    #[test]
    fn resolves_kimi_and_mimo_without_deepseek_beta_rules() {
        let kimi_code = OpenAiDialect::resolve("https://api.kimi.com/coding/v1", "kimi-for-coding");
        let mimo = OpenAiDialect::resolve("https://api.xiaomimimo.com/v1", "mimo-v2.5-pro");
        let generic_moonshot = OpenAiDialect::resolve("https://api.moonshot.cn/v1", "moonshot-v1-128k");

        assert_eq!(kimi_code.kind, OpenAiDialectKind::Kimi);
        assert_eq!(mimo.kind, OpenAiDialectKind::MiMo);
        assert_eq!(generic_moonshot.kind, OpenAiDialectKind::Generic);
        assert!(!kimi_code.uses_beta_for_prefix_completion);
        assert!(kimi_code.requires_tool_choice_auto_for_tools);
        assert!(mimo.supports_reasoning_content_replay);
        assert!(!mimo.sends_legacy_max_tokens);
        assert!(mimo.supports_thinking_control);
    }

    #[test]
    fn uses_beta_only_for_deepseek_prefix_and_fim() {
        let mut config = ChatConfig::default();
        config.prefix_completion = Some(true);

        let deepseek = OpenAiDialect::resolve("https://api.deepseek.com", "deepseek-v4-pro");
        let generic = OpenAiDialect::resolve("https://example.com", "gpt-compatible");

        assert!(deepseek.should_use_beta_chat_completions(&config));
        assert!(deepseek.should_use_beta_completion(true));
        assert!(!generic.should_use_beta_chat_completions(&config));
        assert!(!generic.should_use_beta_completion(true));
    }

    #[test]
    fn builds_beta_base_without_double_suffix() {
        assert_eq!(
            completion_base_url("https://api.deepseek.com", true),
            "https://api.deepseek.com/beta"
        );
        assert_eq!(
            completion_base_url("https://api.deepseek.com/beta", true),
            "https://api.deepseek.com/beta"
        );
        assert_eq!(
            completion_base_url("https://api.deepseek.com", false),
            "https://api.deepseek.com"
        );
    }

    #[test]
    fn normalizes_kimi_tool_choice_and_retry_codes() {
        let kimi = OpenAiDialect::resolve("https://api.kimi.com/coding/v1", "kimi-for-coding");
        let generic = OpenAiDialect::resolve("https://example.com", "generic");

        assert_eq!(kimi.normalize_tool_choice(Some("required"), true), Some("auto"));
        assert_eq!(generic.normalize_tool_choice(Some("required"), true), Some("required"));
        assert!(kimi.is_retryable_error_code("rate_limit_reached_error"));
        assert!(generic.is_retryable_error_code("temporarily_unavailable"));
        assert!(!generic.is_retryable_error_code("invalid_request_error"));
    }

    #[test]
    fn applies_mimo_token_budget_and_thinking_control() {
        let mimo = OpenAiDialect::resolve("https://api.xiaomimimo.com/v1", "mimo-v2.5-pro");
        let mut body = serde_json::json!({
            "model": "mimo-v2.5-pro",
            "max_tokens": 1024
        });

        mimo.apply_token_budget(&mut body, 8192);
        mimo.apply_thinking_control(&mut body, Some(4096));

        assert_eq!(body["max_completion_tokens"], 8192);
        assert!(body.get("max_tokens").is_none());
        assert_eq!(body["thinking"]["type"], "enabled");
    }
}
