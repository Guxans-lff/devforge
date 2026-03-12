use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine;
use russh::client;
use russh::{ChannelMsg, Disconnect};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, RwLock};

use crate::models::ssh::{AuthConfig, ProxyJumpConfig, SessionInfo};
use crate::services::ssh_auth;
use crate::services::terminal_recorder::SharedRecordingWriter;
use crate::utils::error::AppError;

/// 从 Tauri command 发送到 per-session I/O task 的命令
enum SessionCommand {
    Data(Vec<u8>),
    Resize(u32, u32),
    /// 前端 ACK：已处理的字节数
    Ack(u64),
    /// 获取终端当前工作目录（通过在同一 session 上开 exec channel）
    GetCwd(tokio::sync::oneshot::Sender<String>),
    Close,
}

/// Minimal SSH client handler — accepts all host keys (like StrictHostKeyChecking=no).
struct SshClient;

#[async_trait]
impl client::Handler for SshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// Stored state for an active SSH session.
struct SshSession {
    cmd_tx: mpsc::UnboundedSender<SessionCommand>,
    _connection_id: String,
    recording_writer: SharedRecordingWriter,
}

/// SSH 引擎：内部使用 RwLock<HashMap> 实现 per-connection 级别锁定，
/// 不同连接的操作互不阻塞。
pub struct SshEngine {
    sessions: RwLock<HashMap<String, SshSession>>,
}

impl SshEngine {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn connect(
        &self,
        app_handle: &AppHandle,
        session_id: &str,
        connection_id: &str,
        host: &str,
        port: u16,
        username: &str,
        auth: &AuthConfig,
        proxy: Option<&ProxyJumpConfig>,
        cols: u32,
        rows: u32,
    ) -> Result<SessionInfo, AppError> {
        // 清理已存在的同 ID 会话（原子写锁移除，避免 read+disconnect 竞态）
        if let Some(old_session) = self.sessions.write().await.remove(session_id) {
            let _ = old_session.cmd_tx.send(SessionCommand::Close);
        }

        // 终端连接使用小窗口 config，实现 SSH 协议层面的流控
        let config = ssh_auth::create_ssh_terminal_config();
        let handler = SshClient;

        let (session, _proxy_handle) = if let Some(proxy) = proxy {
            // 通过跳板机连接（跳板机本身用大窗口，目标终端用小窗口）
            let (target, proxy_h) = ssh_auth::connect_via_proxy_terminal(
                proxy, host, port, username, auth, handler,
            ).await?;
            (target, Some(proxy_h))
        } else {
            // 直连（带 10 秒连接超时，防止网络异常时长时间挂起）
            let connect_future = client::connect(config, (host, port), handler);
            let mut sess = tokio::time::timeout(Duration::from_secs(10), connect_future)
                .await
                .map_err(|_| AppError::Other("SSH 连接超时（10 秒）".to_string()))?
                .map_err(|e| AppError::Other(format!("SSH connection failed: {}", e)))?;
            ssh_auth::authenticate(&mut sess, username, auth).await?;
            (sess, None)
        };

        let mut channel = session
            .channel_open_session()
            .await
            .map_err(|e| AppError::Other(format!("Failed to open SSH channel: {}", e)))?;

        channel
            .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
            .await
            .map_err(|e| AppError::Other(format!("Failed to request PTY: {}", e)))?;

        channel
            .request_shell(false)
            .await
            .map_err(|e| AppError::Other(format!("Failed to start shell: {}", e)))?;

        // Create command channel for the I/O task
        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();

        // 录制写入器（初始为空，start_recording 时设置）
        let recording_writer: SharedRecordingWriter = Arc::new(tokio::sync::Mutex::new(None));
        let recording_writer_for_task = recording_writer.clone();

        let sid = session_id.to_string();
        let app = app_handle.clone();

        // Spawn I/O task that owns the channel exclusively
        tokio::spawn(async move {
            // 保持跳板机连接存活（如果有的话）
            let _proxy_keepalive = _proxy_handle;

            let output_event = format!("ssh://output/{}", sid);
            let status_event = format!("ssh://status/{}", sid);

            // === 企业级流控引擎 ===
            //
            // 背景：russh 0.48 内部 channel 使用 unbounded mpsc，且自动发送
            // CHANNEL_WINDOW_ADJUST 续窗口。这意味着"不调用 channel.wait()"
            // 无法产生 TCP 背压——数据会无限堆积在 russh 内部的 unbounded channel 中。
            //
            // 因此我们的策略是：
            //   1. 始终消费 channel.wait()（防止 russh 内部 OOM）
            //   2. 通过 ACK 机制控制发送到前端的速率
            //   3. 当前端处理不过来时（in_flight 过高），丢弃中间数据只保留尾部
            //      （终端会短暂乱码但很快恢复，因为最新的转义序列会重置状态）
            //   4. 后端内存使用量被 out_buf 的硬上限（MAX_BUF_SIZE）严格控制
            //
            // 配合 create_ssh_terminal_config() 的小窗口（128KB），可以降低
            // 远端瞬时发送量，减轻后端缓冲压力。

            let mut out_buf: Vec<u8> = Vec::with_capacity(65_536);
            // 发送用的临时缓冲区，避免 drain 的 memmove 开销
            let mut send_buf: Vec<u8> = Vec::with_capacity(65_536);

            // 流控参数
            const FLUSH_INTERVAL_MS: u64 = 8;             // 发送间隔 8ms ~120fps，更丝滑
            const HIGH_WATER: u64 = 1024 * 1024;          // 高水位线 1MB：超过则暂停发送
            const LOW_WATER: u64 = 256 * 1024;            // 低水位线 256KB：低于则恢复发送
            const SEND_CHUNK_SIZE: usize = 48 * 1024;     // 每次发送 48KB（Base64 后 ~64KB，适合前端单帧处理）
            const MAX_BUF_SIZE: usize = 8 * 1024 * 1024;  // out_buf 硬上限 8MB，超过则截断

            let mut flush_interval = tokio::time::interval(Duration::from_millis(FLUSH_INTERVAL_MS));
            flush_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            // 流控状态
            let mut total_sent: u64 = 0;       // 累计已发送到前端的字节数
            let mut total_acked: u64 = 0;      // 累计前端已确认处理的字节数
            let mut send_paused = false;        // 是否暂停向前端发送
            let mut total_dropped: u64 = 0;     // 累计丢弃的字节数（用于日志）

            // shell 进程 PID（用于 GetCwd 时通过 /proc/<pid>/cwd 获取工作目录）
            let mut shell_pid = String::new();
            // 是否已尝试获取 shell PID
            let mut pid_fetched = false;

            /// 从 out_buf 取出一块数据发送到前端
            /// 使用 swap buffer 策略：整块发送时直接 clear，部分发送时 swap + truncate
            /// 避免 drain 的 memmove 开销
            #[inline]
            fn flush_buf(
                buf: &mut Vec<u8>,
                send_buf: &mut Vec<u8>,
                max_size: usize,
                app: &tauri::AppHandle,
                event: &str,
            ) -> u64 {
                if buf.is_empty() {
                    return 0;
                }
                let send_len = buf.len().min(max_size);
                if send_len == buf.len() {
                    // 全部发送：直接 encode + clear，零拷贝
                    let encoded = base64::engine::general_purpose::STANDARD.encode(&*buf);
                    let _ = app.emit(event, encoded);
                    buf.clear();
                } else {
                    // 部分发送：encode 前 send_len 字节，然后用 swap 避免 memmove
                    let encoded = base64::engine::general_purpose::STANDARD.encode(&buf[..send_len]);
                    let _ = app.emit(event, encoded);
                    // 把剩余数据移到 send_buf，再 swap 回来
                    send_buf.clear();
                    send_buf.extend_from_slice(&buf[send_len..]);
                    std::mem::swap(buf, send_buf);
                }
                send_len as u64
            }

            loop {
                // 计算"在途"字节数（已发送但前端尚未处理完的）
                let in_flight = total_sent.saturating_sub(total_acked);

                // 水位线判断：控制向前端发送的速率
                if !send_paused && in_flight >= HIGH_WATER {
                    send_paused = true;
                    log::debug!(
                        "SSH session {} 流控：暂停发送 (in_flight={}KB, buf={}KB)",
                        sid, in_flight / 1024, out_buf.len() / 1024
                    );
                } else if send_paused && in_flight <= LOW_WATER {
                    send_paused = false;
                    log::debug!(
                        "SSH session {} 流控：恢复发送 (in_flight={}KB, buf={}KB)",
                        sid, in_flight / 1024, out_buf.len() / 1024
                    );
                }

                tokio::select! {
                    biased;

                    // 最高优先级：用户命令（键盘输入、Ctrl+C、窗口调整、ACK）
                    cmd = cmd_rx.recv() => {
                        match cmd {
                            Some(SessionCommand::Data(data)) => {
                                if let Some(ref mut writer) = *recording_writer_for_task.lock().await {
                                    writer.write_input(&data);
                                }
                                // 用户输入前先刷新缓冲区，保证用户看到最新输出
                                if !out_buf.is_empty() {
                                    let buf_len = out_buf.len();
                                    let size = flush_buf(&mut out_buf, &mut send_buf, buf_len, &app, &output_event);
                                    total_sent += size;
                                    // 用户输入时重置暂停状态，确保交互响应
                                    send_paused = false;
                                }
                                if let Err(e) = channel.data(&data[..]).await {
                                    log::warn!("SSH session {} data send failed: {}", sid, e);
                                    let _ = app.emit(&status_event, "disconnected");
                                    return;
                                }
                            }
                            Some(SessionCommand::Resize(cols, rows)) => {
                                let _ = channel.window_change(cols, rows, 0, 0).await;
                            }
                            Some(SessionCommand::Ack(bytes)) => {
                                // 前端确认已处理的字节数
                                total_acked = total_acked.max(bytes);
                            }
                            Some(SessionCommand::GetCwd(reply)) => {
                                // 通过 exec channel 获取交互式 shell 的 cwd
                                // 策略：查找当前用户所有 shell 进程，按启动时间倒序，
                                // 逐个检查 /proc/<pid>/cwd，返回第一个不是 "/" 的结果
                                // 如果都是 "/"，则返回 "/"（用户可能确实在根目录）
                                //
                                // 如果已有精确 PID，直接用它
                                let cmd = if !shell_pid.is_empty() {
                                    format!(
                                        "readlink /proc/{pid}/cwd 2>/dev/null || pwdx {pid} 2>/dev/null | awk '{{print $2}}'",
                                        pid = shell_pid
                                    )
                                } else {
                                    // 列出当前用户所有有 PTY 的 shell 进程，按启动时间倒序
                                    // 逐个 readlink /proc/<pid>/cwd，优先返回非 "/" 的结果
                                    concat!(
                                        "BEST=/; ",
                                        "for PID in $(ps -u $(whoami) -o pid=,tty=,comm= | ",
                                        "grep -E '(bash|zsh|fish|sh)$' | ",
                                        "grep -v '?' | ",
                                        "awk '{print $1}' | tac); do ",
                                        "  D=$(readlink /proc/$PID/cwd 2>/dev/null); ",
                                        "  if [ -n \"$D\" ] && [ \"$D\" != \"/\" ]; then ",
                                        "    echo \"$D\"; exit 0; ",
                                        "  fi; ",
                                        "  if [ -n \"$D\" ]; then BEST=$D; fi; ",
                                        "done; ",
                                        "echo \"$BEST\""
                                    ).to_string()
                                };
                                match session.channel_open_session().await {
                                    Ok(mut exec_ch) => {
                                        if exec_ch.exec(true, cmd.as_bytes()).await.is_ok() {
                                            let mut output = Vec::new();
                                            let exec_result = tokio::time::timeout(
                                                Duration::from_secs(3),
                                                async {
                                                    loop {
                                                        match exec_ch.wait().await {
                                                            Some(ChannelMsg::Data { data }) => {
                                                                output.extend_from_slice(&data);
                                                            }
                                                            Some(ChannelMsg::Eof) | None => break,
                                                            _ => {}
                                                        }
                                                    }
                                                }
                                            ).await;
                                            let _ = exec_ch.close().await;
                                            if exec_result.is_ok() {
                                                let cwd = String::from_utf8_lossy(&output).trim().to_string();
                                                log::debug!("SSH session {} GetCwd 结果: '{}' (pid='{}')", sid, cwd, shell_pid);
                                                let _ = reply.send(cwd);
                                            } else {
                                                log::warn!("SSH session {} GetCwd 超时", sid);
                                                let _ = reply.send(String::new());
                                            }
                                        } else {
                                            let _ = reply.send(String::new());
                                        }
                                    }
                                    Err(e) => {
                                        log::warn!("SSH session {} GetCwd 打开 exec channel 失败: {}", sid, e);
                                        let _ = reply.send(String::new());
                                    }
                                }
                            }
                            Some(SessionCommand::Close) => {
                                let _ = channel.close().await;
                                break;
                            }
                            None => break,
                        }
                    }

                    // SSH 通道数据：始终消费（防止 russh 内部 unbounded channel OOM）
                    msg = channel.wait() => {
                        match msg {
                            Some(ChannelMsg::Data { data }) => {
                                if let Some(ref mut writer) = *recording_writer_for_task.lock().await {
                                    writer.write_output(&data);
                                }

                                // 从 SSH 输出中拦截 PID 探测的 OSC 序列和命令回显
                                // OSC 格式：\033]0;__DFPID__<pid>__\007
                                // 同时清理 printf 命令的回显行
                                let mut clean_data = data.to_vec();
                                if shell_pid.is_empty() {
                                    let text = String::from_utf8_lossy(&clean_data);
                                    // 解析 OSC 序列中的 PID
                                    if let Some(start) = text.find("__DFPID__") {
                                        if let Some(end) = text[start..].find("__") {
                                            if end > 9 { // "__DFPID__" 长度是 9
                                                let pid_part = &text[start + 9..start + end];
                                                if !pid_part.is_empty() && pid_part.chars().all(|c| c.is_ascii_digit()) {
                                                    log::info!("SSH session {} 从 OSC 序列获取到 shell PID: {}", sid, pid_part);
                                                    shell_pid = pid_part.to_string();
                                                }
                                            }
                                        }
                                    }
                                    // 剔除包含 __DFPID__ 的 OSC 序列（\033]0;...\007）
                                    let text = String::from_utf8_lossy(&clean_data);
                                    let cleaned = text
                                        .replace(&format!("\x1b]0;__DFPID__{}__\x07", shell_pid), "")
                                        .replace(&format!("\x1b]0;__DFPID__{}__\x1b\\", shell_pid), "");
                                    // 剔除 printf 命令的回显（包含 __DFPID__ 的行）
                                    let lines: Vec<&str> = cleaned.lines().collect();
                                    let filtered: Vec<&str> = lines.into_iter()
                                        .filter(|line| !line.contains("__DFPID__") && !line.contains("printf") || line.trim().is_empty())
                                        .collect();
                                    if filtered.len() < cleaned.lines().count() || cleaned.contains("__DFPID__") {
                                        clean_data = filtered.join("\n").into_bytes();
                                        // 保留原始数据中的尾部换行
                                        if data.last() == Some(&b'\n') && clean_data.last() != Some(&b'\n') {
                                            clean_data.push(b'\n');
                                        }
                                    }
                                }

                                out_buf.extend_from_slice(&clean_data);

                                // 首次收到 shell 输出后，通过交互式 channel 发送隐藏命令获取 shell PID
                                // 使用 OSC 序列传递 PID，xterm.js 不会在内容区显示
                                // 命令前加空格避免记录到 shell history
                                // 后端会从输出流中拦截并剔除 OSC 标记
                                if !pid_fetched {
                                    pid_fetched = true;
                                    // printf 输出 OSC 序列：\033]0;__DFPID__<pid>__\007
                                    // \033]0; 是设置终端标题的 OSC 序列，xterm.js 会处理但不显示在内容区
                                    // 命令用 \r\n 发送，前面加空格不记录 history
                                    // 用 \x1b[A\x1b[2K 回到上一行并擦除，隐藏命令行回显
                                    let pid_probe = " printf '\\033]0;__DFPID__'$$'__\\007'\n";
                                    let _ = channel.data(pid_probe.as_bytes()).await;
                                }

                                // 硬上限保护：out_buf 超过 MAX_BUF_SIZE 时截断，只保留尾部
                                // 这是防止后端 OOM 的最后一道防线
                                if out_buf.len() > MAX_BUF_SIZE {
                                    let keep = MAX_BUF_SIZE / 2; // 保留后半部分
                                    let drop_len = out_buf.len() - keep;
                                    total_dropped += drop_len as u64;
                                    log::warn!(
                                        "SSH session {} 流控：缓冲区溢出，丢弃 {}KB 数据（累计丢弃 {}MB）",
                                        sid, drop_len / 1024, total_dropped / (1024 * 1024)
                                    );
                                    // 在截断点插入终端重置序列，帮助 xterm.js 恢复状态
                                    let tail = out_buf[out_buf.len() - keep..].to_vec();
                                    out_buf.clear();
                                    // ESC[0m 重置所有属性，减少乱码
                                    out_buf.extend_from_slice(b"\x1b[0m");
                                    out_buf.extend_from_slice(&tail);
                                }

                                // 未暂停时，缓冲区较大就立即发送一块
                                if !send_paused && out_buf.len() >= SEND_CHUNK_SIZE {
                                    let size = flush_buf(&mut out_buf, &mut send_buf, SEND_CHUNK_SIZE, &app, &output_event);
                                    total_sent += size;
                                    flush_interval.reset();
                                }
                            }
                            Some(ChannelMsg::ExtendedData { data, .. }) => {
                                if let Some(ref mut writer) = *recording_writer_for_task.lock().await {
                                    writer.write_output(&data);
                                }
                                out_buf.extend_from_slice(&data);

                                if out_buf.len() > MAX_BUF_SIZE {
                                    let keep = MAX_BUF_SIZE / 2;
                                    let drop_len = out_buf.len() - keep;
                                    total_dropped += drop_len as u64;
                                    let tail = out_buf[out_buf.len() - keep..].to_vec();
                                    out_buf.clear();
                                    out_buf.extend_from_slice(b"\x1b[0m");
                                    out_buf.extend_from_slice(&tail);
                                }

                                if !send_paused && out_buf.len() >= SEND_CHUNK_SIZE {
                                    let size = flush_buf(&mut out_buf, &mut send_buf, SEND_CHUNK_SIZE, &app, &output_event);
                                    total_sent += size;
                                    flush_interval.reset();
                                }
                            }
                            Some(ChannelMsg::ExitStatus { .. }) | Some(ChannelMsg::Eof) => {
                                // 连接结束，刷新所有剩余数据
                                if !out_buf.is_empty() {
                                    let encoded = base64::engine::general_purpose::STANDARD.encode(&out_buf);
                                    let _ = app.emit(&output_event, encoded);
                                }
                                let _ = app.emit(&status_event, "disconnected");
                                break;
                            }
                            Some(_) => {}
                            None => {
                                if !out_buf.is_empty() {
                                    let encoded = base64::engine::general_purpose::STANDARD.encode(&out_buf);
                                    let _ = app.emit(&output_event, encoded);
                                }
                                let _ = app.emit(&status_event, "disconnected");
                                break;
                            }
                        }
                    }

                    // 定时刷新：将缓冲区数据发送到前端（仅在未暂停时）
                    // 每个 tick 最多连续发送 4 块，加速消化积压数据
                    _ = flush_interval.tick(), if !out_buf.is_empty() && !send_paused => {
                        let max_per_tick = 4;
                        for _ in 0..max_per_tick {
                            if out_buf.is_empty() { break; }
                            let size = flush_buf(&mut out_buf, &mut send_buf, SEND_CHUNK_SIZE, &app, &output_event);
                            total_sent += size;
                            // 发送后重新检查水位线，避免一次性发太多
                            let new_in_flight = total_sent.saturating_sub(total_acked);
                            if new_in_flight >= HIGH_WATER { break; }
                        }
                    }
                }
            }

            if total_dropped > 0 {
                log::info!(
                    "SSH session {} 结束，累计丢弃 {}MB 数据",
                    sid, total_dropped / (1024 * 1024)
                );
            }

            // Disconnect the underlying SSH session
            let _ = session
                .disconnect(Disconnect::ByApplication, "", "")
                .await;
        });

        let info = SessionInfo {
            session_id: session_id.to_string(),
            connection_id: connection_id.to_string(),
            connected_at: chrono::Utc::now().timestamp(),
        };

        // 短暂写锁插入新会话
        self.sessions.write().await.insert(
            session_id.to_string(),
            SshSession {
                cmd_tx,
                _connection_id: connection_id.to_string(),
                recording_writer,
            },
        );

        Ok(info)
    }

    pub async fn send_data(&self, session_id: &str, data: &[u8]) -> Result<(), AppError> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Other(format!("No SSH session: {}", session_id)))?;

        session
            .cmd_tx
            .send(SessionCommand::Data(data.to_vec()))
            .map_err(|_| AppError::Other("SSH session closed".to_string()))?;

        Ok(())
    }

    pub async fn resize(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), AppError> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Other(format!("No SSH session: {}", session_id)))?;

        session
            .cmd_tx
            .send(SessionCommand::Resize(cols, rows))
            .map_err(|_| AppError::Other("SSH session closed".to_string()))?;

        Ok(())
    }

    /// 前端流控 ACK：通知后端前端已处理的累计字节数
    pub async fn flow_ack(&self, session_id: &str, bytes: u64) -> Result<(), AppError> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Other(format!("No SSH session: {}", session_id)))?;

        session
            .cmd_tx
            .send(SessionCommand::Ack(bytes))
            .map_err(|_| AppError::Other("SSH session closed".to_string()))?;

        Ok(())
    }

    /// 获取终端当前工作目录（通过 exec channel，不在终端中执行命令）
    /// 类似 XShell 的做法：通过 /proc/<pid>/cwd 获取 shell 进程的 cwd
    pub async fn get_cwd(&self, session_id: &str) -> Result<String, AppError> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Other(format!("No SSH session: {}", session_id)))?;

        let (tx, rx) = tokio::sync::oneshot::channel();
        session
            .cmd_tx
            .send(SessionCommand::GetCwd(tx))
            .map_err(|_| AppError::Other("SSH session closed".to_string()))?;

        // 释放读锁，避免死锁
        drop(sessions);

        // 等待 I/O task 返回结果（最多 5 秒）
        match tokio::time::timeout(Duration::from_secs(5), rx).await {
            Ok(Ok(cwd)) => Ok(cwd),
            Ok(Err(_)) => Ok(String::new()),
            Err(_) => Ok(String::new()),
        }
    }

    pub async fn disconnect(&self, session_id: &str) -> Result<(), AppError> {
        if let Some(session) = self.sessions.write().await.remove(session_id) {
            let _ = session.cmd_tx.send(SessionCommand::Close);
        }
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn is_connected(&self, session_id: &str) -> bool {
        self.sessions
            .read()
            .await
            .get(session_id)
            .map(|s| !s.cmd_tx.is_closed())
            .unwrap_or(false)
    }

    /// 获取会话的录制写入器引用（用于 start_recording 时设置）
    pub async fn get_recording_writer(&self, session_id: &str) -> Option<SharedRecordingWriter> {
        self.sessions.read().await.get(session_id).map(|s| s.recording_writer.clone())
    }
}
