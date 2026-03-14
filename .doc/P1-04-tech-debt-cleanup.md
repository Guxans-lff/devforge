# P1-04: 技术债务清理方案

> 优先级：P1 | 预估工作量：中高 | 影响面：代码质量、可维护性、稳定性

---

## 一、现状分析

### 代码规模概览

| 类别 | 文件数 | 总行数 | 超 800 行文件数 |
|------|--------|--------|----------------|
| Vue 组件 | ~80 | ~15,000 | 8 |
| TypeScript | ~40 | ~5,000 | 0 |
| Rust | ~61 | ~15,979 | 4 |

### 核心问题

#### 问题 1：大组件（超 800 行的 Vue 文件）

| 文件 | 行数 | 职责过多 |
|------|------|---------|
| QueryPanel.vue | 1359 | SQL 执行 + 结果管理 + 多语句处理 + 历史 + 片段 |
| TableEditorPanel.vue | 1314 | 表结构 + 列操作 + 索引 + 外键 + DDL 生成 |
| UserManagementPanel.vue | 1215 | 用户 CRUD + 权限管理 + 授权操作 |
| ObjectTree.vue | 999 | 树结构 + 虚拟滚动 + 搜索 + 右键菜单 + 拖拽 |
| QueryResult.vue | 923 | 结果网格 + 行内编辑 + 分页 + 过滤 + 复制 |
| PerformanceDashboard.vue | 639 | 多图表 + 实时轮询 + 进程管理 |
| ExplainPanel.vue | 634 | 执行计划表格 + 可视化 + 优化建议 |
| SchemaComparePanel.vue | 563 | 双 Schema 加载 + 差异计算 + DDL 生成 |

#### 问题 2：错误处理不统一

**Rust 后端**（`utils/error.rs` - 38 行）：
- `AppError` 枚举有 6 种变体，覆盖较基础
- 大部分 Tauri 命令直接 `.map_err(|e| e.to_string())`
- 缺少错误分类（用户错误 vs 系统错误）
- 缺少错误上下文信息（连接 ID、操作类型）

**前端**：
- 错误处理方式不一致：有的用 `try-catch + toast`，有的用 `catch + console.error`
- 无统一的错误边界机制
- API 层（`src/api/`）大部分直接返回 `invoke` 结果，不做错误包装

#### 问题 3：状态持久化碎片化

| Store | 持久化方式 | 位置 |
|-------|----------|------|
| workspace.ts | localStorage（手动快照） | `devforge-workspace-snapshot` |
| settings.ts | localStorage | `devforge-settings` |
| connections.ts | SQLite（storage.rs） | 应用数据库 |
| database-workspace.ts | 无持久化 | 内存 |
| command-palette.ts | localStorage（最近项目） | 内存 + 部分 localStorage |
| log.ts | 无持久化 | 内存 |
| message-center.ts | 无持久化 | 内存 |

**问题**：
- localStorage 和 SQLite 混用，无统一策略
- database-workspace 不持久化，重启后丢失所有标签页状态
- 无版本迁移机制（设置结构变化时无法平滑迁移）

#### 问题 4：测试覆盖不足

- 前端测试仅在少量 composables 中存在
- 大组件无单元测试
- Store 逻辑无测试
- Rust 后端无集成测试

#### 问题 5：TODO/FIXME 散落

项目中存在未完成的标记代码，需要清理或规划。

---

## 二、优化方案

### 2.1 大组件拆分

#### 2.1.1 QueryPanel.vue（1359 行 → 5 个子组件）

**拆分方案**：

```
QueryPanel.vue (约 300 行，编排层)
├── SqlEditorSection.vue      # SQL 编辑器区域（编辑器 + 工具栏）
├── QueryResultSection.vue    # 结果展示区域（结果 + 切换）
├── QueryStatusBar.vue        # 状态栏（执行耗时、行数、状态）
├── QueryTabManager.vue       # 多查询标签页管理
└── composables/
    ├── useQueryExecution.ts   # SQL 执行逻辑
    ├── useMultiStatement.ts   # 多语句分割与执行
    └── useQueryState.ts       # 查询状态管理
```

**拆分原则**：
- QueryPanel 只做组合和协调
- 每个子组件独立处理自己的 UI 和逻辑
- 通过 props/emits 或 composable 共享状态
- 保持现有 API 行为不变

**具体步骤**：
1. 提取 SQL 执行逻辑到 `useQueryExecution.ts`
2. 提取多语句处理到 `useMultiStatement.ts`
3. 将结果展示区域提取为 `QueryResultSection.vue`
4. 将工具栏和编辑器包装提取为 `SqlEditorSection.vue`
5. QueryPanel 变为纯编排组件

#### 2.1.2 TableEditorPanel.vue（1314 行 → 5 个子组件）

**拆分方案**：

```
TableEditorPanel.vue (约 250 行，编排层)
├── ColumnEditor.vue       # 列定义编辑
├── IndexEditor.vue        # 索引编辑
├── ForeignKeyEditor.vue   # 外键编辑
├── DdlPreview.vue         # DDL 预览
└── composables/
    ├── useTableDdl.ts     # DDL 生成逻辑
    └── useColumnOps.ts    # 列操作逻辑
```

#### 2.1.3 ObjectTree.vue（999 行 → 4 个子组件）

**拆分方案**：

```
ObjectTree.vue (约 300 行，编排层)
├── TreeNode.vue               # 单个树节点渲染
├── TreeContextMenu.vue        # 右键菜单
├── TreeSearchBar.vue          # 搜索栏
└── composables/
    ├── useTreeData.ts         # 数据加载和构建
    └── useTreeContextMenu.ts  # 右键菜单逻辑
```

#### 2.1.4 UserManagementPanel.vue（1215 行 → 4 个子组件）

**拆分方案**：

```
UserManagementPanel.vue (约 250 行)
├── UserList.vue            # 用户列表
├── UserForm.vue            # 用户创建/编辑表单
├── PrivilegeEditor.vue     # 权限编辑器
└── composables/
    └── useUserPrivileges.ts  # 权限逻辑
```

#### 2.1.5 QueryResult.vue（923 行 → 3 个子组件）

**拆分方案**：

```
QueryResult.vue (约 300 行)
├── ResultGrid.vue          # 数据网格（虚拟滚动）
├── ResultToolbar.vue       # 工具栏（搜索/过滤/导出）
└── composables/
    ├── useResultSelection.ts  # 选择逻辑
    └── useResultExport.ts     # 导出逻辑
```

**涉及影响**：
- 所有引用这些组件的父组件需要验证 props/emits 兼容
- 大量 import 路径变更
- 需要逐个拆分，每次拆分后验证功能完整

---

### 2.2 错误处理统一化

#### 2.2.1 Rust 后端错误增强

**扩展 AppError**（`src-tauri/src/utils/error.rs`）：

```rust
use thiserror::Error;
use serde::Serialize;

#[derive(Debug, Error, Serialize)]
pub enum AppError {
    // 数据库相关
    #[error("数据库错误: {message}")]
    Database {
        message: String,
        code: Option<String>,      // MySQL 错误码
        connection_id: Option<String>,
    },

    // 连接相关
    #[error("连接错误: {message}")]
    Connection {
        message: String,
        connection_id: String,
        retryable: bool,          // 是否可重试
    },

    // 凭据相关
    #[error("凭据错误: {0}")]
    Credential(String),

    // IO 相关
    #[error("IO 错误: {0}")]
    Io(String),

    // 验证错误（用户输入问题）
    #[error("验证错误: {0}")]
    Validation(String),

    // 权限错误
    #[error("权限不足: {0}")]
    Permission(String),

    // 超时
    #[error("操作超时: {0}")]
    Timeout(String),

    // 其他
    #[error("{0}")]
    Other(String),
}

impl AppError {
    /// 是否为用户可理解的错误（显示原始信息）
    pub fn is_user_error(&self) -> bool {
        matches!(self, Self::Validation(_) | Self::Permission(_))
    }

    /// 是否可重试
    pub fn is_retryable(&self) -> bool {
        matches!(self, Self::Connection { retryable: true, .. } | Self::Timeout(_))
    }
}
```

**Tauri 命令统一错误返回**：

```rust
// 统一的错误响应格式
#[derive(Serialize)]
pub struct ErrorResponse {
    pub code: String,       // "DB_ERROR", "CONNECTION_ERROR", etc.
    pub message: String,    // 用户友好的消息
    pub detail: Option<String>,  // 技术细节（开发模式显示）
    pub retryable: bool,
}

// 命令中使用
#[tauri::command]
async fn execute_query(...) -> Result<QueryResult, ErrorResponse> {
    // ...
}
```

#### 2.2.2 前端统一错误处理

**新增 `src/composables/useErrorHandler.ts`**：

```typescript
interface AppError {
  code: string
  message: string
  detail?: string
  retryable: boolean
}

export function useErrorHandler() {
  // 统一错误处理
  function handleError(error: unknown, context?: string): AppError {
    // 1. 解析 Tauri invoke 错误
    // 2. 分类：网络错误、数据库错误、验证错误
    // 3. 生成用户友好的消息
    // 4. 记录到 log store
    // 5. 返回结构化错误
  }

  // 带重试的操作
  async function withRetry<T>(
    fn: () => Promise<T>,
    options?: { maxRetries?: number; delay?: number }
  ): Promise<T>

  // 安全执行（不抛出异常）
  async function safeInvoke<T>(
    command: string,
    args?: Record<string, unknown>
  ): Promise<{ data: T | null; error: AppError | null }>

  return { handleError, withRetry, safeInvoke }
}
```

**API 层封装**（`src/api/` 统一改造）：

```typescript
// src/api/base.ts - 新增基础封装
import { invoke } from '@tauri-apps/api/core'
import { useErrorHandler } from '@/composables/useErrorHandler'

export async function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    // 统一错误转换和日志
    throw parseError(error)
  }
}
```

**涉及文件**：
- 修改 `src-tauri/src/utils/error.rs` - 错误类型增强
- 新增 `src/composables/useErrorHandler.ts` - 前端错误处理
- 新增 `src/api/base.ts` - API 基础封装
- 修改 `src/api/*.ts` - 所有 API 文件使用统一封装
- 修改所有 `catch` 块 - 使用统一处理

---

### 2.3 状态持久化统一

#### 2.3.1 持久化策略

**统一方案**：所有需持久化的 Store 使用 Pinia 持久化插件 + SQLite 后端

```typescript
// src/plugins/persistence.ts

interface PersistConfig {
  key: string
  storage: 'sqlite' | 'localStorage'  // 按需选择
  paths?: string[]  // 仅持久化特定字段
  version: number   // 版本号，用于迁移
  migrate?: (old: unknown, version: number) => unknown
}
```

**各 Store 持久化策略**：

| Store | 存储方式 | 持久化字段 | 版本 |
|-------|---------|-----------|------|
| settings | SQLite | 全部 | v1 |
| workspace | SQLite | tabs, activeTab, 面板状态 | v1 |
| database-workspace | SQLite | tabs, activeTabId, SQL 内容 | v1 |
| connections | SQLite（已有） | 保持不变 | - |
| command-palette | localStorage | recentItems | v1 |
| log | 不持久化 | - | - |
| message-center | 不持久化 | - | - |

#### 2.3.2 版本迁移机制

```typescript
// 迁移示例
const settingsMigrations = {
  1: (state: any) => {
    // v0 → v1：新增 AI 设置字段
    return {
      ...state,
      ai: { enabled: false, provider: 'ollama' }
    }
  },
  2: (state: any) => {
    // v1 → v2：重命名字段
    const { oldField, ...rest } = state
    return { ...rest, newField: oldField }
  }
}
```

#### 2.3.3 database-workspace 持久化（最关键）

**现状**：重启应用后所有查询标签页丢失，SQL 内容全部消失

**优化后**：
- 保存每个连接的标签页列表和活跃标签
- 保存查询标签页的 SQL 内容
- 应用启动时恢复上次的标签页状态
- 限制：非查询类标签页（如性能面板）不恢复

**涉及文件**：
- 新增 `src/plugins/persistence.ts` - 持久化插件
- 修改 `src/stores/settings.ts` - 使用持久化插件
- 修改 `src/stores/workspace.ts` - 统一持久化
- 修改 `src/stores/database-workspace.ts` - 新增持久化
- 新增 `src-tauri/src/commands/settings.rs` - 设置存取命令
- 修改 `src-tauri/src/services/storage.rs` - 新增通用 KV 存储表

**SQLite KV 存储表**：
```sql
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

### 2.4 测试基础建设

#### 2.4.1 测试策略

**优先级**（按投资回报率排序）：

1. **Composables 单元测试**（ROI 最高）
   - `useSqlCompletion.ts` - 补全逻辑
   - `useDataFilter.ts` - 过滤逻辑
   - `useQueryExecution.ts` - 执行逻辑（拆分后）
   - `useErrorHandler.ts` - 错误处理

2. **Store 逻辑测试**
   - `connections.ts` - 连接增删改查
   - `database-workspace.ts` - Tab 管理
   - `settings.ts` - 设置读写

3. **API 层 Mock 测试**
   - 验证 invoke 调用参数
   - 验证错误处理

#### 2.4.2 测试工具配置

**现有**：Vitest + happy-dom（`vitest.config.ts` 已配置）

**需补充**：
- `@vue/test-utils` - 组件测试
- `msw` 或自定义 mock - Tauri invoke mock
- 覆盖率配置 - Istanbul/c8

**Tauri invoke Mock**：

```typescript
// tests/mocks/tauri.ts
import { vi } from 'vitest'

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

export function mockInvoke(command: string, response: unknown) {
  const { invoke } = await import('@tauri-apps/api/core')
  ;(invoke as Mock).mockImplementation((cmd, args) => {
    if (cmd === command) return Promise.resolve(response)
    return Promise.reject(`Unknown command: ${cmd}`)
  })
}
```

**涉及文件**：
- 新增 `tests/mocks/tauri.ts` - Tauri mock
- 新增 `tests/composables/` - Composable 测试
- 新增 `tests/stores/` - Store 测试
- 修改 `vitest.config.ts` - 覆盖率配置

---

### 2.5 TODO/FIXME 清理

**处理原则**：
1. 能立即修复的 → 修复
2. 需要后续处理的 → 转为 Issue 或文档记录
3. 已过期的 → 删除

**优先处理**：
- 涉及数据安全的 TODO
- 影响用户体验的 FIXME
- 性能相关的 HACK

---

## 三、实施阶段

### 阶段 1：错误处理统一（工作量：2-3 天）
1. [ ] Rust AppError 增强
2. [ ] 前端 useErrorHandler composable
3. [ ] API 基础封装（base.ts）
4. [ ] 逐步迁移现有 API 调用

### 阶段 2：大组件拆分 - QueryPanel（工作量：2-3 天）
1. [ ] 提取 useQueryExecution composable
2. [ ] 提取 useMultiStatement composable
3. [ ] 拆分 SqlEditorSection
4. [ ] 拆分 QueryResultSection
5. [ ] QueryPanel 重构为编排层
6. [ ] 验证所有功能完整

### 阶段 3：持久化统一（工作量：2-3 天）
1. [ ] SQLite KV 存储表
2. [ ] 持久化插件封装
3. [ ] database-workspace 持久化
4. [ ] 设置迁移机制
5. [ ] 验证重启后状态恢复

### 阶段 4：其他大组件拆分（工作量：3-4 天）
1. [ ] TableEditorPanel 拆分
2. [ ] ObjectTree 拆分
3. [ ] QueryResult 拆分
4. [ ] UserManagementPanel 拆分

### 阶段 5：测试基础（工作量：2-3 天）
1. [ ] 测试 Mock 基础设施
2. [ ] 核心 composables 测试
3. [ ] 核心 stores 测试
4. [ ] 覆盖率配置

### 阶段 6：TODO 清理（工作量：1 天）
1. [ ] 全局扫描 TODO/FIXME
2. [ ] 分类处理
3. [ ] 转 Issue 或删除

---

## 四、拆分标准

### 组件拆分检查清单

- [ ] 单个组件不超过 400 行（硬上限 800 行）
- [ ] 每个组件只有一个主要职责
- [ ] 复杂逻辑提取到 composable
- [ ] Props 不超过 10 个
- [ ] Emits 不超过 8 个
- [ ] 模板嵌套不超过 5 层

### 拆分安全原则

1. **每次只拆一个组件**，拆完验证功能完整
2. **保持对外接口不变**（props/emits/expose）
3. **先提取 composable，后拆分模板**
4. **拆分后跑全量测试**
5. **Git 每步一个 commit**，方便回滚

---

## 五、预期收益

| 改进项 | 当前状态 | 目标状态 | 收益 |
|--------|---------|---------|------|
| 最大组件行数 | 1359 行 | <400 行 | 可维护性 ↑ |
| 错误处理一致性 | 3 种方式混用 | 1 种统一方式 | 排错效率 ↑ |
| 标签页持久化 | 重启丢失 | 完整恢复 | 用户体验 ↑ |
| 测试覆盖率 | ~5% | 40%+ | 代码质量 ↑ |
| TODO 数量 | 未知 | 0 | 代码整洁 ↑ |

---

## 六、风险与注意事项

1. **大组件拆分风险最高**：每次拆分都可能引入回归 bug，必须逐步进行
2. **持久化迁移**：localStorage → SQLite 迁移需要考虑旧数据兼容
3. **错误处理迁移**：大量文件修改，建议用自动化工具辅助
4. **测试 Mock**：Tauri invoke 的 mock 需要覆盖所有异步场景
5. **拆分与功能开发冲突**：建议在稳定期进行拆分，避免与新功能开发并行
