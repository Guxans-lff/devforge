# DevForge MySQL 企业级提升路线图

## Context

DevForge 当前已具备完整的 MySQL 基础功能（CRUD、DDL、事务、备份恢复、导入导出、Schema 对比、ER 图、流式查询、虚拟滚动等），整体完成度约 90%。但与 Navicat/DataGrip 企业级工具对比，在**查询性能分析、深度诊断、对象编辑、并发安全**等方面存在明显差距。

大哥的方向：MySQL 专注、自用、性能与功能对标并超越企业级工具。

本计划按**影响力 × 可感知度**排序，分阶段推进。

---

## Phase 0：关键基础设施修补（预计 1.5 天）

修复已知代码隐患，为后续功能打地基。

### 0.1 查询超时 + 取消实装

**问题**：`_timeout_secs` 参数在 `db_engine/mod.rs` 的 6 个执行方法中全部被忽略（前缀 `_` 证实未使用）。`cancel_query` 是空壳 `{ Ok(()) }`。

**方案**：
- 使用 `tokio::time::timeout` 包裹查询 future
- 超时后通过独立连接执行 `KILL QUERY <connection_id>` 真正取消 MySQL 端查询
- 在 `DbEngine` 中维护 `running_queries: RwLock<HashMap<String, u64>>`（tab_id → MySQL connection_id）
- execute 开始时通过 `SELECT CONNECTION_ID()` 注册，结束时移除

**关键文件**：
- [db_engine/mod.rs](src-tauri/src/services/db_engine/mod.rs) — 6 个 execute 方法添加超时包裹
- [mysql/executor.rs](src-tauri/src/services/db_drivers/mysql/executor.rs) — 暴露 connection_id 获取

### 0.2 commands/db.rs 拆分

**问题**：1087 行，远超 800 行上限。

**方案**：按功能域拆分为子模块：
- `commands/db/mod.rs` — 连接管理（connect/disconnect/reconnect/session）
- `commands/db/query.rs` — 查询执行（execute/stream/multi）
- `commands/db/metadata.rs` — 元数据（databases/tables/columns/views/routines/triggers）
- `commands/db/admin.rs` — 管理操作（server_status/processes/kill/variables/users）
- `commands/db/tools.rs` — 工具（export/import/backup/schema_compare）

**关键文件**：
- [commands/db.rs](src-tauri/src/commands/db.rs) — 拆分目标

---

## Phase 1：查询体验革命（预计 3-4 天）

日常最高频操作，提升感知最强。

### 1.1 查询结果缓存

**问题**：切换分页、返回上一个结果都重新执行 SQL，无任何缓存层。

**方案**：
- **后端**：基于 SQL hash + database 的 LRU 缓存，仅缓存 SELECT，TTL 30s，最大 50 条，DML/DDL 清除相关表缓存
- **前端**：`useQueryResultCache.ts` composable，每个 tab 保存结果快照，分页缓存 `Map<number, RowData[]>`

**关键文件**：
- 新增 `src-tauri/src/services/db_engine/cache.rs`
- [db_engine/mod.rs](src-tauri/src/services/db_engine/mod.rs) — execute 链路检查/填充缓存
- 新增 `src/composables/useQueryResultCache.ts`

### 1.2 列冻结/固定

**问题**：宽表浏览时主键列、关键列滚动丢失。

**方案**：利用 @tanstack/vue-table 的 `columnPinning` 特性：
- 行号列 + 主键列默认左固定
- 右键菜单添加"固定到左侧/右侧/取消固定"
- CSS `position: sticky` + `z-index` 实现

**关键文件**：
- [useQueryResult.ts](src/composables/useQueryResult.ts) — 添加 pinning state
- [QueryResult.vue](src/components/database/QueryResult.vue) — 表头右键菜单 + sticky CSS

### 1.3 Composable 拆分重组

**问题**：`useQueryExecution.ts`（747 行）和 `useQueryResult.ts`（625 行）职责过多。

**方案**：

`useQueryExecution` 拆分为：
- `useQueryExecution.ts` — 核心协调器（<200 行）
- `useMultiStatement.ts` — 多语句执行
- `useTableBrowse.ts` — 表数据浏览/分页/筛选
- `useDangerConfirm.ts` — 危险操作确认
- `useExplainAnalysis.ts` — EXPLAIN 执行和结果处理

`useQueryResult` 拆分为：
- `useQueryResult.ts` — 核心表格（<300 行）
- `useResultExport.ts` — 导出逻辑
- `useColumnStats.ts` — 列统计

**关键文件**：
- [useQueryExecution.ts](src/composables/useQueryExecution.ts)
- [useQueryResult.ts](src/composables/useQueryResult.ts)

---

## Phase 2：MySQL 深度性能分析（预计 3-4 天）⭐ 核心差异化

Navicat 只能看 EXPLAIN，DataGrip 分析能力有限。这是超越的关键切入点。

### 2.1 索引分析引擎

**全新模块**，核心能力：
1. **冗余索引检测**：查询 `information_schema.STATISTICS`，检测前缀包含关系
2. **未使用索引检测**：查询 `performance_schema.table_io_waits_summary_by_index_usage`
3. **EXPLAIN 增强分析**：解析 JSON 格式 EXPLAIN，计算索引有效性评分
4. **索引建议**：基于 WHERE/JOIN/ORDER BY 分析，生成 CREATE INDEX DDL

**前端**：`IndexAdvisorPanel.vue`，在 EXPLAIN 面板旁添加"索引建议"标签页，一键生成 DDL

**关键文件**：
- 新增 `src-tauri/src/services/db_engine/index_advisor.rs`
- 新增 `src/components/database/IndexAdvisorPanel.vue`

### 2.2 Performance Dashboard 增强

**现状**：仅有 QPS/TPS 折线图 + 进程列表 + 全局变量。

**补充**：
1. **慢查询 Top N**：查询 `performance_schema.events_statements_summary_by_digest`
2. **InnoDB 引擎状态**：解析 `SHOW ENGINE INNODB STATUS`（死锁、Buffer Pool、Redo Log）
3. **Binlog 状态**：复制位点和日志大小
4. **更多实时指标**：bytes_sent/received、innodb_rows_*、lock_waits

**关键文件**：
- 新增 `src-tauri/src/services/db_engine/performance.rs`
- [PerformanceDashboard.vue](src/components/database/PerformanceDashboard.vue) — 添加子标签页

### 2.3 EXPLAIN 可视对比（独家功能）

Navicat/DataGrip 都没有的功能：
- "保存 Plan" 按钮存入本地 SQLite
- 左右并排对比两个 EXPLAIN JSON 树
- 颜色编码表示改善（绿）/ 退化（红）

**关键文件**：
- 新增 `src/components/database/ExplainComparePanel.vue`
- [storage.rs](src-tauri/src/services/storage.rs) — 添加 explain_history 表

---

## Phase 3：对象管理完善（预计 2-3 天）

### 3.1 视图/存储过程/函数/触发器编辑器

**现状**：只能查看定义，不能创建/编辑。

**方案**：
- 后端新增 `object_editor.rs`：create/alter/drop 操作
- 前端 `ObjectEditorDialog.vue`：CodeMirror 编辑器 + 参数模板自动生成
- ObjectTree 右键菜单添加"新建/编辑"

**关键文件**：
- 新增 `src-tauri/src/services/db_engine/object_editor.rs`
- 新增 `src/components/database/ObjectEditorDialog.vue`
- [ObjectTree.vue](src/components/database/ObjectTree.vue)

### 3.2 用户权限 GRANT/REVOKE 可视化

**现状**：`UserManagementPanel` 只展示 `SHOW GRANTS` 文本。

**方案**：权限矩阵表格（行=数据库.表，列=SELECT/INSERT/UPDATE/DELETE/...），Checkbox 勾选，保存时 diff 出 GRANT/REVOKE 语句。

### 3.3 全文索引管理

在 TableEditorDialog 索引标签页支持 FULLTEXT 类型 + `MATCH...AGAINST` 查询模板。

---

## Phase 4：生产力与安全增强（预计 2 天）

### 4.1 表编辑器乐观并发控制

**问题**：`apply_row_changes` 仅用主键 WHERE 定位行，两个客户端同时编辑会静默覆盖。

**方案**：UPDATE 的 WHERE 中追加原始值检查，`affected_rows = 0` 时返回冲突错误。

**关键文件**：
- [tx.rs](src-tauri/src/services/db_engine/tx.rs) — `generate_change_sql`

### 4.2 操作审计日志

本地 SQLite 记录所有 DDL/DML 操作（不记录 SELECT），保留 30 天。前端 `AuditLogPanel.vue` 时间线展示。

### 4.3 参数化查询模板

SQL 编辑器支持 `:paramName` 占位符，执行时弹出参数输入对话框，模板可保存到 Snippets。

### 4.4 导出预览

ExportDialog 底部添加预览区，取前 10 行按选中格式渲染。

---

## Phase 5：代码质量（预计 1 天）

### 5.1 Import 状态机重构

`AtomicU8` 魔数替换为 `tokio::sync::watch::channel` + `ImportCommand` 枚举。

### 5.2 关键路径测试

只测核心路径：`sql_splitter.rs`、`table_editor.rs` DDL 生成、`exportData.ts` 格式正确性。

---

## Phase 6：长期差异化（按需择取）

| 功能 | 预估 | 价值 |
|------|------|------|
| 数据库同步工具（MySQL → MySQL 增量同步） | 3 天 | 高 |
| 计划任务/定时查询（定时备份、定时导出） | 2 天 | 中 |
| 存储过程调试器（逐句执行 + 变量监控） | 3-4 天 | 独家功能 |

---

## 推荐执行顺序

| 波次 | 内容 | 预估 | 核心价值 |
|------|------|------|---------|
| **第一波** | Phase 0 全部 + Phase 1.1 缓存 + Phase 1.3 拆分 | 4 天 | 基础安全 + 性能感知 + 可维护性 |
| **第二波** | Phase 2.1 索引分析 + Phase 2.2 Dashboard 增强 | 4 天 | ⭐ 超越 Navicat 的杀手锏 |
| **第三波** | Phase 1.2 列冻结 + Phase 3.1 对象编辑 + Phase 4.1 并发控制 | 3 天 | 日常高频痛点 |
| **后续** | 按使用痛点从 Phase 3-6 中选取 | — | 按需迭代 |

---

## 验证方式

每个 Phase 完成后：
1. `cargo check --manifest-path src-tauri/Cargo.toml` — Rust 编译通过
2. `pnpm build` — 前端 TypeScript 类型检查通过
3. `pnpm tauri:dev` — 联调验证功能正常
4. 手动测试对应功能的核心场景
