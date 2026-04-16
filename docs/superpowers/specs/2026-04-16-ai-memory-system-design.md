# DevForge Phase 2: 对话记忆系统 — 设计规格

> AI 对话上下文持久化、自动压缩、跨会话记忆、智能召回。

## 目标

为 DevForge AI 对话添加记忆能力：

1. **自动压缩**：对话 token 接近上下文窗口时，自动压缩早期消息为摘要
2. **知识库管理**：用户手动管理项目级知识条目，AI 对话时作为持久上下文
3. **智能召回**：新消息发送前，自动检索相关记忆注入 system prompt

## 架构决策

- **全前端记忆层**：压缩和召回在前端执行，Rust 后端仅提供 SQLite 存储 CRUD
- **按工作区隔离**：每个工作区根路径维护独立记忆库
- **召回策略分阶段**：Phase 1 关键词匹配，后期可扩展 Embedding 向量检索
- **借鉴 Claude Code**：两级压缩（轻量裁剪 → AI 摘要）、结构化压缩 prompt、熔断器

---

## 数据模型

### `ai_memories` 表

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| workspace_id | TEXT NOT NULL | 工作区根路径 hash（隔离依据） |
| type | TEXT NOT NULL | `summary`（自动摘要）/ `knowledge`（手动知识）/ `preference`（用户偏好） |
| title | TEXT | 简短标题（列表展示） |
| content | TEXT NOT NULL | 记忆正文 |
| tags | TEXT | 逗号分隔关键词（召回匹配用） |
| source_session_id | TEXT | 来源会话 ID（摘要类型） |
| weight | REAL DEFAULT 1.0 | 权重（召回排序，0~2） |
| embedding | BLOB | 预留 Embedding 向量（Phase 2 暂不使用） |
| last_used_at | INTEGER | 上次被召回的时间戳 |
| created_at | INTEGER NOT NULL | 创建时间 |
| updated_at | INTEGER NOT NULL | 更新时间 |

索引：`(workspace_id, type)`, `(workspace_id, tags)`

### `ai_compactions` 表

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| session_id | TEXT NOT NULL | 所属会话 |
| summary | TEXT NOT NULL | 压缩摘要内容 |
| original_count | INTEGER | 被压缩的消息数 |
| original_tokens | INTEGER | 被压缩的 token 数 |
| created_at | INTEGER NOT NULL | 压缩时间 |

---

## 自动压缩机制

### 触发条件

`useAiChat.send()` 收到 AI 回复完成后检查：

```
totalTokens >= maxContext × 90%
```

### 两级压缩

**Level 1 — 轻量裁剪**（无 API 调用）：
- 保留最近 10 轮对话，移除更早的消息
- 适用条件：被裁剪消息 token 总量 < maxContext 的 20%
- 裁剪后重新检测：若 totalTokens 仍 >= 90%，自动升级到 Level 2

**Level 2 — AI 摘要压缩**（Level 1 不够时）：
- 用结构化 prompt 把早期消息发给当前模型生成摘要
- 摘要作为 `role: system` 消息插入消息链头部，替换所有被压缩的旧消息
- 前缀："以下是本次对话早期内容的摘要："
- 摘要同时写入 `ai_compactions` 表
- 压缩时提取关键知识点存入 `ai_memories`（type = `summary`）

### 压缩规则（可配置）

默认规则模板，用户可在记忆设置面板中编辑（存储为 `ai_memories` type = `preference` 条目）：

```
- P0-必须保留: 进行中任务 + todo 列表 + 阻塞点 + 用户决策 + 当前分支 + 未提交变更
- P1-尽量保留: 修改过的文件路径清单（仅路径）、关键架构决策（一句话）、用户明确指示
- P2-立即丢弃: 所有工具调用的原始输出、文件完整内容、搜索结果、堆栈跟踪、已完成步骤详情、闲聊、重复信息
- 压缩比目标: 至少压缩到原文的 20%
```

### 熔断器

连续 3 次压缩失败后停止自动压缩，下次新对话重置。

### 用户感知

压缩进行时消息区顶部显示提示条："正在压缩对话上下文…"，完成后自动消失。

---

## 知识库管理

### 数据来源

1. **手动添加**：用户在记忆管理面板中 CRUD 知识条目
2. **自动提取**：Level 2 压缩时，AI 同时提取关键知识点存入（type = `summary`）

### 记忆管理面板

AI 对话顶栏新增「记忆」按钮（Brain 图标），打开侧边抽屉：

- **列表视图**：按 type 分组（知识 / 摘要 / 偏好），显示标题 + tags + 更新时间
- **搜索**：顶部搜索框，按 title/content/tags 模糊匹配
- **CRUD**：新增/编辑弹窗（标题、内容、tags、类型），删除确认
- **压缩规则编辑**：偏好类型中特殊条目「压缩规则」，多行文本编辑
- **权重调节**：滑块 0~2

### 工作区隔离

- `workspace_id` = 工作区根路径的 SHA-256 前 16 位 hex
- 面板只展示当前工作区的记忆
- 无工作区时使用 `_global` 作为 workspace_id
- 孤立记忆清理：记忆管理面板中提供「清理无效记忆」按钮，检测 workspace_id 对应的路径是否仍存在，不存在则提示用户删除

---

## 智能召回

### 触发时机

每次 `useAiChat.send()` 发送消息前。

### 召回流程（Phase 1: 关键词匹配）

1. 从用户输入提取关键词（按空格/标点拆分，去停用词）
2. 在当前 workspace 的 `ai_memories` 中匹配：
   - tags 包含关键词（精确匹配，权重高）
   - title/content 包含关键词（LIKE 模糊匹配，权重低）
3. 按 `weight × 匹配度 × 时间衰减因子` 排序
4. 取 Top 5 条

### 时间衰减

```
decay = 1 / (1 + daysSinceLastUsed × 0.05)
```

30 天未使用降至约 40%，不归零。被召回时更新 `last_used_at`。

### 注入格式

拼接到 system prompt 末尾：

```
【项目记忆】
- [知识] Vue 3 + TypeScript + Element Plus 前端架构
- [摘要] 上次讨论了登录页重构，决定用 JWT + 双 token 方案
- [偏好] 用户偏好 Composition API，不用 Options API
```

### Token 预算

召回内容总量限制在 maxContext 的 **5%**，超出按排序截断。

### Phase 2 预留（Embedding）

后期替换步骤 2 的匹配逻辑为向量相似度检索，其余流程不变。`ai_memories.embedding` 列已预留。

---

## 前端架构

### 新增文件

| 文件 | 职责 |
|---|---|
| `stores/ai-memory.ts` | Pinia store，记忆列表 CRUD + 召回逻辑 |
| `composables/useAutoCompact.ts` | 自动压缩 composable，Token 检测 + 两级压缩 + 熔断器 |
| `components/ai/AiMemoryDrawer.vue` | 记忆管理抽屉（列表/搜索/CRUD） |
| `components/ai/AiMemoryEditor.vue` | 记忆编辑弹窗 |
| `components/ai/AiCompactBanner.vue` | 压缩进行中提示条 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `composables/useAiChat.ts` | send() 前调用召回、send() 后调用压缩检测 |
| `views/AiChatView.vue` | 顶栏加记忆按钮、集成抽屉和压缩提示 |
| `types/ai.ts` | 新增 AiMemory、AiCompaction、CompactRule 类型 |

### Rust 新增命令（6 个）

| 命令 | 功能 |
|---|---|
| `ai_list_memories` | 按 workspace_id 查询记忆列表 |
| `ai_save_memory` | 新增/更新记忆（upsert） |
| `ai_delete_memory` | 删除记忆 |
| `ai_search_memories` | 按关键词搜索（tags + title + content LIKE） |
| `ai_save_compaction` | 保存压缩记录 |
| `ai_list_compactions` | 查询会话的压缩历史 |

### 数据流

```
用户输入
  │
  ├─ 1. 召回：ai_search_memories(workspace_id, keywords) → Top 5 → 注入 system prompt
  │
  ├─ 2. 发送：useAiChat.send()（现有流程不变）
  │
  └─ 3. 压缩检测：totalTokens >= maxContext × 90%？
       ├─ Level 1: 裁剪早期消息（纯前端，无 API）
       └─ Level 2: AI 摘要 → 替换旧消息 + 存 ai_compactions + 提取知识存 ai_memories
```
