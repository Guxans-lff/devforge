//! 自定义 HTTP 更新模块
//!
//! 提供三个 Tauri 命令：
//! - `download_update`：下载远端安装包到固定目录，推送进度事件，下载完成后校验 SHA-256
//! - `launch_installer`：启动下载好的安装包（仅允许 .exe / .msi，且必须在 updates 目录内）
//! - `reveal_in_folder`：在资源管理器中定位已下载的安装包

use std::path::PathBuf;
use tauri::{command, AppHandle, Emitter};
use crate::utils::error::AppError;

/// 下载结果
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub saved_path: String,
    pub file_size: u64,
}

/// 下载进度事件载荷
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
    percentage: u32,
}

/// 获取固定的更新下载目录（应用数据目录/updates）
fn get_updates_dir() -> Result<PathBuf, AppError> {
    let base = crate::utils::boot_config::BootConfigManager::get_suggested_default_path();
    Ok(base.join("updates"))
}

/// 校验路径是否在允许的 updates 目录内，防止路径穿越
fn validate_path_in_updates_dir(path: &PathBuf) -> Result<(), AppError> {
    let updates_dir = get_updates_dir()?;

    // 确保 updates 目录存在，以便 canonicalize 能正确解析
    if !updates_dir.exists() {
        std::fs::create_dir_all(&updates_dir)?;
    }
    let canonical_updates = updates_dir.canonicalize()
        .map_err(|e| AppError::Io(e))?;

    // canonicalize 需要路径存在，对于目标路径可能还不存在的情况用 parent 校验
    let check_path = if path.exists() {
        path.canonicalize()
            .map_err(|e| AppError::Io(e))?
    } else {
        // 文件可能不存在（如下载前），校验其父目录
        let parent = path.parent()
            .ok_or_else(|| AppError::Validation("无效的文件路径".into()))?;
        if parent.exists() {
            parent.canonicalize()
                .map_err(|e| AppError::Io(e))?
                .join(path.file_name().unwrap_or_default())
        } else {
            return Err(AppError::Validation("目标目录不存在".into()));
        }
    };

    if !check_path.starts_with(&canonical_updates) {
        return Err(AppError::Validation(format!(
            "路径超出允许范围，仅允许在 {} 内操作",
            updates_dir.display()
        )));
    }

    Ok(())
}

/// 校验 URL 协议，仅允许 http/https
fn validate_url(url: &str) -> Result<(), AppError> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::Validation(
            "不允许的下载地址协议，仅支持 http:// 和 https://".into()
        ));
    }
    Ok(())
}

/// 下载远端安装包到固定的 updates 目录，支持进度推送和 SHA-256 校验
///
/// - `url`：安装包下载地址（仅允许 http/https 协议）
/// - `sha256`：可选，下载完成后校验文件完整性
#[command]
pub async fn download_update(
    app: AppHandle,
    url: String,
    sha256: Option<String>,
) -> Result<DownloadResult, AppError> {
    // 校验 URL 协议
    validate_url(&url)?;

    // 从 URL 提取文件名
    let file_name = url
        .rsplit('/')
        .next()
        .filter(|n| !n.is_empty())
        .unwrap_or("devforge-setup.exe");

    // 使用固定的 updates 目录，不接受前端传入
    let dir = get_updates_dir()?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
    }
    let target_path = dir.join(file_name);

    log::info!("开始下载更新: {} -> {:?}", url, target_path);

    // 发起 HTTP 请求
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(600))
        .send()
        .await
        .map_err(|e| AppError::Other(format!("下载请求失败: {}", e)))?;

    if !resp.status().is_success() {
        return Err(AppError::Other(format!(
            "下载失败，HTTP 状态码: {}",
            resp.status()
        )));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    // 流式写入文件
    let mut file = tokio::fs::File::create(&target_path)
        .await
        .map_err(|e| AppError::Io(e))?;

    use tokio::io::AsyncWriteExt;
    use sha2::{Sha256, Digest};

    let mut hasher = Sha256::new();
    let mut stream = resp.bytes_stream();
    let mut last_emit = std::time::Instant::now();

    use futures::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Other(format!("下载中断: {}", e)))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| AppError::Io(e))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;

        // 节流推送进度（每 200ms 一次）
        if last_emit.elapsed() >= std::time::Duration::from_millis(200) {
            let percentage = if total > 0 {
                ((downloaded as f64 / total as f64) * 100.0).min(100.0) as u32
            } else {
                0
            };
            let _ = app.emit(
                "updater://download-progress",
                DownloadProgress {
                    downloaded,
                    total,
                    percentage,
                },
            );
            last_emit = std::time::Instant::now();
        }
    }

    file.flush().await.map_err(|e| AppError::Io(e))?;
    drop(file);

    // 最终进度 100%
    let _ = app.emit(
        "updater://download-progress",
        DownloadProgress {
            downloaded,
            total: downloaded,
            percentage: 100,
        },
    );

    log::info!("下载完成: {:?} ({} bytes)", target_path, downloaded);

    // SHA-256 校验
    if let Some(expected) = sha256 {
        let actual = format!("{:x}", hasher.finalize());
        if actual != expected.to_lowercase() {
            // 校验失败，删除文件
            let _ = tokio::fs::remove_file(&target_path).await;
            return Err(AppError::Validation(format!(
                "SHA-256 校验失败：期望 {}，实际 {}",
                expected, actual
            )));
        }
        log::info!("SHA-256 校验通过");
    }

    Ok(DownloadResult {
        saved_path: target_path.to_string_lossy().to_string(),
        file_size: downloaded,
    })
}

/// 启动已下载的安装包
///
/// 安全限制：
/// 1. 仅允许 `.exe` 和 `.msi` 文件
/// 2. 路径必须在应用 updates 目录内
#[command]
pub async fn launch_installer(app: AppHandle, path: String) -> Result<(), AppError> {
    let path = PathBuf::from(&path);

    // 安全校验：只允许启动安装包格式
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext != "exe" && ext != "msi" {
        return Err(AppError::Validation(format!(
            "不支持的安装包格式: .{}，仅允许 .exe 或 .msi",
            ext
        )));
    }

    if !path.exists() {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("安装包不存在: {:?}", path),
        )));
    }

    // 安全校验：路径必须在 updates 目录内
    validate_path_in_updates_dir(&path)?;

    log::info!("启动安装器: {:?}", path);

    // Windows：启动安装包
    // NSIS 安装包支持 /S（静默安装）和 /D=<dir>（指定安装目录）
    // MSI 使用 msiexec /i 并带 /qn 实现静默安装
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        if ext == "msi" {
            Command::new("msiexec")
                .args(["/i", &path.to_string_lossy(), "/qn"])
                .spawn()
                .map_err(|e| AppError::Other(format!("启动安装器失败: {}", e)))?;
        } else {
            // NSIS .exe 安装包：/S 静默安装
            Command::new(&path)
                .arg("/S")
                .spawn()
                .map_err(|e| AppError::Other(format!("启动安装器失败: {}", e)))?;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        return Err(AppError::Other("当前仅支持 Windows 平台启动安装器".into()));
    }

    // 短暂延迟确保安装器进程已独立启动
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // 退出当前应用，让安装器可以覆盖安装
    log::info!("安装器已启动，退出当前应用");
    app.exit(0);

    Ok(())
}

/// 在资源管理器中定位文件
///
/// 安全限制：路径必须在应用 updates 目录内
#[command]
pub async fn reveal_in_folder(path: String) -> Result<(), AppError> {
    let path = PathBuf::from(&path);

    if !path.exists() {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("文件不存在: {:?}", path),
        )));
    }

    // 安全校验：路径必须在 updates 目录内
    validate_path_in_updates_dir(&path)?;

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .args(["/select,", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| AppError::Other(format!("打开资源管理器失败: {}", e)))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        return Err(AppError::Other("当前仅支持 Windows 平台".into()));
    }

    Ok(())
}
