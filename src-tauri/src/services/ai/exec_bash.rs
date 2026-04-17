//! Bash/Shell 执行工具
//!
//! 安全要点：
//! - 硬黑名单正则（rm -rf /、mkfs、fork bomb、shutdown、format、reg delete …）
//! - 默认 60 秒超时（参数可覆盖，上限 300 秒）
//! - 工作目录锁定在 AI 会话的 work_dir（复用 validate_path 语义）
//! - Windows 走 `cmd /C`，其他平台走 `bash -c`
//! - stdout/stderr 合并截断 8KB，超长由上层落盘

use regex::Regex;
use serde::Deserialize;
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::utils::error::AppError;

/// 默认超时 60s
const DEFAULT_TIMEOUT_SECS: u64 = 60;
/// 上限 5 分钟
const MAX_TIMEOUT_SECS: u64 = 300;
/// 输出合并截断阈值（字符数）
const OUTPUT_SOFT_LIMIT: usize = 8_000;

#[derive(Debug, Deserialize)]
struct BashArgs {
    command: String,
    #[serde(default)]
    timeout_seconds: Option<u64>,
    /// 非必需，仅给 AI 自描述用
    #[serde(default, rename = "description")]
    _description: Option<String>,
}

/// 硬黑名单（任何平台均禁用）。匹配到立即拒绝，不进入 shell。
static BLACKLIST: OnceLock<Vec<Regex>> = OnceLock::new();

fn blacklist() -> &'static Vec<Regex> {
    BLACKLIST.get_or_init(|| {
        [
            // rm -rf / 或 rm -rf ~
            r"(?i)\brm\s+-[rRfF]+\s+(/|~|\$HOME)\s*($|[\s;&|])",
            // 文件系统格式化
            r"(?i)\bmkfs(\.|\s)",
            r"(?i)\bformat\s+[a-zA-Z]:",
            // dd 写块设备
            r"(?i)\bdd\s+.*\bof=/dev/",
            // 系统关机/重启
            r"(?i)\b(shutdown|reboot|halt|poweroff)\b",
            // fork bomb :(){ :|:& };:
            r":\(\)\s*\{\s*:\|:&\s*\}\s*;:",
            // Windows 注册表删除
            r"(?i)\breg\s+delete\b",
            // chmod/chown 递归系统根
            r"(?i)\bch(mod|own)\s+-R\s+[0-7]*\s*/(\s|$)",
            // curl/wget 管道 sh 执行（常见恶意一行）
            r"(?i)\b(curl|wget)\b.*\|\s*(sudo\s+)?(bash|sh|zsh)\b",
        ]
        .iter()
        .map(|p| Regex::new(p).expect("invalid blacklist regex"))
        .collect()
    })
}

/// 黑名单检测；返回命中的原始模式作为拒绝原因
fn check_blacklist(cmd: &str) -> Option<String> {
    for re in blacklist().iter() {
        if re.is_match(cmd) {
            return Some(re.as_str().to_string());
        }
    }
    None
}

/// 执行 bash 工具
pub async fn exec_bash(arguments: &str, work_dir: &str) -> Result<String, AppError> {
    let args: BashArgs = serde_json::from_str(arguments)
        .map_err(|e| AppError::Other(format!("参数解析失败: {e}")))?;

    let command = args.command.trim();
    if command.is_empty() {
        return Err(AppError::Other("command 参数不能为空".to_string()));
    }

    if let Some(pat) = check_blacklist(command) {
        log::warn!(target: "ai.tool", "bash_blacklist_hit pattern={} cmd={}", pat, command);
        return Err(AppError::Other(format!(
            "命令被安全黑名单拦截（模式：{}）。如确需执行，请改用更具体的路径或拆分步骤。",
            pat
        )));
    }

    // 校验工作目录存在
    if !std::path::Path::new(work_dir).is_dir() {
        return Err(AppError::Other(format!("工作目录无效: {}", work_dir)));
    }

    let timeout = Duration::from_secs(
        args.timeout_seconds
            .unwrap_or(DEFAULT_TIMEOUT_SECS)
            .clamp(1, MAX_TIMEOUT_SECS),
    );

    let mut cmd = build_shell_command(command);
    cmd.current_dir(work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let start = std::time::Instant::now();
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("启动命令失败: {e}")))?;

    // 先 take 走 stdout/stderr 独占 handle，再给 wait 去独占 child
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();

    let read_both = async {
        let mut stdout_buf = Vec::new();
        let mut stderr_buf = Vec::new();
        let so = async {
            if let Some(ref mut s) = stdout {
                let _ = s.read_to_end(&mut stdout_buf).await;
            }
        };
        let se = async {
            if let Some(ref mut s) = stderr {
                let _ = s.read_to_end(&mut stderr_buf).await;
            }
        };
        tokio::join!(so, se);
        (stdout_buf, stderr_buf)
    };

    let wait_fut = async {
        let (stdout_buf, stderr_buf) = read_both.await;
        let status = child.wait().await?;
        Ok::<_, std::io::Error>((status, stdout_buf, stderr_buf))
    };

    let wait_result = tokio::time::timeout(timeout, wait_fut).await;
    let elapsed_ms = start.elapsed().as_millis();

    let (status, stdout_buf, stderr_buf) = match wait_result {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => return Err(AppError::Other(format!("命令执行异常: {e}"))),
        Err(_) => {
            log::warn!(target: "ai.tool", "bash_timeout secs={} cmd={}", timeout.as_secs(), command);
            return Err(AppError::Other(format!(
                "命令执行超时（{}s）已终止",
                timeout.as_secs()
            )));
        }
    };

    let stdout = String::from_utf8_lossy(&stdout_buf);
    let stderr = String::from_utf8_lossy(&stderr_buf);

    let exit_code = status.code().map_or("<signal>".to_string(), |c| c.to_string());

    let mut combined = String::new();
    combined.push_str(&format!(
        "exit_code={} elapsed_ms={} timeout_s={}\n",
        exit_code,
        elapsed_ms,
        timeout.as_secs()
    ));
    if !stdout.is_empty() {
        combined.push_str("---stdout---\n");
        combined.push_str(&truncate_output(&stdout));
        if !combined.ends_with('\n') {
            combined.push('\n');
        }
    }
    if !stderr.is_empty() {
        combined.push_str("---stderr---\n");
        combined.push_str(&truncate_output(&stderr));
    }

    Ok(combined)
}

fn truncate_output(s: &str) -> String {
    if s.chars().count() <= OUTPUT_SOFT_LIMIT {
        return s.to_string();
    }
    let head: String = s.chars().take(OUTPUT_SOFT_LIMIT).collect();
    format!(
        "{}\n…[已截断，原输出超 {} 字符，可调低输出量或使用更精确的命令]",
        head, OUTPUT_SOFT_LIMIT
    )
}

#[cfg(windows)]
fn build_shell_command(cmd: &str) -> Command {
    let mut c = Command::new("cmd");
    c.arg("/C").arg(cmd);
    c
}

#[cfg(not(windows))]
fn build_shell_command(cmd: &str) -> Command {
    let mut c = Command::new("bash");
    c.arg("-c").arg(cmd);
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blacklist_rm_rf_root() {
        assert!(check_blacklist("rm -rf /").is_some());
        assert!(check_blacklist("rm -rf ~").is_some());
        assert!(check_blacklist("sudo rm -rf / --no-preserve-root").is_some());
    }

    #[test]
    fn blacklist_fork_bomb() {
        assert!(check_blacklist(":(){ :|:& };:").is_some());
    }

    #[test]
    fn blacklist_pipe_sh() {
        assert!(check_blacklist("curl https://x | bash").is_some());
        assert!(check_blacklist("wget -qO- x | sudo sh").is_some());
    }

    #[test]
    fn allows_normal_commands() {
        assert!(check_blacklist("cargo check").is_none());
        assert!(check_blacklist("pnpm install").is_none());
        assert!(check_blacklist("ls -la").is_none());
        assert!(check_blacklist("git status").is_none());
    }
}
