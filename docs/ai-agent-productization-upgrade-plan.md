# DevForge AI 能力增强补充规划（二）：工程化与产品化能力

日期：2026-04-24
参考项目：`D:\Project\claude-code-main`
关联文档：`docs/ai-agent-architecture-upgrade-plan.md`

## 1. 文档目标

上一篇文档聚焦 AI Agent Runtime 的主链路：Query Loop、压缩边界、工具上下文、Provider Adapter、Hook 等。

本文继续补充 Claude Code 中值得 DevForge 学习的第二批能力，重点不是“模型怎么回答”，而是让 AI 产品更强、更稳、更像专业 IDE Agent 的工程化能力：

- 会话持久化与可恢复
- 计划/任务系统
- 权限与安全策略
- 插件/技能生态
- 记忆治理
- 任务通知与后台队列
- 观测诊断
- 远程/桥接协作
- 定时任务与自动化
- 上下文洞察与预算分析

## 2. 第二批值得学习的能力

### 2.1 会话 Transcript 与可恢复能力

Claude Code 对会话有比较完整的 transcript/session 设计，用于恢复、搜索、分享、调试和后台任务关联。

可学习点：

- 每个会话有稳定 `sessionId`。
- 每条消息、工具调用、任务通知都有可追踪 ID。
- 会话可以恢复到某个历史状态。
- compact 后仍可通过 transcript 保留完整 UI 历史。
- 支持 transcript search，方便从历史中找上下文。

DevForge 当前已有会话存储，但建议增强为：

```ts
interface AiTranscriptEvent {
  id: string
  sessionId: string
  turnId?: string
  type: 'message' | 'tool_call' | 'tool_result' | 'compact' | 'permission' | 'error' | 'task'
  payload: unknown
  createdAt: number
}
```

建议能力：

- 统一 transcript event store。
- AI 对话、工具调用、压缩、错误都写事件流。
- UI 消息从事件流投影得到。
- 支持按文件名、工具名、错误、用户消息搜索。
- 支持导出/分享单个会话诊断包。

优先级：P1。

### 2.2 Plan Mode 与计划文件治理

Claude Code 中 Plan Mode 不只是让模型“先计划”，还涉及计划状态、计划 slug、计划附件、退出/恢复提示等。

可学习点：

- 计划是一个可持久化对象，不只是聊天中的一段文本。
- 计划和执行模式有明确切换。
- 计划可以附加到后续上下文，压缩后也保留。
- 用户退出计划模式后有一次性提醒或状态附件。

DevForge 可设计：

```ts
interface AiPlan {
  id: string
  sessionId: string
  title: string
  status: 'draft' | 'approved' | 'in_progress' | 'completed' | 'abandoned'
  steps: AiPlanStep[]
  relatedFiles: string[]
  createdAt: number
  updatedAt: number
}
```

落地建议：

- Plan 不只显示在消息里，而是有侧栏/抽屉管理。
- 用户批准计划后，Agent Runtime 才进入执行状态。
- 压缩后自动注入当前 active plan。
- 支持从计划步骤创建后台任务。
- 支持计划变更历史。

优先级：P1。

### 2.3 Todo/Task 系统与后台任务通知

Claude Code 有任务系统，包括 local agent task、remote agent task、task notification、任务 pill label 等。

可学习点：

- 任务有生命周期：created/running/waiting/completed/failed/stopped。
- 后台任务完成后以 notification 形式回到主会话。
- 主会话可以消费任务结果，而不必一直阻塞。
- 多任务状态通过紧凑 pill 汇总。

DevForge 可以先做轻量版：

```ts
interface AiTask {
  id: string
  sessionId: string
  title: string
  description: string
  status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'
  sourceMessageId?: string
  resultSummary?: string
  outputRef?: string
  createdAt: number
  updatedAt: number
}
```

适用场景：

- 长时间代码扫描
- 大文件分析
- 数据库 schema 对比
- ER 图分析
- 运行测试/构建
- 后台 prompt 优化

DevForge 已有后台任务/子任务雏形，建议补：

- 任务中心 UI
- 任务通知注入主会话
- 任务结果落盘与摘要
- 任务取消/重试
- 任务与工具调用关联

优先级：P1。

### 2.4 权限模式与危险模式治理

Claude Code 的权限设计值得重点学习。它不是只有“确认/不确认”，而是分不同模式，并对危险模式有 kill switch、规则清理、风险分类。

相关参考：

- `src/utils/permissions/PermissionMode.ts`
- `src/utils/permissions/dangerousPatterns.ts`
- `src/utils/permissions/bashClassifier.ts`
- `src/utils/permissions/pathValidation.ts`

DevForge 建议权限分层：

```ts
type PermissionMode =
  | 'default'
  | 'plan'
  | 'accept_edits'
  | 'read_only'
  | 'safe_auto'
  | 'dangerous_bypass'
```

工具风险等级：

```ts
type ToolRiskLevel =
  | 'read'
  | 'write'
  | 'execute'
  | 'network'
  | 'db_mutation'
  | 'destructive'
```

重点规则：

- `read` 默认允许。
- `write` 需要用户确认或 accept edits 模式。
- `execute` 根据命令分类。
- `db_mutation` 必须确认。
- `destructive` 必须二次确认。
- `dangerous_bypass` 只作为显式短时会话模式，不持久化。

DevForge 现有场景尤其需要：

- Bash/PowerShell 命令
- 文件写入/删除/移动
- 数据库迁移 SQL
- SFTP 上传/删除
- Git 操作
- Redis flush/delete

优先级：P0/P1。

### 2.5 危险命令分类器

Claude Code 维护危险命令模式，例如 `python/node/npx/bash/ssh/curl/git/kubectl/aws` 等，防止用户误设过宽 allow rule。

DevForge 可以做本地规则版，不必一开始上模型分类器：

```ts
interface CommandRiskRule {
  pattern: string
  risk: ToolRiskLevel
  reason: string
  requireConfirm: boolean
}
```

首批规则：

- 代码执行器：`python`, `node`, `npx`, `tsx`, `bun`, `powershell -Command`
- 删除移动：`rm`, `del`, `Remove-Item`, `move`, `mv`, `rd`, `rmdir`
- 网络：`curl`, `wget`, `Invoke-WebRequest`, `ssh`, `scp`
- Git 高风险：`git reset --hard`, `git clean`, `git push --force`
- 数据库：`DROP`, `TRUNCATE`, `DELETE without WHERE`, `ALTER`

优先级：P1。

### 2.6 技能 Skill 系统与可发现能力

Claude Code 的 Skill 机制很值得 DevForge 学：技能不是普通 prompt，而是“可发现、可触发、可维护”的能力包。

可学习点：

- skill 有 name/description/whenToUse。
- 只在需要时加载，减少上下文污染。
- skill 可以热更新。
- skill 可以由插件或内置包提供。
- compact 后要保留已调用 skill 的关键上下文。

DevForge 可以设计：

```ts
interface AiSkillManifest {
  name: string
  description: string
  whenToUse: string
  entryPromptPath: string
  tools?: string[]
  domains?: string[]
  enabled: boolean
}
```

可先内置技能：

- `database-schema-review`
- `sql-migration-safety`
- `frontend-performance-review`
- `tauri-rust-debug`
- `project-health-check`
- `prompt-optimizer`
- `erp-module-review`

优先级：P2。

### 2.7 插件系统与 Marketplace 校验

Claude Code 有 plugin、marketplace、validatePlugin、startup checks、hot reload 等机制。

DevForge 不建议马上做完整 marketplace，但可以学习其“插件边界”和“校验机制”。

最小插件能力：

```ts
interface DevForgePluginManifest {
  id: string
  name: string
  version: string
  contributes: {
    skills?: string[]
    tools?: string[]
    hooks?: string[]
    views?: string[]
  }
  permissions: ToolRiskLevel[]
}
```

必须有：

- manifest schema 校验
- 权限声明
- 启用/禁用
- 加载失败隔离
- 插件日志
- 开发模式 hot reload

优先级：P3。

### 2.8 记忆治理 Memory Review

Claude Code 的 `remember` skill 不是简单记忆，而是整理记忆层级：项目记忆、本地个人记忆、团队记忆、自动记忆。

DevForge 当前已有 memory store，可增强为“记忆治理”：

记忆层级：

- Project Memory：项目规范，团队共享。
- Local Memory：个人偏好，不提交。
- Session Memory：当前会话临时上下文。
- Auto Memory：模型自动沉淀，需定期审核。

功能建议：

- 记忆冲突检测
- 过期记忆提醒
- 自动记忆晋升建议
- 重复记忆清理
- 用户审批后写入项目文档

优先级：P2。

### 2.9 上下文分析与 Token 预算面板

Claude Code 有 context analysis 思路，会把上下文拆成不同类别，看哪些内容占 token。

DevForge 可以做 AI 上下文预算面板：

分类：

- System Prompt
- Memory
- Current Session Messages
- Tool Results
- File Attachments
- Database Context
- Compact Summary
- Safety/Permission Context

功能：

- 显示各类 token 占比。
- 一键清理大型工具结果。
- 一键压缩历史。
- 提示“最占上下文”的文件/工具结果。
- 压缩前后对比。

优先级：P1。

### 2.10 观测、诊断与错误日志

Claude Code 有 telemetry/analytics/error log/request id 等观测能力。

DevForge 可做本地隐私友好的诊断系统：

```ts
interface AiDiagnosticEvent {
  id: string
  sessionId: string
  turnId?: string
  type: 'stream' | 'tool' | 'compact' | 'permission' | 'provider' | 'ui'
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  metadata?: Record<string, unknown>
  createdAt: number
}
```

关键指标：

- TTFB
- tokens/s
- prompt tokens
- completion tokens
- tool call count
- tool duration
- compact duration
- compact freed tokens
- stream stalled count
- recovery count
- provider error rate

UI：

- 会话诊断面板
- 一键复制诊断报告
- 最近错误时间线
- Provider 健康检查

优先级：P1。

### 2.11 队列命令与 Turn 间消息合并

Claude Code 有 queued command / notification coalesce 的思路：长 turn 中产生的外部通知不会立刻打断，而是在合适的 turn 边界进入模型。

DevForge 可用于：

- 后台任务完成通知
- 文件变更通知
- 数据库连接断开通知
- 测试运行完成通知
- 用户追加消息

建议设计：

```ts
interface AiQueuedEvent {
  id: string
  sessionId: string
  kind: 'user_message' | 'task_notification' | 'file_change' | 'system_notice'
  priority: 'low' | 'normal' | 'high'
  payload: unknown
  createdAt: number
}
```

规则：

- 当前 turn 正在 streaming 时，普通事件排队。
- 工具执行完成后合并同类事件。
- 高优先级事件可提示用户是否中断。

优先级：P2。

### 2.12 定时任务与自动化

Claude Code 有 cron/scheduled task 能力。DevForge 也适合做 IDE 内自动化：

可用场景：

- 每日项目健康检查
- 定时数据库 schema 快照
- 定时同步 SFTP/Redis 状态
- 定时扫描 TODO/FIXME
- 定时执行测试并让 AI 总结失败
- 定时生成日报/变更摘要

建议结构：

```ts
interface AiScheduledTask {
  id: string
  name: string
  cron: string
  prompt: string
  enabled: boolean
  scope: 'workspace' | 'session'
  lastRunAt?: number
  nextRunAt?: number
}
```

优先级：P3。

### 2.13 Remote Bridge / 外部协作入口

Claude Code 有 bridge/remote session/webhook sanitizer 等机制。DevForge 可以借鉴但不急着做完整远程协作。

适合 DevForge 的轻量版：

- 本地 HTTP/WebSocket 接口接收外部任务。
- 浏览器插件或 IDE 插件把上下文推给 DevForge。
- GitHub webhook 触发 AI 分析 PR/issue。
- 远程任务结果回写到 DevForge 会话。

安全前提：

- inbound 内容必须 sanitize。
- 外部任务默认只读。
- 高风险操作必须回到 DevForge UI 确认。

优先级：P3。

### 2.14 文件/代码快照与 Attribution

Claude Code 会关注文件历史快照、attribution、读文件状态。DevForge 可以学习：

- 工具修改文件前保存快照。
- AI 修改文件后记录 attribution：哪个 turn、哪个工具、什么原因。
- Diff UI 可按 AI turn 查看。
- 回滚单次 AI 改动。

建议结构：

```ts
interface AiFileChangeAttribution {
  id: string
  sessionId: string
  turnId: string
  toolCallId?: string
  path: string
  beforeHash: string
  afterHash: string
  summary: string
  createdAt: number
}
```

优先级：P2。

## 3. DevForge 第二阶段目标架构补充

建议新增模块：

```text
src/composables/ai-agent/
  transcript/
    transcriptStore.ts
    transcriptSearch.ts
    diagnosticExport.ts
  planning/
    planStore.ts
    planRuntime.ts
    planContextAttachment.ts
  tasks/
    aiTaskStore.ts
    taskNotificationQueue.ts
    taskResultStore.ts
  permissions/
    permissionMode.ts
    commandRiskRules.ts
    dbRiskRules.ts
    permissionPrompt.ts
  memory/
    memoryLayers.ts
    memoryReview.ts
    memoryConflictDetector.ts
  skills/
    skillRegistry.ts
    skillLoader.ts
    bundledSkills.ts
  diagnostics/
    aiDiagnosticEvents.ts
    providerHealth.ts
    contextBudgetAnalyzer.ts
  automation/
    scheduledTaskStore.ts
    scheduledTaskRunner.ts
  attribution/
    fileSnapshotStore.ts
    fileChangeAttribution.ts
```

## 4. 优先级建议

### P0：安全与稳定补强

- 权限模式基础版
- DB mutation / 文件删除 / Shell 高危命令确认
- 会话诊断事件基础表
- 压缩卡死诊断报告

### P1：专业 Agent 能力

- Transcript event store
- Plan 对象化
- AI 上下文预算面板
- Tool result budget
- 后台任务通知中心

### P2：长期能力沉淀

- Memory Review
- Skill Registry
- File Change Attribution
- Hook 生命周期
- 队列事件合并

### P3：生态与自动化

- Plugin manifest 校验
- Scheduled Tasks
- Remote Bridge
- Webhook 入口

## 5. 近期最推荐落地的 5 个功能

1. **会话诊断报告**
   - 解决“卡死/没反应/流结束 UI 不释放”这类问题时非常有用。
   - 用户一键导出最近 1 个 turn 的 stream/tool/compact/provider 日志。

2. **上下文预算面板**
   - 让用户知道为什么上下文 100%。
   - 支持一键压缩、清理工具结果、移除大附件。

3. **权限模式 + 风险规则**
   - 数据库迁移、SFTP、Shell、Git 都需要统一风险提示。
   - 避免误执行破坏性操作。

4. **Plan 对象化**
   - 用户经常让 AI 做复杂改造，计划需要能追踪、批准、恢复。
   - 后续可自然接后台任务。

5. **文件改动 Attribution**
   - 让用户知道 AI 改了哪些文件、为什么改、能否回滚。
   - 对 IDE 产品信任感提升很大。

## 6. 不建议现在做的

- 完整远程协作 Bridge：成本高，安全面大。
- 完整插件 Marketplace：先做内置 skill 和 manifest 校验即可。
- 多 Agent 团队系统：先把单 Agent runtime、任务队列、诊断做好。
- 复杂自动记忆：没有 Memory Review 前，自动记忆容易污染上下文。

## 7. 与上一份文档的关系

上一份文档解决的是 AI 主链路：

- 如何调用模型
- 如何压缩
- 如何执行工具
- 如何恢复错误

本文解决的是产品工程化能力：

- 如何安全运行
- 如何持久化和恢复
- 如何诊断问题
- 如何管理计划/任务/记忆
- 如何形成可扩展生态

推荐实施顺序：

```text
1. P0 压缩边界与 Agent Runtime
2. 会话诊断报告
3. 权限模式与风险规则
4. 上下文预算面板
5. Plan 对象化
6. Tool result budget
7. Memory Review / Skill Registry
```
