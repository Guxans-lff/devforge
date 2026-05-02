# DevForge AI 架构成熟度对比与整改路线

更新时间：2026-05-02

对比对象：

- `D:\Project\DevForge\devforge`
- `D:\Project\claude-code-main`
- `D:\Project\jetbrains-cc-gui-main`

## 1. 总体结论

DevForge 当前已经具备可继续演进的 AI Desktop 架构基础，不再是简单聊天 UI：

- 已有 AgentRuntime / TurnRuntime 状态外壳。
- 已有 Provider Gateway、fallback、usage、dashboard 基础。
- 已有 Transcript Event Store 类型与部分后端接口预留。
- 已有 Permission / Path Safety / Patch Review / Verification / Workspace Isolation 安全集合。
- 已有 Multi-Agent / LSP Diagnostics / Verification Agent / Workspace Isolation Backend Executor 的 MVP。

但和两个参考项目相比，DevForge 仍处于“产品能力丰富，但核心 Agent 内核和工程治理未完全沉淀”的阶段：

- 相比 `claude-code-main`，最大差距是 Agentic Loop、Context Compaction、Tool Runtime、Transcript 的内核化程度。
- 相比 `jetbrains-cc-gui-main`，最大差距是 Runtime Lifecycle、Session Registry、Permission IPC、History JSONL、IDE Bridge 的工程稳定性。
- DevForge 的优势是 GUI 产品面更宽，Provider、数据库、SFTP、Git、ERP、Workspace 面板能力更多；风险是前端 composable 和视图仍承担过多业务 orchestration。

建议定位：

> DevForge 应继续走“桌面 AI 工作台 + Agent Runtime 内核”的方向，而不是只做 Claude Code / JetBrains GUI 的外壳复刻。

## 2. 成熟度评分

| 维度 | DevForge 当前 | Claude Code 参考 | JetBrains GUI 参考 | 结论 |
| --- | --- | --- | --- | --- |
| Agent 主循环 | 6/10 | 9/10 | 7/10 | DevForge 有状态外壳，但主循环仍散在 runner / tool loop / UI glue |
| Transcript / 会话持久化 | 6/10 | 9/10 | 8/10 | DevForge 有事件类型和内存 store，但后端事件源还不彻底 |
| Context Compaction | 5/10 | 9/10 | 7/10 | DevForge 可用，但缺 boundary / microcompact / tool invariant |
| Tool Runtime | 6/10 | 9/10 | 7/10 | DevForge 工具丰富，但 Tool as Capability 抽象还不够硬 |
| Permission / Safety | 6.5/10 | 9/10 | 8/10 | DevForge 有风险摘要和规则基础，但多来源权限、持久决策还需增强 |
| Provider Gateway | 7/10 | 6/10 | 7/10 | DevForge 已有优势，但 Profile 后端化、成本和限流闭环还要做实 |
| Workspace Isolation | 5.5/10 | 9/10 | 6/10 | DevForge 有 executor MVP，但缺 git worktree 生命周期级隔离 |
| Multi-Agent | 4.5/10 | 8/10 | 6/10 | DevForge 目前偏 plan/assignment，不是真实 worker runtime |
| GUI 产品体验 | 7.5/10 | 6/10 | 8/10 | DevForge 面板丰富，但超长会话和大组件风险仍需压住 |
| 工程可维护性 | 6/10 | 8.5/10 | 8/10 | DevForge 模块开始拆分，但 `AiChatView.vue` 仍过重 |

综合判断：

- 当前可作为内部高强度测试版本。
- 若要进入真实长期使用，需要优先补齐 Agent Runtime、Transcript、Compaction、Permission、Workspace Isolation 五条主干。
- 不建议继续无序堆功能，否则会放大大会话卡死、状态漂移、权限绕过、压缩上下文不一致的问题。

## 3. 和 Claude Code 的关键差距

### 3.1 Agentic Loop 还没有完全内核化

Claude Code 的结构是：

```text
QueryEngine
  -> query()
    -> queryLoop()
      -> preprocess context
      -> streaming model call
      -> tool execution
      -> append tool results
      -> continue / complete / abort / recover
```

特点：

- `QueryEngine` 管多轮、持久化、成本、权限上下文。
- `queryLoop` 是真正状态机，每轮都用明确 State 传递。
- Tool execution 是 Agent loop 的一等阶段，不是 UI 辅助函数。
- Streaming-first，工具和流式事件天然进入同一个循环。

DevForge 当前已有：

- `src/composables/ai/AgentRuntime.ts`
- `src/composables/ai/AiTurnRuntime.ts`
- `src/composables/ai/chatSessionRunner.ts`
- `src/composables/ai/chatToolLoop.ts`

问题：

- `AgentRuntime` 更像状态观测和过渡外壳，核心业务仍在 `chatSessionRunner` / `chatToolLoop`。
- `useAiChat.ts`、`AiChatView.vue` 仍参与较多 orchestration，容易出现 UI 状态和 runtime 状态漂移。
- Tool loop、recovery、compact、routing 还没有统一变成“事件驱动状态机”。

整改方向：

- 建立 `AgentRuntimeEngine`，把 `send -> stream -> tools -> followup -> compact -> recover -> finish` 收敛到一个核心 runtime。
- UI 只订阅 runtime snapshot 和 transcript projection，不直接驱动主循环细节。
- 每个阶段必须产生 transcript event，禁止只有日志没有事件。

### 3.2 Context Compaction 需要升级为边界系统

Claude Code 的 compaction 不是简单摘要：

- `MicroCompact` 清理旧工具输出，但保留消息结构。
- `CompactBoundary` 标记压缩边界。
- 保留 tool_use / tool_result 配对不变量。
- 压缩后 transcript 仍保留原始历史，只是不再全部送入模型。
- 每轮前动态评估 token budget，而不是固定 N 轮触发。

DevForge 当前问题：

- Auto compact 已能用，但边界语义不够强。
- 超长工具结果、图片、Markdown、长代码块仍可能压垮前端或上下文预算。
- 压缩结果、保留段、工具配对关系没有统一成为 transcript invariant。

整改方向：

- 新增 `CompactBoundaryEvent` 和 `MicroCompactBoundaryEvent`。
- 给每条 tool call / tool result 建立稳定 id 配对。
- 压缩只影响 model context projection，不删除 event store 原始事件。
- 工具输出分层：完整结果落 event store，UI 渲染 preview，模型上下文走 budgeted projection。

### 3.3 Tool as Capability 还不够强

Claude Code 的工具接口是能力边界：

```text
validateInput -> canUseTool -> checkPermissions -> call -> ToolResult
```

DevForge 当前问题：

- 工具执行能力分散在 `chatToolExecution`、数据库/SFTP/Git composable、Tauri command、面板逻辑中。
- 工具分类、权限、风险摘要、执行结果、可恢复策略没有完全统一。
- Tool result 对 UI、Transcript、Model Context 的投影策略还不一致。

整改方向：

- 建立统一 `AiToolDefinition`：
  - schema
  - risk profile
  - permission policy
  - executor
  - result projector
  - retry policy
  - audit event mapper
- 后续所有工具都通过 registry 接入，不直接在 chat loop 中分支硬写。

## 4. 和 JetBrains GUI 的关键差距

### 4.1 Runtime Lifecycle 和 Session Registry 不够后端化

JetBrains GUI 的 bridge 层有：

- `channel-manager.js`：统一 provider command entry。
- `runtime-registry.js`：按 session / signature 管 runtime。
- `runtime-lifecycle.js`：创建、复用、dispose、idle cleanup。
- `session-service.js`：JSONL history 持久化和恢复。
- `stream-event-processor.js`：统一处理 stream event。

DevForge 当前问题：

- Provider Gateway 在前端侧已经较强，但 runtime lifecycle 仍不够像服务端内核。
- 会话恢复、长会话加载、compact 后恢复仍容易受前端内存和 projection 影响。
- 没有统一的 runtime registry 来管理 session runtime、anonymous runtime、active turn。

整改方向：

- 在 Tauri/Rust 或独立 backend service 增加 `agent_runtime` 模块：
  - `create_runtime`
  - `resume_runtime`
  - `dispose_runtime`
  - `list_runtime_sessions`
  - `append_event`
  - `load_projection`
- 前端只拿分页 projection，不直接持有完整重型历史。

### 4.2 Permission IPC / Path Safety 更成熟

JetBrains GUI 的权限设计特点：

- READ_ONLY / SAFE_ALWAYS_ALLOW / EDIT / EXECUTION 工具分层。
- 路径重写和危险路径检查在 bridge 层强制执行。
- 权限请求通过 IPC 到 Java UI，用户决策回流 runtime。

DevForge 当前已有：

- 风险摘要。
- 路径安全。
- Provider 权限映射。
- Workspace Isolation 边界。

问题：

- 权限策略来源还不够完整：session / project / user / managed / command。
- 权限决策和 transcript、diff review、workspace isolation 的联动还不够强。
- 某些危险操作更多是 UI 确认，不一定是 runtime 强制边界。

整改方向：

- 建立 `PermissionEngine`：
  - rule source priority
  - tool matcher
  - command matcher
  - path matcher
  - provider capability matcher
  - decision persistence
  - transcript audit
- 所有工具执行前必须走 runtime permission gate，UI 确认只是决策来源之一。

### 4.3 History 和大文件会话加载策略需要继续加强

JetBrains GUI 使用 JSONL 和 tail read 等方式降低大历史读取压力。

DevForge 已经修过大会话卡死，但架构上仍需避免回归：

- 不要一次性把完整历史转成完整 DOM。
- 不要让 Markdown / DOMPurify / 图片 / tool cards 对全量消息同步执行。
- 不要让 compact 或 load history 在 UI setup 阶段做重计算。

整改方向：

- 后端 event store + 前端窗口投影。
- 历史读取分页、按需 hydrate。
- Markdown sanitize 分块、缓存、idle 处理。
- Tool card 默认摘要，展开后再加载详情。

## 5. DevForge 当前优势

DevForge 不应该完全照抄两个参考项目，因为它的产品定位更宽：

- Tauri 桌面应用比 CLI 更适合做多面板工作台。
- 已有数据库、SFTP、Git、ERP、Provider 管理等非纯 AI 能力。
- Provider Gateway 和多供应商治理比 Claude Code CLI 方向更贴近国内/企业落地。
- GUI 可以把运行态、权限、验证、成本、fallback、工作区隔离可视化，这是 CLI 的弱项。

应保留并强化的方向：

- Provider Profile Bundle。
- Gateway Dashboard。
- Run Inspector / Diagnostics Panel。
- Verification Center。
- Workspace Isolation Panel。
- Patch Review / Diff Review。
- SFTP/DB/Git 风险确认体系。

## 6. 最高优先级整改路线

### P0-1：AgentRuntimeEngine 核心化

目标：

- `chatSessionRunner` 和 `chatToolLoop` 变成 runtime engine 内部步骤。
- UI 不直接编排 tool loop。
- Runtime 输出统一 snapshot + transcript events。

交付：

- `src/composables/ai/AgentRuntimeEngine.ts`
- `src/composables/ai/AgentRuntimeTypes.ts`
- `src/composables/ai/AgentRuntimeProjection.ts`
- 针对 send / stream / tool / compact / abort / recover 的单测。

验收：

- 发消息、工具调用、fallback、compact、abort、continue 都能从 transcript events 复盘。
- `AiChatView.vue` 不再直接处理主链路业务细节。

### P0-2：Transcript 后端事件源

目标：

- 所有 turn、message、tool、permission、compact、routing、usage、verification 进入 event store。
- 前端只读取 projection，不持有全量重型历史。

交付：

- Tauri command：append/list/search/export transcript events。
- SQLite 或 JSONL 存储适配。
- 前端 transcript store 只做缓存和 projection。

验收：

- 应用重启后能恢复完整 session。
- 大会话不会一次性渲染全量消息。
- compact 后仍可追溯原始事件。

### P0-3：Compaction Boundary / MicroCompact

目标：

- 压缩从“减少消息”升级为“上下文投影策略”。

交付：

- `CompactBoundaryEvent`
- `MicroCompactBoundaryEvent`
- `ModelContextProjector`
- `ToolResultBudgeter`

验收：

- tool_use / tool_result 不会被压坏。
- 原始 transcript 不丢。
- 超长工具输出不会进入完整 DOM 和完整 model context。

### P1-1：PermissionEngine 规则引擎

目标：

- Allow / Ask / Deny 统一由 runtime permission gate 执行。

交付：

- `PermissionRuleSource = session | project | user | managed | command`
- tool / command / path / provider capability matcher
- decision store
- diff review / workspace isolation 联动

验收：

- UI 绕过不了 runtime gate。
- 每次危险操作都有 transcript audit。
- 同一 session 可记住用户决策。

### P1-2：Workspace Isolation 升级为 worktree lifecycle

目标：

- 让高级 Agent / Multi-Agent 具备真实隔离工作目录，而不是仅靠路径边界提示。

交付：

- git worktree create / reuse / diff / apply / cleanup。
- fail-closed cleanup。
- session isolation metadata persistence。
- sparse checkout 可选策略。

验收：

- 子任务可在隔离目录改代码。
- 合并前必须 diff review + verification gate。
- 失败时不会污染主工作区。

### P2：Multi-Agent / LSP / Verification Agent 深水区

目标：

- 在 P0/P1 稳定后，再做真正多 Agent。

交付：

- worker runtime。
- agent mailbox / event stream。
- real LSP server adapter。
- verification queue。
- cross-agent dependency graph。

验收：

- 多 Agent 不是 UI 列表，而是真实隔离执行单元。
- 每个 Agent 有独立 transcript、workspace、permission scope、verification result。

## 7. 不建议继续做的事情

短期不建议：

- 继续在 `AiChatView.vue` 内追加主链路逻辑。
- 把 Multi-Agent 做成只展示卡片、不执行隔离 runtime 的“假并行”。
- 只靠轮数触发 compact。
- 把权限确认只放在按钮层。
- 让前端直接加载和渲染完整大会话。
- 给每个 provider 写一套完全散乱的调用逻辑。

Provider 适配的建议方式：

- Gateway 保持统一入口。
- Provider Adapter 负责协议差异。
- Capability Matrix 描述模型能力。
- Tool / JSON / Thinking / Prefix / FIM 通过 capability 自动选择参数。
- 不要把 DeepSeek / Kimi / Mimo / OpenAI 全部硬编码进 chat loop。

## 8. 下一步建议

建议下一步直接做两件事：

1. 新建 `AgentRuntimeEngine`，把当前 `chatSessionRunner` / `chatToolLoop` 的状态迁移进去。
2. 新建后端 `transcript_event_store`，先支持 append / list / export，再逐步替换前端 localStorage 事件存储。

这两项是后续所有高级能力的地基。先做它们，比继续堆 Multi-Agent UI、LSP 面板、Verification 面板更有价值。
