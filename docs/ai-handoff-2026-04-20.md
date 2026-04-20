# AI 模块交接说明（2026-04-20）

## 1. 本次已完成

### 1.1 AI 聊天视图重构与可维护性提升
- 已拆出 [`src/components/ai/AiChatShell.vue`](/D:/Project/DevForge/devforge/src/components/ai/AiChatShell.vue)
- 已拆出 [`src/composables/useAiChatViewState.ts`](/D:/Project/DevForge/devforge/src/composables/useAiChatViewState.ts)
- [`src/views/AiChatView.vue`](/D:/Project/DevForge/devforge/src/views/AiChatView.vue) 与 [`src/views/AiStandaloneView.vue`](/D:/Project/DevForge/devforge/src/views/AiStandaloneView.vue) 已明显收敛，公共状态和共享 UI 已抽离

### 1.2 启动/恢复链路优化
- [`src/composables/ai/chatHistoryLoad.ts`](/D:/Project/DevForge/devforge/src/composables/ai/chatHistoryLoad.ts)
  - 增加历史记录内存缓存
  - 增加 inflight 请求复用，避免同 session/window 重复请求
  - 支持增量窗口扩展
- [`src/composables/useAiChat.ts`](/D:/Project/DevForge/devforge/src/composables/useAiChat.ts)
  - 发送和清空会话时会失效历史缓存
  - `loadHistory` 会跳过相同内容的重复替换
  - 暴露 observability 指标

### 1.3 诊断面板与观测能力
- 新增 [`src/components/ai/AiDiagnosticsPanel.vue`](/D:/Project/DevForge/devforge/src/components/ai/AiDiagnosticsPanel.vue)
- 新增 [`src/composables/ai/useAiChatObservability.ts`](/D:/Project/DevForge/devforge/src/composables/ai/useAiChatObservability.ts)
- 当前已支持：
  - 首字响应、完整响应、历史恢复、工具队列
  - 趋势统计
  - 会话级历史样本
  - 错误类型分布
  - 诊断快照导出
- 诊断面板已完成一轮中文化

### 1.4 性能与首屏体验
- [`src/components/ai/AiChatShell.vue`](/D:/Project/DevForge/devforge/src/components/ai/AiChatShell.vue)
  - `AiSessionDrawer`
  - `AiMemoryDrawer`
  - `WorkspaceFilePicker`
  已改为 lazy mount，降低首屏渲染负担

### 1.5 工具链稳定性
- [`src/composables/ai/chatToolExecution.ts`](/D:/Project/DevForge/devforge/src/composables/ai/chatToolExecution.ts)
  - 增加执行分类与队列
  - 增加超时、重试、取消、预算裁剪、串并行控制
  - 补充 metadata，便于诊断
- [`src/composables/ai/chatToolLoop.ts`](/D:/Project/DevForge/devforge/src/composables/ai/chatToolLoop.ts)
  - 对工具循环和工具结果落盘链路做了稳定性增强

### 1.6 类型与测试
- [`src/types/ai.ts`](/D:/Project/DevForge/devforge/src/types/ai.ts) 已补充工具执行 metadata 等类型
- 已补/更新测试：
  - [`src/components/ai/__tests__/AiDiagnosticsPanel.test.ts`](/D:/Project/DevForge/devforge/src/components/ai/__tests__/AiDiagnosticsPanel.test.ts)
  - [`src/composables/__tests__/useAiChatObservability.test.ts`](/D:/Project/DevForge/devforge/src/composables/__tests__/useAiChatObservability.test.ts)
  - [`src/composables/__tests__/useAiChat.interaction.test.ts`](/D:/Project/DevForge/devforge/src/composables/__tests__/useAiChat.interaction.test.ts)
  - [`src/views/__tests__/AiChatView.interaction.test.ts`](/D:/Project/DevForge/devforge/src/views/__tests__/AiChatView.interaction.test.ts)
  - [`src/composables/__tests__/chatToolExecution.test.ts`](/D:/Project/DevForge/devforge/src/composables/__tests__/chatToolExecution.test.ts)

## 2. 今天额外推进到一半但还没接完的内容

### 2.1 诊断阈值配置化
- [`src/stores/settings.ts`](/D:/Project/DevForge/devforge/src/stores/settings.ts)
  - 已加入 `AiDiagnosticsThresholds`
  - 已加入默认阈值
  - 已加入 merge 兼容逻辑，保证老配置补默认值
- 但下面两步还没接：
  - [`src/components/settings/DiagnosticsSection.vue`](/D:/Project/DevForge/devforge/src/components/settings/DiagnosticsSection.vue) 还没把阈值输入项做出来
  - [`src/components/ai/AiDiagnosticsPanel.vue`](/D:/Project/DevForge/devforge/src/components/ai/AiDiagnosticsPanel.vue) 还没改成读取 settings，而是仍有部分阈值写死

## 3. 还没做完的事项

### P1
- 启动链路继续压测和清理
  - 重点文件：
    - [`src/views/AiChatView.vue`](/D:/Project/DevForge/devforge/src/views/AiChatView.vue)
    - [`src/views/AiStandaloneView.vue`](/D:/Project/DevForge/devforge/src/views/AiStandaloneView.vue)
    - [`src/composables/useAiChat.ts`](/D:/Project/DevForge/devforge/src/composables/useAiChat.ts)
  - 目标：
    - 首屏空白
    - 卡住
    - 恢复会话异常
    - 切会话残留状态
- 任务面板升级
  - 重点文件：
    - [`src/components/ai/AiSpawnedTasksPanel.vue`](/D:/Project/DevForge/devforge/src/components/ai/AiSpawnedTasksPanel.vue)
    - [`src/composables/ai/chatSideEffects.ts`](/D:/Project/DevForge/devforge/src/composables/ai/chatSideEffects.ts)
  - 当前只支持 `pending/running/done/error`
  - 尚未补齐：
    - createdAt / startedAt / finishedAt
    - duration
    - lastError
    - sourceMessageId
    - retry/run-again
    - 面板中文化和摘要统计
- 剩余 AI 页面英文/硬编码清理
  - `AI Chat`
  - `New Chat`
  - `Model changed`
  - `API key is not configured`
  - `attached file(s)`
  - `queued`
  - `message(s) are queued...`

### P2
- 诊断面板可配置阈值真正落地到设置页
- 任务面板做成真正可用的调度器视图
- 工具链回归覆盖继续补
  - 流中断重放
  - tool loop 卡死
  - 取消后重入
- 历史恢复进一步做缓存预热和更细粒度恢复

## 4. 建议明天接手顺序

1. 先完成阈值配置化闭环
2. 再补 `AiSpawnedTasksPanel` 与 `chatSideEffects.ts`
3. 然后清一轮 `AiChatView.vue` / `AiStandaloneView.vue` 文案与恢复链路
4. 最后补测试并跑一遍类型检查 + AI 关键用例

## 5. 今天已确认通过的校验

```bash
pnpm exec vue-tsc -b
pnpm exec vitest run src/components/ai/__tests__/AiDiagnosticsPanel.test.ts src/composables/__tests__/useAiChatObservability.test.ts src/composables/__tests__/useAiChat.interaction.test.ts src/views/__tests__/AiChatView.interaction.test.ts src/composables/__tests__/chatToolExecution.test.ts
```

## 6. 接手时优先关注的文件

- [`src/composables/useAiChat.ts`](/D:/Project/DevForge/devforge/src/composables/useAiChat.ts)
- [`src/composables/ai/chatHistoryLoad.ts`](/D:/Project/DevForge/devforge/src/composables/ai/chatHistoryLoad.ts)
- [`src/composables/ai/useAiChatObservability.ts`](/D:/Project/DevForge/devforge/src/composables/ai/useAiChatObservability.ts)
- [`src/components/ai/AiDiagnosticsPanel.vue`](/D:/Project/DevForge/devforge/src/components/ai/AiDiagnosticsPanel.vue)
- [`src/components/settings/DiagnosticsSection.vue`](/D:/Project/DevForge/devforge/src/components/settings/DiagnosticsSection.vue)
- [`src/components/ai/AiSpawnedTasksPanel.vue`](/D:/Project/DevForge/devforge/src/components/ai/AiSpawnedTasksPanel.vue)
- [`src/composables/ai/chatSideEffects.ts`](/D:/Project/DevForge/devforge/src/composables/ai/chatSideEffects.ts)
- [`src/views/AiChatView.vue`](/D:/Project/DevForge/devforge/src/views/AiChatView.vue)
- [`src/views/AiStandaloneView.vue`](/D:/Project/DevForge/devforge/src/views/AiStandaloneView.vue)
