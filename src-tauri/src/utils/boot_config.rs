use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use directories::ProjectDirs;
use std::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BootConfig {
    pub data_storage_path: Option<String>,
}

impl Default for BootConfig {
    fn default() -> Self {
        Self { data_storage_path: None }
    }
}

pub struct BootConfigManager;

impl BootConfigManager {
    pub fn get_exe_dir() -> Option<PathBuf> {
        std::env::current_exe().ok()?.parent().map(|p| p.to_path_buf())
    }

    pub fn get_suggested_default_path() -> PathBuf {
        let default_fallback = PathBuf::from("D:\\DevForgeData");
        
        if let Some(exe_dir) = Self::get_exe_dir() {
            let exe_path_str = exe_dir.to_string_lossy().to_lowercase();
            // 如果安装在 D 盘，或者不在常用的系统程序目录（C:\Program Files 等）
            // 我们倾向于做“便携式”关联
            if exe_path_str.starts_with("d:\\") || !exe_path_str.contains("program files") {
                return exe_dir.join("data");
            }
        }
        
        default_fallback
    }

    fn get_config_file_path() -> Option<PathBuf> {
        ProjectDirs::from("com", "devforge", "DevForge")
            .map(|dirs| {
                let path = dirs.data_dir().join("boot.json");
                log::info!("Boot config path: {:?}", path);
                path
            })
    }

    pub fn load() -> BootConfig {
        if let Some(path) = Self::get_config_file_path() {
            if path.exists() {
                if let Ok(content) = fs::read_to_string(path) {
                    if let Ok(config) = serde_json::from_str::<BootConfig>(&content) {
                        return config;
                    }
                }
            }
        }
        BootConfig::default()
    }

    pub fn save(config: &BootConfig) -> Result<(), String> {
        if let Some(path) = Self::get_config_file_path() {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
            fs::write(path, content).map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("Failed to determine config directory".into())
        }
    }
}
