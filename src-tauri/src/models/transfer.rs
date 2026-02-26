use serde::{Deserialize, Serialize};
use std::fmt;

/// A single entry in a directory listing (local or remote).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// Unix timestamp (seconds)
    pub modified: Option<i64>,
    /// Unix permission bits (e.g. 0o755)
    pub permissions: Option<u32>,
}

/// Metadata for a single file/directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<i64>,
    pub permissions: Option<u32>,
    pub owner: Option<String>,
    pub group: Option<String>,
}

/// Progress report emitted via Tauri events during file transfer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub transfer_id: String,
    pub file_name: String,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    /// 0.0 – 1.0
    pub progress: f64,
    /// Bytes per second
    pub speed: u64,
}

/// Final status when a transfer completes or fails.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult {
    pub transfer_id: String,
    pub success: bool,
    pub error: Option<String>,
}

// ============================================================================
// 新增：文件传输优化相关数据结构
// ============================================================================

/// 传输配置
#[derive(Debug, Clone)]
pub struct TransferConfig {
    /// 分块大小（字节）
    pub chunk_size: usize,
    /// 进度事件发送间隔（毫秒）
    pub progress_emit_interval: u64,
    /// 速度计算窗口大小（秒）
    pub speed_window_size: u64,
    /// 最大并发传输任务数
    pub max_concurrent_tasks: usize,
    /// 小文件最小显示时间（毫秒）
    #[allow(dead_code)]
    pub min_display_time_for_small_files: u64,
}

impl Default for TransferConfig {
    fn default() -> Self {
        Self {
            chunk_size: 1024 * 1024,           // 1MB
            progress_emit_interval: 100,       // 100ms
            speed_window_size: 3,              // 3秒
            max_concurrent_tasks: 3,
            min_display_time_for_small_files: 200, // 200ms
        }
    }
}

/// 传输错误类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TransferError {
    // 可恢复错误
    NetworkTimeout,
    ConnectionLost,
    TemporaryServerError,
    
    // 不可恢复错误
    FileNotFound,
    PermissionDenied,
    DiskFull,
    InvalidPath,
    AuthenticationFailed,
    
    // 系统错误
    IoError(String),
    SftpError(String),
}

impl TransferError {
    /// 判断错误是否可恢复
    #[allow(dead_code)]
    pub fn is_recoverable(&self) -> bool {
        matches!(
            self,
            TransferError::NetworkTimeout
                | TransferError::ConnectionLost
                | TransferError::TemporaryServerError
        )
    }
    
    /// 获取用户友好的错误消息
    pub fn user_message(&self) -> String {
        match self {
            TransferError::NetworkTimeout => "网络超时，请检查网络连接".to_string(),
            TransferError::ConnectionLost => "连接断开".to_string(),
            TransferError::TemporaryServerError => "服务器临时错误".to_string(),
            TransferError::FileNotFound => "文件不存在".to_string(),
            TransferError::PermissionDenied => "权限不足".to_string(),
            TransferError::DiskFull => "磁盘空间不足".to_string(),
            TransferError::InvalidPath => "无效的文件路径".to_string(),
            TransferError::AuthenticationFailed => "认证失败".to_string(),
            TransferError::IoError(msg) => format!("IO 错误: {}", msg),
            TransferError::SftpError(msg) => format!("SFTP 错误: {}", msg),
        }
    }
}

impl fmt::Display for TransferError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.user_message())
    }
}

impl std::error::Error for TransferError {}

/// 进度事件（发送给前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressEvent {
    pub id: String,
    pub transferred: u64,
    pub total: u64,
    pub speed: u64, // bytes per second
}

/// 完成事件（发送给前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompleteEvent {
    pub id: String,
}

/// 错误事件（发送给前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorEvent {
    pub id: String,
    pub error: String,
}
