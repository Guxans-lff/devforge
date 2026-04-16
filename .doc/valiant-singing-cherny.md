# DevForge AI 助手集成 — 多版本迭代实施方案（升级版）

## Context

DevForge 是一个基于 Tauri 2（Vue 3 + Rust）的桌面开发工具箱，已集成数据库管理、SSH 终端、SFTP 文件管理、Redis 客户端、Git 版本控制等功能。现需集成类 Claude Code 的 AI 对话插件，对接 Claude、GPT、智普、DeepSeek 等多个大模型 API。

**目标：不是"抄一个 Claude Code"，而是做一个更好的、面向 DevOps 场景的 AI 助手。**

**已有基础**：
- `src/types/ai.ts` + `src-tauri/src/models/ai.rs`：基础 AI 类型定义
- `src-tauri/src/commands/screenshot.rs`：已实现非流式 LLM 调用（截图翻译）
- reqwest 已启用 `stream` feature，Tauri Channel 机制已在多模块中使用
- 完善的 SQLite KV 持久化、凭据管理（keyring）、国际化基础设施

---

## 竞品分析 — 我们要超越的点

| 维度 | Claude Code CLI | JetBrains CC GUI | **DevForge 目标** |
|------|----------------|-----------------|-------------------|
| 交互形态 | 纯 CLI，无 GUI | WebView 嵌套 IDE，架构重 | **原生 GUI + 多布局模式** |
| 多模型 | 模型逻辑散落各处，加新模型改多文件 | 三模型但 Gemini 默认禁用 | **Provider 抽象层 + 模型能力描述** |
| 上下文管理 | 被动压缩，无可视化 | 无 | **Token 实时可视化 + 智能压缩 + 快照恢复** |
| 权限控制 | 粗粒度 allowlist/denylist | 无 | **细粒度权限矩阵 + 审计日志** |
| 对话管理 | 线性历史 | 基础列表 | **全文搜索 + 标签分类 + 对话分支 + 多格式导出** |
| 模块集成 | 通用工具（文件/终端） | IDE 代码级集成 | **DevOps 深度集成（DB + SSH + Redis + Git）** |
| 执行审计 | 基础 | 无 | **完整链路追踪：谁→调什么→传什么→结果→耗时** |
| 对比能力 | 无 | 无 | **多模型同问对比** |
| 成本透明 | 显示 token 数 | 无 | **实时费用估算 + 用量统计面板** |

---

## 版本路线图

| 版本 | 目标 | 核心能力 | 差异化亮点 |
|------|------|---------|-----------|
| **V1** | 基础对话 | 流式对话 + 多模型 + 会话管理 | Provider 抽象层、模型能力描述、费用估算 |
| **V2** | 增强体验 | Thinking + 上下文管理 + 多模态 | 对话分支、全文搜索、上下文快照、多格式导出 |
| **V3** | 模块联动 | SQL/终端/Redis 深度集成 | 场景感知上下文、一键应用、多模型对比 |
| **V4** | 智能代理 | Tool Use + 工作流 + 审计 | 细粒度权限矩阵、执行审计、自动化编排 |

---

## V1: 基础对话 — 流式对话 + Provider 抽象 + 会话管理

### 目标
在 DevForge 中集成独立 AI 对话面板，通过 **Provider 抽象层** 统一管理多模型，实现 SSE 流式多轮对话。V1 的重点是**打好架构基础**，后续版本无需重构核心层。

### 核心功能

1. **Provider 抽象层**（超越竞品的核心设计）
   - 每个 Provider（OpenAI、Anthropic、DeepSeek、智普等）实现统一 trait
   - **模型能力描述系统**：每个模型声明支持的能力（vision、thinking、tool_use、streaming 等）
   - 前端根据模型能力动态显示可用功能（如不支持 vision 的模型隐藏图片按钮）
   - 添加新 Provider 只需实现一个 trait + 注册，不改已有代码

2. **AI 配置管理**
   - 设置页 Provider 管理面板（增删改 Provider 配置）
   - 预设常用 Provider（OpenAI、DeepSeek、智普、Moonshot 等）
   - 自定义 Provider（任意 OpenAI 兼容端点）
   - API Key 通过 keyring 加密存储

3. **流式对话**
   - Rust SSE 解析 + Tauri Channel 推送
   - 前端 50ms 节流批量 DOM 更新
   - 支持中断生成（AbortController）
   - 错误重试机制（网络超时自动重连）

4. **Markdown 渲染** — 消息支持 Markdown + 代码高亮 + 表格
5. **会话管理** — 新建/切换/删除/重命名，SQLite 持久化

6. **费用估算**（竞品都没做好）
   - 每条消息显示 token 用量
   - 会话累计费用估算（根据模型定价）
   - 使用统计面板（按天/周/月的 token 消耗）

### 技术实现

#### 后端（Rust）

**新建 `src-tauri/src/services/ai/mod.rs`** — AI 服务模块（目录结构）：
```
src-tauri/src/services/ai/
├── mod.rs              # 模块入口
├── provider.rs         # Provider trait 定义
├── openai_compat.rs    # OpenAI 兼容协议实现（覆盖 GPT/DeepSeek/智普/Moonshot）
├── anthropic.rs        # Anthropic 原生协议（Claude 直连，非代理场景）
├── stream_parser.rs    # SSE 流解析器
├── session_store.rs    # 会话持久化
└── models.rs           # 数据模型定义
```

**Provider trait 设计**：
```rust
// provider.rs
#[async_trait]
pub trait AiProvider: Send + Sync {
    /// Provider 标识
    fn id(&self) -> &str;
    
    /// 模型能力描述
    fn capabilities(&self) -> ModelCapabilities;
    
    /// 流式对话
    async fn chat_stream(
        &self,
        messages: Vec<AiMessage>,
        config: &ChatConfig,
        on_chunk: &Channel<AiStreamEvent>,
    ) -> Result<ChatResult, AppError>;
    
    /// 中断请求
    fn abort(&self);
}

pub struct ModelCapabilities {
    pub streaming: bool,
    pub vision: bool,         // 图片输入
    pub thinking: bool,       // 思考过程
    pub tool_use: bool,       // 工具调用
    pub max_context: u32,     // 最大上下文 tokens
    pub max_output: u32,      // 最大输出 tokens
    pub pricing: Option<ModelPricing>,  // 定价信息
}

pub struct ModelPricing {
    pub input_per_1m: f64,    // 每百万输入 token 价格（美元）
    pub output_per_1m: f64,   // 每百万输出 token 价格
    pub currency: String,     // 币种
}
```

**AiStreamEvent 统一事件**（比竞品更规范的事件设计）：
```rust
// models.rs
#[derive(Serialize)]
#[serde(tag = "type")]
pub enum AiStreamEvent {
    /// 文本增量
    TextDelta { delta: String },
    /// 思考过程增量（V2 预留）
    ThinkingDelta { delta: String },
    /// 工具调用（V4 预留）
    ToolCall { id: String, name: String, arguments: String },
    /// 用量统计
    Usage { prompt_tokens: u32, completion_tokens: u32 },
    /// 完成
    Done { finish_reason: String },
    /// 错误
    Error { message: String, retryable: bool },
}
```

**新建 `src-tauri/src/commands/ai.rs`** — 命令入口：
- `ai_chat_stream(session_id, messages, provider_id, model, on_event: Channel)` — 流式对话
- `ai_abort_stream(session_id)` — 中断生成
- `ai_list_providers()` — 获取已配置的 Provider 列表（含模型能力）
- `ai_save_provider(config)` / `ai_delete_provider(id)` — Provider CRUD
- `ai_save_session / ai_list_sessions / ai_get_session / ai_delete_session` — 会话 CRUD
- `ai_get_usage_stats(range)` — 用量统计

**SQLite 表设计**：
```sql
-- Provider 配置
CREATE TABLE ai_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL,    -- 'openai_compat' | 'anthropic'
    endpoint TEXT NOT NULL,
    models TEXT NOT NULL,           -- JSON array of model configs
    is_default INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
);

-- 会话
CREATE TABLE ai_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model TEXT NOT NULL,
    system_prompt TEXT,
    message_count INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    estimated_cost REAL DEFAULT 0,
    tags TEXT,                      -- JSON array，为 V2 搜索预留
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 消息
CREATE TABLE ai_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    content_type TEXT DEFAULT 'text',  -- 'text' | 'image' | 'tool_call' | 'tool_result'
    tokens INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    parent_id TEXT,                 -- 为 V2 对话分支预留
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_ai_msg_session ON ai_messages(session_id, created_at);

-- 用量统计（按天聚合）
CREATE TABLE ai_usage_daily (
    date TEXT NOT NULL,             -- YYYY-MM-DD
    provider_id TEXT NOT NULL,
    model TEXT NOT NULL,
    request_count INTEGER DEFAULT 0,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    estimated_cost REAL DEFAULT 0,
    PRIMARY KEY (date, provider_id, model)
);
```

#### 前端（Vue 3）

**新建 `src/types/ai.ts`**（重写扩展）：
```typescript
// Provider 配置
export interface AiProviderConfig {
  id: string
  name: string
  providerType: 'openai_compat' | 'anthropic'
  endpoint: string
  models: AiModelConfig[]
  isDefault: boolean
}

export interface AiModelConfig {
  id: string
  name: string
  capabilities: ModelCapabilities
}

export interface ModelCapabilities {
  streaming: boolean
  vision: boolean
  thinking: boolean
  toolUse: boolean
  maxContext: number
  maxOutput: number
  pricing?: { inputPer1m: number; outputPer1m: number; currency: string }
}

// 流式事件（tagged union）
export type AiStreamEvent =
  | { type: 'TextDelta'; delta: string }
  | { type: 'ThinkingDelta'; delta: string }
  | { type: 'ToolCall'; id: string; name: string; arguments: string }
  | { type: 'Usage'; promptTokens: number; completionTokens: number }
  | { type: 'Done'; finishReason: string }
  | { type: 'Error'; message: string; retryable: boolean }
```

**新建 `src/composables/useAiChat.ts`** — 对话核心：
- 消息列表、流式累积、50ms 节流
- 发送/停止/重试/重新生成
- 自动滚动到底部 + 用户手动滚动时暂停自动滚动
- 费用实时计算

**新建 `src/stores/ai-chat.ts`** — 会话 + Provider 状态管理

**新建 `src/views/AiChatView.vue`** — 主视图：
- **多布局模式**（超越竞品）：
  - 全屏模式：独立 Tab 页
  - 侧边栏模式：在任意模块右侧展开 AI 面板
  - 浮窗模式：可拖动的悬浮对话窗口
- 左侧会话列表（可折叠） + 右侧对话区
- 底部模型选择器 + 输入区

**新建 `src/components/ai/`**：
- `AiMessageBubble.vue` — Markdown + 代码高亮（shiki）+ 表格
- `AiCodeBlock.vue` — 代码块（复制、语言标签、行号）
- `AiInputArea.vue` — 多行输入（Shift+Enter 换行, Enter/Cmd+Enter 发送，可配置）
- `AiSessionList.vue` — 会话列表 + 快速搜索
- `AiProviderSelector.vue` — Provider + Model 级联选择器
- `AiUsageBadge.vue` — Token 用量 + 费用显示
- `AiSidebar.vue` — 侧边栏模式面板
- `AiFloatingWindow.vue` — 浮窗模式

**修改现有文件**：
- `src/types/workspace.ts` — TabType 增加 `'ai-chat'`
- `src/views/MainLayout.vue` — AiChatView 路由 + 侧边栏 AI 按钮
- `src/stores/settings.ts` — AI 配置项
- `src/stores/command-palette.ts` — AI 相关命令
- `src/locales/` — 国际化键值

### 验证
- 配置 DeepSeek / 智普，流式对话正常
- 添加自定义 Provider，验证 OpenAI 兼容
- 验证模型能力描述正确影响 UI（如非 vision 模型不显示图片按钮）
- 重启后会话 + Provider 配置持久化
- 验证三种布局模式切换
- 验证费用估算与实际 token 用量匹配

---

## V2: 增强体验 — Thinking + 上下文智能 + 对话分支

### 目标
打造**业界最佳的对话体验**：思考过程可视化、智能上下文管理、对话分支树、全文搜索、多格式导出。

### 核心功能

1. **思考过程展示**（Thinking/Reasoning）
   - 解析 Claude thinking blocks + DeepSeek reasoning_content
   - 可折叠展示，显示思考耗时
   - 思考过程不计入上下文（节省 token）

2. **智能上下文管理**（超越竞品的核心差异）
   - **Token 实时可视化**：进度条显示 已用/上限，分色预警
   - **上下文占用分析**：饼图显示每条消息的 token 占比
   - **自动压缩策略**：摘要/截断/滑动窗口，可配置阈值
   - **上下文快照**：保存当前上下文状态，随时恢复到某个快照

3. **对话分支**（竞品完全没有）
   - 任意消息处创建分支（"从这里开始另一个方向"）
   - 分支树可视化（简易树形展示）
   - 分支间对比查看

4. **全文搜索 + 高级筛选**
   - 跨会话全文搜索对话内容
   - 按 Provider/Model/日期/标签筛选
   - 搜索结果高亮 + 跳转到对应消息

5. **多格式导出**（竞品只有 JSON）
   - Markdown 导出（含代码块）
   - HTML 导出（可直接浏览器打开）
   - 复制为纯文本
   - 分享链接（可选，本地生成静态 HTML）

6. **图片输入** — Ctrl+V 粘贴 + 截图模块直发 + 文件拖拽
7. **消息操作** — 复制、编辑重发、重新生成、收藏
8. **System Prompt** — 内置预设 + 自定义 + 模板市场（本地）

### 技术实现

#### 后端
- `anthropic.rs` 完善 Claude 原生 API 支持（thinking blocks）
- SSE 解析扩展：DeepSeek `reasoning_content` 字段
- 新建 `token_estimator.rs`（中文/英文估算 + 可选 tiktoken-rs）
- 新增 `ai_compact_context`、`ai_search_messages`、`ai_export_session` 命令
- 消息表 `parent_id` 字段启用，支持分支树查询

#### 前端
- `AiThinkingBlock.vue` — 折叠/展开 + 耗时显示
- `AiContextPanel.vue` — Token 可视化 + 占用分析 + 快照管理
- `AiBranchTree.vue` — 对话分支树形展示
- `AiSearchDialog.vue` — 全文搜索 + 筛选面板
- `AiExportMenu.vue` — 多格式导出菜单
- `AiImageInput.vue` — 图片粘贴/拖拽/截图
- `AiMessageActions.vue` — 消息操作菜单
- `AiSystemPromptEditor.vue` — 预设 + 自定义 + 模板库

### 验证
- Claude/DeepSeek-R1 思考过程正确展示
- Token 可视化准确反映用量
- 自动压缩在阈值触发时正常工作
- 对话分支创建、切换、对比
- 全文搜索跨会话找到目标消息
- Markdown/HTML 导出内容完整

---

## V3: 模块联动 — DevOps 深度集成 + 多模型对比

### 目标
AI 与 DevForge 所有模块**深度融合**，提供场景感知的智能辅助。这是 DevForge 的核心竞争力 — 竞品只有通用工具，我们有 DevOps 领域知识。

### 核心功能

1. **SQL 智能助手**
   - 查询面板 "AI 优化" — 自动注入表结构 + EXPLAIN 结果作为上下文
   - 自然语言转 SQL（NL2SQL）— 描述需求，AI 生成 SQL
   - 索引建议 — 分析查询模式，推荐最优索引
   - SQL 错误诊断 — 报错后 AI 自动分析原因
   - **一键应用** — AI 建议的 SQL 直接替换到编辑器

2. **终端命令助手**
   - 命令建议 — 描述目标，AI 生成命令
   - 错误解释 — 终端报错后自动分析
   - 命令翻译 — 在不同 OS/Shell 间转换命令
   - **一键执行** — AI 建议的命令直接发送到终端

3. **Redis 助手**
   - 数据结构建议 — 根据使用场景推荐最佳数据类型
   - 命令生成 — 自然语言描述转 Redis 命令
   - 性能分析 — 解释 SLOWLOG 结果

4. **Git 助手**
   - Commit Message 生成 — 分析 diff 自动生成
   - 冲突解决建议
   - Git 操作指导

5. **多模型对比**（竞品完全没有）
   - 同一问题同时发给多个模型，并排展示回复
   - 对比维度：回复质量、速度、token 用量、费用
   - 帮助用户选择最佳模型

6. **场景感知上下文**
   - AI 对话时自动感知当前工作上下文（当前数据库、当前 SSH 连接、当前编辑的文件）
   - 无需用户手动粘贴上下文信息

7. **Prompt 模板引擎**
   - 内置模板（SQL 优化、命令建议、代码解释、错误诊断等）
   - 用户自定义模板 + 变量系统
   - 模板分类管理

### 技术实现

#### 后端
- 新建 `prompt_templates.rs`（模板引擎 + 变量替换 `{{sql}}`/`{{schema}}`/`{{error}}`）
- 新增场景化命令：`ai_optimize_sql`、`ai_nl2sql`、`ai_suggest_command`、`ai_explain_code`
- 新增 `ai_compare_models`（并行调用多个模型，聚合结果）
- 每个场景自动收集相关上下文（表结构、连接信息等）

#### 前端
- 新建 `AiInlinePanel.vue`（嵌入各模块的浮动面板）
- 新建 `AiApplyButton.vue`（一键应用到编辑器/终端）
- 新建 `AiCompareView.vue`（多模型对比面板）
- 新建 `AiPromptTemplateEditor.vue`（模板管理）
- 新建 `useAiAssist.ts`（场景化调用 + 上下文自动收集）
- 各模块增加 AI 按钮入口

### 验证
- 写慢 SQL → AI 优化 → 一键应用 → 验证性能提升
- 终端报错 → AI 解释 → 建议修复命令 → 一键执行
- 多模型对比：同一 SQL 优化问题发给 GPT-4o 和 DeepSeek，对比回复
- 自然语言 "查找最近7天活跃用户" → 生成正确 SQL

---

## V4: 智能代理 — Tool Use + 审计 + 自动化编排

### 目标
实现类 Claude Code 的 Tool Use 能力，但在**权限控制和执行审计**上全面超越。AI 可主动执行 DevForge 操作，形成可审计、可回溯的自动化工作流。

### 核心功能

1. **工具系统**
   - DevForge 内置工具集（映射到已有引擎）：
     - `execute_sql` → DbEngine
     - `run_command` → SshEngine / LocalShellEngine
     - `read_file` / `write_file` → SftpEngine
     - `redis_get` / `redis_set` → RedisEngine
     - `git_status` / `git_diff` → GitEngine
     - `describe_table` / `list_tables` — 元数据查询
     - `explain_query` — 执行计划分析
   - 工具通过 JSON Schema 自描述

2. **Function Calling** — 同时支持 OpenAI functions 和 Claude tool_use 协议

3. **细粒度权限矩阵**（核心差异化）
   - 工具分三级：`ReadOnly` / `ReadWrite` / `Dangerous`
   - **自动执行规则**：ReadOnly 工具自动执行，ReadWrite 需确认，Dangerous 需二次确认
   - **权限记忆**：用户可设置"始终允许此工具"/"始终拒绝"
   - **权限配置 UI**：矩阵面板，直观管理每个工具的权限

4. **执行审计系统**（竞品完全没有）
   - 记录每次工具调用：谁触发、什么工具、什么参数、执行结果、耗时
   - 审计日志可查询、可导出
   - 异常操作预警（如连续多次 DELETE/DROP）
   - 执行链路追踪：一个对话中的所有工具调用形成完整链路

5. **工具执行可视化**
   - 对话流中混合展示：文本 → 工具调用 → 执行结果 → AI 分析
   - SQL 结果：内嵌数据表格（复用已有 TanStack Table）
   - 命令结果：终端风格输出
   - 文件内容：代码高亮

6. **自动化工作流**
   - 预设工作流模板："诊断慢查询"、"服务器健康检查"、"数据库备份检查"
   - 工作流步骤可视化（进度条 + 步骤列表）
   - 用户可创建自定义工作流
   - 工作流执行可暂停/恢复/回滚

### 技术实现

#### 后端
- 新建 `ai_tools.rs`（工具注册、JSON Schema 生成、权限定义）
- 新建 `tool_executor.rs`（路由到对应 Engine，结果格式化）
- 新建 `audit_logger.rs`（审计日志记录 + 查询）
- 扩展 `ai_engine` 支持多轮 tool_use loop（AI 调工具 → 结果回传 → AI 继续推理）
- 新增 SQLite 表：`ai_audit_logs`、`ai_tool_permissions`、`ai_workflows`

#### 前端
- 新建 `AiToolCallMessage.vue`（工具调用展示 + 确认/拒绝按钮）
- 新建 `AiToolResultMessage.vue`（结果展示：表格/终端/代码）
- 新建 `AiPermissionDialog.vue`（权限确认 + "记住选择"）
- 新建 `AiPermissionMatrix.vue`（权限矩阵管理面板）
- 新建 `AiAuditLog.vue`（审计日志查看）
- 新建 `AiWorkflowPanel.vue`（工作流模板 + 步骤可视化）
- 新建 `useAiToolExecution.ts`（工具执行 + 权限检查 + 审计记录）

### 验证
- "查看 users 表前 10 条" → AI 调用 execute_sql → 表格展示结果
- "DROP TABLE" → 二次确认弹窗 → 拒绝后 AI 理解并调整方案
- 审计日志完整记录所有工具调用
- "诊断慢查询" 工作流自动执行 EXPLAIN → 分析 → 建议索引 → 确认创建
- 权限矩阵设置后影响后续自动执行行为

---

## 整体架构设计

### 数据流
```
用户输入 → Vue 前端 → invokeCommand (Tauri IPC)
→ Rust ai_command → Provider 抽象层 → 具体 Provider 实现
→ reqwest POST (stream: true) → LLM API
← SSE 流 (data: {...})
← stream_parser 解析 → AiStreamEvent
← Channel.send() → 前端 onmessage → 50ms 节流 → DOM 更新
                                   → audit_logger 记录
```

### Provider 抽象架构
```
                    ┌─────────────────┐
                    │  AiProvider Trait │
                    │  (统一接口)       │
                    └────────┬────────┘
            ┌────────────────┼────────────────┐
     ┌──────┴──────┐  ┌─────┴──────┐  ┌──────┴──────┐
     │ OpenAI 兼容  │  │ Anthropic  │  │  自定义扩展  │
     │ GPT/DS/ZP   │  │ Claude 直连 │  │ (未来)      │
     └─────────────┘  └────────────┘  └─────────────┘
```

### 安全设计
- **API Key**：keyring 加密存储，前端不接触，日志脱敏
- **网络请求**：全部在 Rust 后端执行，前端无法直接调用 LLM API
- **工具权限**：三级权限 + 用户确认 + 权限记忆
- **审计日志**：所有 AI 操作可追溯

### 依赖增量
- **Rust V1**：无新增 crate（reqwest stream 已有）
- **Rust V2**：可选 tiktoken-rs（精确 token 计算）
- **前端 V1**：增加 `shiki`（代码高亮），`marked`（Markdown）

---

## 关键文件总览

| 文件 | 版本 | 说明 |
|------|------|------|
| `src-tauri/src/services/ai/mod.rs` | V1 | AI 服务模块入口 |
| `src-tauri/src/services/ai/provider.rs` | V1 | Provider trait（核心抽象） |
| `src-tauri/src/services/ai/openai_compat.rs` | V1 | OpenAI 兼容实现 |
| `src-tauri/src/services/ai/anthropic.rs` | V1+V2 | Claude 原生实现 |
| `src-tauri/src/services/ai/stream_parser.rs` | V1 | SSE 流解析 |
| `src-tauri/src/services/ai/session_store.rs` | V1 | 会话持久化 |
| `src-tauri/src/services/ai/models.rs` | V1 | 数据模型 |
| `src-tauri/src/commands/ai.rs` | V1 | Tauri 命令 |
| `src/composables/useAiChat.ts` | V1 | 对话核心逻辑 |
| `src/views/AiChatView.vue` | V1 | 对话主视图 |
| `src/api/ai.ts` | V1 | API 封装 |
| `src/stores/ai-chat.ts` | V1 | 状态管理 |
| `src/components/ai/*.vue` | V1~V4 | UI 组件群 |
| `src-tauri/src/services/ai/token_estimator.rs` | V2 | Token 估算 |
| `src-tauri/src/services/ai/prompt_templates.rs` | V3 | 模板引擎 |
| `src-tauri/src/services/ai/ai_tools.rs` | V4 | 工具系统 |
| `src-tauri/src/services/ai/tool_executor.rs` | V4 | 工具执行 |
| `src-tauri/src/services/ai/audit_logger.rs` | V4 | 审计日志 |
