use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex as StdMutex;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

use crate::utils::error::AppError;

/// 单个本地 Shell 会话
struct LocalShellSession {
    /// PTY master 端写入器（向 shell 发送输入）
    /// 使用 std::sync::Mutex 使其满足 Sync（PTY write 是内存操作，阻塞时间可忽略）
    writer: StdMutex<Box<dyn Write + Send>>,
    /// PTY master 端句柄（用于 resize）
    master: StdMutex<Box<dyn MasterPty + Send>>,
    /// 子进程 killer（关闭时用于终止 Shell 进程）
    child_killer: StdMutex<Box<dyn ChildKiller + Send + Sync>>,
    /// 取消令牌（关闭会话时触发 I/O 线程退出）
    cancel_token: CancellationToken,
}

/// 本地 Shell 引擎 — 管理多个本地终端会话
/// 内部使用 RwLock，无需外层 Mutex
pub struct LocalShellEngine {
    sessions: RwLock<HashMap<String, LocalShellSession>>,
}

impl LocalShellEngine {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }

    /// 创建本地 Shell 会话
    /// 输出通过 Tauri event 推送到前端
    pub async fn spawn_shell(
        &self,
        app_handle: &tauri::AppHandle,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), AppError> {
        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Other(format!("打开 PTY 失败: {}", e)))?;

        // Windows 默认使用 PowerShell，回退到 cmd.exe
        let mut cmd = if cfg!(windows) {
            let ps_path = std::env::var("SystemRoot")
                .map(|sr| format!("{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", sr))
                .unwrap_or_else(|_| "powershell.exe".to_string());
            if std::path::Path::new(&ps_path).exists() {
                CommandBuilder::new(ps_path)
            } else {
                CommandBuilder::new("cmd.exe")
            }
        } else {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
            CommandBuilder::new(shell)
        };

        // 设置工作目录为用户 home
        if let Some(home) = directories::UserDirs::new().map(|u| u.home_dir().to_path_buf()) {
            cmd.cwd(home);
        }

        let mut child = pty_pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::Other(format!("启动 Shell 进程失败: {}", e)))?;

        // 获取 ChildKiller（Send + Sync），用于关闭时终止子进程
        let killer = child.clone_killer();

        // 后台线程 wait child，避免僵尸进程
        std::thread::spawn(move || {
            let _ = child.wait();
        });

        // 获取 master 端读写器
        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|e| AppError::Other(format!("获取 PTY writer 失败: {}", e)))?;

        let mut reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::Other(format!("获取 PTY reader 失败: {}", e)))?;

        let cancel_token = CancellationToken::new();
        let token_clone = cancel_token.clone();
        let session_id_owned = session_id.to_string();
        let app_clone = app_handle.clone();

        // I/O 读取循环：PTY 输出 → base64 → Tauri event
        // 使用 std::thread 因为 portable-pty reader 是阻塞 I/O
        std::thread::spawn(move || {
            use tauri::Emitter;
            let event_name = format!("local://output/{}", session_id_owned);
            let exit_event = format!("local://exit/{}", session_id_owned);
            let mut buf = vec![0u8; 4096];
            loop {
                if token_clone.is_cancelled() {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let b64 = base64::Engine::encode(
                            &base64::engine::general_purpose::STANDARD,
                            &buf[..n],
                        );
                        let _ = app_clone.emit(&event_name, b64);
                    }
                    Err(_) => break,
                }
            }
            // Shell 退出时通知前端
            let _ = app_clone.emit(&exit_event, "");
        });

        let new_session = LocalShellSession {
            writer: StdMutex::new(writer),
            master: StdMutex::new(pty_pair.master),
            child_killer: StdMutex::new(killer),
            cancel_token,
        };

        // 使用单次写锁操作避免 TOCTOU 竞态
        let mut sessions = self.sessions.write().await;
        if let Some(old) = sessions.remove(session_id) {
            old.cancel_token.cancel();
            if let Ok(mut k) = old.child_killer.lock() {
                let _ = k.kill();
            }
        }
        sessions.insert(session_id.to_string(), new_session);

        Ok(())
    }

    /// 向本地 Shell 发送输入数据
    pub async fn write_data(&self, session_id: &str, data: &[u8]) -> Result<(), AppError> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Other("本地 Shell 会话不存在".into()))?;
        let mut writer = session
            .writer
            .lock()
            .map_err(|e| AppError::Other(format!("获取 writer 锁失败: {}", e)))?;
        writer
            .write_all(data)
            .map_err(|e| AppError::Other(format!("写入 PTY 失败: {}", e)))?;
        writer
            .flush()
            .map_err(|e| AppError::Other(format!("flush PTY 失败: {}", e)))?;
        Ok(())
    }

    /// 调整终端窗口大小
    pub async fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Other("本地 Shell 会话不存在".into()))?;
        let master = session
            .master
            .lock()
            .map_err(|e| AppError::Other(format!("获取 master 锁失败: {}", e)))?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Other(format!("调整 PTY 大小失败: {}", e)))?;
        Ok(())
    }

    /// 关闭本地 Shell 会话
    pub async fn close_shell(&self, session_id: &str) -> Result<(), AppError> {
        if let Some(session) = self.sessions.write().await.remove(session_id) {
            // 1. 取消 I/O 线程
            session.cancel_token.cancel();
            // 2. 终止子进程
            if let Ok(mut killer) = session.child_killer.lock() {
                let _ = killer.kill();
            }
            // 3. writer 和 master drop 时自动关闭 PTY，reader.read() 会返回 EOF
        }
        Ok(())
    }
}
