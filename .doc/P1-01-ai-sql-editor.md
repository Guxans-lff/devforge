# P1-01: AI SQL 编辑器增强方案

> 优先级：P1 | 预估工作量：中高 | 影响面：SQL 编辑体验核心提升

---

## 一、现状分析

### 当前能力（useSqlCompletion.ts - 390 行）
- ✅ 上下文感知补全（表名、列名、数据库名）
- ✅ SQL 关键字 + 内建函数补全
- ✅ 别名解析（`FROM users u` → `u.` 触发列补全）
- ✅ 代码片段（SELECT、INSERT、UPDATE 等模板）
- ✅ Schema 缓存机制（模块级缓存，按驱动键区分）
- ✅ Monaco Editor 集成（276 行 SqlEditor.vue）

### 当前缺失
- ❌ AI 自然语言转 SQL
- ❌ 智能语法错误检测与修复建议
- ❌ SQL 执行计划优化建议（有 ExplainPanel 但无 AI 辅助分析）
- ❌ 查询历史智能推荐
- ❌ 上下文感知的表关系提示
- ❌ SQL 注释生成

---

## 二、优化方案

### 2.1 增强 SQL 自动补全

#### 2.1.1 JOIN 智能补全

**现状**：输入 `JOIN` 后只有基础表名补全，无法智能推测关联关系

**目标**：基于外键关系和常见命名模式自动推荐 JOIN 条件

**实现思路**：

```typescript
// 在 useSqlCompletion.ts 中扩展
// 新增 ForeignKeyInfo 到 SchemaCache
interface SchemaCache {
  databases: string[]
  tables: Record<string, TableSchema>
  foreignKeys: Record<string, ForeignKeyInfo[]>  // 新增
}

interface ForeignKeyInfo {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
  constraintName: string
}
```

**补全触发逻辑**：
1. 检测到 `JOIN <table>` 后自动建议 `ON` 条件
2. 基于外键关系优先推荐
3. 无外键时根据命名模式推测（如 `user_id` → `users.id`）

**涉及文件**：
- `src/composables/useSqlCompletion.ts` - 补全逻辑扩展
- `src/types/database.ts` - SchemaCache 类型扩展
- `src-tauri/src/services/db_drivers/mysql/mod.rs` - 外键查询
- `src/api/database.ts` - 新增外键 API

**Rust 后端新增查询**：
```sql
-- MySQL 外键信息查询
SELECT
  TABLE_NAME as from_table,
  COLUMN_NAME as from_column,
  REFERENCED_TABLE_NAME as to_table,
  REFERENCED_COLUMN_NAME as to_column,
  CONSTRAINT_NAME
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
```

#### 2.1.2 子查询 / CTE 补全

**现状**：不识别子查询或 CTE 定义的临时表

**目标**：支持 CTE（`WITH ... AS`）和子查询中的列补全

**实现思路**：
1. 在 `getContextKeyword()` 中扩展 AST 分析
2. 解析 `WITH name AS (...)` 结构，提取列信息
3. 子查询别名的列推断

**涉及文件**：
- `src/composables/useSqlCompletion.ts` - 上下文分析扩展

#### 2.1.3 补全排序优化

**现状**：补全项按固定权重排序

**目标**：基于使用频率和上下文相关性动态排序

**实现思路**：
1. 记录用户选择的补全项频率（localStorage）
2. 按最近使用 + 频率混合排序
3. 当前 SQL 上下文中已出现的表/列优先

**涉及文件**：
- `src/composables/useSqlCompletion.ts` - 排序逻辑
- 新增 `src/composables/useCompletionStats.ts` - 补全统计

---

### 2.2 AI 自然语言转 SQL（本地/API 可选）

#### 2.2.1 架构设计

```
用户输入自然语言
       ↓
  [AI Provider 抽象层]
       ↓
  ┌────┴────┐
  │ 本地LLM │  外部API（OpenAI/Claude）
  └────┬────┘
       ↓
  Schema 上下文注入（当前数据库表结构）
       ↓
  SQL 生成 + 验证
       ↓
  插入编辑器 / 预览确认
```

#### 2.2.2 AI Provider 抽象层

**现有基础**：`src-tauri/src/models/ai.rs`（61 行，已预留 AI 模型定义）

**设计**：

```rust
// src-tauri/src/services/ai_provider.rs

pub trait AiProvider: Send + Sync {
    async fn generate_sql(
        &self,
        prompt: &str,
        schema_context: &SchemaContext,
    ) -> Result<String, AppError>;

    async fn explain_sql(
        &self,
        sql: &str,
        schema_context: &SchemaContext,
    ) -> Result<String, AppError>;

    async fn optimize_sql(
        &self,
        sql: &str,
        explain_result: &str,
        schema_context: &SchemaContext,
    ) -> Result<String, AppError>;
}

pub struct SchemaContext {
    pub database: String,
    pub tables: Vec<TableSchemaInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
}
```

**Provider 实现**：
- `OpenAiProvider` - 兼容 OpenAI API 格式（也支持本地 Ollama）
- `ClaudeProvider` - Anthropic API
- `OllamaProvider` - 本地 Ollama（无需 API Key）

#### 2.2.3 前端 AI 交互面板

**新增组件**：`src/components/database/AiAssistPanel.vue`

**交互方式**：
1. **快捷键触发**：`Ctrl+I` 或 `/` 前缀在编辑器中触发
2. **侧边面板**：独立的 AI 对话面板
3. **内联建议**：类似 GitHub Copilot 的 ghost text

**功能**：
- 自然语言 → SQL（"查找最近 7 天注册的用户数"）
- SQL 解释（选中 SQL → 右键 → "解释此查询"）
- SQL 优化建议（结合 EXPLAIN 结果）
- 错误修复建议（执行失败时自动分析）

#### 2.2.4 设置集成

在 `src/stores/settings.ts` 中扩展：

```typescript
interface AiSettings {
  enabled: boolean
  provider: 'openai' | 'claude' | 'ollama' | 'custom'
  apiKey?: string  // 加密存储在 credential.rs
  apiEndpoint?: string  // 自定义端点（Ollama: http://localhost:11434）
  model: string  // 如 'gpt-4o-mini', 'claude-3-haiku', 'codellama'
  maxTokens: number
  temperature: number
  inlineSuggestions: boolean  // 是否开启内联建议
}
```

**涉及文件**：
- 新增 `src-tauri/src/services/ai_provider.rs` - AI 抽象层
- 新增 `src-tauri/src/services/ai_providers/` - 各 Provider 实现
- 新增 `src-tauri/src/commands/ai.rs` - AI 相关 Tauri 命令
- 新增 `src/components/database/AiAssistPanel.vue` - AI 面板
- 修改 `src/stores/settings.ts` - AI 配置
- 修改 `src/components/database/SqlEditor.vue` - 内联建议
- 新增 `src/api/ai.ts` - AI API 封装

---

### 2.3 智能语法检测

#### 2.3.1 实时语法检查

**目标**：在输入时实时标记语法错误，类似 IDE 的红色波浪线

**实现思路**：
1. 使用轻量级 SQL parser（如 `sql-parser-cst` npm 包）进行前端解析
2. 检测常见错误：未闭合引号、缺少 FROM、列名不存在等
3. 通过 Monaco `setModelMarkers` API 标记错误位置

**涉及文件**：
- 新增 `src/composables/useSqlValidator.ts` - SQL 验证器
- 修改 `src/components/database/SqlEditor.vue` - Marker 集成

#### 2.3.2 智能修复建议

**目标**：错误标记处提供 Quick Fix 选项

**实现思路**：
1. 注册 Monaco `CodeActionProvider`
2. 常见修复：拼写纠正（模糊匹配表名/列名）、补全缺失关键字
3. 错误位置点击 → 弹出修复建议列表

---

### 2.4 查询历史智能推荐

#### 2.4.1 历史分析与推荐

**现有基础**：`src/api/query-history.ts`（48 行）已有查询历史存储

**扩展方向**：
1. 基于当前选中的表/数据库推荐最近执行的相关查询
2. 频率统计：常用查询模板高亮
3. 在编辑器空状态时展示推荐

**涉及文件**：
- 修改 `src/api/query-history.ts` - 增加推荐查询接口
- 新增 `src/composables/useQueryRecommend.ts` - 推荐逻辑
- 修改 `src/components/database/QueryPanel.vue` - 推荐 UI

---

## 三、实施阶段

### 阶段 1：补全增强（工作量：2-3 天）
1. [ ] 外键信息查询（Rust 后端）
2. [ ] JOIN 智能补全
3. [ ] 补全排序优化（使用频率）
4. [ ] CTE / 子查询补全

### 阶段 2：语法检测（工作量：2 天）
1. [ ] 集成 SQL parser
2. [ ] Monaco Marker 标记
3. [ ] Quick Fix 基础实现

### 阶段 3：AI 能力集成（工作量：3-5 天）
1. [ ] AI Provider 抽象层（Rust）
2. [ ] OpenAI / Ollama Provider 实现
3. [ ] AI 面板组件
4. [ ] Schema 上下文注入
5. [ ] 自然语言转 SQL 基础流程
6. [ ] 设置页 AI 配置 UI

### 阶段 4：智能推荐（工作量：1-2 天）
1. [ ] 查询历史推荐
2. [ ] 编辑器空状态推荐 UI

---

## 四、技术选型

| 需求 | 推荐方案 | 备选方案 |
|------|---------|---------|
| SQL Parser | `sql-parser-cst` | `node-sql-parser` |
| AI API 兼容 | OpenAI API 格式 | 直接 HTTP 调用 |
| 本地 LLM | Ollama（标准 OpenAI 兼容接口） | LM Studio |
| 内联建议 | Monaco `InlineCompletionProvider` | Ghost decoration |

---

## 五、对标分析

| 功能 | DevForge（当前） | DataGrip | DBeaver | Navicat |
|------|-----------------|----------|---------|---------|
| 基础补全 | ✅ | ✅ | ✅ | ✅ |
| 外键感知补全 | ❌→✅ | ✅ | ✅ | ❌ |
| 实时语法检查 | ❌→✅ | ✅ | ✅ | ❌ |
| AI SQL 生成 | ❌→✅ | ✅(AI) | ❌ | ✅(AI) |
| 查询推荐 | ❌→✅ | ✅ | ❌ | ❌ |

---

## 六、风险与注意事项

1. **AI API Key 安全**：必须通过 `credential.rs` 加密存储，不能明文写配置
2. **本地 LLM 性能**：Ollama 需要用户自行安装，文档需注明硬件要求
3. **SQL Parser 准确性**：轻量级 parser 可能不支持所有 MySQL 方言，需做降级处理
4. **Schema 上下文大小**：大型数据库（数百张表）的 Schema 注入需要截断策略
5. **Monaco 性能**：过多的 Marker 和 InlineCompletion 可能影响编辑器响应速度
