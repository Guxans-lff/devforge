# DevForge 数据库模块重构计划

## Context

当前数据库模块存在三个核心问题：
1. **性能瓶颈**：Rust 后端使用全局 `Arc<Mutex<DbEngine>>` 序列化所有数据库操作，一个慢查询会阻塞所有连接
2. **架构局限**：单层 Tab + 弹窗模式，表编辑器和导入都是 Dialog，无法像 SQLyog 那样多标签并行工作
3. **功能缺失**：查询结果缺少服务端分页、总行数、列宽调整、右键菜单等专业功能

目标：重构为 SQLyog 风格的双层 Tab 架构，消除性能瓶颈，提升到专业工具水准。

---

## Phase 1：性能优化（Rust 后端）

### 1.1 消除全局 Mutex

**问题**：`src-tauri/src/commands/db.rs:11` 定义 `pub type DbEngineState = Arc<Mutex<DbEngine>>`，所有命令都 `engine.lock().await`，导致跨连接串行。

**方案**：将连接池存储改为 `Arc<RwLock<HashMap<String, Arc<DriverPool>>>>`，查询操作只需 read lock 获取 pool 引用后立即释放，实际查询完全并行。

**修改文件**：
- `src-tauri/src/services/db_engine.rs` — DbEngine 内部改用 `RwLock` + `Arc<DriverPool>`
  - `connections: HashMap<String, DriverPool>` → `connections: Arc<RwLock<HashMap<String, Arc<DriverPool>>>>`
  - `connect()` 改为 `&self`（不再需要 `&mut self`），用 write lock 插入
  - `disconnect()` 改为 `&self`，用 write lock 移除
  - `get_pool()` 返回 `Arc<DriverPool>` 克隆（read lock 后立即释放）
  - 所有查询方法内部调用 `get_pool()` 获取 Arc 后释放锁
- `src-tauri/src/services/db_drivers/mod.rs` — DriverPool 无需改动（MySqlPool/PgPool 已是 Send+Sync）
- `src-tauri/src/commands/db.rs` — `DbEngineState` 改为 `Arc<DbEngine>`，所有命令去掉 `.lock().await`
- `src-tauri/src/commands/table_editor.rs` — `execute_ddl` 和 `get_table_detail` 去掉 `.lock().await`
- `src-tauri/src/commands/import.rs` — `import_data` 去掉 `.lock().await`
- `src-tauri/src/lib.rs` — `Arc::new(Mutex::new(DbEngine::new()))` → `Arc::new(DbEngine::new())`

### 1.2 连接池优化

**修改文件**：
- `src-tauri/src/services/db_drivers/mysql.rs` — `max_connections(5)` → `max_connections(10)`，添加 `acquire_timeout`
- `src-tauri/src/services/db_drivers/postgres.rs` — 同上

### 1.3 查询结果添加 totalCount

**修改文件**：
- `src-tauri/src/models/query.rs` — QueryResult 添加 `pub total_count: Option<i64>`
- `src/types/database.ts` — QueryResult 接口添加 `totalCount: number | null`

---

## Phase 2：双层 Tab 架构（前端）

### 2.1 内部 Tab 类型定义

**新建文件**：`src/types/database-workspace.ts`

```typescript
export type InnerTabType = 'query' | 'table-editor' | 'import' | 'table-data'

export interface InnerTab {
  id: string
  type: InnerTabType
  title: string
  closable: boolean
  dirty?: boolean
  context: QueryTabContext | TableEditorTabContext | ImportTabContext | TableDataTabContext
}
// __CONTINUE_HERE__
```

### 2.2 内部 Tab Store

**新建文件**：`src/stores/database-workspace.ts`

- 使用 `Map<connectionId, { tabs: InnerTab[], activeTabId: string }>` 管理每个连接的内部标签
- `getOrCreate(connId)` — 首次访问时创建默认 Query 1 标签
- `addInnerTab(connId, tab)` — 添加或激活已有标签（按 id 去重）
- `closeInnerTab(connId, tabId)` — 关闭标签，自动切换到相邻标签
- `setActiveInnerTab(connId, tabId)` — 切换活动标签
- `cleanup(connId)` — 连接关闭时清理所有状态

### 2.3 内部 TabBar 组件

**新建文件**：`src/components/database/InnerTabBar.vue`

- 比外层 TabBar 更紧凑（h-7，text-[11px]）
- 不同 tab 类型显示不同图标（Play=query, Table2=table-editor, FileUp=import, Database=table-data）
- 右侧 "+" 按钮添加新查询标签
- 支持中键关闭、右键菜单（关闭/关闭其他/关闭全部）

### 2.4 QueryPanel 组件

**新建文件**：`src/components/database/QueryPanel.vue`

从 DatabaseView 中提取 SqlEditor + QueryResult 的组合：
- 顶部迷你工具栏：Execute 按钮 + Ctrl+Enter 提示
- 上半部分：SqlEditor（v-model 绑定到 tab context 的 sql）
- 下半部分：QueryResult（splitpanes 水平分割）
- Props: `connectionId`, `database?`, `schema?`
- 每个 query tab 独立的 SQL 内容和查询结果

### 2.5 TableEditorPanel 组件

**重构文件**：`src/components/database/TableEditorDialog.vue` → `src/components/database/TableEditorPanel.vue`

- 移除 `<Dialog>` 包装，改为填充容器的平铺面板
- 顶部工具栏：表名输入 + 数据库显示 + Preview SQL / Execute 按钮
- 中间：现有的 Columns/Indexes/Options 标签内容（保留 HTML table 布局）
- 底部：SQL 预览区域
- Props 不变（去掉 open），添加 `@success` emit 通知 DatabaseView 刷新树

### 2.6 ImportPanel 组件

**重构文件**：`src/components/database/ImportDialog.vue` → `src/components/database/ImportPanel.vue`

- 同样移除 `<Dialog>` 包装
- 保留所有内部逻辑（文件选择、预览、列映射、批量导入进度）

### 2.7 TableDataPanel 组件

**新建文件**：`src/components/database/TableDataPanel.vue`

双击表时打开的数据浏览面板：
- 顶部工具栏：表名、刷新按钮、分页大小选择
- 使用 QueryResult 组件展示数据
- 调用 `dbGetTableData` 进行服务端分页

### 2.8 重构 DatabaseView

**修改文件**：`src/views/DatabaseView.vue`

从 345 行的单体组件变为编排器：

```
+----------------------------------------------------------+
| 连接状态栏（右上角状态点 + 连接名）                          |
+----------------------------------------------------------+
| ObjectTree (左) | InnerTabBar                             |
|                 |----------------------------------------|
|                 | <KeepAlive :max="8">                   |
|                 |   QueryPanel / TableEditorPanel /       |
|                 |   ImportPanel / TableDataPanel          |
|                 | </KeepAlive>                            |
+----------------------------------------------------------+
```

- 移除所有 dialog 状态（`showTableEditor`, `showImportDialog` 等）
- 移除 `sqlContent`, `queryResult`, `isExecuting` 等（移入 QueryPanel）
- ObjectTree 事件处理改为打开内部标签：
  - `@select-table` → 打开 table-data 标签
  - `@edit-table` → 打开 table-editor 标签
  - `@create-table` → 打开 table-editor 标签（无 table prop）
  - `@import-data` → 打开 import 标签
  - `@show-create-sql` → 在当前 query 标签中显示 SQL
- 工具栏简化：只保留连接状态，Execute 等按钮移入 QueryPanel

### 2.9 外层 Tab 关闭时清理

**修改文件**：`src/stores/workspace.ts`

`closeTab()` 中添加：当关闭 database 类型 tab 时，调用 `dbWorkspaceStore.cleanup(connectionId)`

### 2.10 i18n 更新

**修改文件**：`src/locales/en.ts`, `src/locales/zh-CN.ts`

添加 innerTab 相关翻译键。

---

## Phase 3：查询结果增强

### 3.1 列宽调整

**修改文件**：`src/components/database/QueryResult.vue`

- 启用 tanstack table 的 `columnResizing` 功能
- 表头添加拖拽调整手柄

### 3.2 数据类型感知格式化

- 数字类型右对齐
- NULL 值特殊样式（已有）
- 日期时间格式化显示

### 3.3 右键上下文菜单

- 复制单元格值
- 复制行为 JSON
- 复制行为 INSERT SQL
- 按此值筛选

### 3.4 汇总行

- 选中数字列时底部显示 SUM/AVG/MIN/MAX/COUNT

---

## 实施顺序

| 步骤 | 任务 | 依赖 |
|------|------|------|
| 1 | Phase 1.1-1.3: Rust 性能优化 | 无 |
| 2 | Phase 2.1-2.2: 类型定义 + Store | 无 |
| 3 | Phase 2.3: InnerTabBar | Step 2 |
| 4 | Phase 2.4: QueryPanel | Step 2 |
| 5 | Phase 2.5: TableEditorPanel | Step 2 |
| 6 | Phase 2.6: ImportPanel | Step 2 |
| 7 | Phase 2.7: TableDataPanel | Step 2 |
| 8 | Phase 2.8: 重构 DatabaseView | Step 3-7 |
| 9 | Phase 2.9-2.10: 清理 + i18n | Step 8 |
| 10 | Phase 3: 查询结果增强 | Step 8 |

Step 1 和 Step 2-7 可以并行开发。

---

## 验证方案

1. **性能验证**：连接两个不同数据库，同时执行慢查询，确认互不阻塞
2. **双层 Tab**：打开一个连接 → 创建多个 Query 标签 → 切换标签确认状态保持 → 打开表编辑器标签 → 确认平铺显示
3. **表编辑器**：右键表 → Alter Table → 确认在内部标签中打开（非弹窗）→ 修改列 → Preview SQL → Execute
4. **导入**：右键表 → Import → 确认在内部标签中打开 → 完成导入流程
5. **标签生命周期**：关闭内部标签 → 关闭外层连接标签 → 确认状态正确清理、连接断开

---

## Phase 4：安全与稳定性审计

代码审计发现以下高优先级问题，需在重构过程中一并修复：

### 4.1 Mutex Poison 崩溃风险（严重）

**位置**：`src-tauri/src/services/transfer_manager.rs` 中有 40+ 处 `.lock().unwrap()`

**问题**：如果任何持锁线程 panic，Mutex 进入 poisoned 状态，后续所有 `.lock().unwrap()` 都会导致整个应用崩溃。

**修复**：
- 将 `.lock().unwrap()` 替换为 `.lock().unwrap_or_else(|e| e.into_inner())`（忽略 poison）
- 或改用 `parking_lot::Mutex`（不会 poison）
- Phase 1.1 的 RwLock 重构已覆盖 db_engine，transfer_manager 需单独处理

### 4.2 SSH Host Key 验证缺失（安全）

**位置**：`src-tauri/src/services/ssh_engine.rs`、`sftp_engine.rs`

**问题**：SSH 连接未验证服务器 host key，存在中间人攻击风险。

**修复**：
- 首次连接时提示用户确认 host key fingerprint
- 存储已信任的 host key（`~/.devforge/known_hosts`）
- 后续连接自动验证，不匹配时警告

### 4.3 查询无超时机制（稳定性）

**问题**：`fetch_all` 无超时，加上全局 Mutex，一个死锁查询会永久阻塞所有操作。

**修复**：
- 在 `db_engine.rs` 的查询方法中添加 `tokio::time::timeout(Duration::from_secs(30), query)`
- 前端添加取消查询按钮（通过 `sqlx::query` 的 cancel token 或 drop future）
- 超时时间可在连接设置中配置

### 4.4 任意文件写入（安全）

**位置**：`src-tauri/src/commands/db.rs` — `write_text_file` 命令

**问题**：接受任意路径参数，无路径验证，可写入系统任意位置。

**修复**：
- 限制写入路径到用户选择的目录（通过 Tauri dialog 获取的路径）
- 或添加路径白名单验证（仅允许用户文档目录、下载目录等）

### 4.5 KeepAlive 阻止连接清理（内存泄漏）

**位置**：`src/views/DatabaseView.vue` — `<KeepAlive>` 包裹组件

**问题**：KeepAlive 缓存组件实例，`onBeforeUnmount` 不会触发，导致数据库连接池和 SSH 会话无法释放。

**修复**：
- Phase 2.8 重构时，使用 `<KeepAlive :max="8">` 限制缓存数量
- 在 `onDeactivated` 生命周期中处理资源释放（而非 `onBeforeUnmount`）
- 外层 Tab 关闭时显式调用 `cleanup()` 断开连接

### 4.6 数据导入 SQL 注入（安全）

**位置**：`src-tauri/src/services/import_service.rs`

**问题**：列名使用反引号包裹但未转义，如果列名包含反引号可构造注入。

**修复**：
- 列名中的反引号需要双写转义：`` ` `` → ``` `` ```
- 或使用参数化查询构建 INSERT 语句

### 4.7 fetch_all 无 LIMIT 保护（OOM 风险）

**问题**：`SELECT * FROM large_table` 会将整个表加载到内存，百万行表直接 OOM。

**修复**：
- 后端强制添加 LIMIT 保护：如果用户 SQL 不含 LIMIT，自动追加 `LIMIT 10000`
- 前端显示警告："结果已截断，共 10000 行（总计 N 行）"
- Phase 1.3 的 totalCount 配合使用

### 4.8 Storage 初始化竞态条件（稳定性）

**位置**：`src-tauri/src/lib.rs:64-75`

**问题**：Storage 在异步 spawn 中初始化，如果 Tauri 命令在初始化完成前到达，`State<StorageState>` 获取会 panic。

**修复**：
- 改为同步初始化（`block_on`），或
- 使用 `OnceCell<Storage>` 延迟初始化，命令中优雅处理未就绪状态

### 4.9 PostgreSQL 数据类型处理不完整（数据丢失）

**问题**：JSONB、BYTEA、timestamp with timezone 等 PostgreSQL 特有类型在 `row.try_get()` 时返回 Null，导致静默数据丢失。

**修复**：
- `db_drivers/postgres.rs` 中为 JSONB 使用 `serde_json::Value` 类型
- BYTEA 转为 Base64 字符串或 hex 显示
- timestamp 统一转为 ISO 8601 字符串

### 4.10 ObjectTree 键盘可访问性（无障碍）

**问题**：ObjectTree 完全依赖鼠标操作，无法通过键盘导航。

**修复**：
- 添加 `tabindex`、`role="tree"`、`role="treeitem"` ARIA 属性
- 支持方向键导航、Enter 展开/折叠、Space 选择

---

## Phase 5：竞品对标功能补齐

对比 SQLyog、Navicat、DBeaver、DataGrip，按优先级分三层：

### Tier 1：核心缺失（必须实现）

| 功能 | 竞品参考 | 实现方案 |
|------|----------|----------|
| SQL 格式化 | 全部 | 集成 `sql-formatter` npm 包，编辑器工具栏添加格式化按钮 |
| 查询历史 | Navicat/SQLyog | 本地 SQLite 存储历史记录，侧边栏可搜索、可重新执行 |
| 保存查询 | 全部 | 查询标签支持 Ctrl+S 保存到本地，命名管理 |
| EXPLAIN 可视化 | DataGrip/DBeaver | 执行 EXPLAIN ANALYZE，树形展示执行计划，高亮慢节点 |
| 结果集列过滤 | Navicat/DataGrip | 列头添加过滤图标，支持文本/数字/日期条件筛选 |
| 结果集查找替换 | SQLyog/Navicat | Ctrl+F 打开搜索栏，高亮匹配，支持正则 |
| 连接着色/分组 | Navicat/DBeaver | 连接配置添加颜色选择，TabBar 显示颜色条，树形分组 |
| 自动重连 | 全部 | 连接断开时自动尝试重连（3 次，指数退避），状态栏提示 |
| 状态栏增强 | 全部 | 底部显示：当前数据库、字符集、服务器版本、连接耗时 |

### Tier 2：高价值功能（Phase 5 后续迭代）

| 功能 | 竞品参考 | 说明 |
|------|----------|------|
| 代码片段 | DataGrip | 常用 SQL 模板，支持变量占位符 |
| Schema 对比/同步 | Navicat | 两个数据库结构差异对比，生成同步 DDL |
| ER 图 | DBeaver/Navicat | 基于表关系自动生成实体关系图 |
| 对象全局搜索 | DataGrip | Ctrl+Shift+F 搜索所有数据库对象（表/列/视图/存储过程） |
| 拖拽表到编辑器 | SQLyog/DataGrip | 从 ObjectTree 拖拽表名到 SQL 编辑器自动插入 |
| BLOB/二进制查看器 | Navicat/DBeaver | 图片预览、Hex 查看、文本解码 |
| 批量 DDL 导出 | Navicat | 选中多个表，一键导出 CREATE TABLE 语句 |
| 聚合行（汇总） | DataGrip/SQLyog | 选中列底部显示 SUM/AVG/MIN/MAX/COUNT（Phase 3.4 已规划） |

### Tier 3：差异化功能（长期路线图）

| 功能 | 说明 |
|------|------|
| Mock 数据生成器 | 根据列类型和约束自动生成测试数据 |
| 定时任务自动化 | 定时执行 SQL 并导出结果（类似 Navicat 的计划任务） |
| 命令面板 | Ctrl+Shift+P 全局命令搜索（类似 VS Code） |
| AI 辅助 SQL | 自然语言转 SQL，SQL 优化建议 |
| 性能监控面板 | 实时显示慢查询、连接数、缓存命中率 |
| 进程列表查看器 | SHOW PROCESSLIST 可视化，支持 Kill 查询 |

---

## 更新后的实施顺序

| 步骤 | 任务 | 依赖 | 优先级 |
|------|------|------|--------|
| 1 | Phase 1.1: 消除全局 Mutex | 无 | P0 |
| 2 | Phase 1.2: 连接池优化 | Step 1 | P0 |
| 3 | Phase 1.3: totalCount + LIMIT 保护（含 4.7） | Step 1 | P0 |
| 4 | Phase 4.3: 查询超时 + 取消机制 | Step 1 | P0 |
| 5 | Phase 4.8: Storage 初始化竞态修复 | 无 | P0 |
| 6 | Phase 2.1-2.2: 类型定义 + Store | 无 | P0 |
| 7 | Phase 2.3: InnerTabBar | Step 6 | P0 |
| 8 | Phase 2.4: QueryPanel | Step 6 | P0 |
| 9 | Phase 2.5: TableEditorPanel | Step 6 | P0 |
| 10 | Phase 2.6: ImportPanel | Step 6 | P0 |
| 11 | Phase 2.7: TableDataPanel | Step 6 | P0 |
| 12 | Phase 2.8: 重构 DatabaseView | Step 7-11 | P0 |
| 13 | Phase 2.9-2.10: 清理 + i18n | Step 12 | P0 |
| 14 | Phase 3.1-3.4: 查询结果增强 | Step 12 | P1 |
| 15 | Phase 4.1: transfer_manager Mutex 修复 | 无 | P1 |
| 16 | Phase 4.4: 文件写入路径验证 | 无 | P1 |
| 17 | Phase 4.5: KeepAlive 资源释放 | Step 12 | P1 |
| 18 | Phase 4.6: 导入 SQL 注入修复 | 无 | P1 |
| 19 | Phase 4.9: PostgreSQL 数据类型修复 | Step 1 | P1 |
| 20 | Phase 5 Tier 1: SQL 格式化 | Step 12 | P1 |
| 21 | Phase 5 Tier 1: 查询历史 + 保存查询 | Step 12 | P1 |
| 22 | Phase 5 Tier 1: 自动重连 | Step 1 | P1 |
| 23 | Phase 5 Tier 1: 连接着色/分组 | Step 12 | P2 |
| 24 | Phase 5 Tier 1: EXPLAIN 可视化 | Step 14 | P2 |
| 25 | Phase 5 Tier 1: 结果集过滤/查找 | Step 14 | P2 |
| 26 | Phase 4.2: SSH Host Key 验证 | 无 | P2 |
| 27 | Phase 4.10: 键盘可访问性 | Step 12 | P2 |
| 28 | Phase 5 Tier 2: 后续迭代 | Step 25 | P3 |
| 29 | Phase 5 Tier 3: 长期路线图 | Step 28 | P3 |

Step 1-5 和 Step 6-11 可并行开发。P0 为本次重构必须完成，P1 为紧随其后，P2/P3 为后续迭代。

---

## 验证方案

1. **性能验证**：连接两个不同数据库，同时执行慢查询，确认互不阻塞
2. **超时验证**：执行 `SELECT SLEEP(60)`，确认 30s 后自动超时并返回错误
3. **双层 Tab**：打开一个连接 → 创建多个 Query 标签 → 切换标签确认状态保持 → 打开表编辑器标签 → 确认平铺显示
4. **表编辑器**：右键表 → Alter Table → 确认在内部标签中打开（非弹窗）→ 修改列 → Preview SQL → Execute
5. **导入**：右键表 → Import → 确认在内部标签中打开 → 完成导入流程
6. **标签生命周期**：关闭内部标签 → 关闭外层连接标签 → 确认状态正确清理、连接断开
7. **LIMIT 保护**：执行无 LIMIT 的 SELECT，确认结果被截断并显示总行数提示
8. **自动重连**：断开网络后恢复，确认连接自动恢复
9. **PostgreSQL 类型**：查询含 JSONB/BYTEA/timestamptz 的表，确认数据正确显示

---

## Phase 6：代码质量审计（全量扫描结果）

全量代码审计发现以下问题，按模块分类：

### 6.1 Rust 后端问题

#### 6.1.1 Unwrap 崩溃风险

| 文件 | 位置 | 严重度 | 描述 |
|------|------|--------|------|
| `services/transfer_manager.rs` | L135 | 高 | `self.scheduler_tx.as_ref().unwrap().send(())` — scheduler_tx 为 None 时 panic |
| `services/transfer_manager.rs` | 40+ 处 | 中 | 大量 `.lock().unwrap()` — Mutex poison 后全部 panic |
| `services/progress_tracker.rs` | L60,75,84,93,110,149 | 中 | `.lock().unwrap()` 同上 |
| `services/table_editor.rs` | L20 | 低 | `Regex::new().unwrap()` — 硬编码正则，实际安全但应改为 `expect()` |

**修复方案**：
- `transfer_manager.rs`：改用 `parking_lot::Mutex`（不会 poison），或 `.lock().unwrap_or_else(|e| e.into_inner())`
- `scheduler_tx`：改为 `if let Some(tx) = self.scheduler_tx.as_ref() { tx.send(()) }`

#### 6.1.2 安全漏洞

| 文件 | 位置 | 严重度 | 描述 |
|------|------|--------|------|
| `services/ssh_engine.rs` | L20-31 | 高 | `check_server_key` 始终返回 `Ok(true)`，接受所有 host key |
| `services/sftp_engine.rs` | L20-25 | 高 | 同上 |
| `services/ssh_tunnel.rs` | L21-26 | 高 | 同上 |
| `commands/ssh.rs` | L105-110 | 中 | SSH 测试连接同样不验证 host key |
| `commands/db.rs` | `write_text_file` | 高 | 无路径验证，可写入任意位置 |
| `services/data_import.rs` | SQL 构建 | 高 | 列名拼接未转义，存在 SQL 注入风险 |

#### 6.1.3 资源管理问题

| 文件 | 位置 | 严重度 | 描述 |
|------|------|--------|------|
| `services/ssh_engine.rs` | disconnect | 中 | SSH 会话关闭时未等待 channel 完全关闭 |
| `services/db_engine.rs` | 全局 Mutex | 高 | 已在 Phase 1 规划修复 |
| `services/transfer_manager.rs` | 锁范围 | 中 | 锁持有时间过长，包含 I/O 操作 |

#### 6.1.4 硬编码值

| 文件 | 值 | 建议 |
|------|-----|------|
| `db_drivers/mysql.rs` | `max_connections(5)` | 改为可配置，默认 10 |
| `db_drivers/postgres.rs` | `max_connections(5)` | 同上 |
| `services/ssh_engine.rs` | 终端大小 80x24 | 从前端传入实际大小 |
| `services/transfer_manager.rs` | chunk size 64KB | 根据网络状况自适应 |
| `services/file_chunker.rs` | 各种 buffer size | 提取为常量或配置 |

#### 6.1.5 缺失日志

| 文件 | 描述 |
|------|------|
| `commands/db.rs` | 连接/断开/查询执行无日志 |
| `services/data_import.rs` | 导入进度无日志 |
| `services/ssh_engine.rs` | SSH 连接建立/断开无日志 |
| `services/transfer_manager.rs` | 文件传输开始/完成/失败无日志 |

### 6.2 前端问题

#### 6.2.1 静默错误吞没（8 处）

| 文件 | 位置 | 描述 |
|------|------|------|
| `views/DatabaseView.vue` | L113 | `dbDisconnect().catch(() => {})` — 断开连接失败无提示 |
| `components/terminal/TerminalPanel.vue` | L83-85 | `sshSendData().catch(() => {})` — 终端输入发送失败无提示 |
| `components/terminal/TerminalPanel.vue` | L145 | `sshResize().catch(() => {})` — 终端调整大小失败无提示 |
| `components/terminal/TerminalPanel.vue` | L158 | `sshDisconnect().catch(() => {})` — SSH 断开失败无提示 |
| `components/database/QueryResult.vue` | L63 | `clipboard.writeText().catch(() => {})` — 复制失败无提示 |
| `views/SettingsView.vue` | 多处 | 设置保存失败无提示 |
| `components/sftp/SftpPanel.vue` | 多处 | SFTP 操作失败部分无提示 |
| `stores/workspace.ts` | 清理逻辑 | Tab 关闭时资源清理失败无提示 |

**修复方案**：统一改为 `.catch((e) => { log.warn('operation failed:', e) })`，关键操作添加 toast 提示

#### 6.2.2 类型安全问题

| 文件 | 描述 |
|------|------|
| `components/database/ImportDialog.vue` | `catch (e: any)` — 应使用 `unknown` |
| `api/database.ts` | 部分 invoke 返回值未严格类型化 |
| `stores/workspace.ts` | Tab context 使用联合类型但缺少类型守卫 |

#### 6.2.3 缺失加载/错误状态

| 组件 | 描述 |
|------|------|
| `ObjectTree.vue` | 展开节点时无 loading 指示器 |
| `ImportDialog.vue` | 文件解析阶段无进度提示 |
| `SettingsView.vue` | 保存设置时无 loading 状态 |
| `SftpPanel.vue` | 目录加载时部分场景无 skeleton |

#### 6.2.4 i18n 缺失

| 文件 | 描述 |
|------|------|
| `components/database/TableEditorDialog.vue` | 部分按钮文本硬编码英文 |
| `components/sftp/SftpPanel.vue` | 错误消息部分硬编码 |
| `views/SettingsView.vue` | 设置项标签部分未国际化 |

#### 6.2.5 可访问性缺失

| 组件 | 描述 |
|------|------|
| `ObjectTree.vue` | 无 `role="tree"` / `role="treeitem"`，无键盘导航 |
| `InnerTabBar`（待建） | 需要 `role="tablist"` / `role="tab"` |
| `QueryResult.vue` | 表格无 `aria-label`，排序按钮无 `aria-sort` |
| `TabBar.vue` | Tab 切换无 `aria-selected` 状态 |

#### 6.2.6 性能优化点

| 文件 | 描述 |
|------|------|
| `components/database/QueryResult.vue` | 大数据集排序在前端执行，应考虑后端排序 |
| `views/DatabaseView.vue` | ObjectTree 每次展开都重新请求，无缓存 |
| `components/sftp/SftpPanel.vue` | 文件列表无虚拟滚动，大目录卡顿 |

---

## 更新后的完整实施顺序

| 步骤 | 任务 | 依赖 | 优先级 |
|------|------|------|--------|
| 1 | Phase 1.1: 消除全局 Mutex | 无 | P0 |
| 2 | Phase 1.2: 连接池优化 | Step 1 | P0 |
| 3 | Phase 1.3: totalCount + LIMIT 保护（含 4.7） | Step 1 | P0 |
| 4 | Phase 4.3: 查询超时 + 取消机制 | Step 1 | P0 |
| 5 | Phase 4.8: Storage 初始化竞态修复 | 无 | P0 |
| 6 | Phase 2.1-2.2: 类型定义 + Store | 无 | P0 |
| 7 | Phase 2.3: InnerTabBar | Step 6 | P0 |
| 8 | Phase 2.4: QueryPanel | Step 6 | P0 |
| 9 | Phase 2.5: TableEditorPanel | Step 6 | P0 |
| 10 | Phase 2.6: ImportPanel | Step 6 | P0 |
| 11 | Phase 2.7: TableDataPanel | Step 6 | P0 |
| 12 | Phase 2.8: 重构 DatabaseView | Step 7-11 | P0 |
| 13 | Phase 2.9-2.10: 清理 + i18n | Step 12 | P0 |
| 14 | Phase 3.1-3.4: 查询结果增强 | Step 12 | P1 |
| 15 | Phase 6.1.1: transfer_manager unwrap 修复 | 无 | P1 |
| 16 | Phase 6.1.2: 安全漏洞修复（路径验证+SQL注入+host key） | 无 | P1 |
| 17 | Phase 6.2.1: 静默错误吞没修复（8 处） | 无 | P1 |
| 18 | Phase 4.5: KeepAlive 资源释放 | Step 12 | P1 |
| 19 | Phase 4.9: PostgreSQL 数据类型修复 | Step 1 | P1 |
| 20 | Phase 6.1.4: 硬编码值提取为配置 | Step 1 | P1 |
| 21 | Phase 6.1.5: 关键操作添加日志 | Step 1 | P1 |
| 22 | Phase 5 Tier 1: SQL 格式化 | Step 12 | P1 |
| 23 | Phase 5 Tier 1: 查询历史 + 保存查询 | Step 12 | P1 |
| 24 | Phase 5 Tier 1: 自动重连 | Step 1 | P1 |
| 25 | Phase 6.2.2: 类型安全修复 | 无 | P2 |
| 26 | Phase 6.2.3: 缺失加载/错误状态补全 | Step 12 | P2 |
| 27 | Phase 6.2.4: i18n 缺失补全 | Step 13 | P2 |
| 28 | Phase 6.2.5: 可访问性修复 | Step 12 | P2 |
| 29 | Phase 6.2.6: 前端性能优化 | Step 14 | P2 |
| 30 | Phase 5 Tier 1: 连接着色/分组 | Step 12 | P2 |
| 31 | Phase 5 Tier 1: EXPLAIN 可视化 | Step 14 | P2 |
| 32 | Phase 5 Tier 1: 结果集过滤/查找 | Step 14 | P2 |
| 33 | Phase 5 Tier 2: 后续迭代 | Step 32 | P3 |
| 34 | Phase 5 Tier 3: 长期路线图 | Step 33 | P3 |

Step 1-5 和 Step 6-11 可并行开发。P0 为本次重构必须完成，P1 紧随其后，P2/P3 后续迭代。
