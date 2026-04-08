use std::path::PathBuf;

use chrono::Utc;
use image::GenericImageView;
use uuid::Uuid;
use xcap::{Monitor, Window};

use crate::models::screenshot::{
    CaptureResult, MonitorInfo, ScreenshotHistoryItem, WindowInfo,
};
use crate::utils::error::AppError;

/// 截图引擎：无状态连接，管理截图文件和系统截图能力
pub struct ScreenshotEngine {
    screenshots_dir: PathBuf,
}

impl ScreenshotEngine {
    /// 创建引擎实例，初始化截图目录
    pub fn new(app_data_dir: PathBuf) -> Self {
        let screenshots_dir = app_data_dir.join("screenshots");
        // 确保目录存在
        if let Err(e) = std::fs::create_dir_all(&screenshots_dir) {
            log::warn!("创建截图目录失败: {}", e);
        }
        Self { screenshots_dir }
    }

    /// 获取截图存储目录
    pub fn screenshots_dir(&self) -> &PathBuf {
        &self.screenshots_dir
    }

    // ── 显示器 ─────────────────────────────────────────────────

    /// 枚举所有显示器
    pub fn list_monitors() -> Result<Vec<MonitorInfo>, AppError> {
        let monitors = Monitor::all()
            .map_err(|e| AppError::Other(format!("枚举显示器失败: {e}")))?;

        let mut result = Vec::with_capacity(monitors.len());
        for (idx, m) in monitors.iter().enumerate() {
            result.push(MonitorInfo {
                id: idx as u32,
                name: m.name().unwrap_or_else(|_| format!("Monitor {}", idx)),
                x: m.x().unwrap_or(0),
                y: m.y().unwrap_or(0),
                width: m.width().unwrap_or(0),
                height: m.height().unwrap_or(0),
                is_primary: m.is_primary().unwrap_or(false),
                scale_factor: m.scale_factor().unwrap_or(1.0),
            });
        }
        Ok(result)
    }

    // ── 窗口列表 ──────────────────────────────────────────────

    /// 获取所有可见窗口（用于框选时的智能吸附）
    pub fn list_windows() -> Result<Vec<WindowInfo>, AppError> {
        let windows = Window::all()
            .map_err(|e| AppError::Other(format!("枚举窗口失败: {e}")))?;

        let mut result = Vec::new();
        for w in windows {
            let is_minimized = w.is_minimized().unwrap_or(true);
            let title = w.title().unwrap_or_default();
            let width = w.width().unwrap_or(0);
            let height = w.height().unwrap_or(0);
            // 过滤掉不可见的窗口（最小化、无标题、零尺寸）
            if is_minimized || title.is_empty() || width == 0 || height == 0 {
                continue;
            }
            result.push(WindowInfo {
                title,
                app_name: w.app_name().unwrap_or_default(),
                x: w.x().unwrap_or(0),
                y: w.y().unwrap_or(0),
                width,
                height,
                is_minimized,
            });
        }
        Ok(result)
    }

    // ── 截图 ──────────────────────────────────────────────────

    /// 全屏截图
    pub fn capture_fullscreen(
        &self,
        monitor_id: Option<u32>,
    ) -> Result<CaptureResult, AppError> {
        let monitors = Monitor::all()
            .map_err(|e| AppError::Other(format!("枚举显示器失败: {e}")))?;

        let monitor = if let Some(id) = monitor_id {
            monitors
                .into_iter()
                .nth(id as usize)
                .ok_or_else(|| AppError::Other(format!("显示器 {} 未找到", id)))?
        } else {
            // 默认主显示器
            monitors
                .into_iter()
                .find(|m| m.is_primary().unwrap_or(false))
                .or_else(|| {
                    Monitor::all().ok().and_then(|ms| ms.into_iter().next())
                })
                .ok_or_else(|| AppError::Other("未找到可用显示器".into()))?
        };

        let image = monitor
            .capture_image()
            .map_err(|e| AppError::Other(format!("截图失败: {e}")))?;

        self.save_capture_image(&image)
    }

    /// 区域截图：先全屏截取，再用 image crate 裁剪指定区域
    pub fn capture_region(
        &self,
        monitor_id: u32,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    ) -> Result<CaptureResult, AppError> {
        let monitors = Monitor::all()
            .map_err(|e| AppError::Other(format!("枚举显示器失败: {e}")))?;

        let monitor = monitors
            .into_iter()
            .nth(monitor_id as usize)
            .ok_or_else(|| AppError::Other(format!("显示器 {} 未找到", monitor_id)))?;

        // 先截取全屏
        let full_image = monitor
            .capture_image()
            .map_err(|e| AppError::Other(format!("全屏截图失败: {e}")))?;

        // 用 image crate 裁剪指定区域
        let crop_x = x.max(0) as u32;
        let crop_y = y.max(0) as u32;
        let crop_w = width.min(full_image.width().saturating_sub(crop_x));
        let crop_h = height.min(full_image.height().saturating_sub(crop_y));

        let cropped = image::imageops::crop_imm(&full_image, crop_x, crop_y, crop_w, crop_h)
            .to_image();

        self.save_capture_image(&cropped)
    }

    /// 窗口截图
    pub fn capture_window(&self, window_title: &str) -> Result<CaptureResult, AppError> {
        let windows = Window::all()
            .map_err(|e| AppError::Other(format!("枚举窗口失败: {e}")))?;

        let window = windows
            .into_iter()
            .find(|w| w.title().unwrap_or_default() == window_title)
            .ok_or_else(|| AppError::Other(format!("窗口 '{}' 未找到", window_title)))?;

        if window.is_minimized().unwrap_or(false) {
            return Err(AppError::Other("无法截取最小化窗口".into()));
        }

        let image = window
            .capture_image()
            .map_err(|e| AppError::Other(format!("窗口截图失败: {e}")))?;

        self.save_capture_image(&image)
    }

    // ── 剪贴板 ────────────────────────────────────────────────

    /// 复制图片文件到剪贴板
    ///
    /// 注意：arboard::Clipboard 是 !Send，必须在 spawn_blocking 中调用
    pub fn copy_image_to_clipboard(image_path: &str) -> Result<(), AppError> {
        let img = image::open(image_path)
            .map_err(|e| AppError::Other(format!("打开图片失败: {e}")))?;

        let rgba = img.to_rgba8();
        let (width, height) = img.dimensions();

        let mut clipboard = arboard::Clipboard::new()
            .map_err(|e| AppError::Other(format!("初始化剪贴板失败: {e}")))?;

        clipboard
            .set_image(arboard::ImageData {
                width: width as usize,
                height: height as usize,
                bytes: rgba.into_raw().into(),
            })
            .map_err(|e| AppError::Other(format!("复制到剪贴板失败: {e}")))?;

        Ok(())
    }

    /// 复制 PNG base64 数据到剪贴板
    pub fn copy_base64_to_clipboard(png_base64: &str) -> Result<(), AppError> {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(png_base64)
            .map_err(|e| AppError::Other(format!("base64 解码失败: {e}")))?;

        let img = image::load_from_memory(&bytes)
            .map_err(|e| AppError::Other(format!("图片解码失败: {e}")))?;

        let rgba = img.to_rgba8();
        let (width, height) = img.dimensions();

        let mut clipboard = arboard::Clipboard::new()
            .map_err(|e| AppError::Other(format!("初始化剪贴板失败: {e}")))?;

        clipboard
            .set_image(arboard::ImageData {
                width: width as usize,
                height: height as usize,
                bytes: rgba.into_raw().into(),
            })
            .map_err(|e| AppError::Other(format!("复制到剪贴板失败: {e}")))?;

        Ok(())
    }

    // ── 文件操作 ──────────────────────────────────────────────

    /// 保存文件到指定路径
    pub fn save_to_file(source: &str, dest: &str) -> Result<(), AppError> {
        std::fs::copy(source, dest)
            .map_err(|e| AppError::Io(e))?;
        Ok(())
    }

    /// 保存 base64 PNG 到文件
    pub fn save_base64_to_file(png_base64: &str, dest: &str) -> Result<(), AppError> {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(png_base64)
            .map_err(|e| AppError::Other(format!("base64 解码失败: {e}")))?;

        std::fs::write(dest, &bytes)?;
        Ok(())
    }

    // ── 历史管理 ──────────────────────────────────────────────

    /// 列出截图历史
    pub fn list_history(&self) -> Result<Vec<ScreenshotHistoryItem>, AppError> {
        let mut items = Vec::new();

        if !self.screenshots_dir.exists() {
            return Ok(items);
        }

        let entries = std::fs::read_dir(&self.screenshots_dir)?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("png") {
                continue;
            }

            let metadata = entry.metadata()?;
            let file_name = path.file_stem().unwrap_or_default().to_string_lossy().to_string();

            // 尝试读取图片尺寸
            let (width, height) = match image::image_dimensions(&path) {
                Ok((w, h)) => (w, h),
                Err(_) => (0, 0),
            };

            // 从文件修改时间获取截图时间
            let captured_at = metadata
                .modified()
                .ok()
                .map(|t| {
                    let dt: chrono::DateTime<Utc> = t.into();
                    dt.to_rfc3339()
                })
                .unwrap_or_default();

            items.push(ScreenshotHistoryItem {
                id: file_name,
                file_path: path.to_string_lossy().to_string(),
                width,
                height,
                file_size: metadata.len(),
                captured_at,
            });
        }

        // 按时间倒序
        items.sort_by(|a, b| b.captured_at.cmp(&a.captured_at));
        Ok(items)
    }

    /// 删除截图
    pub fn delete_screenshot(&self, id: &str) -> Result<(), AppError> {
        let path = self.screenshots_dir.join(format!("{}.png", id));
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        Ok(())
    }

    /// 清理旧截图（超过指定天数）
    pub fn cleanup_old(&self, days: u32) -> Result<u32, AppError> {
        let threshold = Utc::now() - chrono::Duration::days(days as i64);
        let mut count = 0;

        if !self.screenshots_dir.exists() {
            return Ok(0);
        }

        let entries = std::fs::read_dir(&self.screenshots_dir)?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("png") {
                continue;
            }
            if let Ok(metadata) = entry.metadata() {
                if let Ok(modified) = metadata.modified() {
                    let dt: chrono::DateTime<Utc> = modified.into();
                    if dt < threshold {
                        if std::fs::remove_file(&path).is_ok() {
                            count += 1;
                        }
                    }
                }
            }
        }
        Ok(count)
    }

    /// 从已有截图文件裁剪指定区域（不重新截屏）
    pub fn crop_from_file(
        &self,
        source_path: &str,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    ) -> Result<CaptureResult, AppError> {
        let img = image::open(source_path)
            .map_err(|e| AppError::Other(format!("打开截图文件失败: {e}")))?
            .to_rgba8();

        let crop_x = x.max(0) as u32;
        let crop_y = y.max(0) as u32;
        let crop_w = width.min(img.width().saturating_sub(crop_x));
        let crop_h = height.min(img.height().saturating_sub(crop_y));

        let cropped = image::imageops::crop_imm(&img, crop_x, crop_y, crop_w, crop_h)
            .to_image();

        self.save_capture_image(&cropped)
    }

    // ── 私有辅助 ──────────────────────────────────────────────

    /// 保存 RgbaImage 到临时文件并返回结果
    fn save_capture_image(
        &self,
        image: &image::RgbaImage,
    ) -> Result<CaptureResult, AppError> {
        let capture_id = Uuid::new_v4().to_string();
        let file_path = self.screenshots_dir.join(format!("{}.png", capture_id));

        image
            .save(&file_path)
            .map_err(|e| AppError::Other(format!("保存截图失败: {e}")))?;

        Ok(CaptureResult {
            file_path: file_path.to_string_lossy().to_string(),
            width: image.width(),
            height: image.height(),
            capture_id,
            captured_at: Utc::now().to_rfc3339(),
        })
    }
}
