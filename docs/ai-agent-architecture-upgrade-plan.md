# DevForge AI Agent 架构升级规划（对标 Claude Code）

日期：2026-04-24
参考项目：`D:\Project\claude-code-main`
适用项目：`D:\Project\DevForge\devforge`

## 1. 背景

DevForge 当前已经具备 AI 对话、流式输出、工具调用、上下文文件、提示词优化、SQL Builder、ER 图等能力，但从近期问题看，AI 子系统仍存在几个明显短板：

- 对话压缩依赖单次流式调用，完成信号不稳定时容易卡住 UI。
- 压缩缺少明确边界，历史消息和摘要消息之间没有可追踪的上下文切分点。
- 工具执行、错误恢复、压缩、发送收尾分散在多个 composable 中，状态流不够集中。
- 工具结果预算、上下文预算、模型恢复策略还不够系统。
- 权限、安全确认和 Hook 生命周期还未形成统一机制。

Claude Code 的优势不在某个单点功能，而在它把 AI 对话视为一个可恢复、可压缩、可审计、可调度的 Agent Runtime。DevForge 可以借鉴其架构思想，但不应照搬其大单体实现。

## 2. Claude Code 值得学习的核心机制

### 2.1 统一 Query Loop

Claude Code 的核心循环大致是：

```text
用户输入
  -> 构建 system/user/system context
  -> queryLoop
     -> 消息预处理（snip/microcompact/context collapse）
     -> autocompact 检查
     -> 模型流式调用
     -> 收集 tool_use
     -> 执行工具
     -> 注入 tool_result / attachments
     -> 判断是否继续下一轮
     -> 错误恢复或完成
```

参考：`D:\Project\claude-code-main\learn\phase-2-conversation-loop.md`

DevForge 当前已有 `runAiChatSessionTurn`，但建议继续演进为显式状态机：

- `preparing`
- `compacting`
- `requesting`
- `streaming`
- `tool_executing`
- `recovering`
- `completed`
- `failed`
- `aborted`

这样可以减少 UI 卡死、按钮状态不一致、流完成但状态未释放等问题。

### 2.2 Compact Boundary 压缩边界

Claude Code 不只是删除历史，而是插入 `compact_boundary`，后续模型上下文从最后一个边界之后开始。

关键思想：

- 压缩后保留一个边界消息，标记本次压缩发生点。
- 摘要消息紧跟边界之后。
- 后续上下文构建只取最后一个压缩边界之后的消息。
- UI 可保留完整历史，但模型侧只使用压缩后的视图。

参考：

- `D:\Project\claude-code-main\src\utils\messages.ts` 的 `createCompactBoundaryMessage`
- `D:\Project\claude-code-main\src\utils\messages.ts` 的 `getMessagesAfterCompactBoundary`

DevForge 建议新增：

```ts
interface AiCompactBoundaryMeta {
  trigger: 'manual' | 'auto' | 'recovery'
  preTokens: number
  summarizedMessages: number
  createdAt: number
  summaryMessageId: string
}
```

并在 `AiMessage` 中支持：

```ts
type: 'compact-boundary' | 'divider'
compactMetadata?: AiCompactBoundaryMeta
```

### 2.3 高保真结构化摘要 Prompt

Claude Code 的 compact prompt 要求保留：

1. 主要请求和意图
2. 关键技术概念
3. 文件和代码位置
4. 错误和修复
5. 问题解决过程
6. 用户原始消息
7. 待办事项
8. 已完成工作
9. 继续工作所需上下文

这比普通“总结一下对话”更适合代码 Agent 继续工作。

DevForge 应保留这一结构，并针对自身能力补充：

- 数据库连接/当前库/表上下文
- 当前工作目录
- 附件文件和上下文文件
- 最近执行的工具命令及结果摘要
- 当前 UI 标签页/任务状态
- 未完成的验证命令

### 2.4 Post-Compact 上下文恢复

Claude Code 在压缩后重新注入必要上下文，例如：

- 文件读取状态
- Plan 状态
- 已发现工具/技能
- Deferred tools
- Agent 列表
- MCP instructions

参考：`D:\Project\claude-code-main\src\services\compact\compact.ts`

DevForge 可做轻量版：

- 恢复当前 `workDir`
- 恢复当前打开/选中的文件附件
- 恢复最近 N 个工具结果摘要
- 恢复当前 Plan/任务列表
- 恢复数据库上下文（连接、database、table、SQL 编辑器状态）

### 2.5 ToolUseContext 工具执行上下文

Claude Code 的工具执行不是散落调用，而是有统一上下文：

- 权限判断
- abort signal
- 进度事件
- 工具结果注入
- 工具结果预算
- Hook 回调
- 工具执行状态

DevForge 当前工具执行分散在前后端 API 和 composable 中，建议抽象成统一 `AiToolRuntime`。

建议接口：

```ts
interface AiToolRuntime {
  canUseTool(tool: AiToolCall): Promise<ToolPermissionDecision>
  execute(tool: AiToolCall, context: AiTurnContext): Promise<AiToolResult>
  summarizeResult(result: AiToolResult, budget: TokenBudget): Promise<AiToolResultView>
  abort(toolCallId: string): Promise<void>
}
```

### 2.6 错误恢复策略

Claude Code 有多种恢复路径：

- prompt too long -> reactive compact retry
- max output tokens -> recovery continue
- missing tool result -> 补错误 tool_result
- abort -> 明确终止态
- API fallback -> 切备用模型

DevForge 可优先实现：

- `context_length_exceeded` -> 自动压缩并重试一次
- `max_tokens`/`length` -> 自动继续一次或提示用户
- stream stalled -> watchdog abort + 可恢复状态
- tool result too large -> 落盘 + 摘要注入
- provider error -> fallback model 或提示切换 provider

### 2.7 Provider Adapter 分层

Claude Code 文档中把 provider 拆成：

- 消息格式转换
- 工具格式转换
- stream adapter
- model mapping
- client

DevForge 当前 provider 适配已有基础，但建议标准化内部事件协议：

```ts
AiStreamEvent =
  | TextDelta
  | ThinkingDelta
  | ToolCallStart
  | ToolCallDelta
  | ToolCallDone
  | Usage
  | Done
  | Error
```

所有 Provider 最终都转成这套事件，UI 和 Agent Runtime 不感知底层模型差异。

### 2.8 Hook 生命周期

Claude Code 支持类似：

- `PreCompact`
- `PostCompact`
- `SessionStart`
- `Stop`
- `PreToolUse`
- `PostToolUse`

DevForge 可先实现内部 Hook，不急着开放插件：

```ts
type AiHookEvent =
  | 'pre_compact'
  | 'post_compact'
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'turn_start'
  | 'turn_end'
  | 'session_start'
  | 'session_stop'
```

典型用途：

- 压缩前保存当前 UI 状态
- 压缩后恢复上下文附件
- 工具执行后刷新资源树/数据库树
- 会话结束时写入长期记忆

## 3. DevForge 建议目标架构

```text
src/composables/ai-agent/
  runtime/
    AiTurnRuntime.ts          # 单轮状态机
    AiSessionRuntime.ts       # 会话级状态、历史、压缩边界
    AiContextBuilder.ts       # 构建模型上下文
    AiRecoveryManager.ts      # 错误恢复策略
  compact/
    compactPrompt.ts          # Claude Code 风格结构化摘要 Prompt
    compactBoundary.ts        # 压缩边界消息
    compactRunner.ts          # AI 摘要、超时、abort、fallback
    postCompactRestore.ts     # 压缩后上下文恢复
  tools/
    AiToolRuntime.ts          # 工具执行统一入口
    toolResultBudget.ts       # 工具结果预算/摘要/落盘
    permissions.ts            # 工具权限策略
  providers/
    ProviderAdapter.ts        # Provider 统一接口
    streamEvents.ts           # 内部标准事件
  hooks/
    AiHookManager.ts          # 生命周期 Hook
```

现有文件逐步迁移：

- `src/composables/useAiChat.ts` -> 保留 UI-facing API，内部委托 runtime
- `src/composables/useAutoCompact.ts` -> 拆到 `compact/compactRunner.ts`
- `src/composables/ai/chatSessionRunner.ts` -> 演进为 `AiTurnRuntime`
- `src/composables/ai/chatToolExecution.ts` -> 迁移到 `tools/AiToolRuntime.ts`
- `src/api/ai.ts` -> 保持 API 封装，但流事件进入 ProviderAdapter

## 4. 分阶段实施计划

### P0：修稳压缩系统

目标：让 `/compact` 可靠、质量高、不卡 UI。

任务：

1. 增加 `compact-boundary` 消息类型。
2. 模型上下文构建时只使用最后一个 boundary 之后的消息。
3. 使用 Claude Code 风格 9 段摘要 Prompt。
4. compact request 使用独立 `sessionId`。
5. 加 `AbortController`/后端 abort 支持。
6. 超时后 abort 请求，并使用本地降级摘要。
7. 压缩后保留最近 N 条消息和当前工作上下文。
8. UI 显示压缩结果：压缩前 tokens、释放 tokens、摘要来源（AI/local）。

验收标准：

- `/compact` 不会无限卡住。
- 压缩后继续问“刚才做到哪了”能准确回答。
- 连续压缩不会重复总结已经被压缩的历史。
- `pnpm test:typecheck` 和相关交互测试通过。

### P1：Agent Turn 状态机

目标：统一一轮 AI 交互的状态和恢复。

任务：

1. 定义 `AiTurnState`。
2. 将 send/stream/tool/finalize/recovery 收敛到一个 runtime。
3. UI 只订阅 runtime 状态，不直接猜测 loading/streaming/compacting。
4. 增加 turn watchdog：流卡住、工具卡住、模型无 Done 都可恢复。
5. 每个 turn 生成 `turnId`，日志和工具结果都关联 turn。

验收标准：

- 任何异常都能落入 `failed` 或 `recovering`，不会停在中间态。
- Abort 能中止模型和工具。
- UI 按钮状态和 runtime 状态一致。

### P1：工具结果预算

目标：防止工具输出撑爆上下文。

任务：

1. 所有工具结果进入 `toolResultBudget`。
2. 大结果自动落盘，只注入摘要和文件引用。
3. Bash/SFTP/文件读取/数据库查询统一结果视图。
4. 工具结果可展开查看全文，但模型只吃预算内摘要。

验收标准：

- 大命令输出不会导致上下文 100%。
- 工具结果可追踪、可打开、可重新注入。

### P2：权限与 Hook

目标：提高安全性和扩展性。

任务：

1. 定义工具风险等级：read/write/destructive/external/db-mutation。
2. 数据库迁移、文件写入、Shell 执行接入统一权限确认。
3. 增加内部 Hook：pre/post compact、pre/post tool、turn start/end。
4. 压缩后自动刷新必要上下文。

验收标准：

- 高风险操作必须有明确确认。
- Hook 不阻塞主链路，失败可记录但不拖死 UI。

### P2：Provider Adapter 标准化

目标：支持更多模型且减少事件差异导致的 bug。

任务：

1. 定义标准 `AiStreamEvent`。
2. OpenAI-compatible、Anthropic、Gemini/Kimi 分别写 adapter。
3. 工具调用流统一转为 ToolCallStart/Delta/Done。
4. Usage/Done/Error 必须最终归一化。

验收标准：

- UI 和 Runtime 不依赖 provider 特殊字段。
- 更换 provider 不影响工具和压缩逻辑。

## 5. 当前 DevForge 可立即修正的问题

基于近期问题，建议优先处理：

1. `/compact` 卡死：按 P0 重构，不再只靠 UI 层兜底。
2. 压缩摘要质量：使用结构化 9 段摘要，并保存 boundary。
3. 输入框命令：`/compact`、`@file` 的键盘事件统一由父组件调度，避免 Enter 被截断。
4. 工具结果过大：Shell 输出、文件读取结果进入预算器。
5. Schema 对比/迁移 SQL：执行前接入权限确认和风险分级。

## 6. 不建议照搬的部分

- 不建议照搬 Claude Code 的超大单体文件，它自身也存在历史包袱。
- 不建议一次性实现完整 subagent/team/plugin 系统，DevForge 目前更需要稳定主链路。
- 不建议把 UI 状态继续堆在组件层，应把状态下沉到 Agent Runtime。
- 不建议所有压缩都依赖网络 AI 摘要，必须有本地 fallback 和 abort。

## 7. 推荐下一步

建议下一步先做 P0：压缩系统重构。

最小实施范围：

- `src/types/ai.ts`
- `src/composables/useAiChat.ts`
- `src/composables/useAutoCompact.ts`
- `src/composables/ai/chatSessionRunner.ts`
- `src/components/ai/AiMessageListVirtual.vue`
- `src/components/ai/AiCompactBanner.vue`
- 相关测试：`src/views/__tests__/AiChatView.interaction.test.ts`

预期收益：

- 解决压缩卡死。
- 压缩后上下文质量接近 Claude Code。
- 后续自动压缩、错误恢复、工具预算都能基于 boundary 继续演进。
