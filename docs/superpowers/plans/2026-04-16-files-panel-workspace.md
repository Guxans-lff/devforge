# FilesPanel 多根工作区资源管理器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 FilesPanel 从 SFTP 连接列表重构为多根工作区本地文件资源管理器，支持懒加载文件树、CRUD、实时监听、Git 装饰、压缩文件夹、AI workDir 联动。

**Architecture:** Rust 后端新增 `workspace_fs` 命令模块 + `file_watcher` 服务，通过 Tauri commands 暴露文件操作和监听。前端 Pinia store 管理扁平树结构，`@tanstack/vue-virtual` 虚拟滚动渲染，Decoration Provider 解耦 Git 状态。

**Tech Stack:** Rust (`notify-debouncer-full`, `trash`, `git2`, `walkdir`), Vue 3, TypeScript, Pinia, `@tanstack/vue-virtual`, Tauri 2

**Design Spec:** `docs/superpowers/specs/2026-04-16-files-panel-workspace-design.md`

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `src-tauri/src/services/file_watcher.rs` | 文件监听引擎，管理多个 watcher 实例 |
| `src-tauri/src/commands/workspace_fs.rs` | Tauri 命令：读目录、CRUD、监听、Git 状态 |
| `src-tauri/src/models/workspace_fs.rs` | Rust 数据结构：DirEntry、FileChangeEvent 等 |
| `src/types/workspace-files.ts` | TypeScript 类型定义 |
| `src/stores/workspace-files.ts` | Pinia store：roots、nodeCache、decorations |
| `src/composables/useFileTree.ts` | 文件树组合函数：虚拟滚动、展开折叠、压缩 |
| `src/components/layout/panels/files/WorkspaceRootHeader.vue` | 根文件夹标题行 |
| `src/components/layout/panels/files/FileTreeRow.vue` | 文件树行组件（28px） |
| `src/components/layout/panels/files/FileTreeRenameInput.vue` | 原地重命名输入框 |
| `src/components/layout/panels/files/FileSearchDialog.vue` | Ctrl+P 快速搜索 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src-tauri/Cargo.toml` | 添加 `notify-debouncer-full`、`trash` 依赖（`notify` 通过 re-export 引用） |
| `src-tauri/src/lib.rs` | 注册新命令、初始化 FileWatcher state |
| `src-tauri/src/commands/mod.rs` | 添加 `pub mod workspace_fs;` |
| `src-tauri/src/services/mod.rs` | 添加 `pub mod file_watcher;` |
| `src-tauri/src/models/mod.rs` | 添加 `pub mod workspace_fs;` |
| `src/components/layout/panels/FilesPanel.vue` | 完全重写为工作区文件树 |
| `src/composables/useAiChat.ts` | workDir 选项联动工作区 roots |

---

## Task 1: Rust 数据模型 + Cargo 依赖

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/models/workspace_fs.rs`
- Modify: `src-tauri/src/models/mod.rs`

- [ ] **Step 1: 添加 Cargo 依赖**

在 `Cargo.toml` 的 `[dependencies]` 末尾添加：

```toml
# 文件监听（去抖 + rename 配对）
notify-debouncer-full = "0.4"

# 删除到回收站
trash = "5"
```

- [ ] **Step 2: 创建 Rust 数据模型**

创建 `src-tauri/src/models/workspace_fs.rs`：

```rust
use serde::{Deserialize, Serialize};

/// 目录条目（单层读取返回）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified: Option<i64>,
}

/// 递归目录条目（带相对路径）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecursiveDirEntry {
    pub relative_path: String,
    pub name: String,
    pub is_dir: bool,
    pub depth: u32,
}

/// 文件变更事件（推送前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    /// 变更类型
    #[serde(rename = "type")]
    pub change_type: String, // "create" | "modify" | "delete" | "rename"
    pub path: String,
    pub new_path: Option<String>,
    pub is_dir: bool,
}

/// Git 文件状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub status: String, // "modified" | "added" | "deleted" | "untracked" | "renamed" | "conflict"
}
```

- [ ] **Step 3: 注册模型模块**

在 `src-tauri/src/models/mod.rs` 中添加：

```rust
pub mod workspace_fs;
```

- [ ] **Step 4: 验证编译**

运行 `cd src-tauri && cargo check` 确认无编译错误。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(workspace-fs): 添加 Rust 数据模型 + notify/trash 依赖"
```

---

## Task 2: FileWatcher 服务

**Files:**
- Create: `src-tauri/src/services/file_watcher.rs`
- Modify: `src-tauri/src/services/mod.rs`

- [ ] **Step 1: 创建 FileWatcher 服务**

创建 `src-tauri/src/services/file_watcher.rs`：

```rust
use crate::models::workspace_fs::FileChangeEvent;
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, Debouncer, RecommendedCache,
    notify::{self, RecursiveMode, EventKind},
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
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
            .watcher()
            .watch(&watch_path, RecursiveMode::Recursive)
            .map_err(|e| format!("启动监听失败: {}", e))?;

        // 同时缓存目录树
        debouncer
            .cache()
            .add_root(&watch_path, RecursiveMode::Recursive);

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
```

- [ ] **Step 2: 注册服务模块**

在 `src-tauri/src/services/mod.rs` 中添加：

```rust
pub mod file_watcher;
```

- [ ] **Step 3: 验证编译**

运行 `cd src-tauri && cargo check`。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(workspace-fs): 添加 FileWatcher 文件监听服务"
```

---

## Task 3: workspace_fs 命令模块

**Files:**
- Create: `src-tauri/src/commands/workspace_fs.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 创建命令模块**

创建 `src-tauri/src/commands/workspace_fs.rs`：

```rust
use crate::models::workspace_fs::{DirEntry, GitFileStatus, RecursiveDirEntry};
use crate::services::file_watcher::FileWatcher;
use crate::utils::error::AppError;
use std::sync::Arc;

pub type FileWatcherState = Arc<FileWatcher>;

/// 读取单层目录
#[tauri::command]
pub async fn ws_read_directory(path: String) -> Result<Vec<DirEntry>, AppError> {
    let dir_path = std::path::Path::new(&path);
    let mut entries = Vec::new();
    let mut read_dir = tokio::fs::read_dir(dir_path)
        .await
        .map_err(|e| AppError::General(format!("读取目录失败: {}", e)))?;

    while let Some(entry) = read_dir.next_entry().await
        .map_err(|e| AppError::General(format!("读取条目失败: {}", e)))? {
        let name = entry.file_name().to_string_lossy().to_string();
        // 跳过隐藏文件（以 . 开头）
        if name.starts_with('.') {
            continue;
        }
        let metadata = entry.metadata().await.ok();
        let is_dir = metadata.as_ref().map_or(false, |m| m.is_dir());
        let size = metadata.as_ref().and_then(|m| if !m.is_dir() { Some(m.len()) } else { None });
        let modified = metadata.as_ref().and_then(|m| {
            m.modified().ok().and_then(|t| {
                t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs() as i64)
            })
        });

        entries.push(DirEntry {
            name,
            is_dir,
            size,
            modified,
        });
    }

    // 目录在前，文件在后；同类按名称排序
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

/// 递归读取目录（限深度，用于预取）
#[tauri::command]
pub async fn ws_read_directory_recursive(
    path: String,
    max_depth: u32,
) -> Result<Vec<RecursiveDirEntry>, AppError> {
    use walkdir::WalkDir;

    let base_path = std::path::Path::new(&path);
    let entries: Vec<RecursiveDirEntry> = WalkDir::new(&path)
        .max_depth(max_depth as usize)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path() != base_path)
        .filter(|e| {
            // 跳过隐藏目录及其内容
            !e.path().components().any(|c| {
                c.as_os_str().to_string_lossy().starts_with('.')
            })
        })
        .map(|e| {
            let relative = e.path().strip_prefix(&path).unwrap_or(e.path());
            RecursiveDirEntry {
                relative_path: relative.to_string_lossy().to_string().replace('\\', "/"),
                name: e.file_name().to_string_lossy().to_string(),
                is_dir: e.file_type().is_dir(),
                depth: e.depth() as u32,
            }
        })
        .collect();

    Ok(entries)
}

/// 新建文件
#[tauri::command]
pub async fn ws_create_file(path: String, content: Option<String>) -> Result<(), AppError> {
    tokio::fs::write(&path, content.unwrap_or_default())
        .await
        .map_err(|e| AppError::General(format!("创建文件失败: {}", e)))
}

/// 新建文件夹
#[tauri::command]
pub async fn ws_create_directory(path: String) -> Result<(), AppError> {
    tokio::fs::create_dir_all(&path)
        .await
        .map_err(|e| AppError::General(format!("创建文件夹失败: {}", e)))
}

/// 重命名
#[tauri::command]
pub async fn ws_rename_entry(old_path: String, new_path: String) -> Result<(), AppError> {
    tokio::fs::rename(&old_path, &new_path)
        .await
        .map_err(|e| AppError::General(format!("重命名失败: {}", e)))
}

/// 删除（默认回收站）
#[tauri::command]
pub async fn ws_delete_entry(path: String, permanent: Option<bool>) -> Result<(), AppError> {
    if permanent.unwrap_or(false) {
        let p = std::path::Path::new(&path);
        if p.is_dir() {
            tokio::fs::remove_dir_all(&path).await
        } else {
            tokio::fs::remove_file(&path).await
        }
        .map_err(|e| AppError::General(format!("删除失败: {}", e)))
    } else {
        trash::delete(&path)
            .map_err(|e| AppError::General(format!("移至回收站失败: {}", e)))
    }
}

/// 移动文件/文件夹
#[tauri::command]
pub async fn ws_move_entry(source: String, target_dir: String) -> Result<(), AppError> {
    let source_path = std::path::Path::new(&source);
    let file_name = source_path.file_name()
        .ok_or_else(|| AppError::General("无效源路径".into()))?;
    let target_path = std::path::Path::new(&target_dir).join(file_name);
    tokio::fs::rename(&source, &target_path)
        .await
        .map_err(|e| AppError::General(format!("移动失败: {}", e)))
}

/// 启动目录监听
#[tauri::command]
pub async fn ws_watch_directory(
    state: tauri::State<'_, FileWatcherState>,
    app: tauri::AppHandle,
    id: String,
    path: String,
) -> Result<(), AppError> {
    state.watch(id, path, app)
        .await
        .map_err(|e| AppError::General(e))
}

/// 停止目录监听
#[tauri::command]
pub async fn ws_unwatch_directory(
    state: tauri::State<'_, FileWatcherState>,
    id: String,
) -> Result<(), AppError> {
    state.unwatch(&id).await;
    Ok(())
}

/// 获取 Git 状态
#[tauri::command]
pub async fn ws_get_git_status(repo_path: String) -> Result<Vec<GitFileStatus>, AppError> {
    // 使用 git2（已在依赖中）获取仓库状态
    let statuses = tokio::task::spawn_blocking(move || -> Result<Vec<GitFileStatus>, String> {
        let repo = git2::Repository::open(&repo_path)
            .map_err(|e| format!("打开仓库失败: {}", e))?;

        let status_opts = &mut git2::StatusOptions::new();
        status_opts.include_untracked(true);
        status_opts.recurse_untracked_dirs(true);

        let statuses = repo.statuses(Some(status_opts))
            .map_err(|e| format!("获取状态失败: {}", e))?;

        let result: Vec<GitFileStatus> = statuses.iter().filter_map(|entry| {
            let path = entry.path()?.to_string();
            let status = entry.status();
            let status_str = if status.is_conflicted() {
                "conflict"
            } else if status.is_wt_new() || status.is_index_new() {
                if status.is_index_new() { "added" } else { "untracked" }
            } else if status.is_wt_deleted() || status.is_index_deleted() {
                "deleted"
            } else if status.is_wt_renamed() || status.is_index_renamed() {
                "renamed"
            } else if status.is_wt_modified() || status.is_index_modified() {
                "modified"
            } else {
                return None;
            };
            Some(GitFileStatus {
                path,
                status: status_str.to_string(),
            })
        }).collect();

        Ok(result)
    })
    .await
    .map_err(|e| AppError::General(format!("Git 任务失败: {}", e)))?
    .map_err(|e| AppError::General(e))?;

    Ok(statuses)
}
```

- [ ] **Step 2: 注册命令模块**

在 `src-tauri/src/commands/mod.rs` 中添加：

```rust
pub mod workspace_fs;
```

- [ ] **Step 3: 更新 lib.rs — 添加 state 和 commands**

在 `lib.rs` 中：

1. 添加 import：
```rust
use commands::workspace_fs::{self, FileWatcherState};
use services::file_watcher::FileWatcher;
```

2. 在 `setup()` 中 Storage 初始化之后添加：
```rust
// Initialize FileWatcher — 文件系统监听引擎
let file_watcher_state: FileWatcherState = Arc::new(FileWatcher::new());
app.manage(file_watcher_state);
```

3. 在 `generate_handler![]` 末尾添加命令列表：
```rust
// Workspace filesystem
workspace_fs::ws_read_directory,
workspace_fs::ws_read_directory_recursive,
workspace_fs::ws_create_file,
workspace_fs::ws_create_directory,
workspace_fs::ws_rename_entry,
workspace_fs::ws_delete_entry,
workspace_fs::ws_move_entry,
workspace_fs::ws_watch_directory,
workspace_fs::ws_unwatch_directory,
workspace_fs::ws_get_git_status,
```

- [ ] **Step 4: 验证编译**

运行 `cd src-tauri && cargo check`。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(workspace-fs): 添加 Tauri 命令模块（目录读取/CRUD/监听/Git状态）"
```

---

## Task 4: TypeScript 类型定义

**Files:**
- Create: `src/types/workspace-files.ts`

- [ ] **Step 1: 创建类型文件**

创建 `src/types/workspace-files.ts`：

```typescript
/** 工作区根文件夹 */
export interface WorkspaceRoot {
  id: string                    // 路径 hash（DJB2）
  path: string                  // 绝对路径
  name: string                  // 显示名（路径最后一段）
  collapsed: boolean
  sortOrder: number
}

/** 扁平树节点 */
export interface FileNode {
  id: string                    // rootId:relativePath
  rootId: string
  name: string
  path: string                  // 相对路径
  absolutePath: string
  depth: number
  isDirectory: boolean
  isExpanded: boolean
  isLoading: boolean
  /** 压缩文件夹（单子目录链合并） */
  isCompressed: boolean
  compressedSegments?: string[]
  childCount?: number
  /** 是否为工作区根标题行（参与虚拟滚动） */
  isRootHeader?: boolean
}

/** 装饰信息（与节点解耦） */
export interface FileDecoration {
  gitStatus?: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'conflict'
  badge?: string
  color?: string
}

/** Tauri 返回的目录条目 */
export interface DirEntry {
  name: string
  isDir: boolean
  size?: number
  modified?: number
}

/** 递归目录条目 */
export interface RecursiveDirEntry {
  relativePath: string
  name: string
  isDir: boolean
  depth: number
}

/** 文件变更事件 */
export interface FileChangeEvent {
  type: 'create' | 'modify' | 'delete' | 'rename'
  path: string
  newPath?: string
  isDir: boolean
}

/** Git 文件状态 */
export interface GitFileStatus {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'conflict'
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(workspace-fs): 添加 TypeScript 类型定义"
```

---

## Task 5: Pinia Store — workspace-files

**Files:**
- Create: `src/stores/workspace-files.ts`

**依赖**: Task 4 类型定义

- [ ] **Step 1: 创建 store**

创建 `src/stores/workspace-files.ts`。这是最核心的文件，实现：

1. **roots 管理**: addRoot/removeRoot/reorderRoots，持久化到 SQLite
2. **nodeCache**: `Map<dirAbsPath, FileNode[]>` — 已加载的目录子节点
3. **expandedDirs**: `Set<string>` — 当前展开的目录 id
4. **decorations**: `Map<absolutePath, FileDecoration>` — Git 装饰，独立更新不触发树重算
5. **flatNodes 计算属性**: DFS 遍历 roots → expandedDirs → nodeCache，生成虚拟滚动数据源
6. **压缩文件夹逻辑**: 单子目录链合并为一个节点
7. **文件变更处理**: 监听 `explorer:changes` 事件，增量更新 nodeCache
8. **Git 装饰刷新**: 异步获取 + 批量更新 decorations Map

```typescript
import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { usePersistence } from '@/plugins/persistence'
import type {
  WorkspaceRoot,
  FileNode,
  FileDecoration,
  DirEntry,
  FileChangeEvent,
  GitFileStatus,
} from '@/types/workspace-files'

export const useWorkspaceFilesStore = defineStore('workspace-files', () => {
  // ─── 状态 ───
  const roots = ref<WorkspaceRoot[]>([])
  const expandedDirs = ref<Set<string>>(new Set())
  const nodeCache = ref<Map<string, FileNode[]>>(new Map())
  const decorations = shallowRef<Map<string, FileDecoration>>(new Map())
  const renamingNodeId = ref<string | null>(null)

  // ─── 持久化（仅 roots） ───
  const persistence = usePersistence({
    key: 'workspace-files',
    version: 1,
    serialize: () => ({ roots: roots.value }),
    deserialize: (data: any) => {
      if (data?.roots) {
        roots.value = data.roots
      }
    },
    debounce: 500,
  })

  // ─── 路径 hash 工具 ───
  function hashPath(path: string): string {
    // 简单 hash，前端不需要加密级别
    let hash = 0
    for (let i = 0; i < path.length; i++) {
      hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0
    }
    return Math.abs(hash).toString(36).slice(0, 8)
  }

  // ─── Roots 管理 ───
  async function addRoot(path: string): Promise<void> {
    // 标准化路径（Windows 反斜杠 → 正斜杠）
    const normalizedPath = path.replace(/\\/g, '/')
    if (roots.value.some(r => r.path === normalizedPath)) return

    const name = normalizedPath.split('/').filter(Boolean).pop() || normalizedPath
    const root: WorkspaceRoot = {
      id: hashPath(normalizedPath),
      path: normalizedPath,
      name,
      collapsed: false,
      sortOrder: roots.value.length,
    }
    roots.value.push(root)

    // 启动监听
    await invoke('ws_watch_directory', { id: root.id, path: normalizedPath })
    // 加载第一层
    await loadChildren(root.id, normalizedPath, 0)
    // 刷新 Git 状态
    refreshGitDecorations(normalizedPath)
  }

  async function removeRoot(id: string): Promise<void> {
    const root = roots.value.find(r => r.id === id)
    if (!root) return

    await invoke('ws_unwatch_directory', { id })
    roots.value = roots.value.filter(r => r.id !== id)

    // 清理缓存
    for (const key of nodeCache.value.keys()) {
      if (key.startsWith(root.path)) {
        nodeCache.value.delete(key)
      }
    }
    // 清理展开状态
    for (const dir of expandedDirs.value) {
      if (dir.startsWith(id + ':')) {
        expandedDirs.value.delete(dir)
      }
    }
  }

  function reorderRoots(fromIndex: number, toIndex: number): void {
    const item = roots.value.splice(fromIndex, 1)[0]
    roots.value.splice(toIndex, 0, item)
    roots.value.forEach((r, i) => r.sortOrder = i)
  }

  // ─── 目录加载 ───
  async function loadChildren(
    rootId: string,
    absolutePath: string,
    depth: number,
  ): Promise<void> {
    const entries: DirEntry[] = await invoke('ws_read_directory', { path: absolutePath })
    const root = roots.value.find(r => r.id === rootId)
    if (!root) return

    const rootPath = root.path
    const nodes: FileNode[] = entries.map(entry => {
      const entryAbsPath = `${absolutePath}/${entry.name}`
      const relativePath = entryAbsPath.slice(rootPath.length + 1)
      const nodeId = `${rootId}:${relativePath}`
      return {
        id: nodeId,
        rootId,
        name: entry.name,
        path: relativePath,
        absolutePath: entryAbsPath,
        depth,
        isDirectory: entry.isDir,
        isExpanded: expandedDirs.value.has(nodeId),
        isLoading: false,
        isCompressed: false,
      }
    })

    nodeCache.value.set(absolutePath, nodes)
    // 触发响应式更新
    nodeCache.value = new Map(nodeCache.value)
  }

  // ─── 展开/折叠 ───
  async function expandDir(nodeId: string): Promise<void> {
    expandedDirs.value.add(nodeId)
    expandedDirs.value = new Set(expandedDirs.value)

    // 找到节点获取 absolutePath
    const node = findNodeById(nodeId)
    if (!node) return

    // 加载子节点（如果未缓存）
    if (!nodeCache.value.has(node.absolutePath)) {
      await loadChildren(node.rootId, node.absolutePath, node.depth + 1)
    }

    // 延迟预取下一层
    setTimeout(() => prefetchChildren(node), 250)
  }

  function collapseDir(nodeId: string): void {
    expandedDirs.value.delete(nodeId)
    expandedDirs.value = new Set(expandedDirs.value)
  }

  function toggleDir(nodeId: string): void {
    if (expandedDirs.value.has(nodeId)) {
      collapseDir(nodeId)
    } else {
      expandDir(nodeId)
    }
  }

  /** 预取已展开目录的直接子目录 */
  async function prefetchChildren(node: FileNode): Promise<void> {
    const children = nodeCache.value.get(node.absolutePath) || []
    const dirsToFetch = children.filter(
      c => c.isDirectory && !nodeCache.value.has(c.absolutePath)
    )
    await Promise.all(
      dirsToFetch.map(d => loadChildren(d.rootId, d.absolutePath, d.depth + 1))
    )
  }

  // ─── 节点查找 ───
  function findNodeById(nodeId: string): FileNode | undefined {
    for (const nodes of nodeCache.value.values()) {
      const found = nodes.find(n => n.id === nodeId)
      if (found) return found
    }
    return undefined
  }

  // ─── 压缩文件夹 + flatNodes ───
  const flatNodes = computed<FileNode[]>(() => {
    const result: FileNode[] = []

    for (const root of roots.value) {
      // 根标题作为虚拟滚动节点（32px 行高）
      result.push({
        id: `root-header:${root.id}`,
        rootId: root.id,
        name: root.name,
        path: '',
        absolutePath: root.path,
        depth: -1,
        isDirectory: true,
        isExpanded: !root.collapsed,
        isLoading: false,
        isCompressed: false,
        isRootHeader: true,
      })
      if (root.collapsed) continue
      const children = nodeCache.value.get(root.path) || []
      for (const child of children) {
        appendNode(child, result)
      }
    }

    return result
  })

  function appendNode(node: FileNode, result: FileNode[]): void {
    // 压缩文件夹检测：目录 + 只有一个子目录
    if (node.isDirectory) {
      const compressed = tryCompress(node)
      if (compressed) {
        result.push(compressed)
        if (expandedDirs.value.has(compressed.id)) {
          const lastSegmentPath = compressed.absolutePath
          const children = nodeCache.value.get(lastSegmentPath) || []
          for (const child of children) {
            appendNode(child, result)
          }
        }
        return
      }
    }

    result.push({ ...node, isExpanded: expandedDirs.value.has(node.id) })

    if (node.isDirectory && expandedDirs.value.has(node.id)) {
      const children = nodeCache.value.get(node.absolutePath) || []
      for (const child of children) {
        appendNode(child, result)
      }
    }
  }

  /** 尝试压缩单子目录链 */
  function tryCompress(node: FileNode): FileNode | null {
    const segments = [node.name]
    let current = node
    let lastAbsPath = node.absolutePath

    while (true) {
      const children = nodeCache.value.get(current.absolutePath)
      if (!children || children.length !== 1 || !children[0].isDirectory) break
      current = children[0]
      segments.push(current.name)
      lastAbsPath = current.absolutePath
    }

    if (segments.length <= 1) return null

    return {
      ...node,
      id: current.id, // 使用最深层节点的 id，展开时从这里开始
      name: segments.join(' / '),
      absolutePath: lastAbsPath,
      isCompressed: true,
      compressedSegments: segments,
      isExpanded: expandedDirs.value.has(current.id),
    }
  }

  // ─── CRUD 操作 ───
  async function createFile(parentPath: string, name: string): Promise<void> {
    const fullPath = `${parentPath}/${name}`
    await invoke('ws_create_file', { path: fullPath })
  }

  async function createDirectory(parentPath: string, name: string): Promise<void> {
    const fullPath = `${parentPath}/${name}`
    await invoke('ws_create_directory', { path: fullPath })
  }

  async function renameEntry(oldAbsPath: string, newName: string): Promise<void> {
    const parent = oldAbsPath.split('/').slice(0, -1).join('/')
    const newPath = `${parent}/${newName}`
    await invoke('ws_rename_entry', { oldPath: oldAbsPath, newPath })
    renamingNodeId.value = null
  }

  async function deleteEntry(absolutePath: string, permanent = false): Promise<void> {
    await invoke('ws_delete_entry', { path: absolutePath, permanent })
  }

  async function moveEntry(source: string, targetDir: string): Promise<void> {
    await invoke('ws_move_entry', { source, targetDir })
  }

  // ─── Git 装饰 ───
  async function refreshGitDecorations(rootPath: string): Promise<void> {
    try {
      const statuses: GitFileStatus[] = await invoke('ws_get_git_status', { repoPath: rootPath })
      const newMap = new Map(decorations.value)
      // 清除该 root 下的旧装饰
      for (const key of newMap.keys()) {
        if (key.startsWith(rootPath)) {
          newMap.delete(key)
        }
      }
      // 写入新装饰
      for (const status of statuses) {
        const absPath = `${rootPath}/${status.path}`
        newMap.set(absPath, { gitStatus: status.status })
      }
      decorations.value = newMap
    } catch {
      // 非 git 仓库，忽略
    }
  }

  // ─── 文件变更事件处理 ───
  async function handleFileChanges(rootId: string, changes: FileChangeEvent[]): Promise<void> {
    const root = roots.value.find(r => r.id === rootId)
    if (!root) return

    // 收集需要刷新的父目录
    const dirsToRefresh = new Set<string>()
    for (const change of changes) {
      const parent = change.path.split('/').slice(0, -1).join('/')
      if (parent) dirsToRefresh.add(parent)
      if (change.newPath) {
        const newParent = change.newPath.split('/').slice(0, -1).join('/')
        if (newParent) dirsToRefresh.add(newParent)
      }
    }

    // 刷新受影响的缓存目录
    for (const dir of dirsToRefresh) {
      if (nodeCache.value.has(dir)) {
        const node = findNodeByAbsPath(dir)
        if (node) {
          await loadChildren(node.rootId, dir, node.depth + 1)
        }
      }
    }

    // 刷新 Git 装饰
    refreshGitDecorations(root.path)
  }

  function findNodeByAbsPath(absPath: string): FileNode | undefined {
    for (const nodes of nodeCache.value.values()) {
      const found = nodes.find(n => n.absolutePath === absPath)
      if (found) return found
    }
    // 可能是 root 本身
    const root = roots.value.find(r => r.path === absPath)
    if (root) {
      return {
        id: root.id,
        rootId: root.id,
        name: root.name,
        path: '',
        absolutePath: root.path,
        depth: -1,
        isDirectory: true,
        isExpanded: true,
        isLoading: false,
        isCompressed: false,
      }
    }
    return undefined
  }

  // ─── 初始化 ───
  let _initialized = false
  async function init(): Promise<void> {
    if (_initialized) return
    _initialized = true

    await persistence.load()
    persistence.autoSave([roots])

    // 恢复监听 + 加载第一层
    for (const root of roots.value) {
      invoke('ws_watch_directory', { id: root.id, path: root.path }).catch(() => {})
      loadChildren(root.id, root.path, 0)
      refreshGitDecorations(root.path)
    }

    // 监听文件变更事件（50ms 二次去抖）
    let _changeBuffer: { id: string; changes: FileChangeEvent[] }[] = []
    let _changeTimer: ReturnType<typeof setTimeout> | null = null

    listen<{ id: string; changes: FileChangeEvent[] }>('explorer:changes', (event) => {
      _changeBuffer.push(event.payload)
      if (_changeTimer) clearTimeout(_changeTimer)
      _changeTimer = setTimeout(() => {
        const buffered = _changeBuffer
        _changeBuffer = []
        // 按 rootId 合并
        const merged = new Map<string, FileChangeEvent[]>()
        for (const { id, changes } of buffered) {
          const existing = merged.get(id) || []
          existing.push(...changes)
          merged.set(id, existing)
        }
        for (const [id, changes] of merged) {
          handleFileChanges(id, changes)
        }
      }, 50)
    })
  }

  return {
    // 状态
    roots,
    expandedDirs,
    nodeCache,
    decorations,
    renamingNodeId,
    flatNodes,
    // roots 管理
    addRoot,
    removeRoot,
    reorderRoots,
    // 树操作
    expandDir,
    collapseDir,
    toggleDir,
    // CRUD
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry,
    moveEntry,
    // 工具
    findNodeById,
    refreshGitDecorations,
    // 生命周期
    init,
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(workspace-fs): 添加 Pinia store（roots/nodeCache/flatNodes/CRUD/Git装饰）"
```

---

## Task 6: useFileTree 组合函数

**Files:**
- Create: `src/composables/useFileTree.ts`

**依赖**: Task 5 store

- [ ] **Step 1: 创建组合函数**

创建 `src/composables/useFileTree.ts`，封装虚拟滚动、键盘导航、拖拽逻辑：

```typescript
import { ref, computed, type Ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useAdaptiveOverscan } from '@/composables/useAdaptiveOverscan'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import type { FileNode } from '@/types/workspace-files'

export function useFileTree(scrollContainerRef: Ref<HTMLElement | null>) {
  const store = useWorkspaceFilesStore()
  const focusedIndex = ref(-1)
  const selectedNodeId = ref<string | null>(null)

  // ─── 虚拟滚动 ───
  const { overscan, attach } = useAdaptiveOverscan(scrollContainerRef, {
    baseOverscan: 20,
    maxOverscan: 60,
    rowHeight: 28,
    velocityThreshold: 15,
    decayDelay: 300,
  })

  const virtualizer = useVirtualizer(computed(() => ({
    count: store.flatNodes.length,
    getScrollElement: () => scrollContainerRef.value,
    estimateSize: () => 28,
    overscan: overscan.value,
  })))

  const virtualItems = computed(() => virtualizer.value.getVirtualItems())
  const totalSize = computed(() => virtualizer.value.getTotalSize())

  // ─── 键盘导航 ───
  function handleKeyDown(e: KeyboardEvent): void {
    const nodes = store.flatNodes
    if (nodes.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusedIndex.value = Math.min(focusedIndex.value + 1, nodes.length - 1)
        selectedNodeId.value = nodes[focusedIndex.value]?.id ?? null
        virtualizer.value.scrollToIndex(focusedIndex.value)
        break
      case 'ArrowUp':
        e.preventDefault()
        focusedIndex.value = Math.max(focusedIndex.value - 1, 0)
        selectedNodeId.value = nodes[focusedIndex.value]?.id ?? null
        virtualizer.value.scrollToIndex(focusedIndex.value)
        break
      case 'ArrowRight':
        e.preventDefault()
        {
          const node = nodes[focusedIndex.value]
          if (node?.isDirectory && !store.expandedDirs.has(node.id)) {
            store.expandDir(node.id)
          }
        }
        break
      case 'ArrowLeft':
        e.preventDefault()
        {
          const node = nodes[focusedIndex.value]
          if (node?.isDirectory && store.expandedDirs.has(node.id)) {
            store.collapseDir(node.id)
          }
        }
        break
      case 'Enter':
        e.preventDefault()
        {
          const node = nodes[focusedIndex.value]
          if (node?.isDirectory) {
            store.toggleDir(node.id)
          }
          // 文件：双击才打开（Enter 不触发）
        }
        break
      case 'F2':
        e.preventDefault()
        if (selectedNodeId.value) {
          store.renamingNodeId = selectedNodeId.value
        }
        break
      case 'Delete':
        e.preventDefault()
        {
          const node = nodes[focusedIndex.value]
          if (node) {
            store.deleteEntry(node.absolutePath)
          }
        }
        break
    }
  }

  // ─── 拖拽 ───
  const dragOverNodeId = ref<string | null>(null)
  let dragExpandTimer: ReturnType<typeof setTimeout> | null = null

  function handleDragStart(e: DragEvent, node: FileNode): void {
    e.dataTransfer?.setData('application/x-devforge-file', JSON.stringify({
      id: node.id,
      absolutePath: node.absolutePath,
      isDirectory: node.isDirectory,
    }))
    e.dataTransfer!.effectAllowed = 'move'
  }

  function handleDragOver(e: DragEvent, node: FileNode): void {
    if (!node.isDirectory) return
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'

    if (dragOverNodeId.value !== node.id) {
      dragOverNodeId.value = node.id
      // 600ms 自动展开
      if (dragExpandTimer) clearTimeout(dragExpandTimer)
      dragExpandTimer = setTimeout(() => {
        if (!store.expandedDirs.has(node.id)) {
          store.expandDir(node.id)
        }
      }, 600)
    }
  }

  function handleDragLeave(): void {
    dragOverNodeId.value = null
    if (dragExpandTimer) {
      clearTimeout(dragExpandTimer)
      dragExpandTimer = null
    }
  }

  function handleDrop(e: DragEvent, targetNode: FileNode): void {
    e.preventDefault()
    dragOverNodeId.value = null
    if (dragExpandTimer) clearTimeout(dragExpandTimer)

    const data = e.dataTransfer?.getData('application/x-devforge-file')
    if (!data || !targetNode.isDirectory) return

    const source = JSON.parse(data)
    if (source.absolutePath === targetNode.absolutePath) return
    store.moveEntry(source.absolutePath, targetNode.absolutePath)
  }

  return {
    // 虚拟滚动
    virtualizer,
    virtualItems,
    totalSize,
    attachOverscan: attach,
    // 焦点
    focusedIndex,
    selectedNodeId,
    // 键盘
    handleKeyDown,
    // 拖拽
    dragOverNodeId,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(workspace-fs): 添加 useFileTree 组合函数（虚拟滚动/键盘/拖拽）"
```

---

## Task 7: UI 组件 — FileTreeRow + WorkspaceRootHeader

**Files:**
- Create: `src/components/layout/panels/files/FileTreeRow.vue`
- Create: `src/components/layout/panels/files/WorkspaceRootHeader.vue`
- Create: `src/components/layout/panels/files/FileTreeRenameInput.vue`

- [ ] **Step 1: 创建 FileTreeRow.vue**

28px 固定行高的文件树行组件：

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import type { FileNode, FileDecoration } from '@/types/workspace-files'
import {
  ChevronRight,
  File,
  Folder,
  FolderOpen,
} from 'lucide-vue-next'
import FileTreeRenameInput from './FileTreeRenameInput.vue'

const props = defineProps<{
  node: FileNode
  focused: boolean
  selected: boolean
  dragOver: boolean
}>()

const emit = defineEmits<{
  click: [node: FileNode]
  dblclick: [node: FileNode]
  contextmenu: [e: MouseEvent, node: FileNode]
  dragstart: [e: DragEvent, node: FileNode]
  dragover: [e: DragEvent, node: FileNode]
  dragleave: [e: DragEvent]
  drop: [e: DragEvent, node: FileNode]
}>()

const store = useWorkspaceFilesStore()

const decoration = computed<FileDecoration | undefined>(
  () => store.decorations.get(props.node.absolutePath)
)

const isRenaming = computed(() => store.renamingNodeId === props.node.id)

const gitStatusColor = computed(() => {
  switch (decoration.value?.gitStatus) {
    case 'modified': return 'text-yellow-500'
    case 'added': case 'untracked': return 'text-green-500'
    case 'deleted': return 'text-red-500'
    case 'conflict': return 'text-orange-500'
    case 'renamed': return 'text-blue-500'
    default: return ''
  }
})

const gitStatusLetter = computed(() => {
  switch (decoration.value?.gitStatus) {
    case 'modified': return 'M'
    case 'added': return 'A'
    case 'deleted': return 'D'
    case 'untracked': return 'U'
    case 'conflict': return 'C'
    case 'renamed': return 'R'
    default: return ''
  }
})
</script>

<template>
  <div
    class="flex h-7 items-center cursor-pointer select-none text-xs hover:bg-muted/50 transition-colors"
    :class="{
      'bg-primary/8': selected,
      'ring-1 ring-primary/30': focused,
      'bg-primary/15 ring-1 ring-primary/40': dragOver,
    }"
    :style="{ paddingLeft: `${node.depth * 16 + 8}px` }"
    draggable="true"
    @click="emit('click', node)"
    @dblclick="emit('dblclick', node)"
    @contextmenu.prevent="emit('contextmenu', $event, node)"
    @dragstart="emit('dragstart', $event, node)"
    @dragover="emit('dragover', $event, node)"
    @dragleave="emit('dragleave', $event)"
    @drop="emit('drop', $event, node)"
  >
    <!-- 展开箭头（目录） -->
    <span v-if="node.isDirectory" class="flex-shrink-0 w-4 h-4 flex items-center justify-center">
      <ChevronRight
        class="h-3 w-3 text-muted-foreground transition-transform duration-150"
        :class="{ 'rotate-90': node.isExpanded }"
      />
    </span>
    <span v-else class="w-4 flex-shrink-0" />

    <!-- 图标 -->
    <component
      :is="node.isDirectory ? (node.isExpanded ? FolderOpen : Folder) : File"
      class="h-4 w-4 flex-shrink-0 mr-1.5"
      :class="node.isDirectory ? 'text-blue-400' : 'text-muted-foreground'"
    />

    <!-- 文件名 / 重命名输入 -->
    <FileTreeRenameInput
      v-if="isRenaming"
      :node="node"
      class="flex-1 min-w-0"
    />
    <span
      v-else
      class="flex-1 truncate"
      :class="gitStatusColor"
    >
      {{ node.name }}
    </span>

    <!-- Git 徽标 -->
    <span
      v-if="gitStatusLetter"
      class="flex-shrink-0 ml-1 mr-2 text-[10px] font-bold"
      :class="gitStatusColor"
    >
      {{ gitStatusLetter }}
    </span>
  </div>
</template>
```

- [ ] **Step 2: 创建 WorkspaceRootHeader.vue**

```vue
<script setup lang="ts">
import type { WorkspaceRoot } from '@/types/workspace-files'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import {
  ChevronRight,
  FolderOpen,
  X,
  RefreshCw,
} from 'lucide-vue-next'

const props = defineProps<{
  root: WorkspaceRoot
}>()

const store = useWorkspaceFilesStore()

function toggleCollapse() {
  props.root.collapsed = !props.root.collapsed
}

function refresh() {
  store.refreshGitDecorations(props.root.path)
  // 清除缓存强制重新加载
  for (const key of store.nodeCache.keys()) {
    if (key.startsWith(props.root.path)) {
      store.nodeCache.delete(key)
    }
  }
  store.nodeCache = new Map(store.nodeCache)
  // 加载可见的展开目录会自动触发
}
</script>

<template>
  <div
    class="flex h-8 items-center gap-1 px-2 text-xs font-bold uppercase tracking-wide text-muted-foreground/70 hover:bg-muted/30 cursor-pointer group"
    @click="toggleCollapse"
  >
    <ChevronRight
      class="h-3 w-3 transition-transform duration-150"
      :class="{ 'rotate-90': !root.collapsed }"
    />
    <FolderOpen class="h-3.5 w-3.5 text-blue-400" />
    <span class="flex-1 truncate">{{ root.name }}</span>
    <button
      class="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted/50"
      @click.stop="refresh"
      title="刷新"
    >
      <RefreshCw class="h-3 w-3" />
    </button>
    <button
      class="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted/50"
      @click.stop="store.removeRoot(root.id)"
      title="移除工作区"
    >
      <X class="h-3 w-3" />
    </button>
  </div>
</template>
```

- [ ] **Step 3: 创建 FileTreeRenameInput.vue**

```vue
<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import type { FileNode } from '@/types/workspace-files'

const props = defineProps<{ node: FileNode }>()
const store = useWorkspaceFilesStore()
const inputRef = ref<HTMLInputElement>()
const inputValue = ref(props.node.name)

onMounted(async () => {
  await nextTick()
  inputRef.value?.focus()
  // 选中不含扩展名的部分
  const dotIndex = inputValue.value.lastIndexOf('.')
  if (dotIndex > 0 && !props.node.isDirectory) {
    inputRef.value?.setSelectionRange(0, dotIndex)
  } else {
    inputRef.value?.select()
  }
})

function confirm() {
  const newName = inputValue.value.trim()
  if (newName && newName !== props.node.name) {
    store.renameEntry(props.node.absolutePath, newName)
  } else {
    store.renamingNodeId = null
  }
}

function cancel() {
  store.renamingNodeId = null
}
</script>

<template>
  <input
    ref="inputRef"
    v-model="inputValue"
    class="h-5 w-full rounded border border-primary/50 bg-background px-1 text-xs outline-none"
    @keydown.enter="confirm"
    @keydown.escape="cancel"
    @blur="confirm"
  />
</template>
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(workspace-fs): 添加文件树行组件（FileTreeRow/RootHeader/RenameInput）"
```

---

## Task 8: FileSearchDialog + FilesPanel 重写

**Files:**
- Create: `src/components/layout/panels/files/FileSearchDialog.vue`
- Modify: `src/components/layout/panels/FilesPanel.vue` (完全重写)

- [ ] **Step 1: 创建 FileSearchDialog.vue**

```vue
<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { fuzzyFilter } from '@/utils/fuzzyMatch'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import type { FileNode } from '@/types/workspace-files'
import { Search, File, Folder } from 'lucide-vue-next'

const emit = defineEmits<{ close: []; select: [node: FileNode] }>()
const store = useWorkspaceFilesStore()
const query = ref('')
const inputRef = ref<HTMLInputElement>()
const selectedIndex = ref(0)

/** 搜集所有已缓存节点 */
const allNodes = computed<FileNode[]>(() => {
  const nodes: FileNode[] = []
  for (const list of store.nodeCache.values()) {
    nodes.push(...list)
  }
  return nodes
})

const results = computed(() => {
  if (!query.value.trim()) return []
  return fuzzyFilter(allNodes.value, query.value, n => n.path, 50)
})

watch(query, () => { selectedIndex.value = 0 })

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
  } else if (e.key === 'Enter' && results.value.length > 0) {
    e.preventDefault()
    emit('select', results.value[selectedIndex.value].item)
    emit('close')
  } else if (e.key === 'Escape') {
    emit('close')
  }
}

onMounted(async () => {
  await nextTick()
  inputRef.value?.focus()
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" @click.self="emit('close')">
    <div class="w-[500px] max-w-[90vw] rounded-lg border bg-background shadow-xl">
      <div class="flex items-center gap-2 border-b px-3 py-2">
        <Search class="h-4 w-4 text-muted-foreground" />
        <input
          ref="inputRef"
          v-model="query"
          class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          placeholder="搜索文件名..."
          @keydown="handleKeyDown"
        />
      </div>
      <div class="max-h-[300px] overflow-auto">
        <div
          v-for="(result, i) in results"
          :key="result.item.id"
          class="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs"
          :class="{ 'bg-primary/10': i === selectedIndex }"
          @click="emit('select', result.item); emit('close')"
          @mouseenter="selectedIndex = i"
        >
          <component :is="result.item.isDirectory ? Folder : File" class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <span class="truncate">{{ result.item.path }}</span>
          <span class="text-[10px] text-muted-foreground/50 ml-auto flex-shrink-0">{{ result.item.rootId }}</span>
        </div>
        <div v-if="query && results.length === 0" class="px-3 py-4 text-center text-xs text-muted-foreground/50">
          无匹配结果
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 重写 FilesPanel.vue**

完全重写 `src/components/layout/panels/FilesPanel.vue`：

```vue
<script setup lang="ts">
/**
 * FilesPanel — 多根工作区本地文件资源管理器
 *
 * 支持多项目文件夹同时浏览、懒加载虚拟滚动、CRUD、
 * 实时文件监听、Git 状态装饰、压缩文件夹。
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import { useWorkspaceStore } from '@/stores/workspace'
import { useFileTree } from '@/composables/useFileTree'
import type { FileNode } from '@/types/workspace-files'
import WorkspaceRootHeader from './files/WorkspaceRootHeader.vue'
import FileTreeRow from './files/FileTreeRow.vue'
import FileSearchDialog from './files/FileSearchDialog.vue'
import {
  FolderPlus,
  FilePlus,
  FolderOpen,
  Search,
  ChevronsDownUp,
  MoreHorizontal,
  Terminal,
  ExternalLink,
  Bot,
} from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'

const store = useWorkspaceFilesStore()
const workspace = useWorkspaceStore()
const scrollContainerRef = ref<HTMLElement | null>(null)
const showSearch = ref(false)

const {
  virtualItems,
  totalSize,
  attachOverscan,
  focusedIndex,
  selectedNodeId,
  handleKeyDown,
  dragOverNodeId,
  handleDragStart,
  handleDragOver,
  handleDragLeave,
  handleDrop,
} = useFileTree(scrollContainerRef)

// ─── 初始化 ───
onMounted(() => {
  store.init()
  if (scrollContainerRef.value) {
    attachOverscan()
  }
})

// ─── 添加工作区文件夹 ───
async function addFolder() {
  const selected = await open({ directory: true, multiple: false })
  if (selected) {
    await store.addRoot(selected as string)
  }
}

// ─── 折叠全部 ───
function collapseAll() {
  store.expandedDirs.clear()
  store.expandedDirs = new Set()
  for (const root of store.roots) {
    root.collapsed = true
  }
}

// ─── 行交互 ───
function handleRowClick(node: FileNode) {
  selectedNodeId.value = node.id
  focusedIndex.value = store.flatNodes.indexOf(node)
}

function handleRowDblClick(node: FileNode) {
  if (node.isDirectory) {
    store.toggleDir(node.id)
  }
  // TODO: 文件双击打开编辑器 Tab（后续任务）
}

// ─── 右键菜单 ───
const contextNode = ref<FileNode | null>(null)
const contextPos = ref({ x: 0, y: 0 })
const showContextMenu = ref(false)

function handleContextMenu(e: MouseEvent, node: FileNode) {
  contextNode.value = node
  contextPos.value = { x: e.clientX, y: e.clientY }
  showContextMenu.value = true
}

async function contextNewFile() {
  if (!contextNode.value) return
  const parent = contextNode.value.isDirectory
    ? contextNode.value.absolutePath
    : contextNode.value.absolutePath.split('/').slice(0, -1).join('/')
  // 创建后进入重命名
  const tmpName = '新建文件'
  await store.createFile(parent, tmpName)
}

async function contextNewFolder() {
  if (!contextNode.value) return
  const parent = contextNode.value.isDirectory
    ? contextNode.value.absolutePath
    : contextNode.value.absolutePath.split('/').slice(0, -1).join('/')
  await store.createDirectory(parent, '新建文件夹')
}

function contextRename() {
  if (contextNode.value) {
    store.renamingNodeId = contextNode.value.id
  }
}

function contextDelete() {
  if (contextNode.value) {
    store.deleteEntry(contextNode.value.absolutePath)
  }
}

async function contextCopyPath() {
  if (contextNode.value) {
    await navigator.clipboard.writeText(contextNode.value.absolutePath)
  }
}

function contextOpenInTerminal() {
  if (!contextNode.value) return
  const dir = contextNode.value.isDirectory
    ? contextNode.value.absolutePath
    : contextNode.value.absolutePath.split('/').slice(0, -1).join('/')
  // 利用现有 workspace.addTab 打开本地终端
  workspace.addTab({
    id: `terminal-${Date.now()}`,
    type: 'local-terminal',
    title: dir.split('/').pop() || 'Terminal',
    closable: true,
    meta: { cwd: dir },
  })
}

async function contextRevealInExplorer() {
  if (!contextNode.value) return
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(contextNode.value.absolutePath)
}

function contextSetAiWorkDir() {
  if (!contextNode.value) return
  const dir = contextNode.value.isDirectory
    ? contextNode.value.absolutePath
    : contextNode.value.absolutePath.split('/').slice(0, -1).join('/')
  // 设置 AI 工作目录（联动 useAiChat）
  // 具体实现取决于 AI 面板的 workDir API
  console.log('[workspace-fs] 设置 AI workDir:', dir)
}

/** 工具栏：在第一个 root 下新建文件 */
async function toolbarNewFile() {
  if (store.roots.length === 0) return
  const root = store.roots[0]
  await store.createFile(root.path, '新建文件')
}

// ─── Ctrl+P ───
function handleGlobalKeyDown(e: KeyboardEvent) {
  if (e.key === 'p' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    showSearch.value = true
  }
  // Ctrl+Shift+E: 聚焦文件面板
  if (e.key === 'e' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
    e.preventDefault()
    scrollContainerRef.value?.focus()
  }
}

onMounted(() => document.addEventListener('keydown', handleGlobalKeyDown))
onUnmounted(() => document.removeEventListener('keydown', handleGlobalKeyDown))

function handleSearchSelect(node: FileNode) {
  // 展开父目录链，滚动到节点
  selectedNodeId.value = node.id
  const idx = store.flatNodes.indexOf(node)
  if (idx >= 0) {
    focusedIndex.value = idx
  }
}

</script>

<template>
  <div class="flex h-full flex-col" @keydown="handleKeyDown" tabindex="0">
    <!-- 工具栏 -->
    <div class="flex items-center gap-0.5 border-b px-2 py-1">
      <button
        class="rounded p-1 hover:bg-muted/50"
        title="添加工作区文件夹"
        @click="addFolder"
      >
        <FolderPlus class="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <button
        class="rounded p-1 hover:bg-muted/50"
        title="新建文件"
        @click="toolbarNewFile"
      >
        <FilePlus class="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <button
        class="rounded p-1 hover:bg-muted/50"
        title="搜索文件 (Ctrl+P)"
        @click="showSearch = true"
      >
        <Search class="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <button
        class="rounded p-1 hover:bg-muted/50"
        title="折叠全部"
        @click="collapseAll"
      >
        <ChevronsDownUp class="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>

    <!-- 空状态 -->
    <div
      v-if="store.roots.length === 0"
      class="flex flex-col items-center justify-center py-10 text-center flex-1"
    >
      <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted/30">
        <FolderOpen class="h-5 w-5 text-muted-foreground/30" />
      </div>
      <p class="text-xs text-muted-foreground/60">暂无工作区文件夹</p>
      <button
        class="mt-3 rounded-md bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20"
        @click="addFolder"
      >
        添加文件夹
      </button>
    </div>

    <!-- 文件树 -->
    <div
      v-else
      ref="scrollContainerRef"
      class="flex-1 overflow-auto min-h-0"
    >
      <div :style="{ height: `${totalSize}px`, position: 'relative' }">
        <div
          v-for="item in virtualItems"
          :key="item.key"
          :style="{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: `${item.size}px`,
            transform: `translateY(${item.start}px)`,
          }"
        >
          <!-- 根标题行（isRootHeader 节点） -->
          <WorkspaceRootHeader
            v-if="store.flatNodes[item.index]?.isRootHeader"
            :root="store.roots.find(r => r.id === store.flatNodes[item.index].rootId)!"
          />
          <!-- 文件行 -->
          <FileTreeRow
            v-else
            :node="store.flatNodes[item.index]"
            :focused="focusedIndex === item.index"
            :selected="selectedNodeId === store.flatNodes[item.index]?.id"
            :drag-over="dragOverNodeId === store.flatNodes[item.index]?.id"
            @click="handleRowClick(store.flatNodes[item.index])"
            @dblclick="handleRowDblClick(store.flatNodes[item.index])"
            @contextmenu="handleContextMenu"
            @dragstart="handleDragStart"
            @dragover="handleDragOver"
            @dragleave="handleDragLeave"
            @drop="handleDrop"
          />
        </div>
      </div>
    </div>

    <!-- 右键菜单（shadcn ContextMenu） -->
    <Teleport to="body">
      <div
        v-if="showContextMenu"
        class="fixed inset-0 z-50"
        @click="showContextMenu = false"
        @contextmenu.prevent="showContextMenu = false"
      >
        <div
          class="absolute z-50 min-w-[180px] rounded-md border bg-popover p-1 shadow-md"
          :style="{ left: `${contextPos.x}px`, top: `${contextPos.y}px` }"
        >
          <button class="context-item" @click="contextNewFile(); showContextMenu = false">
            <FilePlus class="h-3.5 w-3.5" /> 新建文件
          </button>
          <button class="context-item" @click="contextNewFolder(); showContextMenu = false">
            <FolderPlus class="h-3.5 w-3.5" /> 新建文件夹
          </button>
          <div class="my-1 h-px bg-border" />
          <button class="context-item" @click="contextRename(); showContextMenu = false">
            重命名 <span class="ml-auto text-[10px] text-muted-foreground">F2</span>
          </button>
          <button class="context-item text-destructive" @click="contextDelete(); showContextMenu = false">
            删除 <span class="ml-auto text-[10px] text-muted-foreground">Del</span>
          </button>
          <div class="my-1 h-px bg-border" />
          <button class="context-item" @click="contextCopyPath(); showContextMenu = false">
            复制路径
          </button>
          <button class="context-item" @click="contextOpenInTerminal(); showContextMenu = false">
            <Terminal class="h-3.5 w-3.5" /> 在终端中打开
          </button>
          <button class="context-item" @click="contextRevealInExplorer(); showContextMenu = false">
            <ExternalLink class="h-3.5 w-3.5" /> 在系统资源管理器中显示
          </button>
          <div class="my-1 h-px bg-border" />
          <button class="context-item" @click="contextSetAiWorkDir(); showContextMenu = false">
            <Bot class="h-3.5 w-3.5" /> 作为 AI 工作目录
          </button>
        </div>
      </div>
    </Teleport>

    <!-- Ctrl+P 搜索 -->
    <Teleport to="body">
      <FileSearchDialog
        v-if="showSearch"
        @close="showSearch = false"
        @select="handleSearchSelect"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.context-item {
  @apply flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/50 cursor-pointer;
}
</style>
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(workspace-fs): 重写 FilesPanel + FileSearchDialog（完整工作区文件树）"
```

---

## Task 9: AI workDir 联动

**Files:**
- Modify: `src/composables/useAiChat.ts`

**依赖**: Task 5 store

- [ ] **Step 1: 在 useAiChat 中添加工作区 roots 作为 workDir 选项**

在 `src/composables/useAiChat.ts` 中找到 workDir 相关逻辑，添加：

```typescript
import { useWorkspaceFilesStore } from '@/stores/workspace-files'

// 在 composable 内部：
const filesStore = useWorkspaceFilesStore()

/** 可用的工作目录列表（工作区根） */
const availableWorkDirs = computed(() =>
  filesStore.roots.map(r => ({ label: r.name, value: r.path }))
)

/** 校验路径是否在某个工作区根内（安全检查） */
function isPathInWorkspace(targetPath: string): boolean {
  const normalized = targetPath.replace(/\\/g, '/')
  return filesStore.roots.some(r => normalized.startsWith(r.path + '/') || normalized === r.path)
}
```

将 `availableWorkDirs` 和 `isPathInWorkspace` 暴露出去。AI 工具执行路径必须通过 `isPathInWorkspace` 安全检查。

具体修改点需根据当前 `useAiChat.ts` 中 workDir 的用法决定：
- 如果 workDir 是手动输入路径 → 改为下拉选择 + 手动输入
- 如果已有选项列表 → 合入 workspace roots

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(workspace-fs): AI workDir 联动工作区 roots"
```

---

## Task 10: 集成验证 + 编译

- [ ] **Step 1: 后端编译验证**

```bash
cd src-tauri && cargo check
```

确认无编译错误。如果有 `notify` API 变更导致的类型问题，修复 `file_watcher.rs`。

- [ ] **Step 2: 前端类型检查**

```bash
cd src && npx vue-tsc --noEmit
```

修复任何类型错误。

- [ ] **Step 3: 启动开发服务器验证**

```bash
npm run tauri dev
```

手动测试：
1. 点击 Activity Bar 的 Files 图标 → 显示空状态
2. 点击"添加文件夹" → 选择一个项目目录 → 文件树加载
3. 展开/折叠目录 → 懒加载正常
4. 压缩文件夹（如 `src / components / layout`）→ 单行显示
5. Git 装饰 → modified 文件显示 M 徽标
6. F2 重命名 → 原地输入框
7. 右键菜单 → 新建文件/删除
8. Ctrl+P → 搜索文件
9. 添加第二个工作区 → 双根显示
10. 刷新后 roots 保持（持久化）

- [ ] **Step 4: 修复发现的问题**

根据测试结果修复。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix(workspace-fs): 集成测试修复"
```
