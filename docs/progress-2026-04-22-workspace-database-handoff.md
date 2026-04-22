# 需求进度交接 2026-04-22

## 本轮目标与结论

本轮围绕 AI 工作区、文件附件/预览、文件树上下文提示、数据库执行体验四条主线继续收尾和修复，当前已经形成一批可提交改动。

整体结论：

- AI 工作区与任务调度链路继续补强，补了阻塞依赖、取消后晚到结果、焦点任务清理等行为。
- 本地文件编辑器已支持 PNG 等图片只读预览，补齐了 Vue / Java / Markdown / YAML / SQL / XML 等 Monaco 语言映射。
- 文件树父级目录与工作区根节点不再显示“当前 / 相关 / 路径”等文字 badge，仅保留上下文高亮，不再出现杂乱标签。
- 数据库模块补了断线识别、空闲超时后的自动重连、session 级执行/取消、多语句结果落盘与参数解析修复，执行体验比之前稳定。

## 已完成内容

### 1. AI 工作区与任务调度

- `src/composables/ai/chatTaskDispatcher.ts`
  - 依赖链中如果前置任务已 `error` 或 `cancelled`，后续任务直接标记为 `blocked`，不再误进入排队。
  - headless 任务被显式取消后，不再因为晚到结果再次发出取消事件污染状态。
- `src/components/ai/AiChatShell.vue`
  - provider 配置页返回事件改为 `closeConfig`，避免返回时误触发再次打开配置页。
- `src/views/AiStandaloneView.vue`
  - 接入 `closeConfig`，配置页可以正确回到聊天视图。
- `src/components/ai/__tests__/AiSpawnedTasksPanel.test.ts`
  - 补充“失败/取消依赖导致 blocked”的面板表现测试。
- `src/components/ai/AiChatShell.test.ts`
  - 覆盖 provider 配置页返回事件行为。
- `src/views/AiChatView.vue`
  - 当当前聚焦的 spawned task 从列表中消失时，自动清空 `focusedTaskId / focusedTaskPaths / focusedTaskLabel`，避免文件树保留脏焦点。
- `src/views/__tests__/AiChatView.interaction.test.ts`
  - 补了聚焦任务消失后的状态清理回归测试。
- `src/composables/__tests__/chatTaskDispatcher.test.ts`
  - 覆盖阻塞依赖、headless 取消后晚到结果、独立任务仍可执行等场景。

### 2. 附件样式与文件选择器

- `src/components/ai/WorkspaceFilePicker.vue`
  - 重做弹窗结构与间距，搜索区、列表区、底部操作区更稳定，样式比之前更完整。

### 3. 本地文件编辑器与图片预览

- `src/stores/local-file-editor.ts`
  - 新增 `previewType` / `previewSrc`。
  - 图片文件走二进制读取，不再按文本强行塞给 Monaco。
  - 新增 MIME 推断，支持 PNG / JPG / GIF / WEBP / SVG / BMP / ICO / TIFF。
  - Monaco 语言映射补齐：`vue -> html`、`java -> java`，并补了 `markdown/yaml/html/css/scss/sql/xml`。
- `src/views/FileEditorView.vue`
  - 图片文件进入只读预览模式，显示图片预览面板与图片类型标识。
  - 图片模式下禁用保存、隐藏 UTF-8/LF 文本状态、统计区显示“预览模式”。
- `src/utils/monacoSetup.ts`
  - 抽出 Monaco worker 初始化。
- `src/types/monaco-contributions.d.ts`
  - 补充 Monaco contribution 模块声明。
- `src/main.ts`
  - 接入统一的 `setupMonacoEnvironment()`。
- `src/stores/__tests__/local-file-editor.test.ts`
  - 覆盖 PNG 预览、文本文件打开、Vue 高亮模式、Java 高亮模式。

### 4. 文件树上下文提示清理

- `src/components/layout/panels/files/FileTreeRow.vue`
  - 删除行内“当前 / 相关”等文字 badge。
- `src/components/layout/panels/files/WorkspaceRootHeader.vue`
  - 根节点也移除 badge 文案，只保留背景高亮。
  - 新增 `pathActive`，路径命中时使用弱高亮而不是文字标签。
- `src/components/layout/panels/FilesPanel.vue`
  - 重新整理路径归一化、精确命中、父路径命中、后代路径命中逻辑。
  - 区分“当前节点命中”和“父级仅为路径上下文”的视觉状态，避免父级目录错误显示为当前/相关。
- `src/components/layout/panels/files/__tests__/file-tree-context-badges.test.ts`
  - 覆盖父目录、叶子文件、根节点都不再输出 badge 文本的回归测试。

### 5. 数据库模块修复与优化

- `src/stores/connections.ts`
  - 扩充空闲断连/网络断连错误关键字，覆盖 Windows 常见文案与 `10053/10054`。
- `src/components/database/QueryPanel.vue`
  - 执行入口增加 `ensureConnected` 钩子。
- `src/components/database/SqlToolbar.vue`
  - 断开状态下按钮文案逻辑改成“重连”语义，不再直接禁掉点击。
- `src/views/DatabaseView.vue`
  - `connectAndLoad()` 改为返回 `Promise<boolean>`，供执行链路在真正执行前自动重连并恢复。
- `src/api/database.ts`
  - 新增 `dbCancelQueryOnSession(connectionId, tabId)`。
  - 新增 `dbExecuteMultiV2OnSession(...)`。
- `src/composables/useQueryExecution.ts`
  - 执行前支持自动重连并重新申请 session。
  - 流式查询首包前断线时会自动重连后重试一次。
  - 取消掉“流式初始化超时后回退普通执行”的双执行风险。
  - 流式累计结果从数组反复复制改成 `push`。
  - 参数扫描器改成逐字符扫描，忽略字符串/注释，避免 PostgreSQL `::type` 被识别成 `:param`。
  - 多语句执行改走 session 级命令，并把结果 tab 真正写回工作区上下文。
  - 取消查询时按 tab session 定向取消，并通过 `executeVersion` 忽略晚到 chunk。
  - 执行 SQL 时自动收起 explain 面板，避免旧 explain 误导。
- `src-tauri/src/services/db_engine/mod.rs`
  - 新增 `cancel_query_on_session(connection_id, tab_id)`，精确取消 `{connection}:{tab}` 与 `{connection}:{tab}:stream`。
- `src-tauri/src/commands/db/query.rs`
  - 抽出 `execute_multi_statements(...)`。
  - 新增 `db_cancel_query_on_session`。
  - 新增 `db_execute_multi_v2_on_session`。
- `src-tauri/src/lib.rs`
  - 注册新增数据库命令。
- `src/composables/__tests__/useQueryExecution.test.ts`
  - 覆盖空闲断连自动重连、PG cast 参数解析、多语句 session 执行、session 级取消与晚到 chunk 忽略。
- `src/stores/__tests__/connections.test.ts`
  - 覆盖 Windows 空闲断连错误识别。
- `src-tauri/src/services/db_backup.rs`
  - 补了数据库备份相关纯函数测试，校验 MySQL 表过滤、二进制类型识别、转义内容与 SQL splitter 的兼容性。

## 关键文件

- AI / 工作区
  - `src/composables/ai/chatTaskDispatcher.ts`
  - `src/views/AiChatView.vue`
  - `src/components/ai/WorkspaceFilePicker.vue`
- 文件编辑器 / 预览
  - `src/stores/local-file-editor.ts`
  - `src/views/FileEditorView.vue`
  - `src/utils/monacoSetup.ts`
- 文件树
  - `src/components/layout/panels/FilesPanel.vue`
  - `src/components/layout/panels/files/FileTreeRow.vue`
  - `src/components/layout/panels/files/WorkspaceRootHeader.vue`
- 数据库
  - `src/composables/useQueryExecution.ts`
  - `src/api/database.ts`
  - `src/stores/connections.ts`
  - `src/views/DatabaseView.vue`
  - `src-tauri/src/commands/db/query.rs`
  - `src-tauri/src/services/db_engine/mod.rs`

## 验证建议

建议至少验证以下几类场景：

- AI 工作区中，依赖失败/取消后的 spawned task 是否保持 blocked。
- 在文件编辑器中打开 `.png`、`.vue`、`.java`，确认预览与高亮正常。
- 文件树中父目录与根目录不再出现“当前 / 相关 / 路径”文字，仅有背景态。
- 数据库连接空闲超时后，直接执行 SQL 是否自动重连再执行。
- 多语句执行是否生成结果 tab；取消长查询时是否只取消当前 tab。

## 当前风险与待观察项

- 这批改动跨前端、Tauri 后端和状态管理，多语句执行与流式执行路径都被触达，后续仍需关注真实数据库环境下的回归。
- 图片预览当前是只读模式，未支持缩放、拖拽、超大图分片等高级能力。
- 文件树 badge 文本已经去掉，如果后续仍觉得视觉提示偏多，可以继续收敛背景色强度。
- 若后续继续推进数据库体验，优先建议补一轮真实 MySQL 空闲断连集成回归，而不是继续堆前端状态补丁。
