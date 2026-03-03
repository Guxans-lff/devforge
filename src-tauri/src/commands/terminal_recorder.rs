use std::sync::Arc;
use tokio::sync::Mutex;

use tauri::State;

use crate::commands::ssh::SshEngineState;
use crate::services::terminal_recorder::{RecordingInfo, TerminalRecorder};

pub type TerminalRecorderState = Arc<Mutex<TerminalRecorder>>;

#[tauri::command]
pub async fn start_recording(
    recorder: State<'_, TerminalRecorderState>,
    ssh_engine: State<'_, SshEngineState>,
    session_id: String,
    output_path: Option<String>,
    width: u32,
    height: u32,
) -> Result<String, String> {
    let shared_writer = ssh_engine
        .get_recording_writer(&session_id)
        .await
        .ok_or_else(|| "SSH 会话不存在".to_string())?;

    let mut rec = recorder.lock().await;
    let (writer, file_path) = rec.start(&session_id, output_path, width, height)?;

    // 将录制写入器注入到 I/O task 的共享引用中
    let mut guard = shared_writer.lock().await;
    *guard = writer.lock().await.take();

    Ok(file_path)
}

#[tauri::command]
pub async fn stop_recording(
    recorder: State<'_, TerminalRecorderState>,
    ssh_engine: State<'_, SshEngineState>,
    session_id: String,
) -> Result<String, String> {
    // 先清除 I/O task 中的写入器，并显式 flush
    if let Some(shared_writer) = ssh_engine.get_recording_writer(&session_id).await {
        let mut guard = shared_writer.lock().await;
        if let Some(ref mut writer) = *guard {
            let _ = writer.flush();
        }
        *guard = None;
    }

    let mut rec = recorder.lock().await;
    rec.stop(&session_id)
}

#[tauri::command]
pub async fn is_recording(
    recorder: State<'_, TerminalRecorderState>,
    session_id: String,
) -> Result<bool, String> {
    let rec = recorder.lock().await;
    Ok(rec.is_recording(&session_id))
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
