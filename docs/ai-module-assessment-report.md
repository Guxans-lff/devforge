# AI 模块全面评估报告

评估日期：2026-04-20

评估范围：
- 前端：`src/composables/useAiChat.ts`、`src/composables/ai/*`、`src/composables/useToolApproval.ts`、`src/api/ai.ts`、`src/stores/ai-chat.ts`
- 后端：`src-tauri/src/commands/ai.rs`、`src-tauri/src/services/ai/*`

使用的工具与命令：
- 代码检索：`rg`
- TypeScript 类型检查：`pnpm exec vue-tsc -b`
- 前端测试：`pnpm test`
- AI 相关定向测试：`pnpm exec vitest run src/composables/__tests__/useAiChat.multimodal.test.ts src/composables/__tests__/useToolApproval.test.ts`
- Rust 单元测试：`cargo test`
- Rust 静态检查：`cargo clippy --all-targets --all-features -- -D warnings`

## 结论摘要

AI 模块的整体方向是对的：前端已从单一大文件拆分为消息构建、历史恢复、流式事件、tool loop、审批、持久化等子模块；后端也有会话存储、工具结果预算、超长结果落盘、provider 抽象和测试基础。静态结构比之前清晰很多。

但从“稳定性、可扩展性、数据量放大后的性能”来看，当前实现仍有 4 类关键风险：

1. 工具审批的信任域设计存在越会话泄漏，和注释宣称的“按 session 隔离”不一致。
2. 大会话和大上下文场景下缺少分页/限额/渐进恢复，长对话会直接把前后端压力拉满。
3. 部分运行时度量不准确，尤其 token 统计被错误写成 `prompt_tokens`，会误导上下文占用与自动压缩策略。
4. 前端 AI 测试覆盖仍偏薄，当前唯一直接失败的 AI 测试集中在审批流，说明该模块已出现契约漂移。

## 实测结果

### 1. 构建与静态检查

- `pnpm exec vue-tsc -b`：通过
- `cargo test`：通过，83 个测试全部通过
- `cargo clippy --all-targets --all-features -- -D warnings`：失败，仓库级问题较多；AI 相关直接信号包括：
  - `src-tauri/src/commands/ai.rs:25`：`ai_chat_stream` 参数过多
  - `src-tauri/src/services/ai/http_retry.rs:117`：`send_with_backoff` 未使用
  - `src-tauri/src/services/ai/tool_result_store.rs:83`：`should_persist` 未使用

### 2. 测试结果

- `pnpm test`：349 个测试里 336 通过，13 失败
- 失败项里直接与 AI 相关的是 `src/composables/__tests__/useToolApproval.test.ts` 的 5 个用例全部失败
- `src/composables/__tests__/useAiChat.multimodal.test.ts`：通过，说明多模态消息构建路径基本可用

结论：
- Rust 侧 AI 基础能力测试明显强于前端
- 前端 AI 关键链路里，审批流已经出现测试与实现脱节
- 目前还没有覆盖“长历史恢复 / tool loop / 大上下文 / 多 session 并发”的前端集成测试

## 关键问题

### P0-1 工具信任集合是全局的，不是按会话隔离

位置：
- `src/composables/useToolApproval.ts:101-123`
- `src/composables/useToolApproval.ts:167-170`
- `src/composables/useToolApproval.ts:240-242`

问题：
- 注释和设计意图都写的是“按 sessionId 隔离”
- 但实现里 `trustedKeys` 是全局 `localStorage` 键 `ai.trustedPaths`
- 一次会话里信任的命令或路径，会在其他会话里自动放行

影响：
- 安全边界比 UI 文案和注释更宽
- 多个 AI 会话并行时，审批结果会相互污染
- 用户会误以为“只在当前会话信任”，实际是全局信任

建议：
- 将 `trustedKeys` 改成 `Map<sessionId, Set<trustKey>>`
- 如确实需要“跨会话长期信任”，应单独设计显式开关和独立存储键，不能与当前 session trust 混用

### P0-2 上下文文件注入没有大小和 token 上限，大文件会直接拖垮请求

位置：
- `src/composables/ai/chatSendPreparation.ts:87-104`
- `src/api/ai.ts:268-270`

问题：
- `workspaceConfig.contextFiles` 中的每个文件都会被直接读取并拼进 `systemPrompt`
- 调用 `aiReadContextFile(workDir, entry.path)` 时没有传 `maxLines`
- 也没有总大小、总 token、单文件大小、并发读取数量限制

影响：
- 配置到大文件时，发送前的本地读取和字符串拼接成本会急剧上升
- 极易触发 `context_length_exceeded`
- 用户看到的是“模型报错”，但根因其实是前置上下文装配失控

建议：
- 为 context file 增加硬限制：
  - 单文件最大行数
  - 单文件最大字符数
  - 总上下文字符数或 token 预算
- UI 侧显示“该文件因超限被截断/跳过”
- 优先支持摘要化注入，而不是全文注入

### P0-3 历史恢复是全量拉取、全量反序列化、全量重建，长会话会明显卡顿

位置：
- `src/composables/useAiChat.ts:321-357`
- `src-tauri/src/commands/ai.rs:183-233`
- `src-tauri/src/services/ai/session_store.rs:329-360`
- `src/composables/ai/chatHistoryRestore.ts:86-124`

问题：
- 打开会话时直接查询整段历史：`SELECT ... FROM ai_messages WHERE session_id = ? ORDER BY created_at`
- 前端随后对所有记录做恢复、JSON 解析、tool frame 重建和消息清洗
- 没有分页、窗口化、懒加载，也没有“仅恢复最近 N 条 + 压缩摘要”

影响：
- 长对话、工具频繁调用、持久化消息多时，首次打开会话会线性放大耗时和内存
- 这类性能问题在数据量小时不明显，但会在真实使用一段时间后集中暴露

建议：
- 改成分层恢复：
  - 默认只恢复最近一段窗口
  - 历史部分按页加载
  - 已压缩区间直接显示摘要节点
- `ai_get_session` 增加 `offset/limit` 或 “recent only” 变体
- 前端恢复逻辑改成增量拼装，而不是一次性重建全量数组

### P1-1 token 统计写错，导致上下文占用和自动压缩判断失真

位置：
- `src/composables/ai/chatStreamEvents.ts:78-82`
- `src/composables/useAiChat.ts:88-94`
- `src/composables/ai/chatSendFinalize.ts:78-89`

问题：
- 流事件 `Usage` 到来时，前端把 `event.prompt_tokens` 写进了 `message.tokens`
- 后续 `totalTokens` 直接取最后一条 assistant message 的 `tokens`
- 自动压缩和上下文用量显示都基于这个值

影响：
- UI 展示的上下文占用不是总 tokens
- `autoCompact.checkAndCompact(...)` 拿到的不是可靠总量
- 模型接近上下文上限时，前端可能判断过晚或误判

建议：
- 至少保存 `promptTokens`、`completionTokens`、`totalTokens`
- `Usage` 事件到达时直接计算总量
- `AiMessage` 和 `AiSession` 里的 token 字段语义要统一

### P1-2 流式热路径每次都线性查找消息，长对话下会拖慢渲染

位置：
- `src/composables/useAiChat.ts:233-239`

问题：
- `updateStreamingMessage()` 每次更新都 `findIndex`
- 该函数会被流式文本 flush、usage 事件、tool call 事件、done/error 收尾频繁调用
- 当前消息条数越大，单次更新成本越高

影响：
- 短对话基本无感
- 长会话和高频 delta 下，前端渲染会逐步变重

建议：
- 在流式阶段缓存 `streamingMessageIndex`
- 或维护 `messageId -> index` 的映射
- 只在数组结构变化时更新索引，而不是每次流式更新时重扫

### P1-3 审批流强依赖全局 active session，已经出现测试契约漂移

位置：
- `src/composables/useToolApproval.ts:58-76`
- `src/composables/useToolApproval.ts:147-149`
- `src/composables/useToolApproval.ts:261-266`
- `src/composables/__tests__/useToolApproval.test.ts:23-110`

问题：
- `requestApproval()` 现在要求 `sessionId`
- `usePendingApproval()` 却仍默认依赖全局 `activeSessionId`
- 测试没有设置 `sessionId` 和 `activeSessionId`，5 个用例全部失败

影响：
- 这说明审批流接口已经变成“隐式全局状态驱动”
- 可测试性下降
- 一旦 `setActiveSessionId()` 在多标签、KeepAlive、standalone 模式中漏同步，就会出现弹窗不显示或响应错会话

建议：
- 把 `usePendingApproval()` 的主接口改成显式 `useSessionPendingApproval(sessionId)`
- 全局 active session 只保留给兼容层，不要作为核心依赖
- 修复并补齐审批流测试，覆盖多 session 并发

### P1-4 历史恢复靠字符串模式判断工具失败，缺少结构化成功/失败元数据

位置：
- `src/composables/ai/chatHistoryRestore.ts:10-17`
- `src/composables/ai/chatHistoryRestore.ts:66-83`
- `src-tauri/src/services/ai/session_store.rs:304-326`

问题：
- 恢复 tool result 时，成功与失败是靠 `content` 的前缀字符串判断
- 这依赖错误文案、语言、前缀格式长期不变
- 持久化层没有单独保存 `success` 字段

影响：
- 一旦错误文案调整、国际化、后端返回格式变化，历史恢复就会误判结果状态
- UI 中的已执行/失败状态会不稳定

建议：
- `ai_messages` 的 `tool_result` 记录增加结构化字段：`success`、`tool_name`
- 前端恢复逻辑直接读结构化值，不再猜字符串

### P2-1 会话摘要数据和消息事实源分离，崩溃场景下容易出现列表信息不一致

位置：
- `src-tauri/src/services/ai/session_store.rs:195-225`
- `src-tauri/src/services/ai/session_store.rs:304-326`
- `src-tauri/src/commands/ai.rs:196-230`

问题：
- `save_message()` 只写消息，不更新 `ai_sessions.message_count / total_tokens / updated_at`
- 当前依赖前端结束时再调用 `saveFinalSession()`
- 若发送过程中崩溃、强退或异常中断，会话摘要与消息事实源可能暂时不一致

影响：
- 会话列表排序、消息数、更新时间可能落后
- `ai_get_session()` 已经因此补了一段“缺 session 就从 message 重建 skeleton”的恢复逻辑

建议：
- 明确单一事实源
- 如果仍保留 `ai_sessions` 冗余聚合字段，建议在后端写消息时同步更新或用事务封装

### P2-2 Rust AI 命令层维护成本偏高，clippy 已经给出明确信号

位置：
- `src-tauri/src/commands/ai.rs:25`
- `src-tauri/src/services/ai/http_retry.rs:117`
- `src-tauri/src/services/ai/tool_result_store.rs:83`

问题：
- `ai_chat_stream` 命令参数过多
- 若干 AI 辅助函数和类型未被实际调用
- `clippy -D warnings` 目前无法作为质量门禁

影响：
- 命令层继续膨胀时，接口演化和测试都会更难
- 也会降低“评估工具自动给出有效噪音比”的价值

建议：
- 将 `ai_chat_stream` 参数聚合成请求 struct
- 清理未使用 helper 或明确保留意图
- 先把 AI 子域的 clippy 警告压到可控范围

## 性能分析

### 已确认的热点

1. 历史恢复链路是典型的 O(n) 全量路径
   - 数据库全量读取
   - 前端全量恢复
   - tool frame 关联和 JSON.parse

2. 流式更新链路存在 O(n) 热点
   - `updateStreamingMessage()` 每次线性查找
   - 长对话下总成本接近 O(event_count * message_count)

3. 上下文组装缺少预算
   - `contextFiles` 会把文件内容直接堆进 prompt
   - 大文件和多文件场景下，请求前 CPU、内存和字符串分配都会上涨

### 当前未看到的明显问题

1. Rust 侧工具结果预算与超长输出落盘设计是合理的
   - `src-tauri/src/services/ai/tool_result_budget.rs`
   - `src-tauri/src/services/ai/tool_result_store.rs`
2. 后端 AI 单元测试对工具结果、web/bash 安全边界、文本裁剪等已有覆盖
3. 前端 `useAiChat` 虽然仍大，但主要流程已经拆到 helper，后续继续下沉比以前安全

### 现阶段性能结论

小会话下当前实现可以工作；一旦进入“长会话 + 多工具调用 + 多上下文文件”场景，瓶颈会先出现在前端历史恢复和 prompt 组装，而不是 Rust 工具执行本身。

## 架构与代码逻辑审查

### 优点

1. `useAiChat.ts` 已从单文件逻辑堆叠转成 orchestrator，职责边界比之前清楚
2. `chatToolLoop.ts`、`chatToolExecution.ts`、`chatHistoryRestore.ts` 的模块边界基本合理
3. Rust 侧把 provider、session store、tool result budget/store 分开，层次是对的

### 主要不足

1. 审批流仍带有较重的全局状态味道
2. 历史恢复和会话摘要仍有双事实源问题
3. 前端一些关键状态字段语义不统一，例如 `tokens`
4. 大数据量策略更多体现在“兜底”而不是“前置预算”，比如 tool result 已有预算，但 context file 仍没有

## 缺陷检测与测试覆盖评估

### 已暴露缺陷

1. 审批流测试全部失败，说明该模块在重构后没有同步收敛契约
2. token 统计错误会影响上下文条和自动压缩判断
3. 长会话恢复性能瓶颈在设计上已确定存在，不是偶发问题

### 测试缺口

当前缺少以下 AI 专项测试：

1. 长历史分页恢复测试
2. 多 session 并发审批测试
3. tool loop 多轮工具调用集成测试
4. 大 context file 截断与预算测试
5. 流式事件高频更新的性能回归测试

## 优化建议

### 第一阶段：先修正确性和边界

1. 修正审批信任域，改成按 session 隔离
2. 修正 token 统计字段，统一 `prompt/completion/total`
3. 给 `contextFiles` 增加硬限制和截断提示
4. 修复 `useToolApproval` 测试，并补多 session 场景

### 第二阶段：解决数据量放大问题

1. 为 `ai_get_session` 增加分页或 recent-window 查询
2. 前端历史恢复改增量式，不再一次性重建全部消息
3. 流式阶段维护消息索引，去掉高频 `findIndex`

### 第三阶段：收敛维护成本

1. 给 `ai_chat_stream` 定义请求 struct，压缩参数面
2. 清理未使用 AI helper 和类型
3. 让 AI 子域先达到可运行 `clippy -D warnings` 的状态

## 建议优先级

建议按以下顺序处理：

1. `useToolApproval` 的 session trust 设计
2. `chatSendPreparation` 的 context file 限额
3. `chatStreamEvents` / `useAiChat` 的 token 统计修正
4. `ai_get_session + chatHistoryRestore` 的分页和增量恢复
5. `updateStreamingMessage` 的索引优化

## 最终判断

当前 AI 模块不是“架构错误”，而是“已经具备可用基础，但在会话规模扩大和多会话并行后会出现稳定性与性能债务集中爆发”的状态。

如果只修一个点，优先修审批信任域；如果只做一轮性能治理，优先做“上下文预算 + 历史分页恢复”。这两项对真实使用体验的改善最大。
