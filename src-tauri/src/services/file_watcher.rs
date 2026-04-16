use crate::models::workspace_fs::FileChangeEvent;
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, Debouncer, RecommendedCache,
    notify::{self, RecursiveMode, EventKind},
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

/// 单个目录的 watcher 句柄
struct WatchHandle {
    /// 保持 debouncer 存活以维持监听
    _debouncer: Debouncer<notify::RecommendedWatcher, RecommendedCache>,
}

/// 文件监听引擎 — 管理多个目录的 watcher
pub struct FileWatcher {
    watchers: RwLock<HashMap<String, WatchHandle>>,
}

impl FileWatcher {
    pub fn new() -> Self {
        Self {
            watchers: RwLock::new(HashMap::new()),
        }
    }

    /// 启动对指定目录的监听
    pub async fn watch(
        &self,
        id: String,
        path: String,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        // 先停掉同 id 的旧 watcher
        self.unwatch(&id).await;

        let watch_path = PathBuf::from(&path);
        if !watch_path.is_dir() {
            return Err(format!("路径不是目录: {}", path));
        }

        let watcher_id = id.clone();
        let mut debouncer = new_debouncer(
            Duration::from_millis(300),
            None,
            move |result: DebounceEventResult| {
                match result {
                    Ok(events) => {
                        let changes: Vec<FileChangeEvent> = events
                            .iter()
                            .filter_map(|event| {
                                let (change_type, is_dir) = match &event.kind {
                                    EventKind::Create(_) => ("create", event.paths.first().map_or(false, |p| p.is_dir())),
                                    EventKind::Modify(_) => ("modify", false),
                                    EventKind::Remove(_) => ("delete", false),
                                    _ => return None,
                                };
                                let path = event.paths.first()?.to_string_lossy().to_string();
                                // Windows 路径标准化
                                let path = path.replace('\\', "/");
                                Some(FileChangeEvent {
                                    change_type: change_type.to_string(),
                                    path,
                                    new_path: event.paths.get(1).map(|p| p.to_string_lossy().to_string().replace('\\', "/")),
                                    is_dir,
                                })
                            })
                            .collect();
                        if !changes.is_empty() {
                            let _ = app_handle.emit("explorer:changes", &serde_json::json!({
                                "id": watcher_id,
                                "changes": changes,
                            }));
                        }
                    }
                    Err(errors) => {
                        log::warn!("文件监听错误: {:?}", errors);
                    }
                }
            },
        ).map_err(|e| format!("创建 watcher 失败: {}", e))?;

        debouncer
            .watch(&watch_path, RecursiveMode::Recursive)
            .map_err(|e| format!("启动监听失败: {}", e))?;

        let handle = WatchHandle {
            _debouncer: debouncer,
        };

        self.watchers.write().await.insert(id, handle);
        Ok(())
    }

    /// 停止对指定 id 的监听
    pub async fn unwatch(&self, id: &str) {
        self.watchers.write().await.remove(id);
    }

    /// 停止所有监听
    pub async fn unwatch_all(&self) {
        self.watchers.write().await.clear();
    }
}
