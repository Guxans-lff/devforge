//! 崩溃日志收集模块
//!
//! 设置 panic hook，将崩溃信息写入本地日志文件。
//! 日志文件位于 AppData/devforge/logs/ 目录，自动轮转保留最近 5 个。

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::panic;

/// 获取崩溃日志目录
fn crash_log_dir() -> Option<PathBuf> {
    directories::ProjectDirs::from("", "", "devforge")
        .map(|dirs| dirs.data_dir().join("logs"))
}

/// 初始化 panic hook，将崩溃信息写入日志文件
pub fn init_panic_hook() {
    let default_hook = panic::take_hook();

    panic::set_hook(Box::new(move |info| {
        // 先调用默认 hook（打印到 stderr）
        default_hook(info);

        // 写入崩溃日志文件
        if let Err(e) = write_crash_log(info) {
            eprintln!("写入崩溃日志失败: {}", e);
        }
    }));
}

/// 将 panic 信息写入崩溃日志文件
fn write_crash_log(info: &panic::PanicHookInfo<'_>) -> std::io::Result<()> {
    let log_dir = match crash_log_dir() {
        Some(dir) => dir,
        None => return Ok(()),
    };

    fs::create_dir_all(&log_dir)?;

    // 轮转：只保留最近 4 个旧日志（加上本次共 5 个）
    rotate_logs(&log_dir)?;

    // 生成日志文件名（时间戳）
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let log_path = log_dir.join(format!("crash_{}.log", timestamp));

    let mut file = fs::File::create(&log_path)?;

    // 写入基本信息
    writeln!(file, "=== DevForge 崩溃报告 ===")?;
    writeln!(file, "时间: {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"))?;
    writeln!(file, "版本: {}", env!("CARGO_PKG_VERSION"))?;
    writeln!(file)?;

    // Panic 消息
    let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
        s.to_string()
    } else if let Some(s) = info.payload().downcast_ref::<String>() {
        s.clone()
    } else {
        "未知 panic".to_string()
    };

    // 过滤敏感信息（密码、连接字符串等）
    let safe_message = sanitize_message(&message);
    writeln!(file, "Panic: {}", safe_message)?;

    // 位置信息
    if let Some(location) = info.location() {
        writeln!(file, "位置: {}:{}:{}", location.file(), location.line(), location.column())?;
    }

    writeln!(file)?;

    // 回溯（Backtrace）
    writeln!(file, "=== Backtrace ===")?;
    let bt = std::backtrace::Backtrace::force_capture();
    writeln!(file, "{}", bt)?;

    Ok(())
}

/// 轮转日志：只保留最近 4 个崩溃日志文件
fn rotate_logs(log_dir: &std::path::Path) -> std::io::Result<()> {
    let mut crash_files: Vec<_> = fs::read_dir(log_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("crash_")
        })
        .collect();

    // 按修改时间降序排列
    crash_files.sort_by(|a, b| {
        b.metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
            .cmp(
                &a.metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
            )
    });

    // 删除超过 4 个的旧文件
    for old_file in crash_files.iter().skip(4) {
        let _ = fs::remove_file(old_file.path());
    }

    Ok(())
}

/// 过滤敏感信息：移除密码、连接字符串等
fn sanitize_message(message: &str) -> String {
    let mut result = message.to_string();

    // 过滤常见敏感模式
    let patterns = [
        // 密码参数
        (r"password=\S+", "password=***"),
        // 连接字符串中的密码
        (r"://\w+:\S+@", "://***:***@"),
    ];

    for (pattern, replacement) in &patterns {
        if let Ok(re) = regex::Regex::new(pattern) {
            result = re.replace_all(&result, *replacement).to_string();
        }
    }

    result
}

/// 获取崩溃日志列表（供前端诊断面板使用）
pub fn list_crash_logs() -> Vec<CrashLogEntry> {
    let log_dir = match crash_log_dir() {
        Some(dir) => dir,
        None => return vec![],
    };

    let mut entries: Vec<CrashLogEntry> = fs::read_dir(&log_dir)
        .ok()
        .map(|dir| {
            dir.filter_map(|e| e.ok())
                .filter(|e| e.file_name().to_string_lossy().starts_with("crash_"))
                .filter_map(|e| {
                    let metadata = e.metadata().ok()?;
                    Some(CrashLogEntry {
                        filename: e.file_name().to_string_lossy().to_string(),
                        path: e.path().to_string_lossy().to_string(),
                        size: metadata.len(),
                        modified: metadata
                            .modified()
                            .ok()
                            .map(|t| {
                                chrono::DateTime::<chrono::Local>::from(t)
                                    .format("%Y-%m-%d %H:%M:%S")
                                    .to_string()
                            })
                            .unwrap_or_default(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    // 按时间降序
    entries.sort_by(|a, b| b.modified.cmp(&a.modified));
    entries
}

/// 读取指定崩溃日志内容
pub fn read_crash_log(filename: &str) -> Option<String> {
    let log_dir = crash_log_dir()?;

    // 安全检查：防止路径遍历
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return None;
    }

    let path = log_dir.join(filename);
    fs::read_to_string(path).ok()
}

/// 清除所有崩溃日志
pub fn clear_crash_logs() -> usize {
    let log_dir = match crash_log_dir() {
        Some(dir) => dir,
        None => return 0,
    };

    let mut count = 0;
    if let Ok(entries) = fs::read_dir(&log_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            if entry.file_name().to_string_lossy().starts_with("crash_") {
                if fs::remove_file(entry.path()).is_ok() {
                    count += 1;
                }
            }
        }
    }
    count
}

/// 崩溃日志条目
#[derive(serde::Serialize, Clone)]
pub struct CrashLogEntry {
    pub filename: String,
    pub path: String,
    pub size: u64,
    pub modified: String,
}

/// 追加前端错误日志到 error_YYYYMMDD.log 文件
pub fn append_error_log(content: &str) -> std::io::Result<()> {
    let log_dir = crash_log_dir()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "无法获取日志目录"))?;

    fs::create_dir_all(&log_dir)?;

    let date = chrono::Local::now().format("%Y%m%d");
    let log_path = log_dir.join(format!("error_{}.log", date));

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;

    file.write_all(content.as_bytes())?;
    file.write_all(b"\n")?;

    Ok(())
}
