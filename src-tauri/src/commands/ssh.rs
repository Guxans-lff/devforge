use tauri::Manager;

use crate::commands::connection::{StorageState, TestResult};
use crate::models::ssh::{AuthConfig, ProxyJumpConfig, SessionInfo};
use crate::services::ssh_auth;
use crate::services::ssh_engine::SshEngine;
use crate::utils::error::AppError;
use std::sync::Arc;
use tokio::time::Instant;

pub type SshEngineState = Arc<SshEngine>;

/// 从 connection 的 configJson 解析跳板机配置
pub async fn resolve_proxy_from_config(
    storage: &crate::services::storage::Storage,
    config_json: &str,
) -> Result<Option<ProxyJumpConfig>, AppError> {
    let config: serde_json::Value = serde_json::from_str(config_json)
        .unwrap_or_else(|_| serde_json::json!({}));

    let proxy_id = match config["proxyJump"]["connectionId"].as_str() {
        Some(id) if !id.is_empty() => id,
        _ => return Ok(None),
    };

    // storage.get_connection 返回 Result<_, AppError>，直接 ? 传播
    let proxy_conn = storage
        .get_connection(proxy_id)
        .await?;

    // ssh_auth::parse_auth_config 返回 Result<_, AppError>，直接 ? 传播
    let proxy_auth = ssh_auth::parse_auth_config(proxy_id, &proxy_conn.config_json)?;

    Ok(Some(ProxyJumpConfig {
        host: proxy_conn.host,
        port: proxy_conn.port as u16,
        username: proxy_conn.username,
        auth: proxy_auth,
    }))
}

#[tauri::command]
pub async fn ssh_connect(
    app_handle: tauri::AppHandle,
    connection_id: String,
    cols: u32,
    rows: u32,
) -> Result<SessionInfo, AppError> {
    let ssh_engine = app_handle.state::<SshEngineState>().inner().clone();
    let storage = app_handle.state::<StorageState>().inner().clone();

    let conn = storage
        .get_connection(&connection_id)
        .await?;

    let auth = ssh_auth::parse_auth_config(&connection_id, &conn.config_json)?;

    let proxy = resolve_proxy_from_config(&storage, &conn.config_json).await?;

    let session_id = uuid::Uuid::new_v4().to_string();

    ssh_engine
        .connect(
            &app_handle,
            &session_id,
            &connection_id,
            &conn.host,
            conn.port as u16,
            &conn.username,
            &auth,
            proxy.as_ref(),
            cols,
            rows,
        )
        .await
}

#[tauri::command]
pub async fn ssh_disconnect(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<bool, AppError> {
    let ssh_engine = app.state::<SshEngineState>().inner().clone();
    ssh_engine
        .disconnect(&session_id)
        .await?;
    Ok(true)
}

#[tauri::command]
pub async fn ssh_send_data(
    app: tauri::AppHandle,
    session_id: String,
    data: String,
) -> Result<(), AppError> {
    let ssh_engine = app.state::<SshEngineState>().inner().clone();
    ssh_engine
        .send_data(&session_id, data.as_bytes())
        .await
}

#[tauri::command]
pub async fn ssh_resize(
    app: tauri::AppHandle,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), AppError> {
    let ssh_engine = app.state::<SshEngineState>().inner().clone();
    ssh_engine
        .resize(&session_id, cols, rows)
        .await
}

#[tauri::command]
pub async fn ssh_flow_ack(
    app: tauri::AppHandle,
    session_id: String,
    bytes: u64,
) -> Result<(), AppError> {
    let ssh_engine = app.state::<SshEngineState>().inner().clone();
    ssh_engine
        .flow_ack(&session_id, bytes)
        .await
}

#[tauri::command]
pub async fn ssh_get_cwd(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<String, AppError> {
    let ssh_engine = app.state::<SshEngineState>().inner().clone();
    ssh_engine
        .get_cwd(&session_id)
        .await
}

#[tauri::command]
pub async fn ssh_exec_command(
    app_handle: tauri::AppHandle,
    connection_id: String,
    command: String,
) -> Result<String, AppError> {
    let storage = app_handle.state::<StorageState>().inner().clone();
    let conn = storage
        .get_connection(&connection_id)
        .await?;

    let auth = ssh_auth::parse_auth_config(&connection_id, &conn.config_json)?;

    let config = crate::services::ssh_auth::create_ssh_config();
    // russh::client::connect 返回 russh::Error，包装为 AppError::Connection
    let mut session = russh::client::connect(config, (&*conn.host, conn.port as u16), TestSshClient)
        .await
        .map_err(|e| AppError::Connection(format!("SSH 连接失败: {}", e)))?;

    // ssh_auth::authenticate 返回 Result<_, AppError>，直接 ? 传播
    ssh_auth::authenticate(&mut session, &conn.username, &auth)
        .await?;

    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| AppError::Connection(format!("打开通道失败: {}", e)))?;

    channel
        .exec(true, command.as_bytes())
        .await
        .map_err(|e| AppError::Connection(format!("执行命令失败: {}", e)))?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();

    let result = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            match channel.wait().await {
                Some(russh::ChannelMsg::Data { data }) => {
                    stdout.extend_from_slice(&data);
                }
                Some(russh::ChannelMsg::ExtendedData { data, ext }) if ext == 1 => {
                    stderr.extend_from_slice(&data);
                }
                Some(russh::ChannelMsg::Eof) | None => break,
                _ => {}
            }
        }
    })
    .await;

    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "")
        .await;

    if result.is_err() {
        return Err(AppError::Timeout("命令执行超时（10秒）".to_string()));
    }

    if !stderr.is_empty() {
        let err_msg = String::from_utf8_lossy(&stderr);
        if stdout.is_empty() {
            return Err(AppError::Other(err_msg.trim().to_string()));
        }
    }

    String::from_utf8(stdout)
        .map(|s| s.trim().to_string())
        .map_err(|e| AppError::Other(format!("输出解码失败: {}", e)))
}

/// 采集服务器指标的合并命令
const METRICS_COMMAND: &str = r#"echo "===CPU===" && top -bn1 | head -5 && echo "===MEM===" && free -m && echo "===DISK===" && df -m --output=source,target,size,used,avail,pcent -x tmpfs -x devtmpfs 2>/dev/null || df -m && echo "===NET===" && cat /proc/net/dev 2>/dev/null && echo "===LOAD===" && cat /proc/loadavg && echo "===UPTIME===" && cat /proc/uptime"#;

/// 采集远程服务器系统指标
#[tauri::command]
pub async fn ssh_collect_metrics(
    app_handle: tauri::AppHandle,
    connection_id: String,
) -> Result<crate::models::ssh::ServerMetrics, AppError> {
    let output = ssh_exec_command(app_handle, connection_id, METRICS_COMMAND.to_string()).await?;
    parse_server_metrics(&output)
}

/// 解析合并命令的输出为结构化指标
fn parse_server_metrics(raw: &str) -> Result<crate::models::ssh::ServerMetrics, AppError> {
    use crate::models::ssh::*;

    let sections = split_sections(raw);

    // 解析 CPU
    let cpu_section = sections.get("CPU").map(|s| s.as_str()).unwrap_or("");
    let (cpu_usage, cpu_cores) = parse_cpu(cpu_section);

    // 解析内存
    let mem_section = sections.get("MEM").map(|s| s.as_str()).unwrap_or("");
    let (mem_total, mem_used, mem_available, swap_total, swap_used) = parse_memory(mem_section);

    // 解析磁盘
    let disk_section = sections.get("DISK").map(|s| s.as_str()).unwrap_or("");
    let disks = parse_disks(disk_section);

    // 解析网络
    let net_section = sections.get("NET").map(|s| s.as_str()).unwrap_or("");
    let network = parse_network(net_section);

    // 解析负载
    let load_section = sections.get("LOAD").map(|s| s.as_str()).unwrap_or("");
    let load_avg = parse_load_avg(load_section);

    // 解析运行时间
    let uptime_section = sections.get("UPTIME").map(|s| s.as_str()).unwrap_or("");
    let uptime_seconds = parse_uptime(uptime_section);

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    Ok(ServerMetrics {
        cpu_usage,
        cpu_cores,
        memory_total: mem_total,
        memory_used: mem_used,
        memory_available: mem_available,
        swap_total,
        swap_used,
        disks,
        network,
        load_avg,
        uptime_seconds,
        timestamp,
    })
}

/// 按 ===XXX=== 分割输出为各段
fn split_sections(raw: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let mut current_key = String::new();
    let mut current_content = String::new();

    for line in raw.lines() {
        if let Some(key) = line.strip_prefix("===").and_then(|s| s.strip_suffix("===")) {
            if !current_key.is_empty() {
                map.insert(current_key.clone(), current_content.trim().to_string());
            }
            current_key = key.to_string();
            current_content.clear();
        } else {
            current_content.push_str(line);
            current_content.push('\n');
        }
    }
    if !current_key.is_empty() {
        map.insert(current_key, current_content.trim().to_string());
    }
    map
}

/// 从 top 输出解析 CPU 使用率和核心数
fn parse_cpu(section: &str) -> (f64, u32) {
    let mut cpu_usage = 0.0;
    let mut cores = 1u32;

    for line in section.lines() {
        // top 输出示例: %Cpu(s):  5.0 us,  2.0 sy,  0.0 ni, 92.5 id, ...
        if line.contains("Cpu") || line.contains("cpu") {
            // 匹配 idle 百分比
            if let Some(idle_str) = extract_field(line, "id") {
                if let Ok(idle) = idle_str.parse::<f64>() {
                    cpu_usage = 100.0 - idle;
                }
            }
        }
        // 提取 CPU 核心数（从 top 的 "Tasks" 行上方或 %Cpu 行推断）
        // 备选：从 top 头行中找线程数推断，但最可靠的方式是 nproc
        // 这里简化处理，后续可扩展
    }

    // 尝试从 top 输出提取核心数（如果有多核信息）
    for line in section.lines() {
        if line.contains("Cpu") && line.contains("/") {
            // 某些 top 版本会显示 "8 Cpu"
            let parts: Vec<&str> = line.split_whitespace().collect();
            for (i, part) in parts.iter().enumerate() {
                if part.to_lowercase().contains("cpu") && i > 0 {
                    if let Ok(n) = parts[i - 1].parse::<u32>() {
                        cores = n;
                    }
                }
            }
        }
    }

    (cpu_usage, cores)
}

/// 从字符串中提取指定字段前面的数字（如 "92.5 id" → "92.5"）
fn extract_field(line: &str, field: &str) -> Option<String> {
    let parts: Vec<&str> = line.split(',').collect();
    for part in parts {
        let trimmed = part.trim();
        if trimmed.ends_with(field) || trimmed.contains(&format!(" {}", field)) {
            let tokens: Vec<&str> = trimmed.split_whitespace().collect();
            if let Some(first) = tokens.first() {
                return Some(first.replace('%', ""));
            }
        }
    }
    None
}

/// 从 free -m 解析内存信息
fn parse_memory(section: &str) -> (u64, u64, u64, u64, u64) {
    let mut mem_total = 0u64;
    let mut mem_used = 0u64;
    let mut mem_available = 0u64;
    let mut swap_total = 0u64;
    let mut swap_used = 0u64;

    for line in section.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if line.starts_with("Mem:") && parts.len() >= 4 {
            mem_total = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            mem_used = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
            // free -m 第 7 列是 available
            mem_available = parts.get(6).and_then(|s| s.parse().ok()).unwrap_or(0);
        }
        if line.starts_with("Swap:") && parts.len() >= 3 {
            swap_total = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            swap_used = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
        }
    }

    (mem_total, mem_used, mem_available, swap_total, swap_used)
}

/// 从 df 输出解析磁盘信息
fn parse_disks(section: &str) -> Vec<crate::models::ssh::DiskInfo> {
    let mut disks = Vec::new();

    for line in section.lines() {
        // 跳过标题行
        if line.starts_with("Filesystem") || line.starts_with("文件系统") || line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 6 {
            let filesystem = parts[0].to_string();
            // 跳过伪文件系统
            if filesystem.starts_with("tmpfs")
                || filesystem.starts_with("devtmpfs")
                || filesystem == "none"
                || filesystem == "udev"
            {
                continue;
            }

            let mount_or_target = parts[parts.len() - 1].to_string();
            let use_str = parts[parts.len() - 2].replace('%', "");
            let use_percent = use_str.parse::<f64>().unwrap_or(0.0);

            // df -m 输出：Size Used Avail
            let total_mb = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            let used_mb = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
            let available_mb = parts.get(3).and_then(|s| s.parse().ok()).unwrap_or(0);

            disks.push(crate::models::ssh::DiskInfo {
                filesystem,
                mount_point: mount_or_target,
                total_mb,
                used_mb,
                available_mb,
                use_percent,
            });
        }
    }

    disks
}

/// 从 /proc/net/dev 解析网络接口信息
fn parse_network(section: &str) -> Vec<crate::models::ssh::NetworkInterface> {
    let mut interfaces = Vec::new();

    for line in section.lines() {
        if !line.contains(':') || line.contains("Inter") || line.contains("face") {
            continue;
        }
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() < 2 {
            continue;
        }
        let name = parts[0].trim().to_string();
        // 跳过 lo
        if name == "lo" {
            continue;
        }
        let stats: Vec<&str> = parts[1].split_whitespace().collect();
        if stats.len() >= 9 {
            let rx_bytes = stats[0].parse::<u64>().unwrap_or(0);
            let tx_bytes = stats[8].parse::<u64>().unwrap_or(0);
            interfaces.push(crate::models::ssh::NetworkInterface {
                name,
                rx_bytes,
                tx_bytes,
            });
        }
    }

    interfaces
}

/// 从 /proc/loadavg 解析负载均值
fn parse_load_avg(section: &str) -> [f64; 3] {
    let parts: Vec<&str> = section.split_whitespace().collect();
    [
        parts.first().and_then(|s| s.parse().ok()).unwrap_or(0.0),
        parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0.0),
        parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0.0),
    ]
}

/// 从 /proc/uptime 解析运行时间
fn parse_uptime(section: &str) -> u64 {
    section
        .split_whitespace()
        .next()
        .and_then(|s| s.parse::<f64>().ok())
        .map(|s| s as u64)
        .unwrap_or(0)
}

struct TestSshClient;

#[async_trait::async_trait]
impl russh::client::Handler for TestSshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

async fn ssh_test_connect(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthConfig,
) -> Result<u64, AppError> {
    let start = Instant::now();
    let config = crate::services::ssh_auth::create_ssh_config();

    // russh::client::connect 返回 russh::Error，包装为 AppError::Connection
    let mut session = russh::client::connect(config, (host, port), TestSshClient)
        .await
        .map_err(|e| AppError::Connection(format!("SSH connection failed: {}", e)))?;

    // ssh_auth::authenticate 返回 Result<_, AppError>，直接 ? 传播
    ssh_auth::authenticate(&mut session, username, auth)
        .await?;

    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "")
        .await;

    Ok(start.elapsed().as_millis() as u64)
}

#[tauri::command]
pub async fn ssh_test_connection(
    app: tauri::AppHandle,
    id: String,
) -> Result<TestResult, AppError> {
    let storage = app.state::<StorageState>().inner().clone();
    let conn = storage
        .get_connection(&id)
        .await?;

    let auth = ssh_auth::parse_auth_config(&id, &conn.config_json)?;

    // ssh_test_connect 现在返回 AppError，Err(e) 需要 .to_string() 赋值给 message
    match ssh_test_connect(&conn.host, conn.port as u16, &conn.username, &auth).await {
        Ok(latency) => Ok(TestResult {
            success: true,
            message: format!("Connected to {}:{} ({}ms)", conn.host, conn.port, latency),
            latency_ms: Some(latency),
        }),
        Err(e) => Ok(TestResult {
            success: false,
            message: e.to_string(),
            latency_ms: None,
        }),
    }
}

#[tauri::command]
pub async fn ssh_test_connection_params(
    host: String,
    port: u16,
    username: String,
    password: String,
    auth_method: Option<String>,
    private_key_path: Option<String>,
    passphrase: Option<String>,
) -> Result<TestResult, AppError> {
    let auth = match auth_method.as_deref() {
        Some("key") => AuthConfig::PrivateKey {
            key_path: private_key_path.unwrap_or_default(),
            passphrase,
        },
        _ => AuthConfig::Password { password },
    };

    // ssh_test_connect 现在返回 AppError，Err(e) 需要 .to_string() 赋值给 message
    match ssh_test_connect(&host, port, &username, &auth).await {
        Ok(latency) => Ok(TestResult {
            success: true,
            message: format!("Connected to {}:{} ({}ms)", host, port, latency),
            latency_ms: Some(latency),
        }),
        Err(e) => Ok(TestResult {
            success: false,
            message: e.to_string(),
            latency_ms: None,
        }),
    }
}
