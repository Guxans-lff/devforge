# AI 记忆系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 DevForge AI 对话添加自动压缩、知识库管理和智能召回能力。

**Architecture:** 全前端记忆层——Rust 后端仅提供 SQLite 存储 CRUD（新增 `ai_memories` + `ai_compactions` 两张表和 6 个 Tauri command），压缩和召回逻辑全部在前端 composable/store 中实现。自动压缩采用两级策略（轻量裁剪 → AI 摘要），智能召回采用关键词匹配（Phase 1）。

**Tech Stack:** Rust/SQLite (sqlx) · Vue 3 · TypeScript · Pinia · Tauri 2

**Spec:** `docs/superpowers/specs/2026-04-16-ai-memory-system-design.md`

---

## File Structure

### 新增文件

| 文件 | 职责 |
|---|---|
| `src-tauri/src/services/ai/memory_store.rs` | Rust：ai_memories + ai_compactions 表创建、CRUD SQL 函数 |
| `src-tauri/src/services/ai/memory_models.rs` | Rust：AiMemory / AiCompaction 结构体 + serde |
| `src/api/ai-memory.ts` | 前端 API 层：6 个 Tauri command 封装 |
| `src/stores/ai-memory.ts` | Pinia store：记忆列表 CRUD + 关键词召回 + workspace hash |
| `src/composables/useAutoCompact.ts` | 自动压缩 composable：Token 检测 + 两级压缩 + 熔断器 |
| `src/components/ai/AiMemoryDrawer.vue` | 记忆管理抽屉（列表/搜索/分组/CRUD） |
| `src/components/ai/AiMemoryEditor.vue` | 记忆编辑对话框（标题/内容/tags/类型/权重） |
| `src/components/ai/AiCompactBanner.vue` | 压缩进行中提示条 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `src-tauri/src/services/ai/mod.rs` | 注册 memory_store + memory_models 模块 |
| `src-tauri/src/services/ai/session_store.rs` | init_tables() 中追加 ai_memories + ai_compactions 建表迁移 |
| `src-tauri/src/commands/ai.rs` | 注册 6 个新 command |
| `src-tauri/src/main.rs` 或 `lib.rs` | invoke_handler 中追加新 command |
| `src/types/ai.ts` | 新增 AiMemory、AiCompaction、CompactRule 类型 |
| `src/composables/useAiChat.ts` | send() 前调用召回、send() 后调用压缩检测 |
| `src/views/AiChatView.vue` | 顶栏加记忆按钮、集成抽屉和压缩提示 |

---

## Task 1: 类型定义 + Rust 数据模型

**Files:**
- Modify: `src/types/ai.ts`
- Create: `src-tauri/src/services/ai/memory_models.rs`
- Modify: `src-tauri/src/services/ai/mod.rs`

- [ ] **Step 1: 前端类型定义**

在 `src/types/ai.ts` 文件末尾（`AiResult` 接口之后）追加：

```typescript
// ─────────────────────────────────── 记忆系统 ───────────────────────────────────

/** 记忆类型 */
export type MemoryType = 'summary' | 'knowledge' | 'preference'

/** 记忆条目 */
export interface AiMemory {
  id: string
  workspaceId: string
  type: MemoryType
  title: string
  content: string
  tags: string
  sourceSessionId?: string
  weight: number
  lastUsedAt?: number
  createdAt: number
  updatedAt: number
}

/** 压缩记录 */
export interface AiCompaction {
  id: string
  sessionId: string
  summary: string
  originalCount: number
  originalTokens: number
  createdAt: number
}

/** 压缩规则配置 */
export interface CompactRule {
  /** P0-必须保留的内容描述 */
  p0: string
  /** P1-尽量保留的内容描述 */
  p1: string
  /** P2-立即丢弃的内容描述 */
  p2: string
  /** 压缩比目标（如 0.2 表示压缩到 20%） */
  ratio: number
}
```

- [ ] **Step 2: Rust 数据模型**

创建 `src-tauri/src/services/ai/memory_models.rs`：

```rust
//! 记忆系统数据模型

use serde::{Deserialize, Serialize};

/// 记忆条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMemory {
    pub id: String,
    pub workspace_id: String,
    #[serde(rename = "type")]
    pub memory_type: String,
    pub title: String,
    pub content: String,
    pub tags: String,
    pub source_session_id: Option<String>,
    pub weight: f64,
    pub last_used_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 压缩记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiCompaction {
    pub id: String,
    pub session_id: String,
    pub summary: String,
    pub original_count: i64,
    pub original_tokens: i64,
    pub created_at: i64,
}
```

- [ ] **Step 3: 注册模块**

在 `src-tauri/src/services/ai/mod.rs` 中追加：

```rust
pub mod memory_models;
pub mod memory_store;
```

- [ ] **Step 4: 提交**

```bash
git add src/types/ai.ts src-tauri/src/services/ai/memory_models.rs src-tauri/src/services/ai/mod.rs
git commit -m "feat(ai-memory): 新增记忆系统类型定义（前端 + Rust）"
```

---

## Task 2: Rust SQLite 存储层

**Files:**
- Create: `src-tauri/src/services/ai/memory_store.rs`
- Modify: `src-tauri/src/services/ai/session_store.rs`

- [ ] **Step 1: 建表迁移**

在 `src-tauri/src/services/ai/session_store.rs` 的 `init_tables()` 函数末尾（`ALTER TABLE ai_sessions ADD COLUMN work_dir` 之后）追加：

```rust
    // 迁移：创建 ai_memories 表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS ai_memories (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            type TEXT NOT NULL,
            title TEXT DEFAULT '',
            content TEXT NOT NULL,
            tags TEXT DEFAULT '',
            source_session_id TEXT,
            weight REAL DEFAULT 1.0,
            embedding BLOB,
            last_used_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("创建 ai_memories 表失败: {e}")))?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_ai_mem_ws_type ON ai_memories(workspace_id, type)")
        .execute(pool).await.ok();
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_ai_mem_ws_tags ON ai_memories(workspace_id, tags)")
        .execute(pool).await.ok();

    // 迁移：创建 ai_compactions 表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS ai_compactions (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            summary TEXT NOT NULL,
            original_count INTEGER DEFAULT 0,
            original_tokens INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("创建 ai_compactions 表失败: {e}")))?;
```

- [ ] **Step 2: memory_store CRUD 函数**

创建 `src-tauri/src/services/ai/memory_store.rs`：

```rust
//! 记忆系统存储操作

use super::memory_models::{AiCompaction, AiMemory};
use crate::utils::error::AppError;
use sqlx::SqlitePool;

/// 按 workspace_id 查询记忆列表
pub async fn list_memories(pool: &SqlitePool, workspace_id: &str) -> Result<Vec<AiMemory>, AppError> {
    let rows = sqlx::query_as::<_, (String, String, String, String, String, String, Option<String>, f64, Option<i64>, i64, i64)>(
        "SELECT id, workspace_id, type, title, content, tags, source_session_id, weight, last_used_at, created_at, updated_at FROM ai_memories WHERE workspace_id = ? ORDER BY updated_at DESC"
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("查询记忆列表失败: {e}")))?;

    Ok(rows.into_iter().map(|r| AiMemory {
        id: r.0, workspace_id: r.1, memory_type: r.2, title: r.3,
        content: r.4, tags: r.5, source_session_id: r.6, weight: r.7,
        last_used_at: r.8, created_at: r.9, updated_at: r.10,
    }).collect())
}

/// 保存记忆（upsert）
pub async fn save_memory(pool: &SqlitePool, memory: &AiMemory) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT OR REPLACE INTO ai_memories
           (id, workspace_id, type, title, content, tags, source_session_id, weight, last_used_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&memory.id)
    .bind(&memory.workspace_id)
    .bind(&memory.memory_type)
    .bind(&memory.title)
    .bind(&memory.content)
    .bind(&memory.tags)
    .bind(&memory.source_session_id)
    .bind(memory.weight)
    .bind(memory.last_used_at)
    .bind(memory.created_at)
    .bind(memory.updated_at)
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("保存记忆失败: {e}")))?;
    Ok(())
}

/// 删除记忆
pub async fn delete_memory(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM ai_memories WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| AppError::Other(format!("删除记忆失败: {e}")))?;
    Ok(())
}

/// 按关键词搜索记忆（tags 精确 + title/content 模糊）
pub async fn search_memories(
    pool: &SqlitePool,
    workspace_id: &str,
    keywords: &[String],
) -> Result<Vec<AiMemory>, AppError> {
    if keywords.is_empty() {
        return list_memories(pool, workspace_id).await;
    }

    // 全量加载后在 Rust 侧过滤（避免动态 SQL 拼接注入风险，记忆条目数量有限）
    let all = list_memories(pool, workspace_id).await?;
    let keywords_lower: Vec<String> = keywords.iter().map(|k| k.to_lowercase()).collect();

    let mut matched: Vec<AiMemory> = all
        .into_iter()
        .filter(|m| {
            keywords_lower.iter().any(|kw| {
                m.tags.to_lowercase().contains(kw)
                    || m.title.to_lowercase().contains(kw)
                    || m.content.to_lowercase().contains(kw)
            })
        })
        .collect();

    // 按 weight 降序排列
    matched.sort_by(|a, b| b.weight.partial_cmp(&a.weight).unwrap_or(std::cmp::Ordering::Equal));
    matched.truncate(20);

    return Ok(matched);

    Ok(rows.into_iter().map(|r| AiMemory {
        id: r.0, workspace_id: r.1, memory_type: r.2, title: r.3,
        content: r.4, tags: r.5, source_session_id: r.6, weight: r.7,
        last_used_at: r.8, created_at: r.9, updated_at: r.10,
    }).collect())
}

/// 保存压缩记录
pub async fn save_compaction(pool: &SqlitePool, compaction: &AiCompaction) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT INTO ai_compactions (id, session_id, summary, original_count, original_tokens, created_at)
           VALUES (?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&compaction.id)
    .bind(&compaction.session_id)
    .bind(&compaction.summary)
    .bind(compaction.original_count)
    .bind(compaction.original_tokens)
    .bind(compaction.created_at)
    .execute(pool)
    .await
    .map_err(|e| AppError::Other(format!("保存压缩记录失败: {e}")))?;
    Ok(())
}

/// 查询会话的压缩历史
pub async fn list_compactions(pool: &SqlitePool, session_id: &str) -> Result<Vec<AiCompaction>, AppError> {
    let rows = sqlx::query_as::<_, (String, String, String, i64, i64, i64)>(
        "SELECT id, session_id, summary, original_count, original_tokens, created_at FROM ai_compactions WHERE session_id = ? ORDER BY created_at DESC"
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Other(format!("查询压缩历史失败: {e}")))?;

    Ok(rows.into_iter().map(|r| AiCompaction {
        id: r.0, session_id: r.1, summary: r.2,
        original_count: r.3, original_tokens: r.4, created_at: r.5,
    }).collect())
}
```

- [ ] **Step 3: 验证编译**

```bash
cd src-tauri && cargo check
```

Expected: 编译通过（warning 可接受，error 不可）

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/services/ai/memory_store.rs src-tauri/src/services/ai/session_store.rs
git commit -m "feat(ai-memory): 新增记忆系统 SQLite 存储层（两表 + CRUD）"
```

---

## Task 3: Tauri Command 注册

**Files:**
- Modify: `src-tauri/src/commands/ai.rs`
- Modify: `src-tauri/src/lib.rs` 或 `main.rs`（command 注册入口）

- [ ] **Step 1: 新增 6 个 command**

在 `src-tauri/src/commands/ai.rs` 末尾追加：

```rust
use crate::services::ai::memory_models::{AiCompaction, AiMemory};
use crate::services::ai::memory_store;

#[tauri::command]
pub async fn ai_list_memories(
    storage: State<'_, Arc<Storage>>,
    workspace_id: String,
) -> Result<Vec<AiMemory>, AppError> {
    let pool = storage.get_pool().await;
    memory_store::list_memories(&pool, &workspace_id).await
}

#[tauri::command]
pub async fn ai_save_memory(
    storage: State<'_, Arc<Storage>>,
    memory: AiMemory,
) -> Result<(), AppError> {
    let pool = storage.get_pool().await;
    memory_store::save_memory(&pool, &memory).await
}

#[tauri::command]
pub async fn ai_delete_memory(
    storage: State<'_, Arc<Storage>>,
    id: String,
) -> Result<(), AppError> {
    let pool = storage.get_pool().await;
    memory_store::delete_memory(&pool, &id).await
}

#[tauri::command]
pub async fn ai_search_memories(
    storage: State<'_, Arc<Storage>>,
    workspace_id: String,
    keywords: Vec<String>,
) -> Result<Vec<AiMemory>, AppError> {
    let pool = storage.get_pool().await;
    memory_store::search_memories(&pool, &workspace_id, &keywords).await
}

#[tauri::command]
pub async fn ai_save_compaction(
    storage: State<'_, Arc<Storage>>,
    compaction: AiCompaction,
) -> Result<(), AppError> {
    let pool = storage.get_pool().await;
    memory_store::save_compaction(&pool, &compaction).await
}

#[tauri::command]
pub async fn ai_list_compactions(
    storage: State<'_, Arc<Storage>>,
    session_id: String,
) -> Result<Vec<AiCompaction>, AppError> {
    let pool = storage.get_pool().await;
    memory_store::list_compactions(&pool, &session_id).await
}
```

- [ ] **Step 2: 注册到 invoke_handler**

找到 `src-tauri/src/lib.rs` 或 `main.rs` 中的 `invoke_handler(tauri::generate_handler![...])` 宏调用，追加 6 个新 command：

```rust
ai::ai_list_memories,
ai::ai_save_memory,
ai::ai_delete_memory,
ai::ai_search_memories,
ai::ai_save_compaction,
ai::ai_list_compactions,
```

- [ ] **Step 3: 验证编译**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/commands/ai.rs src-tauri/src/lib.rs
git commit -m "feat(ai-memory): 注册 6 个记忆系统 Tauri command"
```

---

## Task 4: 前端 API 层

**Files:**
- Create: `src/api/ai-memory.ts`

- [ ] **Step 1: 创建 API 封装**

创建 `src/api/ai-memory.ts`：

```typescript
/**
 * AI 记忆系统 API 层
 *
 * 封装记忆和压缩相关的 Tauri 命令调用。
 */

import { invokeCommand } from '@/api/base'
import type { AiMemory, AiCompaction } from '@/types/ai'

/** 按工作区查询记忆列表 */
export function aiListMemories(workspaceId: string): Promise<AiMemory[]> {
  return invokeCommand('ai_list_memories', { workspaceId }, { source: 'AI' })
}

/** 保存记忆（新增或更新） */
export function aiSaveMemory(memory: AiMemory): Promise<void> {
  return invokeCommand('ai_save_memory', { memory }, { source: 'AI' })
}

/** 删除记忆 */
export function aiDeleteMemory(id: string): Promise<void> {
  return invokeCommand('ai_delete_memory', { id }, { source: 'AI' })
}

/** 按关键词搜索记忆 */
export function aiSearchMemories(workspaceId: string, keywords: string[]): Promise<AiMemory[]> {
  return invokeCommand('ai_search_memories', { workspaceId, keywords }, { source: 'AI' })
}

/** 保存压缩记录 */
export function aiSaveCompaction(compaction: AiCompaction): Promise<void> {
  return invokeCommand('ai_save_compaction', { compaction }, { source: 'AI' })
}

/** 查询会话的压缩历史 */
export function aiListCompactions(sessionId: string): Promise<AiCompaction[]> {
  return invokeCommand('ai_list_compactions', { sessionId }, { source: 'AI' })
}
```

- [ ] **Step 2: 提交**

```bash
git add src/api/ai-memory.ts
git commit -m "feat(ai-memory): 新增前端 API 层（6 个 Tauri command 封装）"
```

---

## Task 5: Pinia 记忆 Store

**Files:**
- Create: `src/stores/ai-memory.ts`

- [ ] **Step 1: 创建 store**

创建 `src/stores/ai-memory.ts`：

```typescript
/**
 * AI 记忆 Pinia Store
 *
 * 管理记忆列表 CRUD、workspace hash 计算、关键词召回。
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { aiListMemories, aiSaveMemory, aiDeleteMemory, aiSearchMemories } from '@/api/ai-memory'
import type { AiMemory, MemoryType, CompactRule } from '@/types/ai'

/** 默认压缩规则 */
const DEFAULT_COMPACT_RULE: CompactRule = {
  p0: '进行中任务 + todo 列表 + 阻塞点 + 用户决策 + 当前分支 + 未提交变更',
  p1: '修改过的文件路径清单（仅路径）、关键架构决策（一句话）、用户明确指示',
  p2: '所有工具调用的原始输出、文件完整内容、搜索结果、堆栈跟踪、已完成步骤详情、闲聊、重复信息',
  ratio: 0.2,
}

/** 中文停用词（召回时过滤） */
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '他', '她', '它', '们', '那', '些', '什么', '怎么', '如何', '可以',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'to', 'of', 'in', 'for', 'on', 'with',
  'at', 'by', 'from', 'this', 'that', 'it', 'and', 'or', 'not', 'no',
])

/**
 * 计算 workspace hash（SHA-256 前 16 位 hex）
 *
 * 使用 Web Crypto API，异步计算。
 */
async function computeWorkspaceId(rootPath: string): Promise<string> {
  const normalized = rootPath.replace(/\\/g, '/').toLowerCase()
  const data = new TextEncoder().encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 从文本中提取关键词
 *
 * 按空格/标点拆分，去停用词，去重，限制数量。
 */
function extractKeywords(text: string, maxCount = 10): string[] {
  const words = text
    .toLowerCase()
    .split(/[\s,，。！？；：、""''（）【】《》\-+*/=<>{}[\]()#@!?.;:'"]+/)
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w))

  return [...new Set(words)].slice(0, maxCount)
}

/**
 * 时间衰减因子
 *
 * decay = 1 / (1 + daysSinceLastUsed × 0.05)
 */
function decayFactor(lastUsedAt: number | undefined): number {
  if (!lastUsedAt) return 0.5 // 从未使用过给 0.5 基础分
  const days = (Date.now() - lastUsedAt) / (1000 * 60 * 60 * 24)
  return 1 / (1 + days * 0.05)
}

export const useAiMemoryStore = defineStore('ai-memory', () => {
  const memories = ref<AiMemory[]>([])
  const currentWorkspaceId = ref<string>('_global')
  const isLoading = ref(false)

  /** 按类型分组 */
  const memoriesByType = computed(() => {
    const groups: Record<MemoryType, AiMemory[]> = {
      knowledge: [],
      summary: [],
      preference: [],
    }
    for (const m of memories.value) {
      const type = m.type as MemoryType
      if (groups[type]) groups[type].push(m)
    }
    return groups
  })

  /** 获取当前压缩规则（从 preference 类型记忆中读取） */
  const compactRule = computed<CompactRule>(() => {
    const pref = memories.value.find(
      m => m.type === 'preference' && m.title === '压缩规则',
    )
    if (pref) {
      try {
        return JSON.parse(pref.content) as CompactRule
      } catch { /* 解析失败用默认 */ }
    }
    return DEFAULT_COMPACT_RULE
  })

  /** 设置当前工作区并加载记忆 */
  async function setWorkspace(rootPath: string | null): Promise<void> {
    if (!rootPath) {
      currentWorkspaceId.value = '_global'
    } else {
      currentWorkspaceId.value = await computeWorkspaceId(rootPath)
    }
    await loadMemories()
  }

  /** 加载当前工作区的记忆 */
  async function loadMemories(): Promise<void> {
    isLoading.value = true
    try {
      memories.value = await aiListMemories(currentWorkspaceId.value)
    } catch (e) {
      console.error('[AI Memory] 加载记忆失败:', e)
    } finally {
      isLoading.value = false
    }
  }

  /** 保存记忆 */
  async function saveMemory(memory: AiMemory): Promise<void> {
    await aiSaveMemory(memory)
    // 乐观更新
    const idx = memories.value.findIndex(m => m.id === memory.id)
    if (idx >= 0) {
      memories.value = memories.value.map((m, i) => i === idx ? memory : m)
    } else {
      memories.value = [memory, ...memories.value]
    }
  }

  /** 删除记忆 */
  async function deleteMemory(id: string): Promise<void> {
    await aiDeleteMemory(id)
    memories.value = memories.value.filter(m => m.id !== id)
  }

  /** 保存压缩规则 */
  async function saveCompactRule(rule: CompactRule): Promise<void> {
    const existing = memories.value.find(
      m => m.type === 'preference' && m.title === '压缩规则',
    )
    const now = Date.now()
    const memory: AiMemory = {
      id: existing?.id ?? `pref-compact-rule-${now}`,
      workspaceId: currentWorkspaceId.value,
      type: 'preference',
      title: '压缩规则',
      content: JSON.stringify(rule),
      tags: '压缩,规则,compact',
      weight: 1.0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await saveMemory(memory)
  }

  /**
   * 智能召回：按用户输入检索相关记忆
   *
   * @param userInput 用户输入文本
   * @param maxTokenBudget 召回 token 预算
   * @returns 格式化后的记忆注入文本
   */
  async function recall(userInput: string, maxTokenBudget: number): Promise<string> {
    const keywords = extractKeywords(userInput)
    if (keywords.length === 0) return ''

    try {
      const results = await aiSearchMemories(currentWorkspaceId.value, keywords)
      if (results.length === 0) return ''

      // 计算综合得分并排序
      const scored = results.map(m => {
        const tagWords = m.tags.split(',').map(t => t.trim().toLowerCase())
        // tags 精确匹配得 2 分，title/content 模糊匹配得 1 分
        let matchScore = 0
        for (const kw of keywords) {
          if (tagWords.includes(kw)) matchScore += 2
          else if (m.title.toLowerCase().includes(kw) || m.content.toLowerCase().includes(kw)) matchScore += 1
        }
        const decay = decayFactor(m.lastUsedAt)
        return { memory: m, score: m.weight * matchScore * decay }
      })
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)

      if (scored.length === 0) return ''

      // 格式化输出，控制 token 预算（粗略：4 字符 ≈ 1 token）
      const typeLabel: Record<string, string> = {
        knowledge: '知识',
        summary: '摘要',
        preference: '偏好',
      }
      let output = '【项目记忆】\n'
      let tokenCount = 10 // 标题开销

      for (const { memory: m } of scored) {
        const line = `- [${typeLabel[m.type] ?? m.type}] ${m.title}: ${m.content}\n`
        const lineTokens = Math.ceil(line.length / 4)
        if (tokenCount + lineTokens > maxTokenBudget) break
        output += line
        tokenCount += lineTokens

        // 更新 last_used_at（fire and forget）
        aiSaveMemory({ ...m, lastUsedAt: Date.now() }).catch(() => {})
      }

      return output
    } catch (e) {
      console.warn('[AI Memory] 召回失败:', e)
      return ''
    }
  }

  return {
    memories,
    memoriesByType,
    currentWorkspaceId,
    isLoading,
    compactRule,
    setWorkspace,
    loadMemories,
    saveMemory,
    deleteMemory,
    saveCompactRule,
    recall,
  }
})

export { DEFAULT_COMPACT_RULE, extractKeywords, computeWorkspaceId }
```

- [ ] **Step 2: 提交**

```bash
git add src/stores/ai-memory.ts
git commit -m "feat(ai-memory): 新增 Pinia 记忆 store（CRUD + 召回 + workspace hash）"
```

---

## Task 6: 自动压缩 Composable

**Files:**
- Create: `src/composables/useAutoCompact.ts`

- [ ] **Step 1: 创建 composable**

创建 `src/composables/useAutoCompact.ts`：

```typescript
/**
 * 自动压缩 composable
 *
 * 检测对话 token 是否接近上下文上限（90%），
 * 触发两级压缩：轻量裁剪 → AI 摘要。
 * 含熔断器（连续 3 次失败停止）。
 */

import { ref } from 'vue'
import { useAiMemoryStore } from '@/stores/ai-memory'
import { aiSaveCompaction } from '@/api/ai-memory'
import { aiChatStream } from '@/api/ai'
import type { AiMessage, AiMemory, AiStreamEvent, ProviderConfig, ModelConfig, CompactRule, AiCompaction } from '@/types/ai'

/** 压缩阈值：maxContext 的 90% */
const COMPACT_THRESHOLD = 0.9
/** Level 1 适用条件：被裁剪 token < 20% */
const LEVEL1_MAX_RATIO = 0.2
/** 保留最近 N 轮对话（user+assistant = 1 轮） */
const KEEP_RECENT_ROUNDS = 10
/** 熔断器上限 */
const MAX_FAILURES = 3

function genId(): string {
  return `compact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 构建压缩 prompt
 */
function buildCompactPrompt(messages: AiMessage[], rule: CompactRule): string {
  const conversation = messages
    .filter(m => m.role !== 'error')
    .map(m => `[${m.role}]: ${m.content.slice(0, 2000)}`)
    .join('\n\n')

  return `你是一个对话压缩助手。请将以下对话历史压缩为结构化摘要。

## 压缩规则

**P0-必须保留:** ${rule.p0}
**P1-尽量保留:** ${rule.p1}
**P2-立即丢弃:** ${rule.p2}
**压缩比目标:** 压缩到原文的 ${Math.round(rule.ratio * 100)}%

## 对话历史

${conversation}

## 输出要求

直接输出压缩摘要，不要解释你的压缩过程。摘要应包含所有 P0 内容和尽量多的 P1 内容。以"以下是本次对话早期内容的摘要："开头。`
}

export function useAutoCompact() {
  const isCompacting = ref(false)
  const consecutiveFailures = ref(0)
  const memoryStore = useAiMemoryStore()

  /**
   * 检测并执行自动压缩
   *
   * @param messages 当前消息列表 ref（会被直接修改）
   * @param totalTokens 当前总 token 数
   * @param maxContext 模型最大上下文
   * @param sessionId 当前会话 ID
   * @param provider Provider 配置
   * @param model 模型配置
   * @param apiKey API Key
   * @returns 压缩后的消息列表（如果执行了压缩），或 null（未触发/失败）
   */
  async function checkAndCompact(
    messages: AiMessage[],
    totalTokens: number,
    maxContext: number,
    sessionId: string,
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
  ): Promise<AiMessage[] | null> {
    // 熔断器检查
    if (consecutiveFailures.value >= MAX_FAILURES) return null

    // 阈值检查
    if (totalTokens < maxContext * COMPACT_THRESHOLD) return null

    // 消息太少不压缩
    const nonErrorMsgs = messages.filter(m => m.role !== 'error')
    if (nonErrorMsgs.length <= KEEP_RECENT_ROUNDS * 2) return null

    isCompacting.value = true

    try {
      // ── Level 1: 轻量裁剪 ──
      const keepCount = KEEP_RECENT_ROUNDS * 2 // user + assistant 各一条算一轮
      const toRemove = nonErrorMsgs.slice(0, nonErrorMsgs.length - keepCount)
      const removedTokens = toRemove.reduce((sum, m) => sum + (m.tokens ?? 0), 0)

      if (removedTokens < maxContext * LEVEL1_MAX_RATIO) {
        // Level 1 够用：直接裁剪
        const kept = messages.slice(messages.length - keepCount)
        const newTotal = kept.reduce((sum, m) => sum + (m.tokens ?? 0), 0)

        // 裁剪后仍超阈值？升级 Level 2
        if (newTotal >= maxContext * COMPACT_THRESHOLD) {
          return await level2Compact(messages, sessionId, provider, model, apiKey)
        }

        consecutiveFailures.value = 0
        return kept
      }

      // ── Level 2: AI 摘要压缩 ──
      return await level2Compact(messages, sessionId, provider, model, apiKey)
    } catch (e) {
      consecutiveFailures.value++
      console.error('[AutoCompact] 压缩失败:', e)
      return null
    } finally {
      isCompacting.value = false
    }
  }

  /**
   * Level 2 压缩：调用 AI 生成摘要
   */
  async function level2Compact(
    messages: AiMessage[],
    sessionId: string,
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
  ): Promise<AiMessage[] | null> {
    const nonErrorMsgs = messages.filter(m => m.role !== 'error')
    const keepCount = KEEP_RECENT_ROUNDS * 2
    const toCompress = nonErrorMsgs.slice(0, nonErrorMsgs.length - keepCount)
    const toKeep = messages.slice(messages.length - keepCount)

    if (toCompress.length === 0) return null

    const rule = memoryStore.compactRule
    const prompt = buildCompactPrompt(toCompress, rule)

    // 调用 AI 生成摘要（非流式收集完整结果）
    let summary = ''
    await aiChatStream(
      {
        sessionId: `compact-${sessionId}`,
        messages: [{ role: 'user', content: prompt }],
        providerType: provider.providerType,
        model: model.id,
        apiKey,
        endpoint: provider.endpoint,
        maxTokens: Math.min(model.capabilities.maxOutput, 4096),
        systemPrompt: '你是一个专业的对话压缩助手，严格按照规则压缩对话内容。',
      },
      (event: AiStreamEvent) => {
        if (event.type === 'TextDelta') summary += event.delta
      },
    )

    if (!summary.trim()) {
      throw new Error('AI 返回空摘要')
    }

    // 保存压缩记录
    const compressedTokens = toCompress.reduce((sum, m) => sum + (m.tokens ?? 0), 0)
    const compaction: AiCompaction = {
      id: genId(),
      sessionId,
      summary,
      originalCount: toCompress.length,
      originalTokens: compressedTokens,
      createdAt: Date.now(),
    }
    aiSaveCompaction(compaction).catch(e => console.warn('[AutoCompact] 保存压缩记录失败:', e))

    // 从摘要中提取关键知识点存入记忆库
    const memoryStore = useAiMemoryStore()
    const knowledgeMemory: AiMemory = {
      id: `mem-summary-${Date.now()}`,
      workspaceId: memoryStore.currentWorkspaceId,
      type: 'summary',
      title: `对话摘要 (${new Date().toLocaleDateString()})`,
      content: summary.slice(0, 2000), // 限制长度
      tags: '自动摘要,压缩',
      sourceSessionId: sessionId,
      weight: 0.8,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    memoryStore.saveMemory(knowledgeMemory).catch(e => console.warn('[AutoCompact] 保存摘要记忆失败:', e))

    // 构建摘要消息
    const summaryMsg: AiMessage = {
      id: genId(),
      role: 'system',
      content: summary,
      timestamp: Date.now(),
    }

    consecutiveFailures.value = 0
    return [summaryMsg, ...toKeep]
  }

  /** 重置熔断器（新对话时调用） */
  function resetCircuitBreaker(): void {
    consecutiveFailures.value = 0
  }

  return {
    isCompacting,
    consecutiveFailures,
    checkAndCompact,
    resetCircuitBreaker,
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/composables/useAutoCompact.ts
git commit -m "feat(ai-memory): 新增自动压缩 composable（两级压缩 + 熔断器）"
```

---

## Task 7: useAiChat 集成召回和压缩

**Files:**
- Modify: `src/composables/useAiChat.ts`

- [ ] **Step 1: 导入依赖**

在 `useAiChat.ts` 顶部 import 区追加：

```typescript
import { useAiMemoryStore } from '@/stores/ai-memory'
import { useAutoCompact } from '@/composables/useAutoCompact'
```

- [ ] **Step 2: 在 useAiChat 函数体内初始化**

在 `const aiStore = useAiChatStore()` 之后追加：

```typescript
  const memoryStore = useAiMemoryStore()
  const autoCompact = useAutoCompact()
```

- [ ] **Step 3: send() 前插入召回逻辑**

在 `send()` 函数中，`const enableTools = ...` 行之前插入：

```typescript
    // 智能召回：检索相关记忆注入 system prompt
    let enrichedSystemPrompt = systemPrompt
    if (memoryStore.currentWorkspaceId !== '_global') {
      const tokenBudget = Math.floor(model.capabilities.maxContext * 0.05)
      const recalled = await memoryStore.recall(content, tokenBudget)
      if (recalled) {
        enrichedSystemPrompt = (systemPrompt ?? '') + '\n\n' + recalled
      }
    }
```

然后将后续所有使用 `systemPrompt` 参数的地方改为 `enrichedSystemPrompt`：
- `streamWithToolLoop(sid, chatMessages, provider, model, apiKey, enrichedSystemPrompt, enableTools)`
- 会话保存中的 `systemPrompt` 字段保持原值（不含召回内容）

- [ ] **Step 4: send() 后插入压缩检测**

在 `send()` 函数的 `finally` 块中，`aiStore.saveSession(session)` 之后追加：

```typescript
      // 自动压缩检测
      if (model.capabilities.maxContext > 0) {
        const compacted = await autoCompact.checkAndCompact(
          messages.value,
          totalTokens.value,
          model.capabilities.maxContext,
          sid,
          provider,
          model,
          apiKey,
        )
        if (compacted) {
          messages.value = compacted
        }
      }
```

- [ ] **Step 5: clearMessages 中重置熔断器**

在 `clearMessages()` 函数末尾追加：

```typescript
    autoCompact.resetCircuitBreaker()
```

- [ ] **Step 6: 导出 autoCompact 状态**

在 return 对象中追加：

```typescript
    /** 自动压缩状态 */
    isCompacting: autoCompact.isCompacting,
```

- [ ] **Step 7: 验证 TypeScript 编译**

```bash
cd D:\Project\DevForge\devforge && npx vue-tsc --noEmit
```

- [ ] **Step 8: 提交**

```bash
git add src/composables/useAiChat.ts
git commit -m "feat(ai-memory): useAiChat 集成智能召回 + 自动压缩"
```

---

## Task 8: AiCompactBanner 组件

**Files:**
- Create: `src/components/ai/AiCompactBanner.vue`

- [ ] **Step 1: 创建组件**

```vue
<script setup lang="ts">
/**
 * 压缩进行中提示条
 *
 * 显示在消息区顶部，压缩完成后自动消失。
 */
import { Loader2 } from 'lucide-vue-next'

defineProps<{
  visible: boolean
}>()
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-300 ease-out"
    enter-from-class="opacity-0 -translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition-all duration-200 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 -translate-y-2"
  >
    <div
      v-if="visible"
      class="mx-auto max-w-4xl px-5 py-2"
    >
      <div class="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2">
        <Loader2 class="h-3.5 w-3.5 animate-spin text-amber-500" />
        <span class="text-xs text-amber-600 dark:text-amber-400">正在压缩对话上下文…</span>
      </div>
    </div>
  </Transition>
</template>
```

- [ ] **Step 2: 提交**

```bash
git add src/components/ai/AiCompactBanner.vue
git commit -m "feat(ai-memory): 新增 AiCompactBanner 压缩提示组件"
```

---

## Task 9: AiMemoryEditor 组件

**Files:**
- Create: `src/components/ai/AiMemoryEditor.vue`

- [ ] **Step 1: 创建组件**

```vue
<script setup lang="ts">
/**
 * 记忆编辑对话框
 *
 * 支持新增/编辑记忆条目：标题、内容、tags、类型、权重。
 */
import { ref, watch, computed } from 'vue'
import type { AiMemory, MemoryType } from '@/types/ai'
import { X } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  open: boolean
  /** 编辑模式传入已有记忆，新增模式不传 */
  memory?: AiMemory | null
  workspaceId: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [memory: AiMemory]
}>()

const title = ref('')
const content = ref('')
const tags = ref('')
const memoryType = ref<MemoryType>('knowledge')
const weight = ref(1.0)

const isEdit = computed(() => !!props.memory)

watch(() => props.open, (open) => {
  if (open && props.memory) {
    title.value = props.memory.title
    content.value = props.memory.content
    tags.value = props.memory.tags
    memoryType.value = props.memory.type as MemoryType
    weight.value = props.memory.weight
  } else if (open) {
    title.value = ''
    content.value = ''
    tags.value = ''
    memoryType.value = 'knowledge'
    weight.value = 1.0
  }
})

function handleSave() {
  if (!content.value.trim()) return

  const now = Date.now()
  const memory: AiMemory = {
    id: props.memory?.id ?? `mem-${now}-${Math.random().toString(36).slice(2, 7)}`,
    workspaceId: props.workspaceId,
    type: memoryType.value,
    title: title.value.trim(),
    content: content.value.trim(),
    tags: tags.value.trim(),
    sourceSessionId: props.memory?.sourceSessionId,
    weight: weight.value,
    lastUsedAt: props.memory?.lastUsedAt,
    createdAt: props.memory?.createdAt ?? now,
    updatedAt: now,
  }
  emit('save', memory)
  emit('update:open', false)
}

const TYPE_OPTIONS: { value: MemoryType; label: string }[] = [
  { value: 'knowledge', label: '知识' },
  { value: 'summary', label: '摘要' },
  { value: 'preference', label: '偏好' },
]
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-150"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
        <!-- 遮罩 -->
        <div class="absolute inset-0 bg-black/50" @click="emit('update:open', false)" />

        <!-- 对话框 -->
        <div class="relative w-[480px] max-h-[80vh] rounded-xl border bg-background shadow-xl flex flex-col">
          <!-- 头部 -->
          <div class="flex items-center justify-between px-5 py-4 border-b">
            <h3 class="text-sm font-semibold">{{ isEdit ? '编辑记忆' : '新增记忆' }}</h3>
            <button class="text-muted-foreground hover:text-foreground" @click="emit('update:open', false)">
              <X class="h-4 w-4" />
            </button>
          </div>

          <!-- 表单 -->
          <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <!-- 类型 -->
            <div>
              <label class="text-xs font-medium text-muted-foreground mb-1.5 block">类型</label>
              <div class="flex gap-2">
                <button
                  v-for="opt in TYPE_OPTIONS"
                  :key="opt.value"
                  class="px-3 py-1.5 rounded-md text-xs border transition-colors"
                  :class="memoryType === opt.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:bg-muted'"
                  @click="memoryType = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 标题 -->
            <div>
              <label class="text-xs font-medium text-muted-foreground mb-1.5 block">标题</label>
              <input
                v-model="title"
                class="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="简短描述"
              />
            </div>

            <!-- 内容 -->
            <div>
              <label class="text-xs font-medium text-muted-foreground mb-1.5 block">内容</label>
              <textarea
                v-model="content"
                rows="5"
                class="w-full rounded-md border bg-transparent px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="记忆详细内容…"
              />
            </div>

            <!-- Tags -->
            <div>
              <label class="text-xs font-medium text-muted-foreground mb-1.5 block">标签（逗号分隔）</label>
              <input
                v-model="tags"
                class="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Vue,TypeScript,架构"
              />
            </div>

            <!-- 权重 -->
            <div>
              <label class="text-xs font-medium text-muted-foreground mb-1.5 block">
                权重: {{ weight.toFixed(1) }}
              </label>
              <input
                v-model.number="weight"
                type="range"
                min="0"
                max="2"
                step="0.1"
                class="w-full"
              />
            </div>
          </div>

          <!-- 底部 -->
          <div class="flex justify-end gap-2 px-5 py-4 border-t">
            <Button variant="ghost" size="sm" @click="emit('update:open', false)">取消</Button>
            <Button size="sm" :disabled="!content.trim()" @click="handleSave">保存</Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
```

- [ ] **Step 2: 提交**

```bash
git add src/components/ai/AiMemoryEditor.vue
git commit -m "feat(ai-memory): 新增 AiMemoryEditor 记忆编辑对话框"
```

---

## Task 10: AiMemoryDrawer 组件

**Files:**
- Create: `src/components/ai/AiMemoryDrawer.vue`

- [ ] **Step 1: 创建组件**

```vue
<script setup lang="ts">
/**
 * 记忆管理抽屉
 *
 * 按类型分组展示记忆列表，支持搜索、新增、编辑、删除。
 * 包含压缩规则编辑入口。
 */
import { ref, computed } from 'vue'
import { useAiMemoryStore, DEFAULT_COMPACT_RULE } from '@/stores/ai-memory'
import AiMemoryEditor from './AiMemoryEditor.vue'
import type { AiMemory, CompactRule } from '@/types/ai'
import {
  Brain,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  BookOpen,
  FileText,
  Settings2,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const memoryStore = useAiMemoryStore()

const searchQuery = ref('')
const showEditor = ref(false)
const editingMemory = ref<AiMemory | null>(null)
const showCompactRuleEditor = ref(false)
const compactRuleText = ref('')

/** 搜索过滤后的记忆（按类型分组） */
const filteredGroups = computed(() => {
  const q = searchQuery.value.toLowerCase()
  const groups = memoryStore.memoriesByType

  if (!q) return groups

  const filter = (list: AiMemory[]) =>
    list.filter(m =>
      m.title.toLowerCase().includes(q) ||
      m.content.toLowerCase().includes(q) ||
      m.tags.toLowerCase().includes(q),
    )

  return {
    knowledge: filter(groups.knowledge),
    summary: filter(groups.summary),
    preference: filter(groups.preference),
  }
})

const groupConfig = [
  { key: 'knowledge' as const, label: '知识', icon: BookOpen, color: 'text-blue-500' },
  { key: 'summary' as const, label: '摘要', icon: FileText, color: 'text-green-500' },
  { key: 'preference' as const, label: '偏好', icon: Settings2, color: 'text-amber-500' },
]

function handleNew() {
  editingMemory.value = null
  showEditor.value = true
}

function handleEdit(memory: AiMemory) {
  editingMemory.value = memory
  showEditor.value = true
}

async function handleDelete(id: string) {
  await memoryStore.deleteMemory(id)
}

async function handleSave(memory: AiMemory) {
  await memoryStore.saveMemory(memory)
}

function openCompactRuleEditor() {
  const rule = memoryStore.compactRule
  compactRuleText.value = `P0-必须保留: ${rule.p0}\nP1-尽量保留: ${rule.p1}\nP2-立即丢弃: ${rule.p2}\n压缩比目标: ${Math.round(rule.ratio * 100)}%`
  showCompactRuleEditor.value = true
}

async function saveCompactRule() {
  // 简单解析文本格式
  const lines = compactRuleText.value.split('\n')
  const rule: CompactRule = { ...DEFAULT_COMPACT_RULE }
  for (const line of lines) {
    if (line.startsWith('P0')) rule.p0 = line.replace(/^P0[^:]*:\s*/, '')
    else if (line.startsWith('P1')) rule.p1 = line.replace(/^P1[^:]*:\s*/, '')
    else if (line.startsWith('P2')) rule.p2 = line.replace(/^P2[^:]*:\s*/, '')
    else if (line.includes('压缩比')) {
      const match = line.match(/(\d+)%/)
      if (match) rule.ratio = parseInt(match[1]) / 100
    }
  }
  await memoryStore.saveCompactRule(rule)
  showCompactRuleEditor.value = false
}

/** 清理无效记忆（workspace 路径不存在的记忆） */
async function cleanOrphanMemories() {
  // TODO: 调用 Tauri 命令检查路径是否存在，或提示用户手动确认
  // 当前版本仅清理 workspace_id !== currentWorkspaceId 且 !== '_global' 的记忆
  // 完整实现需要后端提供路径存在性检查命令
  console.warn('[Memory] 清理无效记忆功能待完善（需要后端路径检查支持）')
}

/** 格式化时间 */
function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <!-- 抽屉遮罩 -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-150"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-40 bg-black/30" @click="emit('update:open', false)" />
    </Transition>

    <!-- 抽屉面板 -->
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="translate-x-full"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-to-class="translate-x-full"
    >
      <div
        v-if="open"
        class="fixed right-0 top-0 z-50 h-full w-[400px] border-l bg-background shadow-xl flex flex-col"
      >
        <!-- 头部 -->
        <div class="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div class="flex items-center gap-2">
            <Brain class="h-4 w-4 text-primary" />
            <span class="text-sm font-semibold">项目记忆</span>
            <span class="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {{ memoryStore.memories.length }}
            </span>
          </div>
          <div class="flex items-center gap-1">
            <Button variant="ghost" size="icon" class="h-7 w-7" @click="handleNew">
              <Plus class="h-3.5 w-3.5" />
            </Button>
            <button class="text-muted-foreground hover:text-foreground p-1" @click="emit('update:open', false)">
              <X class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- 搜索 -->
        <div class="px-4 py-2 shrink-0">
          <div class="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-1.5">
            <Search class="h-3.5 w-3.5 text-muted-foreground" />
            <input
              v-model="searchQuery"
              class="flex-1 bg-transparent text-xs focus:outline-none placeholder:text-muted-foreground/50"
              placeholder="搜索记忆…"
            />
          </div>
        </div>

        <!-- 记忆列表 -->
        <div class="flex-1 overflow-y-auto px-4 py-2 space-y-4">
          <div v-for="group in groupConfig" :key="group.key">
            <template v-if="filteredGroups[group.key].length > 0">
              <div class="flex items-center gap-1.5 mb-2">
                <component :is="group.icon" class="h-3.5 w-3.5" :class="group.color" />
                <span class="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  {{ group.label }} ({{ filteredGroups[group.key].length }})
                </span>
              </div>

              <div class="space-y-1.5">
                <div
                  v-for="memory in filteredGroups[group.key]"
                  :key="memory.id"
                  class="group rounded-lg border border-border/50 px-3 py-2.5 hover:border-border transition-colors"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex-1 min-w-0">
                      <p class="text-xs font-medium truncate">{{ memory.title || '(无标题)' }}</p>
                      <p class="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                        {{ memory.content }}
                      </p>
                    </div>
                    <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        class="p-1 rounded hover:bg-muted text-muted-foreground"
                        @click="handleEdit(memory)"
                      >
                        <Pencil class="h-3 w-3" />
                      </button>
                      <button
                        class="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        @click="handleDelete(memory.id)"
                      >
                        <Trash2 class="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 mt-1.5">
                    <span v-if="memory.tags" class="text-[10px] text-muted-foreground/60 truncate">
                      {{ memory.tags }}
                    </span>
                    <span class="text-[10px] text-muted-foreground/40 ml-auto shrink-0">
                      {{ formatTime(memory.updatedAt) }}
                    </span>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- 空状态 -->
          <div
            v-if="memoryStore.memories.length === 0"
            class="flex flex-col items-center justify-center py-12 text-center"
          >
            <Brain class="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p class="text-xs text-muted-foreground">暂无记忆</p>
            <p class="text-[10px] text-muted-foreground/60 mt-1">点击 + 添加项目知识</p>
          </div>
        </div>

        <!-- 底部：压缩规则编辑 + 清理 -->
        <div class="px-4 py-3 border-t shrink-0 space-y-1">
          <button
            class="w-full flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
            @click="openCompactRuleEditor"
          >
            <Settings2 class="h-3.5 w-3.5" />
            编辑压缩规则
          </button>
          <button
            class="w-full flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            @click="cleanOrphanMemories"
          >
            <Trash2 class="h-3.5 w-3.5" />
            清理无效记忆
          </button>
        </div>

        <!-- 压缩规则编辑弹窗 -->
        <Teleport to="body">
          <Transition
            enter-active-class="transition-opacity duration-200"
            enter-from-class="opacity-0"
            leave-active-class="transition-opacity duration-150"
            leave-to-class="opacity-0"
          >
            <div v-if="showCompactRuleEditor" class="fixed inset-0 z-[60] flex items-center justify-center">
              <div class="absolute inset-0 bg-black/50" @click="showCompactRuleEditor = false" />
              <div class="relative w-[500px] rounded-xl border bg-background shadow-xl p-5">
                <h3 class="text-sm font-semibold mb-3">压缩规则</h3>
                <textarea
                  v-model="compactRuleText"
                  rows="8"
                  class="w-full rounded-md border bg-transparent px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <div class="flex justify-end gap-2 mt-3">
                  <Button variant="ghost" size="sm" @click="showCompactRuleEditor = false">取消</Button>
                  <Button size="sm" @click="saveCompactRule">保存</Button>
                </div>
              </div>
            </div>
          </Transition>
        </Teleport>
      </div>
    </Transition>
  </Teleport>

  <!-- 编辑器 -->
  <AiMemoryEditor
    :open="showEditor"
    :memory="editingMemory"
    :workspace-id="memoryStore.currentWorkspaceId"
    @update:open="showEditor = $event"
    @save="handleSave"
  />
</template>
```

- [ ] **Step 2: 提交**

```bash
git add src/components/ai/AiMemoryDrawer.vue
git commit -m "feat(ai-memory): 新增 AiMemoryDrawer 记忆管理抽屉"
```

---

## Task 11: AiChatView 集成

**Files:**
- Modify: `src/views/AiChatView.vue`

- [ ] **Step 1: 导入新组件和 store**

在 AiChatView.vue 的 `<script setup>` import 区追加：

```typescript
import { useAiMemoryStore } from '@/stores/ai-memory'
import AiMemoryDrawer from '@/components/ai/AiMemoryDrawer.vue'
import AiCompactBanner from '@/components/ai/AiCompactBanner.vue'
import { Brain } from 'lucide-vue-next'
```

- [ ] **Step 2: 初始化记忆 store**

在 `const fileAttachment = useFileAttachment()` 之后追加：

```typescript
const memoryStore = useAiMemoryStore()
const showMemoryDrawer = ref(false)
```

- [ ] **Step 3: workDir 变化时更新记忆 store**

在 `handleSelectWorkDir` 函数中，`chat.workDir.value = dir as string` 之后追加：

```typescript
    // 更新记忆 store 的工作区
    memoryStore.setWorkspace(dir as string)
```

在 `onMounted` 中 `await chat.loadHistory()` 之后追加：

```typescript
  // 初始化记忆 store（使用当前工作目录）
  if (chat.workDir.value) {
    memoryStore.setWorkspace(chat.workDir.value)
  }
```

- [ ] **Step 4: 顶栏添加记忆按钮**

在 `AiChatView.vue` 模板中，顶栏「配置」Tooltip 之后（`</TooltipProvider>` 之前）追加：

```html
            <!-- 记忆 -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="showMemoryDrawer = true">
                  <Brain class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">项目记忆</TooltipContent>
            </Tooltip>
```

- [ ] **Step 5: 添加压缩提示和记忆抽屉**

在模板中，`<!-- 错误提示 -->` 之前追加压缩提示条：

```html
      <!-- 压缩提示 -->
      <AiCompactBanner :visible="chat.isCompacting?.value ?? false" />
```

在 `<!-- 工作区文件选择器 -->` 之后追加记忆抽屉：

```html
    <!-- 记忆管理抽屉 -->
    <AiMemoryDrawer
      :open="showMemoryDrawer"
      @update:open="showMemoryDrawer = $event"
    />
```

- [ ] **Step 6: 验证 TypeScript 编译**

```bash
cd D:\Project\DevForge\devforge && npx vue-tsc --noEmit
```

- [ ] **Step 7: 提交**

```bash
git add src/views/AiChatView.vue
git commit -m "feat(ai-memory): AiChatView 集成记忆按钮、抽屉和压缩提示"
```

---

## Task 12: 构建验证

- [ ] **Step 1: Rust 编译**

```bash
cd D:\Project\DevForge\devforge\src-tauri && cargo build
```

Expected: 编译成功

- [ ] **Step 2: 前端类型检查**

```bash
cd D:\Project\DevForge\devforge && npx vue-tsc --noEmit
```

Expected: 无错误

- [ ] **Step 3: 前端构建**

```bash
cd D:\Project\DevForge\devforge && npx vite build
```

Expected: 构建成功

- [ ] **Step 4: 提交（如有修复）**

如果前面步骤发现需要修复的类型错误或编译问题，修复后提交：

```bash
git add -A && git commit -m "fix(ai-memory): 修复构建错误"
```
