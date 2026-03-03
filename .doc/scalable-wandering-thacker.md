# DevForge 数据库模块 10 大功能实现计划

## Context

DevForge 是一个 Tauri 2.10 + Vue 3 + Rust 的桌面开发者工具，集成数据库管理、SSH 终端和 SFTP。当前数据库模块已有基础的 SQL 查询、表浏览、表编辑器、数据导入导出等功能，但对比 Navicat/DBeaver/DataGrip 等竞品，在 SQL 编辑体验、对象管理深度、高级功能等方面存在差距。本计划旨在一次性规划 10 个核心功能的实现方案，按优先级分阶段交付。

## 实现顺序与依赖关系

```
Phase 1 (基础增强，无外部依赖):
  ├── F1: SQL 智能补全增强 (纯前端)
  ├── F4: SQL 格式化 (纯前端)
  └── F5: 多语句/选中执行 (前端为主 + 后端小改)

Phase 2 (核心功能):
  ├── F2: 查询历史 (前后端，依赖 storage.rs 扩展)
  ├── F3: 存储过程/视图/函数/触发器 (前后端)
  └── F10: SQL 片段管理 (前后端，依赖 storage.rs 扩展)

Phase 3 (高级功能):
  ├── F6: EXPLAIN 执行计划可视化 (前后端)
  └── F9: 表数据高级过滤/排序 (前后端)

Phase 4 (重量级功能):
  ├── F7: 数据库对比/同步
  └── F8: 数据库备份/恢复
```

---

## F1: SQL 智能补全增强

**复杂度: 中 | 纯前端改动**

### 修改文件
- `src/composables/useSqlCompletion.ts` — 增强补全逻辑
- `src/utils/sqlSnippets.ts` — 新增，SQL 代码片段模板

### 实现方案

1. **表别名识别** — 在 `useSqlCompletion.ts` 中新增 `extractTableAliases()`:
   - 解析 `FROM users u` / `FROM users AS u` / `JOIN orders o` 模式
   - 当输入 `u.` 时，解析别名映射到实际表名，提供列补全
   - 修改 `charBeforeWord === '.'` 分支，先查别名再查表名

2. **SQL 代码片段** — 新建 `sqlSnippets.ts`:
   - 定义常用模板: SELECT *, INSERT INTO, UPDATE SET, CREATE TABLE, ALTER TABLE, JOIN 等
   - 使用 Monaco Snippet 语法 (`${1:placeholder}`)
   - 按驱动区分 MySQL/PostgreSQL 特有片段
   - 在 CompletionItemProvider 中以 `Snippet` 类型注入

3. **列类型信息增强** — 补全详情中显示:
   - 数据类型 + 是否可空 (如 `VARCHAR(255) NOT NULL`)
   - 列注释作为 documentation
   - 主键标记

4. **MySQL 特有函数补全** — 扩展 `SQL_FUNCTIONS` 数组:
   - 添加 MySQL 特有函数 (GROUP_CONCAT, FIND_IN_SET, INET_ATON 等)
   - 函数签名提示 (参数说明)

---

## F2: 查询历史

**复杂度: 中 | 前后端改动**

### 修改/新增文件
- `src-tauri/src/services/storage.rs` — 新增 query_history 表 + CRUD
- `src-tauri/src/models/query_history.rs` — 新增数据模型
- `src-tauri/src/commands/db.rs` — 新增历史记录命令
- `src-tauri/src/lib.rs` — 注册新命令
- `src/api/database.ts` — 新增历史 API
- `src/components/database/QueryHistoryPanel.vue` — 新增历史面板组件
- `src/components/layout/BottomPanel.vue` — 替换 Output tab 为查询历史
- `src/components/database/QueryPanel.vue` — 执行后自动保存历史
- `src/locales/zh-CN.ts` + `en.ts` — 国际化

### 后端设计

**SQLite 新表:**
```sql
CREATE TABLE query_history (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  connection_name TEXT,
  database_name TEXT,
  sql TEXT NOT NULL,
  execution_time_ms INTEGER NOT NULL DEFAULT 0,
  is_error INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  affected_rows INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER,
  executed_at INTEGER NOT NULL
);
CREATE INDEX idx_qh_conn ON query_history(connection_id);
CREATE INDEX idx_qh_time ON query_history(executed_at DESC);
```

**Tauri 命令:**
- `save_query_history(record)` — 保存一条历史
- `list_query_history(filter)` — 分页查询历史 (支持 connection_id/搜索/时间范围过滤)
- `delete_query_history(id)` — 删除单条
- `clear_query_history(connection_id?)` — 清空历史

### 前端设计

**QueryHistoryPanel.vue:**
- 搜索框 + 连接过滤下拉
- 历史列表: SQL 预览 + 执行时间 + 状态(成功/失败) + 时间戳
- 操作: 点击复制 SQL / 双击在当前编辑器执行 / 删除
- 虚拟滚动 (历史可能很多)

**集成位置:** 替换底部面板的 `Output` tab 为 `查询历史`，因为 Output 目前是占位状态。

**自动保存:** 在 `QueryPanel.vue` 的 `handleExecute` 完成后调用 `saveQueryHistory`。

---

## F3: 存储过程/视图/函数/触发器管理

**复杂度: 中高 | 前后端改动**

### 修改/新增文件
- `src-tauri/src/services/db_drivers/mysql.rs` — 新增 get_views/procedures/functions/triggers
- `src-tauri/src/services/db_drivers/postgres.rs` — 同上
- `src-tauri/src/services/db_engine.rs` — 新增代理方法
- `src-tauri/src/models/database_objects.rs` — 新增模型
- `src-tauri/src/commands/db.rs` — 新增命令
- `src-tauri/src/lib.rs` — 注册命令
- `src/api/database.ts` — 新增 API
- `src/components/database/ObjectTree.vue` — 扩展树结构
- `src/types/database.ts` — 新增类型
- `src/locales/zh-CN.ts` + `en.ts`

### 后端设计

**数据模型 (`models/database_objects.rs`):**
```rust
pub struct RoutineInfo {
    pub name: String,
    pub routine_type: String, // PROCEDURE / FUNCTION
    pub definer: Option<String>,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub comment: Option<String>,
}

pub struct TriggerInfo {
    pub name: String,
    pub event: String,        // INSERT/UPDATE/DELETE
    pub timing: String,       // BEFORE/AFTER
    pub table_name: String,
    pub statement: Option<String>,
}
```

**MySQL 查询:**
- Views: `SELECT * FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?`
- Procedures: `SELECT * FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'`
- Functions: 同上 `ROUTINE_TYPE = 'FUNCTION'`
- Triggers: `SELECT * FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?`
- 查看定义: `SHOW CREATE VIEW/PROCEDURE/FUNCTION/TRIGGER`

**Tauri 命令:**
- `db_get_views(connection_id, database)`
- `db_get_procedures(connection_id, database)`
- `db_get_functions(connection_id, database)`
- `db_get_triggers(connection_id, database)`
- `db_get_routine_definition(connection_id, database, name, type)`

### 前端设计

**ObjectTree 扩展:** 数据库节点展开后显示 5 个分类文件夹:
```
📁 Database
  ├── 📁 Tables (12)
  ├── 📁 Views (3)
  ├── 📁 Procedures (5)
  ├── 📁 Functions (2)
  └── 📁 Triggers (1)
```

每个分类文件夹懒加载，展开时调用对应 API。

**右键菜单:**
- Views: 查看数据 / 查看定义
- Procedures/Functions: 查看定义 / 执行(仅 Procedure)
- Triggers: 查看定义

**查看定义:** 在新的查询 Tab 中打开，SQL 只读模式。

---

## F4: SQL 格式化

**复杂度: 低 | 纯前端改动**

### 修改/新增文件
- `package.json` — 添加 `sql-formatter` 依赖
- `src/components/database/SqlEditor.vue` — 添加格式化按钮和快捷键
- `src/components/database/QueryPanel.vue` — 工具栏添加格式化按钮
- `src/locales/zh-CN.ts` + `en.ts`

### 实现方案

**依赖:** `sql-formatter` (npm 包，支持 MySQL/PostgreSQL/标准 SQL)

**集成方式:**
1. 在 `SqlEditor.vue` 中注册 Monaco Action: `Shift+Alt+F` 触发格式化
2. 在 QueryPanel 工具栏添加格式化图标按钮
3. 调用 `sql-formatter` 的 `format()` 方法:
```typescript
import { format } from 'sql-formatter'
const formatted = format(sql, {
  language: driver === 'mysql' ? 'mysql' : 'postgresql',
  tabWidth: settingsStore.settings.editorTabSize,
  keywordCase: 'upper',
})
```
4. 替换编辑器内容 (保留 undo 历史)

---

## F5: 多语句执行 / 选中执行

**复杂度: 中 | 前端为主**

### 修改/新增文件
- `src/components/database/SqlEditor.vue` — 获取选中文本
- `src/components/database/QueryPanel.vue` — 选中执行逻辑 + 多结果集
- `src/components/database/QueryResult.vue` — 多结果集 Tab 展示
- `src/types/database.ts` — 扩展 QueryResult
- `src/types/database-workspace.ts` — 扩展 QueryTabContext
- `src-tauri/src/commands/db.rs` — 多语句分割执行
- `src-tauri/src/services/db_engine.rs` — execute_queries (多语句)
- `src/locales/zh-CN.ts` + `en.ts`

### 后端设计

**新增命令 `db_execute_queries`:**
```rust
pub async fn db_execute_queries(
    connection_id: String,
    statements: Vec<String>,
    engine: State<'_, DbEngineState>,
) -> Result<Vec<QueryResult>, String>
```
- 前端负责分割 SQL 语句 (用 `;` 分割，排除字符串内的分号)
- 后端按顺序执行每条语句，返回结果数组
- 任一语句失败时停止执行，返回已执行的结果 + 错误

### 前端设计

**选中执行:**
1. `SqlEditor.vue` 暴露 `getSelectedText()` 方法
2. `QueryPanel.vue` 执行时: 有选中文本 → 执行选中部分; 无选中 → 执行全部
3. 工具栏显示"执行选中" / "执行全部"状态提示

**多结果集展示:**
- `QueryTabContext` 新增 `results: QueryResult[]` (替代单个 result)
- `QueryResult.vue` 顶部添加结果集 Tab 栏: `结果 1 (100行)` / `结果 2 (5行受影响)`
- 每个结果集独立展示

**SQL 分割:** 前端使用简单的分号分割器:
```typescript
function splitStatements(sql: string): string[] {
  // 处理字符串内的分号、注释等
  // 返回非空语句数组
}
```

---

## F6: 查询执行计划 (EXPLAIN)

**复杂度: 中高 | 前后端改动**

### 修改/新增文件
- `src-tauri/src/commands/db.rs` — 新增 explain 命令
- `src-tauri/src/services/db_engine.rs` — explain 方法
- `src/api/database.ts` — 新增 explain API
- `src/components/database/ExplainPanel.vue` — 新增执行计划可视化组件
- `src/components/database/QueryPanel.vue` — 添加 EXPLAIN 按钮
- `src/types/database.ts` — ExplainResult 类型
- `src/locales/zh-CN.ts` + `en.ts`

### 后端设计

**Tauri 命令:**
```rust
pub async fn db_explain_query(
    connection_id: String,
    sql: String,
    analyze: bool, // true = EXPLAIN ANALYZE
    engine: State<'_, DbEngineState>,
) -> Result<QueryResult, String>
```
- MySQL: `EXPLAIN FORMAT=JSON {sql}` 或 `EXPLAIN ANALYZE {sql}`
- PostgreSQL: `EXPLAIN (FORMAT JSON, ANALYZE) {sql}`
- 返回标准 QueryResult (JSON 格式的执行计划)

### 前端设计

**ExplainPanel.vue:**
- 解析 JSON 执行计划
- 树形展示: 每个节点显示操作类型、表名、行数估算、成本
- 关键指标高亮: 全表扫描(红色)、索引扫描(绿色)、临时表(黄色)
- 表格视图 (传统 EXPLAIN 输出) 和树形视图切换

**集成:** QueryPanel 工具栏添加 EXPLAIN 按钮 (闪电图标旁边)，点击后在结果区域切换到 ExplainPanel。

---

## F7: 数据库对比/同步

**复杂度: 高 | 前后端改动**

### 修改/新增文件
- `src-tauri/src/services/schema_compare.rs` — 新增 Schema 对比引擎
- `src-tauri/src/commands/schema_compare.rs` — 新增命令
- `src-tauri/src/models/schema_compare.rs` — 对比结果模型
- `src-tauri/src/lib.rs` — 注册命令
- `src/views/SchemaCompareView.vue` — 新增对比视图 (作为新的 Tab 类型)
- `src/components/database/SchemaCompareResult.vue` — 对比结果展示
- `src/api/schema-compare.ts` — 新增 API
- `src/types/schema-compare.ts` — 类型定义
- `src/types/workspace.ts` — 新增 TabType
- `src/locales/zh-CN.ts` + `en.ts`

### 后端设计

**Schema 对比引擎 (`schema_compare.rs`):**
```rust
pub struct SchemaDiff {
    pub tables_only_in_source: Vec<String>,
    pub tables_only_in_target: Vec<String>,
    pub table_diffs: Vec<TableDiff>,
}

pub struct TableDiff {
    pub table_name: String,
    pub columns_added: Vec<ColumnInfo>,
    pub columns_removed: Vec<ColumnInfo>,
    pub columns_modified: Vec<ColumnModification>,
    pub indexes_added: Vec<IndexInfo>,
    pub indexes_removed: Vec<IndexInfo>,
}

pub struct ColumnModification {
    pub column_name: String,
    pub source: ColumnInfo,
    pub target: ColumnInfo,
    pub changes: Vec<String>, // ["type: INT → BIGINT", "nullable: YES → NO"]
}
```

**对比流程:**
1. 获取源和目标的完整 schema (tables + columns + indexes)
2. 对比表级差异 (新增/删除/修改)
3. 对比列级差异 (类型/默认值/可空/注释)
4. 对比索引差异
5. 生成迁移 SQL (ALTER TABLE ADD/DROP/MODIFY COLUMN)

**Tauri 命令:**
- `schema_compare(source_connection_id, source_db, target_connection_id, target_db)` → `SchemaDiff`
- `generate_migration_sql(diff)` → `String` (SQL 脚本)

### 前端设计

**SchemaCompareView.vue:**
- 顶部: 源连接/数据库选择 ↔ 目标连接/数据库选择 + "对比"按钮
- 中间: 三栏 Diff 视图 (仅源有 / 两边都有但不同 / 仅目标有)
- 底部: 生成的迁移 SQL 预览 + "执行同步"按钮
- 颜色编码: 绿色(新增) / 红色(删除) / 黄色(修改)

---

## F8: 数据库备份/恢复

**复杂度: 高 | 前后端改动**

### 修改/新增文件
- `src-tauri/src/services/db_backup.rs` — 新增备份引擎
- `src-tauri/src/commands/db_backup.rs` — 新增命令
- `src-tauri/src/lib.rs` — 注册命令
- `src/components/database/BackupDialog.vue` — 备份配置对话框
- `src/components/database/RestoreDialog.vue` — 恢复对话框
- `src/api/database.ts` — 新增备份 API
- `src/locales/zh-CN.ts` + `en.ts`

### 后端设计

**备份引擎 (`db_backup.rs`):** 纯 SQL 方式生成 dump，不依赖 mysqldump:
1. 生成 `SET` 头部 (字符集、外键检查关闭等)
2. 遍历选中的表:
   - `SHOW CREATE TABLE` → 结构 SQL
   - `SELECT * FROM table` → 分批生成 INSERT 语句 (每批 1000 行)
3. 生成 `SET` 尾部 (恢复外键检查等)
4. 通过 Tauri Event 发送进度 (`backup://progress`)

**Tauri 命令:**
```rust
pub async fn db_backup(
    connection_id: String,
    database: String,
    tables: Vec<String>,      // 空 = 全部表
    include_structure: bool,
    include_data: bool,
    output_path: String,
    app_handle: AppHandle,
) -> Result<(), String>

pub async fn db_restore(
    connection_id: String,
    database: String,
    file_path: String,
    app_handle: AppHandle,
) -> Result<(), String>
```

**恢复:** 读取 SQL 文件，按语句分割执行，通过事件报告进度。

### 前端设计

**BackupDialog.vue:**
- 选择数据库 + 表 (多选)
- 选项: 结构/数据/两者都要
- 输出路径 (Tauri 文件对话框)
- 进度条 + 当前表名

**触发方式:** ObjectTree 数据库节点右键菜单 → "备份数据库"

---

## F9: 表数据高级过滤/排序

**复杂度: 中 | 前后端改动**

### 修改/新增文件
- `src/components/database/FilterBuilder.vue` — 新增 WHERE 条件构建器
- `src/components/database/QueryResult.vue` — 集成过滤器 + 服务端排序
- `src/components/database/QueryPanel.vue` — 传递过滤/排序参数
- `src-tauri/src/commands/db.rs` — 扩展 db_get_table_data 支持 WHERE/ORDER BY
- `src-tauri/src/services/db_engine.rs` — 扩展 get_table_data
- `src/api/database.ts` — 扩展 API 参数
- `src/types/database.ts` — FilterCondition 类型
- `src/locales/zh-CN.ts` + `en.ts`

### 后端设计

**扩展 `db_get_table_data`:**
```rust
pub async fn db_get_table_data(
    connection_id: String,
    database: String,
    table: String,
    page: u32,
    page_size: u32,
    where_clause: Option<String>,  // 新增
    order_by: Option<String>,      // 新增
    engine: State<'_, DbEngineState>,
) -> Result<QueryResult, String>
```
- where_clause: 前端构建的 WHERE 条件字符串 (参数化防注入)
- order_by: 如 `"name ASC, id DESC"`

### 前端设计

**FilterBuilder.vue:**
- 每列一行过滤条件: `列名` + `操作符` + `值`
- 操作符: `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `NOT LIKE`, `IN`, `NOT IN`, `IS NULL`, `IS NOT NULL`, `BETWEEN`
- 支持添加多个条件 (AND/OR 逻辑)
- "应用过滤" 按钮 → 构建 WHERE 子句发送到后端
- "清除过滤" 按钮

**列排序:** 点击列头 → 切换 ASC/DESC/无排序 → 发送 ORDER BY 到后端重新查询。

**集成:** 在 QueryResult 的工具栏区域，Filter 按钮点击后展开 FilterBuilder 面板。

---

## F10: SQL 片段管理

**复杂度: 中 | 前后端改动**

### 修改/新增文件
- `src-tauri/src/services/storage.rs` — 新增 sql_snippets 表
- `src-tauri/src/models/sql_snippet.rs` — 新增模型
- `src-tauri/src/commands/sql_snippet.rs` — 新增命令
- `src-tauri/src/lib.rs` — 注册命令
- `src/api/sql-snippet.ts` — 新增 API
- `src/components/database/SqlSnippetPanel.vue` — 片段管理面板
- `src/components/database/QueryPanel.vue` — 集成片段面板
- `src/types/sql-snippet.ts` — 类型定义
- `src/locales/zh-CN.ts` + `en.ts`

### 后端设计

**SQLite 新表:**
```sql
CREATE TABLE sql_snippets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  sql TEXT NOT NULL,
  category TEXT DEFAULT 'default',
  tags TEXT,  -- JSON array
  connection_id TEXT,  -- NULL = 全局
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**Tauri 命令:**
- `list_sql_snippets(category?, search?)` — 列表
- `create_sql_snippet(title, sql, category?, tags?, connection_id?)` — 创建
- `update_sql_snippet(id, ...)` — 更新
- `delete_sql_snippet(id)` — 删除

### 前端设计

**SqlSnippetPanel.vue:**
- 侧边抽屉或弹窗形式
- 分类列表 + 搜索框
- 片段卡片: 标题 + SQL 预览 + 标签
- 操作: 插入到编辑器 / 编辑 / 删除 / 复制
- 新建片段: 从当前编辑器选中文本快速保存

**触发方式:**
- QueryPanel 工具栏添加"片段"按钮 (BookmarkIcon)
- 快捷键: `Ctrl+Shift+S` 保存当前 SQL 为片段

---

## 验证方案

每个功能完成后的验证步骤:

1. **F1 SQL 补全:** 输入 `FROM users u` 后输入 `u.` 验证列补全; 输入 `sel` 验证片段补全
2. **F2 查询历史:** 执行多条 SQL 后检查底部面板历史记录; 搜索/过滤/重新执行
3. **F3 对象管理:** 展开数据库节点验证 Views/Procedures/Functions/Triggers 分类; 右键查看定义
4. **F4 SQL 格式化:** 输入混乱 SQL 后按 Shift+Alt+F 验证格式化效果
5. **F5 选中执行:** 选中部分 SQL 按 Ctrl+Enter 验证只执行选中部分; 多语句验证多结果集
6. **F6 EXPLAIN:** 对 SELECT 语句点击 EXPLAIN 按钮验证执行计划树形展示
7. **F7 Schema 对比:** 选择两个数据库对比，验证差异展示和迁移 SQL 生成
8. **F8 备份恢复:** 备份一个数据库到文件，然后恢复到另一个数据库验证数据完整性
9. **F9 高级过滤:** 在表数据浏览中添加多个过滤条件，验证服务端过滤结果
10. **F10 SQL 片段:** 保存/编辑/删除片段; 从片段面板插入到编辑器

**构建验证:** 每个 Phase 完成后运行 `cd src-tauri && cargo check` 验证 Rust 编译，`cd .. && pnpm build` 验证前端构建。
