# AI 多窗口独立工作区 — 设计规格

## 概述

允许用户在同一个 DevForge 进程内打开多个独立的 AI 对话窗口，每个窗口绑定各自的工作区目录，互不干扰。支持从主窗口按钮和全局快捷键两种方式创建新窗口。

## 需求范围

- **仅 AI 对话**支持多窗口，DB/Redis/SSH 等功能维持单窗口
- 每个窗口独立 session、独立工作目录、独立模型选择
- 共享 Provider 配置、历史会话列表、API Key（进程级天然共享）

## 技术方案：Tauri 多 Webview 窗口

### 1. 窗口创建（后端）

新增 Tauri 命令 `create_ai_window`，上限 5 个独立 AI 窗口：

```rust
#[tauri::command]
async fn create_ai_window(app: tauri::AppHandle) -> Result<String, String> {
    // 上限检查：通过 app.webview_windows() 枚举 "ai-" 前缀窗口
    let ai_count = app.webview_windows().keys()
        .filter(|k| k.starts_with("ai-"))
        .count();
    if ai_count >= 5 {
        return Err("最多同时打开 5 个 AI 窗口".into());
    }

    let window_id = format!("ai-{}", chrono::Utc::now().timestamp_millis());
    let url = format!("/ai-standalone?windowId={}", window_id);

    tauri::WebviewWindowBuilder::new(&app, &window_id, tauri::WebviewUrl::App(url.into()))
        .title("AI 对话")
        .inner_size(800.0, 700.0)
        .min_inner_size(480.0, 400.0)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(window_id)
}
```

### 2. 前端路由

新增路由 `/ai-standalone`，对应 `AiStandaloneView.vue`：

```typescript
// main.ts 路由新增
{ path: '/ai-standalone', component: () => import('./views/AiStandaloneView.vue') }
```

### 3. AiStandaloneView.vue

精简版 AI 对话视图，复用核心组件：

- 复用：`useAiChat`、`useFileAttachment`、`useAiMemoryStore`、`AiInputArea`、`AiMessageBubble`、`AiUsageBadge`、`AiProviderConfig`、`AiSessionDrawer`、`AiMemoryDrawer`、`AiCompactBanner`
- 去掉：退出沉浸式按钮（`Minimize2`）、Tab 相关逻辑（`workspace.addTab`、`workspace.activeTab`）
- 新增：从 URL query 解析 `windowId`，sessionId 格式为 `session-{windowId}`（如 `session-ai-1713300000000`），与主窗口 `session-default-*` 命名空间隔离
- 新增：窗口标题动态更新为 "AI - {工作目录名}"
- 新增：通过 Tauri `window.onCloseRequested` 拦截关闭事件，先保存会话再放行（避免 Vue 生命周期不可靠导致数据丢失）
- 新增：workDir 未设置时允许正常对话（作为通用 AI 助手），仅文件操作类工具不可用
- 记忆隔离：`useAiMemoryStore` 现有机制已按 workDir SHA-256 自动隔离，无需改动

### 4. 状态隔离

每个 Tauri WebviewWindow 加载独立的 Vue app 实例（Tauri 2 的 WebviewWindow 每个窗口有独立的 JS context），Pinia store 天然隔离：

| 状态 | 隔离方式 |
|------|----------|
| sessionId | 窗口级，URL 参数派生 |
| workDir | 窗口级，用户各自选择 |
| messages | 窗口级，useAiChat 实例独立 |
| selectedProvider/Model | 窗口级，各窗口独立选择 |
| Provider 配置列表 | 共享，SQLite 存储 |
| 历史会话列表 | 共享，任何窗口可浏览恢复 |
| API Key | 共享，系统密钥环 |
| 记忆数据 | 按 workDir SHA-256 隔离（已有机制） |

### 5. 窗口管理

不额外维护注册表，直接使用 Tauri 的 `app.webview_windows()` API 枚举 `ai-` 前缀窗口即可获取活跃 AI 窗口信息。

### 6. 全局快捷键

使用 Tauri `global-shortcut` plugin：

```rust
// setup 阶段注册
app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+A", move |app, _| {
    // 调用 create_ai_window 逻辑
});
```

快捷键：`Ctrl+Shift+A`（macOS 为 `Cmd+Shift+A`）。

### 7. 主窗口入口改造

现有 `AiChatView.vue` 顶栏的 `Bot` 按钮（原 `handleNewAiTab`）改为调用 `invoke('create_ai_window')`，创建独立窗口。主窗口内的 Tab 多开能力移除（独立窗口替代），保留 `Plus` 按钮的"新建对话"功能不变（在当前窗口内新建 session）。

### 8. 窗口生命周期

```
用户触发 → create_ai_window → Rust 创建 Webview
  → 前端加载 /ai-standalone?windowId=ai-xxx
  → onMounted: 解析 windowId, 初始化 session, 加载 Provider
  → 用户使用（选工作目录、对话、切模型…）
  → 窗口关闭: onCloseRequested 拦截 → 保存 session → 放行关闭
```

### 9. 快捷键注册失败处理

全局快捷键注册失败时（系统冲突）静默降级：仅 log 警告，不影响其他功能。用户仍可通过主窗口按钮创建 AI 窗口。

## 不做的事

- 窗口间通信/同步（各窗口完全独立）
- 窗口布局记忆/恢复（关闭即销毁）
- 非 AI 功能的多窗口支持
- 窗口间切换/聚焦快捷键（用系统任务栏）

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src-tauri/src/commands/ai.rs` | 修改 | 新增 `create_ai_window` 命令 |
| `src-tauri/src/lib.rs` | 修改 | 注册命令 + 全局快捷键 |
| `src/views/AiStandaloneView.vue` | 新建 | 独立 AI 窗口视图 |
| `src/main.ts` | 修改 | 新增 `/ai-standalone` 路由 |
| `src/views/AiChatView.vue` | 修改 | Bot 按钮改为打开独立窗口 |
| `src-tauri/tauri.conf.json` | 修改 | 添加 global-shortcut plugin 权限 |
| `src-tauri/Cargo.toml` | 修改 | 添加 global-shortcut 依赖（如需） |
