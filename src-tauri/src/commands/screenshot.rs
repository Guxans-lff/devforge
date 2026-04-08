use std::sync::Arc;
use tauri::Manager;

use crate::models::ai::{AiConfig, ChatCompletionResponse};
use crate::models::screenshot::{
    CaptureResult, MonitorInfo, ScreenshotHistoryItem, WindowInfo,
};
use crate::services::screenshot_engine::ScreenshotEngine;
use crate::utils::error::AppError;

pub type ScreenshotEngineState = Arc<ScreenshotEngine>;

// ── 显示器 ─────────────────────────────────────────────────────

/// 枚举所有显示器
#[tauri::command]
pub async fn screenshot_list_monitors() -> Result<Vec<MonitorInfo>, AppError> {
    tokio::task::spawn_blocking(ScreenshotEngine::list_monitors)
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
}

// ── 窗口列表 ──────────────────────────────────────────────────

/// 获取所有可见窗口信息
#[tauri::command]
pub async fn screenshot_list_windows() -> Result<Vec<WindowInfo>, AppError> {
    tokio::task::spawn_blocking(ScreenshotEngine::list_windows)
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
}

// ── 截图 ──────────────────────────────────────────────────────

/// 全屏截图
#[tauri::command]
pub async fn screenshot_capture_fullscreen(
    app: tauri::AppHandle,
    monitor_id: Option<u32>,
) -> Result<CaptureResult, AppError> {
    let engine = app.state::<ScreenshotEngineState>().inner().clone();
    tokio::task::spawn_blocking(move || engine.capture_fullscreen(monitor_id))
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
}

/// 区域截图
#[tauri::command]
pub async fn screenshot_capture_region(
    app: tauri::AppHandle,
    monitor_id: u32,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<CaptureResult, AppError> {
    let engine = app.state::<ScreenshotEngineState>().inner().clone();
    tokio::task::spawn_blocking(move || engine.capture_region(monitor_id, x, y, width, height))
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
}

/// 从已有截图文件裁剪区域（不重新截屏，避免截到覆盖层）
#[tauri::command]
pub async fn screenshot_crop_region(
    app: tauri::AppHandle,
    source_path: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<CaptureResult, AppError> {
    let engine = app.state::<ScreenshotEngineState>().inner().clone();
    tokio::task::spawn_blocking(move || engine.crop_from_file(&source_path, x, y, width, height))
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
}

/// 窗口截图
#[tauri::command]
pub async fn screenshot_capture_window(
    app: tauri::AppHandle,
    window_title: String,
) -> Result<CaptureResult, AppError> {
    let engine = app.state::<ScreenshotEngineState>().inner().clone();
    tokio::task::spawn_blocking(move || engine.capture_window(&window_title))
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
}

// ── 保存/剪贴板 ──────────────────────────────────────────────

/// 保存截图到指定路径
#[tauri::command]
pub async fn screenshot_save_to_file(
    source_path: String,
    dest_path: String,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        ScreenshotEngine::save_to_file(&source_path, &dest_path)
    })
    .await
    .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
}

/// 保存标注后的图片（base64 PNG）到文件
#[tauri::command]
pub async fn screenshot_save_annotated(
    png_base64: String,
    dest_path: String,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        ScreenshotEngine::save_base64_to_file(&png_base64, &dest_path)
    })
    .await
    .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
}

/// 复制截图文件到剪贴板
#[tauri::command]
pub async fn screenshot_copy_to_clipboard(source_path: String) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        ScreenshotEngine::copy_image_to_clipboard(&source_path)
    })
    .await
    .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
}

/// 复制标注后的图片（base64 PNG）到剪贴板
#[tauri::command]
pub async fn screenshot_copy_annotated_to_clipboard(
    png_base64: String,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        ScreenshotEngine::copy_base64_to_clipboard(&png_base64)
    })
    .await
    .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
}

// ── 历史管理 ──────────────────────────────────────────────────

/// 列出截图历史
#[tauri::command]
pub async fn screenshot_list_history(
    app: tauri::AppHandle,
) -> Result<Vec<ScreenshotHistoryItem>, AppError> {
    let engine = app.state::<ScreenshotEngineState>().inner().clone();
    tokio::task::spawn_blocking(move || engine.list_history())
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
}

/// 删除截图
#[tauri::command]
pub async fn screenshot_delete(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), AppError> {
    let engine = app.state::<ScreenshotEngineState>().inner().clone();
    tokio::task::spawn_blocking(move || engine.delete_screenshot(&id))
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
}

/// 清理旧截图
#[tauri::command]
pub async fn screenshot_cleanup(
    app: tauri::AppHandle,
    days: Option<u32>,
) -> Result<u32, AppError> {
    let engine = app.state::<ScreenshotEngineState>().inner().clone();
    let days = days.unwrap_or(7);
    tokio::task::spawn_blocking(move || engine.cleanup_old(days))
        .await
        .map_err(|e| AppError::Other(format!("任务执行失败: {e}")))?
}

// ── 翻译 ────────────────────────────────────────────────────────

/// 调用 OpenAI 兼容的 LLM API 进行文字翻译
#[tauri::command]
pub async fn screenshot_translate(
    text: String,
    source_lang: String,
    target_lang: String,
    api_config: AiConfig,
    api_key: String,
) -> Result<String, AppError> {
    if text.trim().is_empty() {
        return Err(AppError::Validation("翻译文本不能为空".to_string()));
    }

    let source_desc = if source_lang == "auto" {
        "auto-detected language".to_string()
    } else {
        source_lang.clone()
    };

    let prompt = format!(
        "Translate the following text from {} to {}. Only return the translated text, no explanations or extra formatting.\n\n{}",
        source_desc, target_lang, text
    );

    let body = serde_json::json!({
        "model": api_config.model,
        "messages": [
            {
                "role": "system",
                "content": "You are a professional translator. Translate text accurately and naturally."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "max_tokens": api_config.max_tokens,
        "temperature": 0.3
    });

    let url = format!("{}/chat/completions", api_config.endpoint.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("翻译请求失败: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Other(format!(
            "翻译 API 返回错误 {}: {}", status, text
        )));
    }

    let data: ChatCompletionResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("解析翻译响应失败: {e}")))?;

    let translated = data
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .unwrap_or_default();

    Ok(translated)
}
