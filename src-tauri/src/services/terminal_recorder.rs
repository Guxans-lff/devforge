use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::{Mutex, RwLock};

/// asciicast v2 格式的录制器
/// 每个 session 独立录制，数据通过 I/O 循环写入
/// 内部使用 RwLock，无需外层 Mutex
pub struct TerminalRecorder {
    recordings: RwLock<HashMap<String, RecordingState>>,
}

struct RecordingState {
    file_path: PathBuf,
}

/// 可在 I/O task 中共享的录制写入器
pub type SharedRecordingWriter = Arc<Mutex<Option<RecordingWriter>>>;

pub struct RecordingWriter {
    file: std::io::BufWriter<std::fs::File>,
    start_time: Instant,
}

impl RecordingWriter {
    /// 写入一条输出事件 (asciicast v2 格式)
    pub fn write_output(&mut self, data: &[u8]) {
        let elapsed = self.start_time.elapsed().as_secs_f64();
        // 转义为 JSON 字符串
        let text = String::from_utf8_lossy(data);
        let json_text = serde_json::to_string(&text).unwrap_or_default();
        let _ = writeln!(self.file, "[{:.6}, \"o\", {}]", elapsed, json_text);
    }

    /// 写入一条输入事件
    pub fn write_input(&mut self, data: &[u8]) {
        let elapsed = self.start_time.elapsed().as_secs_f64();
        let text = String::from_utf8_lossy(data);
        let json_text = serde_json::to_string(&text).unwrap_or_default();
        let _ = writeln!(self.file, "[{:.6}, \"i\", {}]", elapsed, json_text);
    }

    /// 刷新缓冲区
    pub fn flush(&mut self) {
        let _ = self.file.flush();
    }
}

impl TerminalRecorder {
    pub fn new() -> Self {
        Self {
            recordings: RwLock::new(HashMap::new()),
        }
    }

    /// 开始录制，返回可在 I/O task 中共享的写入器
    pub async fn start(
        &self,
        session_id: &str,
        output_path: Option<String>,
        width: u32,
        height: u32,
    ) -> Result<(SharedRecordingWriter, String), String> {
        if self.recordings.read().await.contains_key(session_id) {
            return Err("该会话已在录制中".into());
        }

        let file_path = match output_path {
            Some(p) => PathBuf::from(p),
            None => {
                let dir = directories::UserDirs::new()
                    .and_then(|u| u.document_dir().map(|d| d.to_path_buf()))
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join("DevForge")
                    .join("recordings");
                std::fs::create_dir_all(&dir)
                    .map_err(|e| format!("创建录制目录失败: {}", e))?;
                let ts = chrono::Local::now().format("%Y%m%d_%H%M%S");
                dir.join(format!("recording_{}.cast", ts))
            }
        };

        let file = std::fs::File::create(&file_path)
            .map_err(|e| format!("创建录制文件失败: {}", e))?;
        let mut writer = std::io::BufWriter::new(file);

        // 写入 asciicast v2 header
        let header = serde_json::json!({
            "version": 2,
            "width": width,
            "height": height,
            "timestamp": chrono::Utc::now().timestamp(),
            "env": { "TERM": "xterm-256color" }
        });
        writeln!(writer, "{}", header).map_err(|e| format!("写入 header 失败: {}", e))?;
        writer.flush().map_err(|e| format!("flush header 失败: {}", e))?;

        let start_time = Instant::now();
        let path_str = file_path.to_string_lossy().to_string();

        // 创建共享写入器给 I/O task（复用同一个文件句柄）
        let shared_writer: SharedRecordingWriter = Arc::new(Mutex::new(Some(RecordingWriter {
            file: writer,
            start_time,
        })));

        // 保存状态用于 stop 时清理
        self.recordings.write().await.insert(
            session_id.to_string(),
            RecordingState {
                file_path: file_path.clone(),
            },
        );

        Ok((shared_writer, path_str))
    }

    /// 停止录制，返回文件路径
    pub async fn stop(&self, session_id: &str) -> Result<String, String> {
        let state = self
            .recordings
            .write()
            .await
            .remove(session_id)
            .ok_or("该会话未在录制")?;
        Ok(state.file_path.to_string_lossy().to_string())
    }

    /// 检查是否正在录制
    pub async fn is_recording(&self, session_id: &str) -> bool {
        self.recordings.read().await.contains_key(session_id)
    }

    /// 列出所有录制文件
    pub fn list_recordings() -> Result<Vec<RecordingInfo>, String> {
        let dir = directories::UserDirs::new()
            .and_then(|u| u.document_dir().map(|d| d.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
            .join("DevForge")
            .join("recordings");

        if !dir.exists() {
            return Ok(vec![]);
        }

        let mut files = Vec::new();
        let entries = std::fs::read_dir(&dir)
            .map_err(|e| format!("读取录制目录失败: {}", e))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "cast").unwrap_or(false) {
                let metadata = entry.metadata().ok();
                files.push(RecordingInfo {
                    file_path: path.to_string_lossy().to_string(),
                    file_name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
                    size: metadata.as_ref().map(|m| m.len()).unwrap_or(0),
                    created_at: metadata
                        .and_then(|m| m.created().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0),
                });
            }
        }

        files.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(files)
    }
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecordingInfo {
    pub file_path: String,
    pub file_name: String,
    pub size: u64,
    pub created_at: i64,
}
