# AI 模块交接说明（2026-04-20，2026-04-21 更新）

## 1. 当前总体状态

AI 聊天模块这轮已经完成 P1 主要收口，并推进了多项 P2：

- 诊断面板阈值配置闭环已完成。
- 任务面板已经从简单状态列表升级为可操作的子任务调度视图。
- 工具链关键回归覆盖已补齐一轮。
- 启动、切会话、历史恢复链路已经做了去重、状态清理、缓存和预热。
- AI 主要聊天页面、输入框、会话抽屉和任务面板的硬编码文案已经集中接入 i18n。

当前仍建议继续做 P2 深化：任务调度器体验、历史恢复更细粒度策略、工具链更多异常组合覆盖。

## 2. 已完成内容

### 2.1 聊天视图重构与共享状态

- 已拆出 [`src/components/ai/AiChatShell.vue`](/D:/Project/devforge/src/components/ai/AiChatShell.vue)。
- 已拆出 [`src/composables/useAiChatViewState.ts`](/D:/Project/devforge/src/composables/useAiChatViewState.ts)。
- [`src/views/AiChatView.vue`](/D:/Project/devforge/src/views/AiChatView.vue) 与 [`src/views/AiStandaloneView.vue`](/D:/Project/devforge/src/views/AiStandaloneView.vue) 已共用 provider/model/workdir/send/continue 等状态逻辑。
- `AiSessionDrawer`、`AiMemoryDrawer`、`WorkspaceFilePicker` 已在 shell 中 lazy mount，降低首屏渲染负担。

### 2.2 诊断面板与阈值配置

- [`src/components/ai/AiDiagnosticsPanel.vue`](/D:/Project/devforge/src/components/ai/AiDiagnosticsPanel.vue) 已读取 settings 中的诊断阈值，不再依赖硬编码阈值。
- [`src/components/settings/DiagnosticsSection.vue`](/D:/Project/devforge/src/components/settings/DiagnosticsSection.vue) 已提供诊断阈值输入和重置。
- [`src/stores/settings.ts`](/D:/Project/devforge/src/stores/settings.ts) 已有 `AiDiagnosticsThresholds` 默认值和老配置 merge 兼容。
- 已补 locale：[`src/locales/zh-CN.ts`](/D:/Project/devforge/src/locales/zh-CN.ts)、[`src/locales/en.ts`](/D:/Project/devforge/src/locales/en.ts)。
- 已更新 [`src/components/ai/__tests__/AiDiagnosticsPanel.test.ts`](/D:/Project/devforge/src/components/ai/__tests__/AiDiagnosticsPanel.test.ts)。

### 2.3 启动、切会话与历史恢复

- [`src/composables/ai/chatHistoryLoad.ts`](/D:/Project/devforge/src/composables/ai/chatHistoryLoad.ts)
  - 保留历史记录内存缓存。
  - 保留 inflight 请求复用，避免同 session/window 重复请求。
  - 支持增量窗口扩展。
  - 新增 `preloadChatHistoryWindow()`，用于后台预热历史窗口。
- [`src/composables/useAiChat.ts`](/D:/Project/devforge/src/composables/useAiChat.ts)
  - `loadHistory` 会跳过相同内容的重复替换。
  - 完整恢复会话时清理 session-scoped runtime 状态：plan gate、phase、spawned tasks、stale workDir 等。
  - `loadMoreHistory()` 的窗口扩展已限制在 `totalRecords` 内，避免无效超大窗口请求。
  - 历史窗口被截断时会后台预热下一档窗口。
  - 新增 `preloadHistory()`，可在不污染当前聊天状态的前提下预热其他会话。
- [`src/components/ai/AiSessionDrawer.vue`](/D:/Project/devforge/src/components/ai/AiSessionDrawer.vue) hover/focus 会触发会话预热。
- [`src/components/ai/AiChatShell.vue`](/D:/Project/devforge/src/components/ai/AiChatShell.vue)、[`src/views/AiChatView.vue`](/D:/Project/devforge/src/views/AiChatView.vue)、[`src/views/AiStandaloneView.vue`](/D:/Project/devforge/src/views/AiStandaloneView.vue) 已透传并处理 `preloadSession`。
- [`src/views/AiChatView.vue`](/D:/Project/devforge/src/views/AiChatView.vue) 已用 `pendingSessionLoadId` 避免选择会话时 watcher 和显式加载重复触发 `loadHistory`。
- [`src/views/AiStandaloneView.vue`](/D:/Project/devforge/src/views/AiStandaloneView.vue) 已加入 `switchSession()` 辅助方法，和主聊天页的会话切换语义保持一致。

### 2.4 任务面板和子任务调度

- [`src/composables/ai/chatSideEffects.ts`](/D:/Project/devforge/src/composables/ai/chatSideEffects.ts)
  - `SpawnedTask` 已扩展：`createdAt`、`startedAt`、`finishedAt`、`durationMs`、`lastError`、`lastSummary`、`sourceMessageId`、`retryCount`、`taskTabId`、`taskSessionId`。
  - 已提供 `markSpawnedTaskRunning()`、`markSpawnedTaskDone()`、`markSpawnedTaskError()`、`markSpawnedTaskClosed()`、`resetSpawnedTaskForRetry()`、`syncSpawnedTaskFromTabMeta()`。
  - 子任务 tab meta 中的 `taskSummary` 会同步到父任务的 `lastSummary`。
- [`src/components/ai/AiSpawnedTasksPanel.vue`](/D:/Project/devforge/src/components/ai/AiSpawnedTasksPanel.vue)
  - 已显示 pending/running/done/error 统计。
  - 已显示 created/started/finished、duration、source message、retry count、lastError、lastSummary。
  - 已支持 run、open、complete、retry/run-again。
- [`src/views/AiChatView.vue`](/D:/Project/devforge/src/views/AiChatView.vue)
  - 运行子任务时创建独立 AI task tab 和独立 task session。
  - 子任务 tab 将 `taskStatus`、`taskError`、`taskSummary` 写回 meta。
  - 父聊天页 watcher 会从 tab meta 同步任务完成/失败/摘要。
  - 若运行中的子任务 tab 被关闭，父任务会自动标记为 error，并保留已有 summary。

### 2.5 工具链稳定性和回归覆盖

- [`src/composables/ai/chatToolLoop.ts`](/D:/Project/devforge/src/composables/ai/chatToolLoop.ts)
  - 只在最终消息仍为 assistant 时解析 journal/spawn side effects。
  - 只执行参数可解析为对象的有效 tool calls。
  - invalid/incomplete streamed tool-call JSON 会将 assistant 转为 error，不再执行。
  - max tool loop 命中后有 warning。
- [`src/composables/ai/chatAbort.ts`](/D:/Project/devforge/src/composables/ai/chatAbort.ts)
  - abort 后会清理 stream runtime 状态：`streamingMessageId`、pending deltas、pending tool calls、`lastFinishReason`、`inToolExec`。
- [`src/composables/ai/chatStreamEvents.ts`](/D:/Project/devforge/src/composables/ai/chatStreamEvents.ts)
  - streamed `ToolCallDelta` 在 JSON 变完整后会更新 `parsedArgs`。
- 新增/更新测试：
  - [`src/composables/__tests__/chatToolLoop.test.ts`](/D:/Project/devforge/src/composables/__tests__/chatToolLoop.test.ts)
  - [`src/composables/__tests__/chatStreamEvents.test.ts`](/D:/Project/devforge/src/composables/__tests__/chatStreamEvents.test.ts)
  - [`src/composables/__tests__/chatAbort.test.ts`](/D:/Project/devforge/src/composables/__tests__/chatAbort.test.ts)
  - [`src/composables/__tests__/chatSideEffects.test.ts`](/D:/Project/devforge/src/composables/__tests__/chatSideEffects.test.ts)
  - 既有 [`src/composables/__tests__/chatToolExecution.test.ts`](/D:/Project/devforge/src/composables/__tests__/chatToolExecution.test.ts) 仍保留。

### 2.6 AI UI 文案和 i18n

- [`src/views/AiChatView.vue`](/D:/Project/devforge/src/views/AiChatView.vue)、[`src/views/AiStandaloneView.vue`](/D:/Project/devforge/src/views/AiStandaloneView.vue)、[`src/composables/useAiChatViewState.ts`](/D:/Project/devforge/src/composables/useAiChatViewState.ts) 的主要硬编码用户可见文案已接入 i18n。
- [`src/components/ai/AiInputArea.vue`](/D:/Project/devforge/src/components/ai/AiInputArea.vue)
  - 模式名、短标签、拖拽提示、模型选择、能力标签、添加文件、上下文占用、提示词优化、发送方式提示、免责声明已接入 i18n。
- [`src/components/ai/AiSessionDrawer.vue`](/D:/Project/devforge/src/components/ai/AiSessionDrawer.vue)、[`src/components/ai/AiSessionList.vue`](/D:/Project/devforge/src/components/ai/AiSessionList.vue)
  - 标题、描述、搜索、空态、新建/删除、确认删除、相对时间已接入 i18n。
- [`src/views/AiChatView.vue`](/D:/Project/devforge/src/views/AiChatView.vue) 仍保留 legacy tab title 兼容判断：`AI Chat`、`AI 对话`、`New Chat`、`新建对话`，这是兼容旧 tab，不属于用户可见新文案问题。
- 新增/更新测试：
  - [`src/components/ai/__tests__/AiSessionDrawer.test.ts`](/D:/Project/devforge/src/components/ai/__tests__/AiSessionDrawer.test.ts)
  - [`src/components/ai/__tests__/AiSpawnedTasksPanel.test.ts`](/D:/Project/devforge/src/components/ai/__tests__/AiSpawnedTasksPanel.test.ts)
  - [`src/composables/__tests__/useAiChatViewState.test.ts`](/D:/Project/devforge/src/composables/__tests__/useAiChatViewState.test.ts)

## 3. 当前仍建议继续推进的事项

### P2

- 任务面板继续向“真正调度器视图”推进：
  - 支持更清晰的任务分组、依赖关系、批量运行/重试。
  - 支持从父会话汇总子任务结果并生成最终 synthesize prompt。
  - 支持子任务取消和父面板状态回写。
- 历史恢复继续深化：
  - 评估 session drawer 打开时预热最近 N 个会话。
  - 评估缓存大小、TTL 或 LRU，避免长时间运行后缓存无限增长。
  - 对超大历史做更细粒度恢复或分段 UI。
- 工具链继续补异常组合：
  - 流中断后的重放/恢复。
  - tool loop 复杂卡死场景。
  - 工具取消后立即重入。
  - 多 tool call 中部分 invalid、部分 valid 的边界。
- AI UI 继续扫尾：
  - `AiProviderConfig.vue` 仍可继续检查硬编码文案。
  - `AiMemoryDrawer`、`AiPromptEnhancer`、`WorkspaceFilePicker` 可继续做 i18n 一致性检查。

## 4. 建议接手顺序

1. 先跑一轮完整 AI 相关测试和 `vue-tsc`，确认当前工作树基线。
2. 做任务调度器视图深化，因为当前 task panel 已有元数据和 tab 同步基础。
3. 做历史缓存策略的 TTL/LRU，避免预热能力上线后缓存无上限增长。
4. 继续清理剩余 AI 子组件硬编码文案。
5. 最后补工具链更多异常组合回归。

## 5. 最近已确认通过的校验

```bash
pnpm exec vue-tsc -b
pnpm exec vitest run src/composables/__tests__/useAiChat.interaction.test.ts
pnpm exec vitest run src/views/__tests__/AiChatView.interaction.test.ts
pnpm exec vitest run src/components/ai/__tests__/AiSessionDrawer.test.ts src/views/__tests__/AiChatView.interaction.test.ts
pnpm exec vitest run src/components/ai/__tests__/AiSpawnedTasksPanel.test.ts src/composables/__tests__/chatSideEffects.test.ts
pnpm exec vitest run src/composables/__tests__/chatToolLoop.test.ts src/composables/__tests__/chatStreamEvents.test.ts src/composables/__tests__/chatAbort.test.ts
pnpm exec vitest run src/components/ai/__tests__/AiDiagnosticsPanel.test.ts
pnpm exec vitest run src/composables/__tests__/useAiChatViewState.test.ts
```

## 6. 接手时优先关注的文件

- [`src/composables/useAiChat.ts`](/D:/Project/devforge/src/composables/useAiChat.ts)
- [`src/composables/ai/chatHistoryLoad.ts`](/D:/Project/devforge/src/composables/ai/chatHistoryLoad.ts)
- [`src/composables/ai/chatToolLoop.ts`](/D:/Project/devforge/src/composables/ai/chatToolLoop.ts)
- [`src/composables/ai/chatAbort.ts`](/D:/Project/devforge/src/composables/ai/chatAbort.ts)
- [`src/composables/ai/chatStreamEvents.ts`](/D:/Project/devforge/src/composables/ai/chatStreamEvents.ts)
- [`src/composables/ai/chatSideEffects.ts`](/D:/Project/devforge/src/composables/ai/chatSideEffects.ts)
- [`src/components/ai/AiSpawnedTasksPanel.vue`](/D:/Project/devforge/src/components/ai/AiSpawnedTasksPanel.vue)
- [`src/components/ai/AiSessionDrawer.vue`](/D:/Project/devforge/src/components/ai/AiSessionDrawer.vue)
- [`src/components/ai/AiInputArea.vue`](/D:/Project/devforge/src/components/ai/AiInputArea.vue)
- [`src/components/ai/AiDiagnosticsPanel.vue`](/D:/Project/devforge/src/components/ai/AiDiagnosticsPanel.vue)
- [`src/components/settings/DiagnosticsSection.vue`](/D:/Project/devforge/src/components/settings/DiagnosticsSection.vue)
- [`src/views/AiChatView.vue`](/D:/Project/devforge/src/views/AiChatView.vue)
- [`src/views/AiStandaloneView.vue`](/D:/Project/devforge/src/views/AiStandaloneView.vue)

## 7. 注意事项

- 当前工作树里有较多 AI 相关未提交变更，接手时不要用 `git reset --hard` 或 checkout 覆盖。
- 文档中的 legacy 英文 tab title 是兼容旧数据用，不建议简单删除。
- 历史预热是 best-effort，不应向 UI 暴露失败错误，也不应改变当前 chat state。
- 子任务关闭 tab 后自动标 error 是当前约定；如果后续支持 pause/cancel，需要重新设计这条状态规则。
