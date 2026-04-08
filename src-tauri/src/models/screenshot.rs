use serde::{Deserialize, Serialize};

/// 显示器信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: u32,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
    pub scale_factor: f32,
}

/// 窗口信息（用于智能吸附）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub title: String,
    pub app_name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_minimized: bool,
}

/// 截图结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    /// 临时文件路径
    pub file_path: String,
    /// 图片宽度（物理像素）
    pub width: u32,
    /// 图片高度（物理像素）
    pub height: u32,
    /// 唯一标识
    pub capture_id: String,
    /// 截图时间 ISO 8601
    pub captured_at: String,
}

/// 截图历史记录项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotHistoryItem {
    pub id: String,
    pub file_path: String,
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
    pub captured_at: String,
}
