# AI Desktop GUI Experience 实现状态

更新时间：2026-04-26

## 已完成

- Provider Adapter 已接入主链路，聊天、工具循环、自动压缩均通过统一 provider 能力与流式适配层运行。
- 消息投影、虚拟列表、状态面板、文件变更摘要、权限风险说明、Feature Gate、Provider 能力矩阵、Workspace Prompt/Skill 管理已落地。
- MCP 面板已接入后端 `.mcp.json` 读取，并展示 server、transport、command/url、状态与问题说明。
- Skill 配置已进入发送上下文，启用项会以 `<workspace-skills>` 形式注入模型上下文。
- Provider permission mapper 已进入工具执行主链路，支持 strict 模式、读工具审批与模型禁用 toolUse 时的强制审批。
- Rewind 已支持当前会话软回退：不删除历史记录，通过 `rewind-boundary` 截断后续模型上下文。
- AI Bridge 已增加 `AiBridgeError`，AI API 模块错误会统一携带 `command/kind/retryable/message` 元数据。

## 本轮深化

- 对话区 v2 视觉落地：主对话流改为无头像 timeline + turn header，普通 AI 文本不再套大卡片，结构化内容保持明确边界。
- Run Inspector：运行状态、MCP、上下文预算、Patch Review、Workflow Runtime、Workspace Isolation、Plan、Diagnostics、Transcript 统一迁入右侧辅助面板，避免压缩主对话流。
- Composer：底部输入区改为 v2 原型的中等高度暗色渐变容器，工具栏 chip 化并保持固定可见。
- Rewind 回退：新增 `src/ai-gui/conversationRewind.ts`，UI 事件从 `AiMessageBubble.vue` 贯通到 `AiChatView.vue`，回退边界会保存到会话记录。
- 上下文治理：`chatMessageBuilder.ts` 同时识别 `compact-boundary` 与 `rewind-boundary`，保证回退前旧消息不会再次进入模型。
- Bridge 错误治理：新增 `src/api/ai/errors.ts`，各 AI API 子模块改用 `invokeAiCommand`，保留原有 `{ source: 'AI' }` 日志行为。
- MCP 状态深化：后端对 stdio server 做 command 可解析检查，对 http/sse URL 做协议校验，并在 message 中明确“未启动长期 MCP 连接”。

## 延后项

- MCP 真实连接健康检查暂不做长期进程管理，避免加载面板时启动外部 server 导致卡顿或副作用。
- MCP tools 动态合并到 Tool Use 仍是后续大项，需要工具 schema、权限、执行器与结果预算一起设计。
- Rewind 当前采用软边界，不物理删除数据库历史；如后续需要“历史可视化分支树”，可基于 `rewindMetadata` 扩展。

## 验证命令

- `pnpm vitest run src/ai-gui/conversationRewind.test.ts src/composables/__tests__/chatMessageBuilder.test.ts`
- `pnpm vitest run src/api/ai/bridgeModules.test.ts`
- `pnpm vitest run src/views/__tests__/AiChatView.interaction.test.ts src/components/ai/__tests__/AiMessageBubble.test.ts src/components/ai/__tests__/AiMessageListVirtual.test.ts`
- `pnpm test:typecheck`
- `cd src-tauri && cargo check`
