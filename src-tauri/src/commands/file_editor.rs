use tauri::{AppHandle, Emitter, State, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::commands::sftp::SftpEngineState;
use crate::utils::error::AppError;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex as StdMutex;

// 全局搜索取消标志
static SEARCH_CANCEL_FLAGS: std::sync::OnceLock<StdMutex<HashMap<String, Arc<AtomicBool>>>> =
    std::sync::OnceLock::new();

fn get_cancel_flags() -> &'static StdMutex<HashMap<String, Arc<AtomicBool>>> {
    SEARCH_CANCEL_FLAGS.get_or_init(|| StdMutex::new(HashMap::new()))
}

/// 判断是否为 glob 模式（包含 * 或 ?）
fn is_glob_pattern(pattern: &str) -> bool {
    pattern.contains('*') || pattern.contains('?')
}

/// 构建搜索正则：glob 模式转正则，否则子串匹配
fn build_search_regex(pattern: &str, case_sensitive: bool) -> Result<regex::Regex, String> {
    let regex_str = if is_glob_pattern(pattern) {
        let mut s = String::from("^");
        for c in pattern.chars() {
            match c {
                '*' => s.push_str(".*"),
                '?' => s.push('.'),
                _ => s.push_str(&regex::escape(&c.to_string())),
            }
        }
        s.push('$');
        s
    } else {
        // 子串匹配模式
        regex::escape(pattern)
    };

    regex::RegexBuilder::new(&regex_str)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("Invalid pattern: {}", e))
}

/// 读取远程文件文本内容
#[tauri::command]
pub async fn sftp_read_file_content(
    app: tauri::AppHandle,
    connection_id: String,
    remote_path: String,
    max_size: Option<u64>,
) -> Result<String, String> {
    let sftp_engine = app.state::<SftpEngineState>().inner().clone();
    let sftp = sftp_engine
        .get_sftp_session(&connection_id)
        .await
        .ok_or_else(|| format!("No SFTP session for connection: {}", connection_id))?;

    let metadata = sftp
        .metadata(&remote_path)
        .await
        .map_err(|e| format!("获取文件信息失败: {}", e))?;

    let file_size = metadata.size.unwrap_or(0);
    let max_allowed = max_size.unwrap_or(10 * 1024 * 1024);

    if file_size > max_allowed {
        return Err(format!(
            "文件过大 ({} bytes)，超过限制 ({} bytes)",
            file_size, max_allowed
        ));
    }

    let mut file = sftp
        .open(&remote_path)
        .await
        .map_err(|e| format!("打开文件失败: {}", e))?;

    let mut content = Vec::with_capacity(file_size as usize);
    file.read_to_end(&mut content)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?;

    String::from_utf8(content).map_err(|_| "文件不是有效的 UTF-8 文本".to_string())
}

/// 写入文本内容到远程文件
#[tauri::command]
pub async fn sftp_write_file_content(
    app: tauri::AppHandle,
    connection_id: String,
    remote_path: String,
    content: String,
) -> Result<(), String> {
    let sftp_engine = app.state::<SftpEngineState>().inner().clone();
    let sftp = sftp_engine
        .get_sftp_session(&connection_id)
        .await
        .ok_or_else(|| format!("No SFTP session for connection: {}", connection_id))?;

    use russh_sftp::protocol::OpenFlags;
    let mut file = sftp
        .open_with_flags(
            &remote_path,
            OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE,
        )
        .await
        .map_err(|e| format!("打开文件失败: {}", e))?;

    file.write_all(content.as_bytes())
        .await
        .map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(())
}

/// 修改远程文件权限 (chmod)
#[tauri::command]
pub async fn sftp_chmod(
    app: tauri::AppHandle,
    connection_id: String,
    path: String,
    mode: u32,
) -> Result<(), String> {
    let sftp_engine = app.state::<SftpEngineState>().inner().clone();
    let sftp = sftp_engine
        .get_sftp_session(&connection_id)
        .await
        .ok_or_else(|| format!("No SFTP session for connection: {}", connection_id))?;

    let mut attrs = sftp
        .metadata(&path)
        .await
        .map_err(|e| format!("获取文件信息失败: {}", e))?;

    let file_type_bits = attrs.permissions.unwrap_or(0) & 0o170000;
    attrs.permissions = Some(file_type_bits | (mode & 0o7777));

    sftp.set_metadata(&path, attrs)
        .await
        .map_err(|e| format!("修改权限失败: {}", e))?;

    Ok(())
}

/// 搜索远程文件（BFS 并发 + 流式推送结果）
///
/// 使用 BFS 遍历 + 并发批量 read_dir，大幅减少网络延迟。
/// 通过 Tauri event 实时推送每条结果，命令返回时搜索结束。
#[tauri::command]
pub async fn sftp_search_files(
    app_handle: AppHandle,
    connection_id: String,
    base_path: String,
    pattern: String,
    case_sensitive: Option<bool>,
    max_depth: Option<u32>,
) -> Result<SearchDoneEvent, String> {
    let sftp_engine = app_handle.state::<SftpEngineState>().inner().clone();
    let sftp = sftp_engine
        .get_sftp_session(&connection_id)
        .await
        .ok_or_else(|| format!("No SFTP session for connection: {}", connection_id))?;

    let case_sensitive = case_sensitive.unwrap_or(false);
    let max_depth = max_depth.unwrap_or(10);
    let re = build_search_regex(&pattern, case_sensitive)?;

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut flags = get_cancel_flags().lock().unwrap();
        flags.insert(connection_id.clone(), cancel.clone());
    }

    let count = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let _ = search_bfs_concurrent(
        &sftp, &base_path, &re, max_depth, &cancel, &app_handle, &count,
    )
    .await;

    let cancelled = cancel.load(Ordering::Relaxed);
    {
        let mut flags = get_cancel_flags().lock().unwrap();
        flags.remove(&connection_id);
    }

    Ok(SearchDoneEvent {
        cancelled,
        total: count.load(Ordering::Relaxed),
    })
}

/// 取消正在进行的搜索
#[tauri::command]
pub async fn sftp_cancel_search(connection_id: String) -> Result<(), String> {
    let flags = get_cancel_flags().lock().unwrap();
    if let Some(cancel) = flags.get(&connection_id) {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<i64>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDoneEvent {
    cancelled: bool,
    total: u32,
}

use russh_sftp::client::SftpSession;
use std::collections::VecDeque;
use std::sync::Arc;

const MAX_RESULTS: u32 = 1000;
const CONCURRENT_DIRS: usize = 8;

/// BFS 并发搜索：同时读取多个目录，大幅减少网络延迟
async fn search_bfs_concurrent(
    sftp: &Arc<SftpSession>,
    base_path: &str,
    re: &regex::Regex,
    max_depth: u32,
    cancel: &Arc<AtomicBool>,
    app_handle: &AppHandle,
    count: &Arc<std::sync::atomic::AtomicU32>,
) -> Result<(), AppError> {
    // BFS 队列: (path, depth)
    let mut queue: VecDeque<(String, u32)> = VecDeque::new();
    queue.push_back((base_path.to_string(), 0));

    while !queue.is_empty() {
        if cancel.load(Ordering::Relaxed) || count.load(Ordering::Relaxed) >= MAX_RESULTS {
            break;
        }

        // 取一批目录并发读取
        let batch: Vec<(String, u32)> = queue
            .drain(..queue.len().min(CONCURRENT_DIRS))
            .collect();

        // 并发发起所有 read_dir 请求
        let mut futures = Vec::with_capacity(batch.len());
        for (path, depth) in &batch {
            let sftp = sftp.clone();
            let path = path.clone();
            let depth = *depth;
            futures.push(async move {
                let result = sftp.read_dir(&path).await;
                (path, depth, result)
            });
        }

        let results = futures::future::join_all(futures).await;

        for (dir_path, depth, read_result) in results {
            if cancel.load(Ordering::Relaxed) || count.load(Ordering::Relaxed) >= MAX_RESULTS {
                break;
            }

            let entries = match read_result {
                Ok(e) => e,
                Err(_) => continue, // 跳过无权限的目录
            };

            for entry in entries {
                if cancel.load(Ordering::Relaxed) || count.load(Ordering::Relaxed) >= MAX_RESULTS {
                    break;
                }

                let name = entry.file_name();
                if name == "." || name == ".." {
                    continue;
                }

                let attrs = entry.metadata();
                let perms = attrs.permissions.unwrap_or(0);
                let file_type = perms & 0o170000;
                let is_dir = file_type == 0o040000;
                let is_symlink = file_type == 0o120000;

                let full_path = if dir_path.ends_with('/') {
                    format!("{}{}", dir_path, name)
                } else {
                    format!("{}/{}", dir_path, name)
                };

                if re.is_match(&name) {
                    count.fetch_add(1, Ordering::Relaxed);
                    let _ = app_handle.emit(
                        "search:result",
                        SearchResult {
                            name: name.clone(),
                            path: full_path.clone(),
                            is_dir,
                            size: attrs.size.unwrap_or(0),
                            modified: attrs.mtime.map(|t| t as i64),
                        },
                    );
                }

                // 子目录加入队列
                if is_dir && !is_symlink && depth + 1 <= max_depth {
                    queue.push_back((full_path, depth + 1));
                }
            }
        }
    }

    Ok(())
}

/// 读取本地文件文本内容
#[tauri::command]
pub async fn local_read_file_content(
    path: String,
    max_size: Option<u64>,
) -> Result<String, String> {
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("获取文件信息失败: {}", e))?;

    let max_allowed = max_size.unwrap_or(10 * 1024 * 1024);
    if metadata.len() > max_allowed {
        return Err(format!(
            "文件过大 ({} bytes)，超过限制 ({} bytes)",
            metadata.len(),
            max_allowed
        ));
    }

    let content = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?;

    String::from_utf8(content).map_err(|_| "文件不是有效的 UTF-8 文本".to_string())
}
