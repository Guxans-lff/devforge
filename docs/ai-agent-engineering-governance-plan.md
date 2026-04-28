# DevForge AI 能力增强补充规划（四）：工程治理、运行韧性与体验内功

日期：2026-04-24
参考项目：`D:\Project\claude-code-main`
关联文档：

- `docs/ai-agent-architecture-upgrade-plan.md`
- `docs/ai-agent-productization-upgrade-plan.md`
- `docs/ai-agent-advanced-capabilities-plan.md`

## 1. 文档目标

前三份文档已经覆盖 AI 主链路、产品化能力、高级协作和质量闭环。本文继续深挖 Claude Code 中更偏“工程内功”的设计：Feature Gate、后台守护、主动任务、输入系统、输出风格、团队记忆、配置迁移、诊断观测等。

这些能力不一定直接提升模型智商，但会明显提升 DevForge AI 的稳定性、可控性、长期可维护性和用户体验。尤其针对当前已经暴露过的卡顿、按钮无响应、压缩卡死、加载慢、资源覆盖等问题，这一层能力比单点修 bug 更重要。

## 2. 第四批值得学习的能力

### 2.1 Feature Gate 与 Kill Switch：所有高级能力都必须可灰度、可回滚

Claude Code 对不少能力都采用 Feature Flag 控制，例如 Daemon、Proactive、Coordinator、Workflow Scripts、Voice Mode、Context Collapse 等。部分能力还叠加远程 kill switch 或运行时条件，避免实验能力影响主链路。

DevForge 当前很多 AI 功能已经逐步复杂化，如果继续直接硬接到主流程，会出现两个问题：

1. 新功能异常时难以及时关闭。
2. 用户环境差异大，无法渐进式发布。

建议新增统一 Feature Gate：

```ts
interface AiFeatureGate {
  key: string
  enabled: boolean
  source: 'default' | 'local_settings' | 'workspace' | 'remote' | 'dev_override'
  reason?: string
}
```

优先接入的开关：

- `ai.compact.v2`：新版压缩策略。
- `ai.agent.runtime`：Agent Runtime 状态机。
- `ai.tools.parallel`：并行工具调用。
- `ai.diagnostics.capture`：诊断包采集。
- `ai.permission.strict`：严格权限模式。
- `ai.proactive.enabled`：主动任务模式。
- `ai.experimental.ui`：实验性 AI UI。

落地建议：

- 前端：`src/stores/aiFeatureGateStore.ts` 管理本地与 workspace 开关。
- 后端：`src-tauri/src/commands/feature_gate.rs` 暴露读取和更新命令。
- 配置：`.devforge/settings.json` 支持项目级覆盖。
- UI：设置页增加“实验功能”分组，标注风险和回滚入口。

### 2.2 Daemon / Worker：把长任务从 UI 主交互里拆出去

Claude Code 的 Daemon 思路是 supervisor 管理多个 worker，适合长期运行、远程控制和后台任务。即使参考项目中部分实现仍是 Stub，这个方向对 DevForge 很有价值。

DevForge 当前卡顿问题的根因之一，是一些重任务和 UI 对话流耦合太紧：压缩、加载、资源扫描、ERP 功能树、Schema 对比、AI 流式处理都可能争抢同一条交互链路。

建议引入轻量 Worker Runtime，不必一开始做完整多进程，可以先做“后端任务队列 + 前端订阅”：

```rust
pub enum BackgroundJobKind {
    AiCompact,
    WorkspaceIndex,
    ResourceScan,
    SchemaCompare,
    ErpModuleLoad,
    DiagnosticCapture,
}

pub enum BackgroundJobStatus {
    Queued,
    Running,
    Cancelling,
    Succeeded,
    Failed,
    Cancelled,
}
```

关键原则：

- UI 只提交任务和订阅进度，不直接等待长任务完成。
- 每个 job 必须有 `id`、`kind`、`createdAt`、`startedAt`、`timeoutMs`、`cancelToken`。
- 同类任务支持去重，例如同一个 session 只允许一个 compact job。
- 结果写入可恢复存储，页面刷新后能继续展示状态。

优先场景：

1. `/compact` 不再阻塞输入框和消息滚动。
2. ERP 功能树加载拆为后台 job，并支持分批返回。
3. 资源管理扫描改为 job，避免多窗口互相覆盖。
4. Schema 对比大库分析改为 job，可取消、可重试。

### 2.3 Proactive Tick：让 AI 能“等待、观察、继续”，但不能骚扰用户

Claude Code 的 Proactive 设计通过 tick 驱动，让 Agent 在用户无输入时也能继续工作，并通过 SleepTool 控制节奏。这个能力适合等待 CI、轮询任务、监控文件变化、长流程分阶段执行。

DevForge 可借鉴，但必须先做强约束，避免变成“AI 自己乱跑”：

```ts
interface AiProactiveTask {
  id: string
  sessionId: string
  objective: string
  tickIntervalMs: number
  maxTicks: number
  nextTickAt: number
  allowedTools: string[]
  stopConditions: string[]
  status: 'idle' | 'waiting' | 'running' | 'paused' | 'done' | 'failed'
}
```

适合 DevForge 的 P0 场景：

- “等测试跑完后继续分析”。
- “等依赖安装完成后继续构建”。
- “每隔一段时间检查后台 job 是否完成”。
- “监控指定日志文件，发现错误后总结”。

不建议 P0 支持：

- 无目标自主探索整个项目。
- 自动修改大量文件。
- 自动执行部署、数据库变更、权限变更。

交互规则：

- 默认关闭，需要用户明确启动。
- 每个主动任务在 UI 中有可见状态和停止按钮。
- 进入 Plan 模式、权限弹窗、用户正在输入时暂停 tick。
- 没有新信息时不刷屏，只更新任务状态。

### 2.4 输入系统：Enter、Slash、@、快捷键必须统一仲裁

Claude Code 有独立 keybindings、Vim transitions、PromptInput 状态和 shortcut resolver。DevForge 之前出现过“输入一半按 Enter 没反应，必须点击才执行”“更多功能点了没反应”等问题，本质是输入事件被多个弹层和状态分支抢占。

建议把 AI 输入区升级为统一 Input Intent Resolver：

```ts
type AiInputIntent =
  | { type: 'submit_message' }
  | { type: 'accept_slash_command'; commandId: string }
  | { type: 'accept_at_mention'; targetId: string }
  | { type: 'insert_newline' }
  | { type: 'close_popover' }
  | { type: 'navigate_popover'; direction: 'up' | 'down' }
```

仲裁优先级建议：

1. IME 组合输入中：不提交、不选择。
2. 弹窗打开且有高亮项：Enter 选择当前项。
3. 弹窗打开但无高亮项：Enter 关闭弹窗或提交，按场景明确。
4. `Shift+Enter`：固定换行。
5. 普通 Enter：提交消息。
6. 流式输出中 Enter：默认提交新消息到队列，或者提示“正在生成”。

需要补的能力：

- 快捷键冲突检测。
- 输入事件 debug overlay，显示当前 resolver 命中的 intent。
- Slash、@、历史命令、更多功能共用弹层状态机。
- 输入框、按钮点击、命令面板都走同一条 `submitMessage()`，避免行为不一致。

### 2.5 Output Styles：让 AI 输出风格可配置，而不是写死在 Prompt 里

Claude Code 支持从 `.claude/output-styles` 和用户目录加载 markdown 风格配置。这个设计值得 DevForge 学习，因为 DevForge 用户可能有不同输出偏好：研发、测试、DBA、产品、运维、中文简洁、详细解释等。

建议增加 DevForge Output Style：

```md
---
name: 简洁工程师
description: 适合日常编码，回答短、直接、偏执行
keep-coding-instructions: true
---

你是 DevForge 工程助手。优先给出可执行结论，避免长篇背景。
```

目录约定：

- 项目级：`.devforge/output-styles/*.md`
- 用户级：`~/.devforge/output-styles/*.md`
- 内置级：`src/ai/output-styles/builtin/*.md`

加载优先级：项目级 > 用户级 > 内置级。

收益：

- 不同团队可以固定 AI 交付风格。
- 避免每次对话重复强调“简洁一点”“输出文档”。
- 可以为 ERP、数据库、前端、Rust 后端分别定义领域风格。
- 后续 Skill / Plugin 可以附带自己的 output style。

### 2.6 Team Memory：把“项目经验”沉淀成可检索资产

Claude Code 有 memdir / team memory 方向，用于查找相关记忆。DevForge 当前更需要的不是无限长期记忆，而是“项目规则、历史坑点、架构决策”的可控记忆。

建议把 Memory 分为三类：

```ts
type AiMemoryType =
  | 'project_rule'
  | 'architecture_decision'
  | 'bug_lesson'
  | 'user_preference'
  | 'domain_knowledge'
```

存储建议：

- 项目共享：`.devforge/memory/*.md`
- 用户私有：`~/.devforge/memory/*.md`
- 会话临时：IndexedDB / SQLite session memory。

写入必须走 Review：

1. AI 提议记忆内容。
2. 用户确认、编辑或拒绝。
3. 写入时带来源会话、时间、适用范围。
4. 后续检索时展示“引用了哪些记忆”。

优先沉淀的内容：

- “压缩对话不能阻塞 UI”。
- “资源管理必须用 namespace，不能互相覆盖”。
- “数据库迁移 SQL 默认保守，不自动执行危险操作”。
- “所有沟通中文，技术术语保留英文”。

### 2.7 Config Migration：配置结构升级必须有迁移系统

Claude Code 有多份 migration，用于模型默认值、设置迁移、权限迁移等。DevForge 后续会增加 Feature Gate、权限、Memory、Output Style、Agent Runtime 配置，如果没有 migration，用户升级后很容易出现隐性异常。

建议新增配置版本：

```ts
interface DevForgeSettingsFile {
  version: number
  ai?: AiSettings
  features?: Record<string, boolean>
  permissions?: PermissionSettings
  outputStyle?: string
}
```

迁移规则：

- 每次启动读取 settings 时执行 migration。
- migration 必须幂等。
- 迁移前保留 `.bak`。
- 迁移失败不阻塞启动，回退默认配置并上报诊断。

优先 migration：

- 旧 AI provider 配置迁移到 provider profiles。
- 旧 compact 设置迁移到 `ai.compact`。
- 旧权限配置迁移到 permission policy。
- 旧资源管理路径迁移到 workspace namespace。

### 2.8 Query Profiler 与诊断包：卡顿问题要可定位

Claude Code 中有 query profiler、debug mode、telemetry 相关设计。DevForge 当前多次出现“感觉卡死”“加载慢”“点了没反应”，仅靠肉眼复现效率低，必须做本地诊断包。

建议为每次 AI 请求生成 trace：

```ts
interface AiTraceSpan {
  traceId: string
  spanId: string
  name: string
  startedAt: number
  endedAt?: number
  status: 'ok' | 'error' | 'cancelled' | 'timeout'
  metadata?: Record<string, unknown>
}
```

必须记录的 Span：

- input submit：输入事件到提交。
- session build：构建 messages / tools / system prompt。
- compact check：上下文预算判断。
- provider request：模型请求耗时。
- first token：首 token 时间。
- stream render：流式渲染批次。
- tool call：工具调用耗时。
- persistence：消息写库耗时。
- UI render：大消息渲染耗时。

诊断包内容：

- 最近 N 次 trace。
- 当前 Feature Gate 状态。
- AI provider 配置摘要，不包含密钥。
- 前端性能指标：长任务、渲染批次、消息数量。
- 后端 job 状态。
- 最近错误日志。

UI 入口：

- AI 面板右上角“诊断”。
- 卡顿超过阈值自动提示“导出诊断包”。
- Debug 模式展示 trace timeline。

### 2.9 Workflow Scripts：把高频操作变成可复用流程

Claude Code 有 Workflow Scripts 方向，虽然部分实现是 Stub，但设计适合 DevForge：将多步操作定义成 YAML/JSON，然后由 AI 或任务系统执行。

DevForge 可定义 `.devforge/workflows/*.yaml`：

```yaml
name: 修复并验证前端问题
description: 适合 UI bug 的标准处理流程
steps:
  - type: inspect
    prompt: 定位相关组件、store、composable
  - type: edit
    prompt: 做最小必要修复
  - type: test
    command: pnpm test:typecheck
  - type: summarize
    prompt: 输出变更说明和验证结果
```

适合内置的工作流：

- `fix-ui-freeze`：卡顿/无响应排查。
- `fix-tauri-command`：Tauri command 前后端链路排查。
- `db-schema-review`：Schema 对比和迁移 SQL 审查。
- `erp-module-optimize`：ERP 功能树加载优化。
- `ai-compact-debug`：压缩卡死诊断。

与普通 Slash Command 的区别：

- Slash Command 是单次 prompt。
- Workflow 是多步骤、有状态、可暂停、可验证的流程。

### 2.10 Session Discovery 与 Resume：会话恢复要面向任务，而不是只看聊天记录

Claude Code 有 session discovery / assistant session chooser 方向。DevForge 也需要把 AI 会话从“消息列表”升级为“任务上下文”。

建议会话列表显示：

- 最近目标。
- 当前状态：空闲、生成中、等待权限、后台任务中、失败。
- 关联文件。
- 未完成 TODO。
- 最近 compact 摘要。
- 是否存在可恢复工具调用。

恢复策略：

- 只恢复 UI 状态不自动继续执行。
- 如果上次停在工具调用前，需要用户确认继续。
- 如果后台 job 仍在运行，恢复后重新订阅进度。
- 如果 compact 摘要缺失，允许用本地 fallback 重建。

### 2.11 Voice / 多模态输入：不是 P0，但输入架构要提前留口

Claude Code 已有 Voice Mode 设计，包括语音开关、录音状态、中间转录、最终转录。DevForge 当前没必要马上做语音，但输入系统如果重构，应预留多输入源。

建议统一输入来源：

```ts
type AiInputSource =
  | 'keyboard'
  | 'slash_command'
  | 'context_menu'
  | 'resource_manager'
  | 'schema_compare'
  | 'voice'
  | 'workflow'
```

这样未来从资源管理器右键、Schema 对比、ERP 模块、语音输入进入 AI，都不会各写一套提交逻辑。

### 2.12 UI Backpressure：对话滚动、流式输出、长列表必须限流

Claude Code 是终端 UI，DevForge 是 Vue 桌面 UI，但“输出太快导致 UI 卡顿”的问题相同。DevForge 需要明确 backpressure 策略。

建议规则：

- 流式 token 不逐 token 写响应式状态，按 50-100ms 批量 flush。
- 大消息 markdown 渲染使用 memo/cache，内容不变不重算。
- 历史消息虚拟滚动，默认只渲染可视区域。
- 代码块高亮延迟到消息完成后执行。
- compact、schema compare、ERP tree 这类大数据结果分页展示。
- 滚动跟随只在用户位于底部时启用，用户向上查看时停止自动吸底。

需要加的监控：

- 单次 flush 字符数。
- 消息列表渲染耗时。
- markdown 渲染耗时。
- 主线程 long task 数量。
- 自动滚动触发次数。

## 3. 建议落地顺序

### P0：先治卡顿和不可控 ✅ 已完成

1. `AiTraceSpan` + 本地诊断包。
2. 输入 `Intent Resolver`，统一 Enter / Slash / @ / 按钮提交。
3. 流式输出 backpressure，降低对话滚动卡顿。
4. Compact / ERP / Schema Compare 接入后台 job。
5. Feature Gate 基础版，能快速关闭实验能力。

### P1：提升长期可维护性 ✅ 已完成

1. Output Styles。
2. Config Migration。
3. Session Discovery / Resume。
4. Team Memory Review。
5. Workflow Scripts MVP。

### P2：增强自主协作 ✅ 已完成

1. Proactive Tick。
2. Daemon / Worker 多进程化。
3. 多输入源统一。
4. 远程控制与后台任务联动。

## 4. 与前三份文档的关系

这份文档不是新增一堆炫技功能，而是补齐 DevForge AI 的“地基”：

- 第一份文档解决“AI 怎么跑”。
- 第二份文档解决“AI 怎么产品化”。
- 第三份文档解决“AI 怎么更强”。
- 本文解决“AI 怎么稳定、可控、不卡、可演进”。

如果实施资源有限，建议先做本文 P0。因为只要卡顿、卡死、不可诊断还存在，任何高级 Agent 能力都会被用户体验抵消。

## 5. 可直接拆给同事的任务清单

### 任务 A：AI 诊断包 MVP

- 新增 `AiTraceSpan` 类型和 trace store。
- 对输入提交、provider 请求、首 token、流式渲染、持久化加 span。
- AI 面板增加“导出诊断包”。
- 导出内容过滤 API key、token、密码。

### 任务 B：输入 Intent Resolver

- 梳理 `AiInputArea`、`SlashCommandPopover`、`AtMentionPopover` 的 Enter 行为。
- 新增统一 resolver。
- 输入框 Enter、发送按钮、命令选择全部走同一 submit 入口。
- 加最小测试覆盖 IME、Slash、@、Shift+Enter、普通 Enter。

### 任务 C：流式输出 Backpressure

- token buffer 按固定间隔 flush。
- markdown 渲染做缓存。
- 用户离开底部时暂停自动滚动。
- 加消息数量较大时的虚拟滚动预案。

### 任务 D：后台 Job Runtime MVP

- 后端定义 job id、状态、进度、取消。
- 前端提供 job store 和订阅。
- 先接 `/compact` 与 ERP 功能加载。
- 同类 job 去重，避免重复压缩和重复扫描。

### 任务 E：Feature Gate 基础版

- 支持默认值、本地设置、项目设置。
- AI 设置页展示实验能力开关。
- Compact v2、后台 job、诊断包先接入 gate。

## 6. 结论

Claude Code 值得学习的不只是 Agent Loop 和工具调用，更重要的是它围绕复杂 AI 系统建立了一整套“可灰度、可诊断、可恢复、可持续运行”的工程体系。

DevForge 接下来如果要让 AI 真正变强，建议先把这套工程内功补上：先让系统不卡、不死锁、可定位、可回滚，再逐步加多 Agent、主动任务和工作流自动化。这样后续能力越多，系统不会越脆。
