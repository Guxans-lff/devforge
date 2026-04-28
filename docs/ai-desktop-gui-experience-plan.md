# DevForge AI 能力增强补充规划（六）：桌面 GUI 体验、IDE 集成与交互韧性

日期：2026-04-24
参考项目：`D:\Project\jetbrains-cc-gui-main`
关联文档：

- `docs/ai-agent-architecture-upgrade-plan.md`
- `docs/ai-agent-engineering-governance-plan.md`
- `docs/ai-provider-gateway-governance-plan.md`
- `docs/ai-agent-productization-upgrade-plan.md`
- `docs/ai-agent-advanced-capabilities-plan.md`

## 1. 文档目标

`jetbrains-cc-gui-main` 是一个 JetBrains 插件项目，通过 Java 插件层、React WebView 和 Node `ai-bridge` 将 Claude Code / Codex 接入 IDE。它和 DevForge 的相似点不是技术栈完全一致，而是都属于“桌面 GUI + AI 编程助手”的场景。

本文重点吸收它在以下方面的经验：

- WebView / 对话列表性能优化。
- 消息合并、turn scope 和工具展示。
- Bridge 回调分层。
- 状态面板 `StatusPanel`。
- 会话回退 `Rewind`。
- 权限弹窗与路径安全。
- Provider Bridge 多引擎抽象。
- 项目级 Prompt / Skill 管理。
- 配置优先级文档化。

本文不是替代第四份“工程治理与体验稳定”，而是补充更偏桌面 GUI 和 IDE-like 体验的细节。

## 2. `jetbrains-cc-gui-main` 值得学习的核心机制

### 2.1 WebView 性能：对象引用稳定性与缓存命中率

该项目专门总结了 WebView 聊天界面的性能问题：当后端每次推送 JSON 字符串，前端 `JSON.parse()` 会生成全新对象树，即使内容没变，也会导致 React memo、WeakMap 和 useMemo 全部失效。

参考文件：

- `D:\Project\jetbrains-cc-gui-main\docs\fix\PERFORMANCE_GUIDE.md`
- `D:\Project\jetbrains-cc-gui-main\webview\src\hooks\useMessageProcessing.ts`

DevForge 当前 Vue 对话也存在类似风险：

- 流式 token 更新过频。
- 消息对象每次全量重建。
- Markdown 渲染重复计算。
- 工具调用/Thinking 消息合并导致大数组反复复制。
- 滚动和虚拟列表因引用变化频繁重算。

建议新增 `AiMessageStableMerger`：

```ts
interface StableMessageMergeCache {
  byMessageId: Map<string, AiMessage>
  byAssistantGroup: Map<string, AiMessage>
  markdownCache: WeakMap<object, RenderedMarkdown>
}
```

核心原则：

- 消息内容未变时复用旧对象引用。
- 合并后的 assistant group 未变时复用旧合并对象。
- Markdown / content blocks 使用 WeakMap 或 key-based cache。
- 切换 session、语言、主题、字体时清空相关缓存。
- 流式更新只更新最后一条 active message，不重建整棵消息树。

### 2.2 消息合并与 Turn Scope：让 Thinking / Tool / Text 展示更稳定

`jetbrains-cc-gui-main` 有 `mergeConsecutiveAssistantMessages` 和 `turnScope`，用于处理连续 assistant 消息、thinking、tool use、tool result 的展示合并，同时保留 turn 信息。

参考文件：

- `D:\Project\jetbrains-cc-gui-main\webview\src\utils\messageUtils.ts`
- `D:\Project\jetbrains-cc-gui-main\webview\src\utils\turnScope.ts`

DevForge 可借鉴为：

```ts
interface AiTurnScope {
  turnId: string
  sessionId: string
  userMessageId: string
  assistantMessageIds: string[]
  toolCallIds: string[]
  startedAt: number
  finishedAt?: number
}
```

展示层规则：

- 同一个 turn 的 assistant text / thinking / tool calls 可以合并为一个展示块。
- 原始消息仍保留，不破坏持久化。
- 合并只发生在 UI projection 层。
- projection 必须缓存，避免每次滚动都重新合并。
- compact boundary、divider、user message 必须打断合并。

这能解决：

- 工具调用多时聊天气泡过碎。
- Thinking 与正文分离导致阅读割裂。
- 合并逻辑影响原始消息结构。
- 大对话滚动卡顿。

### 2.3 Bridge 回调分层：不要让 Tauri invoke/event 变成巨型文件

该项目把 WebView 回调拆成多个模块，例如 message、streaming、session、permission、agent、settings 等，而不是所有回调堆在一个文件里。

参考文件：

- `D:\Project\jetbrains-cc-gui-main\webview\src\hooks\windowCallbacks\registerCallbacks.ts`
- `D:\Project\jetbrains-cc-gui-main\webview\src\utils\bridge.ts`

DevForge 当前 Tauri API 随功能增多也会有膨胀风险。建议拆分：

```text
src/bridge/
  aiMessageBridge.ts
  aiStreamingBridge.ts
  aiSessionBridge.ts
  aiPermissionBridge.ts
  aiProviderBridge.ts
  aiSettingsBridge.ts
  aiTaskBridge.ts
  aiFileBridge.ts
```

每个 bridge 文件只做三件事：

1. typed invoke/event 封装。
2. 参数校验和脱敏。
3. 错误归一化。

不要在 bridge 层写业务状态。

### 2.4 StatusPanel：把 AI 状态从聊天气泡里解放出来

`jetbrains-cc-gui-main` 有 `StatusPanel`，集中展示任务、subagent、文件变更、撤销入口等。这个能力非常适合 DevForge。

参考文件：

- `D:\Project\jetbrains-cc-gui-main\webview\src\components\StatusPanel\StatusPanel.tsx`

DevForge 建议新增 `AiStatusPanel`：

```ts
interface AiStatusPanelState {
  activeTurn?: AiTurnScope
  planItems: AiPlanItem[]
  runningTools: AiToolExecution[]
  backgroundJobs: AiBackgroundJob[]
  fileChanges: AiFileChange[]
  diagnostics: AiTraceSpan[]
  providerHealth: AiProviderHealth[]
}
```

展示内容：

- 当前 AI 阶段：preparing / streaming / tool_executing / compacting / recovering。
- 当前 Plan / TODO。
- 正在执行的工具。
- 后台 Job：compact、ERP load、schema compare。
- 文件变更列表。
- 一键撤销 / 丢弃。
- Provider 状态。
- 最近错误。

收益：

- 用户不用从长对话里找状态。
- 长任务不再表现为“卡住”。
- 工具执行和文件变更更可控。
- 后续多 Agent 有统一可视化入口。

### 2.5 Rewind / Fork：从某条消息回退或分叉会话

该项目支持会话回退，用户可以选择历史消息回退。DevForge 目前更适合做两个能力：

1. `Rewind`：回到某条消息，删除后续上下文或隐藏后续分支。
2. `Fork`：从某条消息创建新会话分支，保留原会话。

参考文件：

- `D:\Project\jetbrains-cc-gui-main\webview\src\components\RewindDialog.tsx`
- `D:\Project\jetbrains-cc-gui-main\webview\src\components\RewindSelectDialog.tsx`

建议数据结构：

```ts
interface AiConversationBranch {
  id: string
  sessionId: string
  parentBranchId?: string
  forkFromMessageId?: string
  title: string
  createdAt: number
}
```

优先做 Fork，不建议一开始物理删除历史。

验收标准：

- 用户能从任意 user message 创建分支。
- 分支保留 compact boundary。
- 分支保留必要上下文和附件引用。
- 原会话不被破坏。

### 2.6 权限弹窗与路径安全：自动编辑必须有工作区边界

`jetbrains-cc-gui-main` 对路径安全做了很多处理：

- 将 `/tmp` 等临时目录路径重写到项目根目录下。
- 检查路径是否在允许工作区内。
- 禁止自动编辑危险文件和目录，如 `.git`、`.idea`、`.claude`、`.gitconfig`、`.mcp.json` 等。
- 对路径穿越做前后端双层校验。

参考文件：

- `D:\Project\jetbrains-cc-gui-main\ai-bridge\permission-safety.js`
- `D:\Project\jetbrains-cc-gui-main\ai-bridge\permission-handler.js`

DevForge Tool Runtime 应新增：

```ts
interface AiPathSafetyResult {
  safe: boolean
  normalizedPath?: string
  reason?: string
  requiresConfirmation?: boolean
}
```

默认规则：

- 自动写入只允许 workspace 内。
- 默认禁止 `.git`、`.idea`、`.vscode`、`.claude`、`.devforge` 敏感配置目录。
- 默认禁止 shell profile、git config、mcp config 等敏感文件。
- 工作区外读取需要确认，写入默认禁止。
- 临时目录路径不能直接写，必须映射或确认。

这应纳入第一份文档的 ToolUseContext 和第四份文档的 Safety / Permission。

### 2.7 Provider Bridge 多引擎抽象：统一权限、会话和事件

该项目有 Claude / Codex 双引擎 bridge，核心设计包括：

- `channel-manager` 负责按 provider 路由。
- 统一权限模型再映射到 provider-specific permission。
- Claude 的 `sessionId` 和 Codex 的 `threadId` 在上层抽象为 conversation id。
- 不同 provider 事件输出标准化为统一事件。

参考文件：

- `D:\Project\jetbrains-cc-gui-main\docs\codex\MULTI-PROVIDER-ARCHITECTURE.md`
- `D:\Project\jetbrains-cc-gui-main\ai-bridge\channel-manager.js`
- `D:\Project\jetbrains-cc-gui-main\ai-bridge\utils\permission-mapper.js`

这与第五份 Provider Gateway 文档高度契合。DevForge 建议补一个 `AiPermissionMapper`：

```ts
type AiUnifiedPermissionMode = 'read_only' | 'workspace_write' | 'full_access'

interface AiPermissionMapper<TProviderConfig> {
  toProvider(mode: AiUnifiedPermissionMode): TProviderConfig
  fromProvider(config: TProviderConfig): AiUnifiedPermissionMode
}
```

不同 provider / tool runtime 可以映射为：

- Claude-like：default / sandbox / yolo。
- Codex-like：read-only / workspace-write / danger-full-access。
- DevForge Tool Runtime：read / write / destructive / external / db-mutation。

### 2.8 项目级 Prompt 管理：Prompt 也应该分 scope

该项目支持项目级 prompt，存储在项目目录下 `.codemoss/prompt.json`，并有 global/project 管理器。

参考文件：

- `D:\Project\jetbrains-cc-gui-main\src\main\java\com\github\claudecodegui\settings\ProjectPromptManager.java`
- `D:\Project\jetbrains-cc-gui-main\src\main\java\com\github\claudecodegui\settings\GlobalPromptManager.java`

DevForge 建议统一 Prompt Scope：

```ts
type AiPromptScope = 'builtin' | 'user' | 'workspace' | 'session'
```

目录建议：

- workspace：`.devforge/prompts/*.md`
- user：`~/.devforge/prompts/*.md`
- builtin：应用内置。

优先级：session > workspace > user > builtin。

注意：这和 Output Styles、Memory、Skill 要共用配置优先级规则。

### 2.9 Skill 管理 UI：Skill 不只是文件扫描，还要可管理

该项目有 `SkillManager`，负责 Skill 读取、校验、增删改、同步配置。

参考文件：

- `D:\Project\jetbrains-cc-gui-main\src\main\java\com\github\claudecodegui\settings\SkillManager.java`

DevForge 后续 Skill 应提供 UI：

- 已安装 Skill 列表。
- 启用/禁用。
- scope：全局 / 项目。
- 权限声明。
- 触发词。
- 最近使用。
- 校验错误。

Skill 文件扫描只是基础，产品化必须有管理入口。

### 2.10 配置优先级文档化：减少“为什么没生效”

该项目把配置优先级写得很清楚：环境变量 > 用户配置 > 默认值。

参考文件：

- `D:\Project\jetbrains-cc-gui-main\docs\fix\CONFIG_PRIORITY_GUIDE.md`

DevForge 后续配置越来越多，需要统一优先级：

```text
会话临时设置
  > workspace 配置
  > 用户配置
  > 环境变量覆盖项
  > 内置默认值
```

但 API key 等敏感项可以单独规定：

```text
显式环境变量 > 系统密钥链/用户配置 > workspace 引用 > 默认空
```

必须在设置页显示“当前值来源”，例如：

- 来源：workspace `.devforge/settings.json`
- 来源：用户配置 `~/.devforge/settings.json`
- 来源：环境变量 `OPENAI_API_KEY`

## 3. DevForge 推荐落地方案

### 3.1 新增 GUI Experience 模块

```text
src/ai-gui/
  messageProjection.ts       # UI 层消息投影、合并、缓存
  messageStableMerge.ts      # 引用稳定复用
  turnScope.ts               # turn 归属和分组
  markdownRenderCache.ts     # markdown/cache 管理
  pathSafety.ts              # 路径安全前端规则
  statusPanelStore.ts        # AI 状态面板状态
  conversationBranch.ts      # rewind/fork 数据结构
```

### 3.2 组件建议

```text
src/components/ai/
  AiStatusPanel.vue
  AiRewindDialog.vue
  AiForkDialog.vue
  AiPermissionDialog.vue
  AiProviderHealthCard.vue
  AiFileChangeList.vue
```

### 3.3 与现有文档关系

- 与第一份文档：补强 Turn Runtime、ToolUseContext、权限路径安全。
- 与第四份文档：补强 WebView 性能、输入体验、诊断可视化。
- 与第五份文档：补强 Provider Bridge、权限映射和配置来源。
- 与第二份文档：补强 Skill、Prompt、会话分支产品化。
- 与第三份文档：为多 Agent / Verification / Workflow 提供可视化状态面板。

## 4. 分阶段实施计划

### P0：先解决聊天 GUI 卡顿与状态不可见

任务：

1. 新增消息 projection 层，原始 messages 和 UI messages 分离。
2. 实现消息对象引用复用。
3. Markdown 渲染缓存。
4. Assistant 连续消息合并缓存。
5. 新增轻量 `AiStatusPanel`，先展示当前 phase、running tools、background jobs。

验收标准：

- 长对话滚动明显更顺。
- 流式输出不导致整列表重渲染。
- 用户能看到 AI 当前在做什么。

### P1：路径安全、Rewind/Fork 与 Bridge 分层

任务：

1. Tool Runtime 接入路径安全策略。
2. 新增 `AiPermissionDialog` 风险说明。
3. 支持从某条消息 fork 新会话。
4. Tauri bridge 按 message/session/streaming/permission/settings 拆分。
5. 设置页展示配置来源。

验收标准：

- 自动写文件不会越过 workspace 边界。
- 高风险路径有明确阻断或确认。
- 用户能从历史消息创建分支。
- bridge 文件不继续膨胀。

### P2：Skill / Prompt / Provider GUI 管理增强

任务：

1. 项目级 Prompt 管理。
2. Skill 管理 UI。
3. Provider permission mapper。
4. MCP 状态检测可视化。
5. 文件变更列表和撤销入口。

验收标准：

- Prompt、Skill、Provider 配置可视化管理。
- 多 Provider 权限语义一致。
- 用户能清楚看到 AI 改了哪些文件，并可撤销。

## 5. 可直接拆给同事的任务清单

### 任务 A：消息 Projection 与缓存

- 新增 `messageProjection.ts`。
- 原始消息不直接用于渲染。
- 合并 assistant group。
- 缓存合并结果和 markdown 渲染结果。

### 任务 B：轻量 StatusPanel

- 新增 `AiStatusPanel.vue`。
- 展示当前 phase、工具执行、后台 Job。
- 可折叠。
- 后续扩展 Plan、Todo、文件变更。

### 任务 C：路径安全策略

- 新增 `pathSafety.ts`。
- 阻止 workspace 外自动写入。
- 阻止 `.git/.idea/.vscode/.claude/.devforge` 自动编辑。
- Tool Runtime 写入前调用。

### 任务 D：Fork 会话

- 从 user message 创建新 branch/session。
- 复制必要上下文、compact boundary、附件引用。
- 原会话不删除。

### 任务 E：Bridge 拆分

- 按 message/session/streaming/permission/settings 拆 API 封装。
- 统一错误处理。
- 参数做基础校验。

## 6. 不建议照搬的部分

- 不建议照搬 JetBrains Java ToolWindow 架构，DevForge 是 Tauri。
- 不建议直接引入 Node `ai-bridge`，DevForge 应保持 Rust 后端为主。
- 不建议使用全局 window callback 模式，Tauri 下应使用 typed invoke/event。
- 不建议把 Rewind 做成物理删除历史，优先做 Fork。
- 不建议把 UI projection 结果写回数据库，projection 应只是展示层。

## 7. 结论

`jetbrains-cc-gui-main` 对 DevForge 最大启发是：AI 桌面应用不只是模型和工具，GUI 体验本身就是核心能力。

DevForge 后续要重点补齐：

1. 长对话不卡顿的消息 projection 和缓存。
2. 可视化状态面板，让用户知道 AI 在做什么。
3. Rewind/Fork，让用户能安全探索不同方案。
4. 路径安全和权限弹窗，让自动编辑可控。
5. 项目级 Prompt、Skill、Provider 配置管理。

这份文档建议插入总体路线中的第二阶段，与“工程治理与体验稳定”并行推进。优先级上，P0 的消息性能和 StatusPanel 应尽早做，因为它们直接影响用户对 AI 是否“卡住”的感知。
