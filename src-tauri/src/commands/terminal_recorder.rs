use std::sync::Arc;

use tauri::Manager;

use crate::commands::ssh::SshEngineState;
use crate::services::terminal_recorder::{RecordingInfo, TerminalRecorder};

/// 内部使用 RwLock，无需外层 Mutex
pub type TerminalRecorderState = Arc<TerminalRecorder>;

#[tauri::command]
pub async fn start_recording(
    app: tauri::AppHandle,
    session_id: String,
    output_path: Option<String>,
    width: u32,
    height: u32,
) -> Result<String, String> {
    let recorder = app.state::<TerminalRecorderState>().inner().clone();
    let ssh_engine = app.state::<SshEngineState>().inner().clone();
    let shared_writer: crate::services::terminal_recorder::SharedRecordingWriter = match ssh_engine
        .get_recording_writer(&session_id)
        .await
    {
        Some(w) => w,
        None => return Err("SSH 会话不存在".to_string()),
    };

    let (writer, file_path) = recorder.start(&session_id, output_path, width, height).await?;

    // 将录制写入器注入到 I/O task 的共享引用中
    let mut guard = shared_writer.lock().await;
    *guard = writer.lock().await.take();

    Ok(file_path)
}

#[tauri::command]
pub async fn stop_recording(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<String, String> {
    let recorder = app.state::<TerminalRecorderState>().inner().clone();
    let ssh_engine = app.state::<SshEngineState>().inner().clone();
    // 先清除 I/O task 中的写入器，并显式 flush
    if let Some(shared_writer) = ssh_engine.get_recording_writer(&session_id).await {
        let shared_writer: crate::services::terminal_recorder::SharedRecordingWriter = shared_writer;
        let mut guard = shared_writer.lock().await;
        if let Some(ref mut writer) = *guard {
            let _ = writer.flush();
        }
        *guard = None;
    }

    recorder.stop(&session_id).await
}

#[tauri::command]
pub async fn is_recording(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<bool, String> {
    let recorder = app.state::<TerminalRecorderState>().inner().clone();
    Ok(recorder.is_recording(&session_id).await)
}

#[tauri::command]
pub async fn list_recordings() -> Result<Vec<RecordingInfo>, String> {
    TerminalRecorder::list_recordings()
}

#[tauri::command]
pub async fn read_recording(file_path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| format!("读取录制文件失败: {}", e))
}

#[tauri::command]
pub async fn export_recording(source_path: String, target_path: String) -> Result<(), String> {
    tokio::fs::copy(&source_path, &target_path)
        .await
        .map_err(|e| format!("导出录制文件失败: {}", e))?;
    Ok(())
}
