# DevForge AI 升级任务前后顺序与依赖说明

---

## 14. 当前阶段差异复核与最新状态（2026-04-29）

状态：✅ 已按当前代码重新核对阶段一至阶段五。文档中早期“待实现/部分完成”的条目，有一部分已经在后续迭代中落地；剩余差异主要集中在后端化、Profile 化、真实 LSP 与多 Agent 协作深度上。

### 14.1 阶段一：Agent 主链路

当前状态：✅ 主体完成，进入维护与回归阶段。

已核对落地：
- ✅ `useAiChat.ts`、`chatToolLoop.ts`、`chatToolExecution.ts`、`AiTurnRuntime.ts` 已支撑主对话、工具循环、审批、失败恢复与运行态管理。
- ✅ `ProviderAdapter.ts` 已存在并可作为 Provider 能力抽象基础。
- ✅ Compact / Auto Compact / Abort / Error Recovery / Rewind / Fork 等主链路能力已有实现基础。

当前边界：
- ⚠️ 主链路稳定性需要继续守住大会话加载、虚拟列表、历史恢复这几条高风险链路；后续 UI 合并不得直接恢复旧 stash 中 `useAiChat.ts` / `AiMessageListVirtual.vue` 的大范围改动。

### 14.2 阶段二：工程治理与体验稳定

当前状态：✅ P0/P1 主体完成。

已核对落地：
- ✅ Background Job Runtime、任务恢复/取消/中断、观测指标、MCP 状态、路径安全、权限审批、风险摘要均有代码入口。
- ✅ AI 对话区已完成 v2 视觉重构，运行态组件迁入右侧“运行与验证”面板，主对话流不再承载大量诊断面板。
- ✅ 大会话卡死问题已通过清理历史加载策略和避免预加载/重复渲染类风险项缓解；当前仍需持续回归。
- ✅ `AiContextBudgetPanel` 的真实中文 key 覆盖已补强，避免再次出现 `ai.contextBudget.*` 泄漏到 UI。

当前边界：
- ⚠️ Background Job 仍是“前端执行器 + 后端状态持久化”，不是完整后端 daemon/supervisor。
- ⚠️ 工程治理能力已有闭环，但仍应补充更多跨窗口、刷新后恢复和异常进程退出场景的压力测试。

### 14.3 阶段三：Provider Gateway 与模型治理

当前状态：✅ Gateway MVP 已接入主链路；Provider Profile Bundle 已完成前端产品闭环 MVP，后端化与迁移回填仍待做。

已核对落地：
- ✅ `src/ai-gateway/AiGateway.ts`、`router.ts`、`rateLimiter.ts`、`usageTracker.ts`、`security.ts`、`types.ts` 已存在。
- ✅ Chat / Compact / Prompt Optimize / Tool Loop 均可看到 Gateway 接入证据，不再只是“类型设计”阶段。
- ✅ Gateway 已具备 fallback、rate limit、usage record、endpoint security、token estimate 等基础治理能力。
- ✅ Bridge API 模块化、`AiBridgeError`、Provider Capability / Permission Mapper 等治理基础已存在。
- ✅ Provider Profile Bundle 前端闭环已落地：支持 Provider / Model / Output Style / Workspace Prompt / Dispatcher / SSRF 安全策略打包、预览、应用、备份、回滚。
- ✅ Output Style 已从 Profile Bundle 进入主对话链路，会在 `chatSendPreparation` 中注入系统提示，不再只是配置字段。
- ✅ Provider 级 `security` 已接入后端 Provider 持久化，SSRF allowlist / localhost / private IP 策略可随 Provider 保存并被 Gateway preflight 读取。

当前边界：
- ⚠️ Provider Profile Bundle 当前使用前端 localStorage 持久化；Provider security 已后端化，但 Profile 本身仍不是 SQLite / workspace 文件级配置，跨设备、团队共享、迁移回填尚未完成。
- ⚠️ SSRF allowlist 已能随 Provider 保存；fallback keys 和更细的 Profile 级策略仍需要进一步产品化。
- ⚠️ Gateway 诊断信息已有记录能力，但 UI 对“实际落到哪个 provider/model”的显性展示仍可继续增强。

### 14.4 阶段四：AI 产品化能力

当前状态：🟡 产品化 MVP 大部分完成，深度 runtime 与团队治理仍待完善。

已核对落地：
- ✅ Workspace Prompt / Workspace Skill / Output Style / Workflow Scripts / Slash 命令已有入口。
- ✅ Team Memory Review 基础能力存在。
- ✅ Plan Store 已具备变更历史、localStorage 持久化、jobRefs、压缩后证据注入。
- ✅ Workflow Runtime 已支持轻量运行、恢复、暂停/取消、Verification 挂接等能力。
- ✅ Transcript Store 已具备轻量持久化与时间线面板。

当前边界：
- ⚠️ Workflow Runtime 仍偏前端轻量 runtime，不是完整可暂停/恢复/验证/长期运行的后端 runtime。
- ⚠️ Team Memory 仍是基础 review，尚未形成团队级检索、冲突治理和审计体系。
- ⚠️ Prompt / Output Style 已能随 Bundle 生效；Skill 当前主要通过 Workspace Config 间接打包，仍缺独立 Skill 选择器和团队级治理。

### 14.5 阶段五：高级智能与协作能力

当前状态：🟡 安全集合和基础能力已完成较多，高级协作仍未全面启动。

已核对落地：
- ✅ Patch Review / Verification Center / Verification Presets / Verification Archive 已有实现。
- ✅ Code Intelligence MVP 已有启发式 symbols/imports/exports/diagnostics 分析。
- ✅ Workspace Isolation 已具备 warn / smart / deny 策略、自动登记、TTL、二次确认 UI 和写入前 guard。
- ✅ Plan 与 Background Job / Verification Job 的证据链已经建立。
- ✅ Proactive Tick 有基础 store 和面板入口，但仍是 MVP。

当前边界：
- ⏳ Ultraplan MVP 尚未完成。
- ⏳ Verification Agent 尚未从“验证任务/面板”升级为独立 Agent。
- ⏳ LSP Code Intelligence 当前仍是启发式轻量分析，不是真实 LSP。
- ⏳ Multi-Agent / Remote Bridge / Workspace Isolation 强隔离仍未全面产品化。

### 14.6 当前建议优先级

1. ✅ 先提交本轮小修：`AiChatShell` 残留 preload 清理、`ContextBudget` i18n key 补齐和真实中文测试。
2. ✅ Provider Profile Bundle 前端 MVP 已完成：配置切换、预览、备份、回滚，并把 Provider / Model / Output Style / Workspace Prompt / Dispatcher / SSRF 安全策略纳入同一 Profile。
3. ✅ Output Style 主链路注入与 Provider security 后端持久化已完成，Profile 配置开始真正影响 chat/Gateway。
4. 🟡 下一步优先做 Provider Profile 后端化：SQLite / workspace 文件持久化、导入导出、迁移回填、团队共享和冲突处理。
5. 🟡 然后做 Gateway 诊断 UI：展示实际 provider/model、fallback 链、成本、rate limit、SSRF 拦截原因。
6. 🔵 最后再推进真实 LSP / Verification Agent / Ultraplan / Multi-Agent，避免在基础治理未完全产品化前扩大风险面。

### 14.7 逐项验收矩阵（按当前代码）

| 阶段 | 目标项 | 当前结论 | 核对证据 | 剩余差异 |
| --- | --- | --- | --- | --- |
| 阶段一 | Agent 主对话链路 | ✅ 已完成主体 | `useAiChat.ts`、`chatSessionRunner.ts`、`chatToolLoop.ts`、`chatToolExecution.ts`、`AiTurnRuntime.ts` | 继续回归大会话加载、滚动和历史恢复，禁止直接回灌旧高风险 diff。 |
| 阶段一 | Compact / Auto Compact | ✅ 已接入 | `useAutoCompact.ts`、`chatSendRecovery.ts`、`chatMessageBuilder.ts`、`background-job.ts` | 仍需持续验证极大会话下的 UI 不阻塞。 |
| 阶段一 | Rewind / Fork / Abort / Recovery | ✅ 已有实现基础 | `AiChatView.vue`、`useAiChat.ts`、`chatAbort.ts`、`chatSendRecovery.ts` | 属维护项，后续以回归测试为主。 |
| 阶段二 | Background Job Runtime | 🟡 MVP 完成 | `background-job.ts`、`useJobWorker.ts`、`AiBackgroundJobsPanel.vue` | 不是完整后端 daemon/supervisor，跨进程长期运行能力不足。 |
| 阶段二 | 权限、路径安全、风险摘要 | ✅ 主体完成 | `approvalRisk.ts`、`pathSafety.ts`、`workspaceIsolation.ts`、各风险工具测试 | 仍需更多异常进程、跨窗口、刷新恢复压力测试。 |
| 阶段二 | 对话区体验稳定 | ✅ 主体完成 | `AiChatShell.vue`、`AiMessageListVirtual.vue`、`AiInputArea.vue`、`AiChatView.interaction.test.ts` | 重点守住大会话性能，不再恢复预加载会话类逻辑。 |
| 阶段三 | Gateway 统一入口 | ✅ MVP 完成 | `AiGateway.ts`、`types.ts`、`router.ts`、`rateLimiter.ts`、`usageTracker.ts` | 仍需产品化配置管理和诊断展示。 |
| 阶段三 | Chat / Compact / Prompt Optimize 覆盖 | ✅ 已覆盖 | `chatSessionRunner.ts`、`chatToolLoop.ts`、`useAutoCompact.ts`、`promptOptimizer.ts`、`gatewayCoverage.test.ts` | 后续新增模型调用必须继续统一走 Gateway。 |
| 阶段三 | fallback key / rate limit / SSRF | 🟡 基础完成 | `fallbackKeys.ts`、`rateLimiter.ts`、`security.ts`、`AiGateway.test.ts`、`session_store.rs` | SSRF allowlist 已可随 Provider 保存；fallback keys 和更细粒度 Profile 策略还未产品化。 |
| 阶段三 | Provider Profile Bundle | 🟡 前端 MVP 完成 | `providerProfileBundle.ts`、`provider-profile-bundle.ts`、`AiProviderProfileBundlePanel.vue` | 已有 CRUD、预览、应用、备份、回滚，且 Output Style / Provider security 已影响主链路；缺 Profile 本体后端持久化、导入导出、迁移回填、团队共享和冲突处理。 |
| 阶段四 | Workspace Prompt / Skill / Output Style | 🟡 MVP 完成 | `workspaceSkills.ts`、`useOutputStyles.ts`、`chatSendPreparation.ts`、`AiProviderProfileBundlePanel.vue` | Prompt / Output Style 已能随 Profile Bundle 生效；Skill 仍缺独立选择器、团队治理和审计。 |
| 阶段四 | Team Memory | 🟡 基础完成 | `ai-memory.ts`、`AiMemoryDrawer.vue`、`Team Memory Review` 相关入口 | 缺团队级检索、冲突处理、审计和权限策略。 |
| 阶段四 | Plan / Transcript / Workflow | 🟡 MVP 完成 | `planStore.ts`、`transcriptStore.ts`、`workflowRuntime.ts`、`workflowPersistence.ts`、`AiWorkflowRuntimePanel.vue` | Workflow 仍是前端轻量 runtime，不是后端长期任务编排。 |
| 阶段五 | Patch Review / Verification Center | ✅ 基础闭环完成 | `patchReview.ts`、`verificationReport.ts`、`verificationPresets.ts`、`verificationArchive.ts`、`AiPatchReviewPanel.vue` | Verification 仍是 job/panel，不是独立 Agent。 |
| 阶段五 | Code Intelligence | 🟡 MVP 完成 | `codeIntelligence.ts`、`codeIntelligence.test.ts` | 当前是启发式解析，不是真实 LSP。 |
| 阶段五 | Workspace Isolation | 🟡 安全子集完成 | `workspaceIsolation.ts`、`AiWorkspaceIsolationPanel.vue`、`chatToolExecution.ts` | 强隔离、远程执行隔离和多 Agent 并发隔离未产品化。 |
| 阶段五 | Ultraplan / Multi-Agent / Remote Bridge | ⏳ 未完成 | 仅有计划文档和部分基础依赖 | 需要在 Gateway/Profile/权限闭环稳定后再启动。 |

---

## 11. 第二阶段完成复核（2026-04-25）

状态：✅ 第二阶段“工程治理与体验稳定”P0/P1 已补齐并完成针对性验证。

本轮补齐：
- ✅ `erp_module_load` 已接入 ER 图“显示全部/全量加载”入口，重型加载通过 Background Job Runtime 调度，不再只停留在 store 能力层。
- ✅ `resource_scan` 已补齐后台任务提交能力、任务面板文案与 store 单测。
- ✅ `AiBackgroundJobsPanel` 修正任务创建时间类型，避免面板渲染类型不一致。
- ✅ `AiChatView` 修正后台任务面板传参，避免对已解包 store 状态重复 `.value`。
- ✅ `useErDiagram` 单测补齐 Pinia 初始化，覆盖新增后台任务依赖。

验证结果：
- ✅ `pnpm vitest run src/stores/__tests__/background-job.test.ts src/composables/__tests__/useJobWorker.test.ts src/composables/__tests__/streamBackpressure.test.ts src/composables/__tests__/useErDiagram.test.ts`
- ✅ `pnpm check:rust`
- ⚠️ `pnpm test:typecheck` 仍有既有 AI 类型债阻塞，但第二阶段本轮新增/修改相关错误已清除；剩余集中在 `AiContextBudgetPanel`、`AiHookManager/AiTurnRuntime`、`useAiChat` 消息类型、settings 默认项等历史改动。

后续说明：
- 如后续出现独立命名的 ERP 功能树页面，可直接复用 `submitErpModuleLoadJob()` + `jobWorker.dispatch('erp_module_load')` 接入同一后台任务链路。
- 当前 Background Job 仍是“前端执行器 + 后端状态持久化”模式，不是完整后端 daemon/supervisor；这属于后续增强项，不阻塞第二阶段验收。

## 12. 第五阶段安全子集启动（2026-04-25）

状态：🟡 已开始第五阶段中低风险、高收益的能力，不直接启动完整 Multi-Agent / Remote Bridge。

本轮落地：
- ✅ `Patch Review` 基础版：读取当前 Git working diff，按文件规模、敏感路径、删除/二进制文件、测试覆盖信号生成风险摘要。
- ✅ `Verification Job` 基础版：复用 Background Job Runtime 和受控 `bash` tool，按 Patch Review 建议执行验证命令并回写后台任务状态。
- ✅ `AiPatchReviewPanel` 已接入 AI 页面，可手动“审查 diff”和“跑建议验证”。
- ✅ `verification` job kind 已接入任务 store、任务面板文案和单测。

当前边界：
- Patch Review 目前是静态启发式审查，不替代模型级审查和人工 code review。
- Verification Job 当前执行命令仍依赖前端 job worker，不是后端 daemon；刷新应用后会按既有恢复逻辑标记中断。
- 暂不做完整多 Agent、远程协作、自动提交/推送，避免权限和隔离体系未成熟时扩大风险面。

### 12.1 可并行推进项更新（2026-04-25）

本轮在不碰阶段三 Provider Gateway 主链路的前提下，完成 1/2/3 三项旁路增强：
- ✅ 类型检查清零：`pnpm test:typecheck` 已通过，修复 Gateway 类型、诊断导出、hook 类型、settings 默认项、乱码截断字符串等编译阻塞。
- ✅ Verification Job 深化：验证任务输出升级为结构化报告，包含每条命令状态、耗时和截断后的证据日志。
- ✅ LSP Code Intelligence MVP：新增轻量代码智能分析器，可从 TS/Vue/Rust 文本中提取 symbols、imports、exports 和启发式 diagnostics，后续可替换/接入真实 LSP。

代表文件：
- `src/composables/useVerificationJob.ts`
- `src/ai-gui/codeIntelligence.ts`
- `src/ai-gui/__tests__/codeIntelligence.test.ts`

### 12.2 Verification Center 与 Patch Review 深化（2026-04-25）

状态：✅ 已完成第一版验证闭环产品化。

本轮落地：
- ✅ Patch Review 报告增加 `summary` 和 `impactGroups`，可按前端 UI、运行时、Gateway、后端、依赖配置等影响面归组。
- ✅ Verification Job 结构化输出可被解析为命令列表、状态、耗时和摘要。
- ✅ `AiPatchReviewPanel` 升级为 `Patch Review / Verification Center`，支持查看最近验证、重跑上次命令、查看风险/影响面/文件清单。
- ✅ 新增验证报告解析测试，避免报告格式后续漂移。

代表文件：
- `src/ai-gui/patchReview.ts`
- `src/ai-gui/verificationReport.ts`
- `src/components/ai/AiPatchReviewPanel.vue`

### 12.3 Code Intelligence 面板化与验证预设（2026-04-25）

状态：✅ 已完成第一版可用入口。

本轮落地：
- ✅ `Verification Presets`：新增前端轻量、后端 Rust、AI 链路验证等预设，并根据当前 Patch Review 自动插入“当前 diff 建议验证”。
- ✅ `Code Intelligence` 面板化：在 Patch Review 面板中可读取最多 5 个变更代码文件，展示语言、symbols、imports、exports、diagnostics 摘要。
- ✅ 复用 `aiReadContextFile()`，不新增后端接口，不影响阶段三 Provider Gateway 主链路。

代表文件：
- `src/ai-gui/verificationPresets.ts`
- `src/ai-gui/codeIntelligence.ts`
- `src/components/ai/AiPatchReviewPanel.vue`

### 12.4 Workflow Runtime 轻量版（2026-04-25）

状态：🟡 已完成 MVP，不做复杂后端 runtime。

本轮落地：
- ✅ 新增 `workflowRuntime` 纯逻辑状态机，支持 workflow run、step pending/running/done/failed、下一步动作推导、失败与重置。
- ✅ 新增 `AiWorkflowRuntimePanel`，可选择内置 Workflow，新建运行，逐步执行当前步骤。
- ✅ Prompt 类步骤会插入输入框，test 类步骤会挂接现有 Verification Job。
- ✅ 当前实现是轻量前端 runtime，不持久化、不自动发送消息，避免误触发长任务或破坏阶段三开发。

代表文件：
- `src/ai-gui/workflowRuntime.ts`
- `src/components/ai/AiWorkflowRuntimePanel.vue`
- `src/ai-gui/__tests__/workflowRuntime.test.ts`

## 10. 当前完成状态更新（2026-04-25）

> 说明：原文存在历史编码乱码，本次不重写原文结构，仅在此处追加可读状态，方便后续继续排期。

### 10.1 阶段一：Agent 主链路架构

状态：✅ 已完成主体验收，进入后续维护。

已完成项：

- ✅ `compact-boundary` 持久化与恢复链路已接入。
- ✅ 模型上下文只取最后一个 `compact-boundary` / `rewind-boundary` 后内容。
- ✅ Compact 已支持独立请求、超时、fallback 与后台 job 化。
- ✅ `AiTurnRuntime` 状态机已接入主链路。
- ✅ 工具执行已接入统一上下文、审批、权限与路径安全策略。
- ✅ 错误恢复、Abort、失败状态治理已落地。
- ✅ Provider Adapter 已接入聊天与工具循环主链路。

代表文件：

- `src/composables/ai/chatMessageBuilder.ts`
- `src/composables/useAutoCompact.ts`
- `src/composables/useAiChat.ts`
- `src/composables/ai/AiTurnRuntime.ts`
- `src/composables/ai/chatToolExecution.ts`
- `src/composables/ai/providers/ProviderAdapter.ts`

### 10.2 阶段二：工程治理与体验稳定

状态：✅ P0/P1 主体已完成，⚠️ ERP 实际页面接线仍需确认。

已完成项：

- ✅ `AiTraceSpan`、观测指标与诊断包导出已实现。
- ✅ 输入 `Intent Resolver` 已统一 Enter / Slash / @ / 按钮提交。
- ✅ 流式输出 Backpressure 已明确为策略模块，默认 50ms flush，大缓冲立即 flush。
- ✅ Background Job Runtime MVP 已实现，并接入 Compact、Auto Compact、Schema Compare。
- ✅ Job 恢复/中断/取消闭环已补齐。
- ✅ `erp_module_load` 后台 job 已接入 ER 图“显示全部/全量加载”入口；如后续出现独立 ERP 功能树，可复用同一 job 链路。
- ✅ Feature Gate / Kill Switch 基础版已实现。
- ✅ 消息 Projection、虚拟列表、Markdown 渲染缓存方向已落地。
- ✅ `AiStatusPanel` 已展示 phase、工具、任务、耗时与诊断指标。
- ✅ 路径安全、权限风险摘要、通用审批 UI 已接入工具链路。
- ✅ Rewind 软回退已实现，不删除历史但截断后续上下文。
- ✅ MCP 状态面板与后端 `.mcp.json` 状态读取已实现，增加轻量健康判断。

代表文件：

- `src/composables/ai/useAiChatObservability.ts`
- `src/composables/ai/aiInputResolver.ts`
- `src/composables/ai/streamBackpressure.ts`
- `src/stores/background-job.ts`
- `src/composables/useJobWorker.ts`
- `src/components/ai/AiStatusPanel.vue`
- `src/ai-gui/messageProjection.ts`
- `src/ai-gui/pathSafety.ts`
- `src/ai-gui/conversationRewind.ts`
- `src/components/ai/AiMcpStatusPanel.vue`

待补/注意：

- ⚠️ 代码库中尚未定位到明确命名的 ERP 功能树组件；目前已提供 `submitErpModuleLoadJob()`，后续需要在真实 ERP 加载入口接线。
- ⚠️ Background Job 当前仍是前端执行器 + 后端状态持久化，不是完整后端 supervisor，多进程 daemon 可作为后续增强。

### 10.3 阶段三：Provider Gateway 与模型治理

状态：🟡 部分完成，Gateway 类型与配置切换方案已设计，完整网关仍待实现。

已完成项：

- ✅ Provider Adapter 主链路已接入。
- ✅ Provider 能力矩阵已实现。
- ✅ Provider Permission Mapper 已接入工具执行链路。
- ✅ Bridge API 已拆分为 streaming / providers / sessions / tools / workspace 模块。
- ✅ AI Bridge 错误已统一为 `AiBridgeError`，携带 `command/kind/retryable`。
- ✅ 配置切换能力详细方案已输出，参考 `cc-switch-main` 的 SSOT、Backfill、Adapter、Preview/Backup/Rollback。

代表文件：

- `src/composables/ai/providers/ProviderAdapter.ts`
- `src/ai-gui/providerCapabilityMatrix.ts`
- `src/ai-gui/providerPermissionMapper.ts`
- `src/api/ai/errors.ts`
- `src/api/ai/index.ts`
- `docs/ai-config-switching-plan.md`

待做项：

- ⏳ 统一 `AiGatewayRequest` / `AiGatewayContext` / `AiGatewayResult` / `AiGatewayError` 类型。
- ⏳ Provider Health、Model Route、成本统计、fallback 策略尚未形成完整 Gateway。
- ⏳ 配置切换目前是详细设计文档，尚未实现 Profile CRUD / Preview / Backup / Rollback。

### 10.4 阶段四：AI 产品化能力

状态：🟡 部分完成。

已完成项：

- ✅ Workspace Prompt 管理已接入配置 UI。
- ✅ Workspace Skill 管理已接入，并会注入发送上下文。
- ✅ Team Memory Review 基础审批面板已实现。
- ✅ Output Style 已有基础能力并可注入 effective system prompt。
- ✅ Workflow Scripts MVP 已接入 Slash 命令，可插入工作流首步 prompt。
- ✅ Session Discovery / Resume 的历史加载、预加载、窗口恢复能力已落地。

代表文件：

- `src/components/ai/AiWorkspaceSkillManager.vue`
- `src/ai-gui/workspaceSkills.ts`
- `src/components/ai/AiMemoryReviewPanel.vue`
- `src/composables/useOutputStyles.ts`
- `src/composables/useWorkflowScripts.ts`
- `src/components/ai/SlashCommandPopover.vue`

待做项：

- ⏳ Workflow 目前不是完整可暂停/恢复/验证的 runtime。
- ⏳ Team Memory 仍是 proposal review，尚未形成团队级检索、冲突治理与审计体系。
- ⏳ Profile 化配置切换完成后，需要把 Prompt / Skill / Output Style 纳入 Profile Bundle。

### 10.5 阶段五：高级智能与协作能力

状态：🔵 尚未全面启动，仅完成部分基础依赖。

已完成基础：

- ✅ Background Job Runtime MVP 可作为 Verification / Workflow / 长任务基础。
- ✅ MCP 状态面板、配置读取、轻量健康判断已完成。
- ✅ 文件变更摘要与撤销能力已完成，可作为 Patch Review 基础。
- ✅ Rewind / Fork 会话能力已完成，可作为多分支协作基础。

待做项：

- ⏳ Ultraplan MVP。
- ⏳ Verification Agent。
- ⏳ LSP Code Intelligence。
- ⏳ 完整 Workflow Runtime。
- ⏳ MCP 动态工具注册、权限隔离与执行闭环。
- ⏳ Workspace Isolation。
- ⏳ Patch Review 深度化。

### 10.6 最近推荐三步状态

1. ✅ 收尾阶段一验收：已完成。
2. ✅ 启动阶段二 P0：已完成主体；ERP 入口接线待确认。
3. 🟡 提前设计阶段三 Gateway 类型：已完成配置切换详细设计，Gateway 核心类型仍待实现。

### 10.7 新增关联文档

- `docs/ai-desktop-gui-experience-implementation-status.md`
- `docs/ai-agent-engineering-governance-implementation-status.md`
- `docs/ai-config-switching-plan.md`
日期：2026-04-24

关联规划文档：

1. `docs/ai-agent-architecture-upgrade-plan.md`
2. `docs/ai-agent-engineering-governance-plan.md`
3. `docs/ai-desktop-gui-experience-plan.md`
4. `docs/ai-provider-gateway-governance-plan.md`
5. `docs/ai-agent-productization-upgrade-plan.md`
6. `docs/ai-agent-advanced-capabilities-plan.md`

## 1. 总体实施顺序

建议顺序：

```text
第一阶段：Agent 主链路架构
  ↓
第二阶段：工程治理与体验稳定
  + 桌面 GUI 体验与交互韧性
  ↓
第三阶段：Provider Gateway 与模型治理
  ↓
第四阶段：AI 产品化能力
  ↓
第五阶段：高级智能与协作能力
```

简化理解：

```text
先稳主链路 → 再治卡顿/GUI体验/诊断 → 再管模型和 Provider → 再产品化 → 最后做高级 Agent
```

## 2. 阶段一：Agent 主链路架构

对应文档：`docs/ai-agent-architecture-upgrade-plan.md`

### 2.1 目标

先把 AI 最核心的执行链路打稳：

- 对话发送。
- 流式输出。
- 工具调用。
- 压缩边界。
- 错误恢复。
- Abort。
- Turn 状态机。

这是所有后续能力的地基。

### 2.2 为什么必须先做

如果主链路不稳定，后面做 Provider Gateway、Skill、Plugin、多 Agent，都会把问题放大。

典型风险：

- `/compact` 卡死。
- 工具调用后状态不释放。
- 流式 Done 丢失导致 UI 一直 loading。
- 历史上下文越积越大。
- 失败后不知道能否重试。

### 2.3 前置条件

无。此阶段可以直接开始。

### 2.4 核心任务

1. 修稳 `compact-boundary`。
2. 模型上下文只取最后一个 boundary 后内容。
3. 压缩摘要采用结构化 Prompt。
4. Compact 支持独立 request/session、timeout、abort、本地 fallback。
5. 引入 `AiTurnState`。
6. 工具执行接入统一上下文。
7. 错误进入 `failed/recovering/aborted`，不能悬挂。

### 2.5 验收重点

- `/compact` 不会无限卡住。
- 压缩后继续问“刚才做到哪了”能回答准确。
- 刷新后 compact boundary 仍然有效。
- Abort 能停止模型请求和工具执行。
- UI loading 状态和 runtime 状态一致。

### 2.6 输出给下一阶段的能力

完成后应提供：

- 稳定的 AI Turn Runtime。
- 可恢复的 compact 机制。
- 基础错误恢复机制。
- 工具调用状态基础。
- 后续诊断和 Gateway 可挂载的 request/turn 标识。

## 3. 阶段二：工程治理与体验稳定

对应文档：

- `docs/ai-agent-engineering-governance-plan.md`
- `docs/ai-desktop-gui-experience-plan.md`

### 3.1 目标

解决用户最直观的问题：

- 卡顿。
- 卡死。
- 加载慢。
- 按钮无响应。
- Enter 不执行。
- 无法定位问题。
- 新功能出问题不能快速关闭。
- 长对话渲染不流畅。
- AI 正在做什么不可见。
- 自动编辑路径风险不可控。

### 3.2 为什么排第二

第一阶段解决“能不能正确跑”，第二阶段解决“跑起来是否顺滑、可诊断、可回滚”。

如果不先做这层，后续 Provider Gateway 和产品化功能越多，越难排查。

### 3.3 前置条件

需要阶段一至少完成：

- Turn 状态基本可用。
- Compact 不会卡死。
- Abort 链路可用。

### 3.4 核心任务

1. 新增 `AiTraceSpan` 和诊断包。
2. 输入 `Intent Resolver` 统一 Enter / Slash / @ / 按钮提交。
3. 流式输出 Backpressure，避免逐 token 触发重渲染。
4. 长任务接入后台 Job Runtime。
5. Feature Gate / Kill Switch 基础版。
6. Provider / Compact / ERP / Schema 等关键链路加 trace。
7. 消息 projection 层，原始消息和 UI 消息分离。
8. Markdown / assistant group 合并缓存。
9. 轻量 `AiStatusPanel` 展示 phase、工具、后台 Job。
10. Tool Runtime 接入路径安全策略。

### 3.5 验收重点

- 对话滚动不卡顿。
- Enter、Slash、@、发送按钮行为一致。
- Compact、ERP 加载、Schema 对比不阻塞 UI。
- 出现卡顿能导出诊断包。
- 实验功能能一键关闭。
- 长对话渲染不会因对象全量重建而明显卡顿。
- 用户能通过状态面板看到 AI 当前阶段、工具和后台任务。
- 自动写文件不会越过 workspace 安全边界。

### 3.6 输出给下一阶段的能力

完成后应提供：

- 请求 trace 基础设施。
- Feature Gate 基础设施。
- 后台 Job 基础设施。
- 输入事件统一入口。
- 流式 UI 限流能力。
- 消息 projection 和渲染缓存能力。
- 状态面板基础能力。
- 路径安全基础能力。

## 4. 阶段三：Provider Gateway 与模型治理

对应文档：`docs/ai-provider-gateway-governance-plan.md`

### 4.1 目标

把 AI Provider 从“配置项”升级为“可治理网关”：

- 统一请求入口。
- Provider Health Test。
- 模型路由。
- fallback。
- 限流。
- 成本统计。
- token 估算。
- override 兼容。
- SSRF 防护。

### 4.2 为什么排第三

阶段一和阶段二解决本地 AI 主链路稳定后，才适合做模型治理。

否则 Provider Gateway 会和已有 chat/compact/prompt optimize 混在一起，导致又出现多条调用链。

### 4.3 前置条件

需要阶段二至少完成：

- `requestId/trace` 能记录请求。
- Feature Gate 可用。
- Compact 已经从 UI 私活中解耦一部分。
- AI 请求入口有收敛空间。

### 4.4 核心任务

1. 定义 `AiGatewayRequest / AiGatewayResult / AiGatewayContext`。
2. Chat、Compact、Prompt Optimize 统一走 Gateway。
3. Provider Profile 增加 Health Test。
4. 增加 Model Route：chat / compact / erp / schema。
5. 支持 priority、weight、fallback。
6. 接入 token estimator 和 cost tracker。
7. URL 类工具接入 SSRF 防护。

### 4.5 验收重点

- 任意 AI 请求都有 `requestId`。
- Provider 配置后能测试连接。
- 主模型失败能自动切备用模型。
- 鉴权失败不会盲目重试。
- `/compact` 可指定便宜快速模型。
- 能看到会话级 token 和成本。

### 4.6 输出给下一阶段的能力

完成后应提供：

- 稳定统一的 Provider 调用入口。
- 模型 fallback 能力。
- 成本和 token 基础数据。
- Provider health 状态。
- 安全 URL 访问能力。

## 5. 阶段四：AI 产品化能力

对应文档：`docs/ai-agent-productization-upgrade-plan.md`

### 5.1 目标

把 AI 从“对话工具”做成“产品系统”：

- 会话持久化增强。
- Plan。
- Task。
- 权限模式。
- Skill。
- Plugin。
- Memory Review。
- 上下文预算。
- 队列和定时任务。
- Remote Bridge。

### 5.2 为什么排第四

产品化能力会大量依赖前面三阶段：

- Plan / Task 依赖稳定 Turn Runtime。
- 权限和 Skill 依赖 Hook / Tool Runtime。
- Memory 和上下文预算依赖 compact 和 token estimator。
- Remote Bridge 和队列依赖诊断、Feature Gate、后台 Job。
- 多 Provider 体验依赖 Gateway。

如果提前做，会出现功能可见但不稳定。

### 5.3 前置条件

需要阶段三至少完成：

- Gateway 请求入口统一。
- 成本和 token 数据可用。
- 基础诊断和 Feature Gate 可用。
- Tool Runtime 状态相对稳定。

### 5.4 核心任务

1. Plan 模式产品化。
2. Task 状态和后台任务中心。
3. 权限模式基础版。
4. Skill 发现、加载、启用。
5. Plugin 基础协议。
6. Memory Review。
7. 会话恢复增强。
8. 上下文预算 UI。

### 5.5 验收重点

- 用户能看到 AI 当前计划和任务进度。
- 高风险工具需要确认。
- Skill / Plugin 不会破坏主链路。
- Memory 写入必须可 review。
- 会话恢复后任务状态清晰。

### 5.6 输出给下一阶段的能力

完成后应提供：

- 可管理的 AI 工作台。
- 可扩展的 Skill / Plugin 基础。
- 可审计权限系统。
- 可恢复任务和会话状态。

## 6. 阶段五：高级智能与协作能力

对应文档：`docs/ai-agent-advanced-capabilities-plan.md`

### 6.1 目标

在稳定地基上增强 AI 的“高级能力”：

- Ultraplan。
- 多 Agent critique。
- Verification Agent。
- LSP Code Intelligence。
- Workflow。
- MCP。
- Workspace Isolation。
- Patch Review。
- 多模态。

### 6.2 为什么最后做

这些能力最复杂，依赖最多：

- 多 Agent 需要稳定任务系统。
- Verification Agent 需要后台 Job 和诊断。
- LSP 需要工具预算和上下文预算。
- Workflow 需要 Plan / Task / Gateway。
- MCP 需要权限、安全、SSRF 和 Provider Gateway。
- Workspace Isolation 需要成熟的文件操作和任务隔离。

提前做会导致系统复杂度超过可控范围。

### 6.3 前置条件

需要阶段四至少完成：

- Plan / Task 可用。
- 权限系统可用。
- Skill / Plugin 有基础协议。
- Gateway 和 Job Runtime 稳定。
- 诊断包能覆盖复杂任务。

### 6.4 核心任务

1. Ultraplan MVP。
2. Verification Agent。
3. LSP Code Intelligence。
4. Workflow Scripts。
5. MCP 管理和权限。
6. Workspace Isolation。
7. Patch Review。

### 6.5 验收重点

- 多 Agent 不会互相覆盖文件。
- Verification 能独立验证并输出证据。
- Workflow 可暂停、恢复、取消。
- MCP 工具有权限和安全边界。
- Patch Review 能发现高风险改动。

## 7. 并行策略

虽然总体按顺序推进，但部分任务可以并行。

### 7.1 可并行任务

- 第一阶段 compact 修复 与 第二阶段输入 Intent Resolver 可以并行。
- 第二阶段诊断包、消息 projection、轻量 StatusPanel 可以并行。
- 第二阶段路径安全策略 与 第一阶段 ToolUseContext 收尾可以并行。
- 第二阶段诊断包 与 第三阶段 Gateway 类型设计可以并行。
- 第三阶段 Provider Health Test 与 Token Cost Tracker 可以并行。
- 第四阶段 Plan UI 与 Memory Review 可以并行。

### 7.2 不建议并行任务

- 不建议在 Agent 主链路未稳定前做多 Agent。
- 不建议在 Gateway 未统一前继续新增多个 Provider 特殊调用。
- 不建议在权限系统未完成前开放 Plugin/MCP 写操作。
- 不建议在 Job Runtime 未完成前做长时间主动任务。

## 8. 当前推荐最近三步

结合目前项目状态，推荐最近三步：

### 第一步：收尾第一阶段验收

重点检查：

- `compact-boundary` 持久化。
- 手动 compact 落库。
- summary 和 boundary 顺序。
- Turn Runtime 工具执行状态。
- Hook 是否覆盖工具前后。

### 第二步：启动第二阶段 P0

优先做：

- 诊断包。
- 输入 Intent Resolver。
- 流式输出 Backpressure。
- 消息 projection / 对象引用复用 / Markdown 缓存。
- 轻量 StatusPanel。
- Compact / ERP / Schema 后台 Job。
- Feature Gate 基础版。

### 第三步：提前设计第三阶段 Gateway 类型

先只设计类型和调用边界，不急着全量实现：

- `AiGatewayRequest`
- `AiGatewayContext`
- `AiGatewayResult`
- `AiGatewayError`
- `ProviderHealth`
- `ModelRoute`

这样第二阶段的 trace 和第三阶段的 Gateway 不会重复建设。

## 9. 总结

推荐顺序不是按“功能看起来高级程度”排，而是按依赖关系排：

```text
Agent 主链路
  是所有 AI 任务的执行地基

工程治理与体验稳定
  是排查、回滚、不卡顿的保障

Provider Gateway
  是多模型、多上游、成本和 fallback 的基础

产品化能力
  是把 AI 功能做成可管理系统

高级智能协作
  是在稳定系统上继续增强能力
```

如果资源有限，必须至少先完成前三阶段的 P0。否则后面的 Skill、Plugin、MCP、多 Agent 做出来也会因为卡顿、失败、不可诊断、Provider 不稳定而难以真正使用。

## 13. 当前并行增强完成状态（2026-04-25）

本节为最新可读状态块，用于覆盖旧段落中因历史编码问题或过期描述造成的误判。

### 13.1 已完成

- ✅ Workflow Runtime 增强：支持 localStorage 恢复、暂停、恢复、取消，test 步骤会等待 Verification Job 回写后再完成或失败。
- ✅ Verification 结果归档：Patch Review 面板会保存最近验证历史，展示状态、摘要和耗时，便于回溯质量证据。
- ✅ Workspace Isolation 预备能力：新增写入范围/触碰文件记录、冲突检测和 UI 预览，先用于并行任务覆盖风险提示。
- ✅ 阶段三类型兼容修复：修复 Gateway/rateLimiter/router 现有 typecheck 问题，但不改 Provider Gateway 主链路行为。

### 13.2 当前边界

- Workflow Runtime 仍是前端轻量 runtime，未接后端持久化队列，也不会自动发送 AI 消息。
- Workspace Isolation 当前只做记录和预警，不做强制文件锁、不拦截真实写入。
- Verification Archive 当前存 localStorage，适合单机 GUI 使用；后续可升级为 session/task 级持久化。
- Provider Gateway 主链路仍由阶段三开发继续推进，本次只做类型和健康状态兼容。

### 13.3 下一步建议

1. 把 Verification Archive 与 Workflow Run ID 绑定，形成“工作流执行证据链”。
2. 把 Workspace Isolation 接入文件写入工具，在写入前提示冲突而不是事后记录。
3. 深化 Code Intelligence 的 diff symbol/export API 影响面分析。
4. 等阶段三 Gateway 完成后，再把 Workflow / Verification 的模型调用统一接入 Gateway。

### 13.4 Workspace Isolation 写入前防护更新（2026-04-25）

- ✅ 写入工具链路已接入 Workspace Isolation Guard：`write_file` / `edit_file` 在真实执行前会检查当前路径是否与已记录 scope 冲突。
- ✅ 发现冲突时不会静默放行，即使当前权限模式允许写入，也会强制进入审批弹窗。
- ✅ 审批弹窗会显示 Workspace Isolation 冲突原因，用户可明确决定继续或拒绝。
- ✅ 当前策略仍保持轻量：只做风险提示和人工确认，不做强制文件锁，避免影响阶段三 Provider Gateway 和现有工具执行链路。

后续可继续升级为：任务开始前声明 write scope、工具写入成功后自动登记 owner、冲突严重时支持 deny-by-policy。

### 13.5 Workspace Isolation 自动登记更新（2026-04-25）

- ✅ `write_file` / `edit_file` 写入成功后会自动登记 Workspace Write Scope。
- ✅ 自动登记的 owner 使用 `tool:{sessionId}:{toolCallId}`，展示标签使用 `{toolName}:{toolCallId}`，便于追踪是哪次工具调用写入。
- ✅ 后续写入同一路径时，Workspace Isolation Guard 可基于自动登记记录触发写入前审批。
- ✅ 用户仍可在 Workspace Isolation 面板手动记录当前 Patch，用于同事/外部修改等非工具写入来源。

下一步可做：为 scope 增加过期时间和按 session 清理能力，避免历史记录长期影响新任务。

### 13.6 Workspace Isolation 清理策略更新（2026-04-25）

- ✅ Write Scope 增加默认 24 小时 TTL，写入前 Guard 和自动登记都会优先过滤过期记录。
- ✅ 新增按 session 清理能力，只清理 `tool:{sessionId}:*` 自动登记记录，不影响手动 Patch scope 或其他会话。
- ✅ Workspace Isolation 面板新增“清理过期”和“清理本会话”操作，降低历史记录误拦截概率。
- ✅ 当前仍保留“清空全部”作为手动兜底操作。

下一步可做：把 session 结束/切换时的清理策略自动化，或者为高风险 scope 增加 deny-by-policy。

### 13.7 Workspace Isolation deny-by-policy 更新（2026-04-25）

- ✅ 新增 Workspace Isolation Policy：`warn` / `deny`。
- ✅ 默认策略为 `warn`，保持兼容：冲突时强制审批但不直接拒绝。
- ✅ `deny` 策略下，`write_file` / `edit_file` 遇到跨 owner 文件冲突会在工具执行前直接拒绝，返回 `[workspace_isolation_denied]`。
- ✅ Workspace Isolation 面板支持策略切换，并持久化到 localStorage。
- ✅ 策略不会替代 path safety；路径越界仍由 path safety 优先阻断。

下一步可做：增加策略分级，例如“同 session 只审批、跨 session 直接拒绝、手动 Patch scope 需二次确认”。

### 13.8 Workspace Isolation 智能分级策略更新（2026-04-25）

- ✅ Workspace Isolation Policy 扩展为 `warn` / `smart` / `deny`。
- ✅ `warn`：所有冲突都进入审批，不直接拒绝。
- ✅ `deny`：所有跨 owner 冲突都在写入前拒绝。
- ✅ `smart`：同 session 冲突进入审批；手动 Patch scope 冲突进入审批；跨 session 工具写入冲突直接拒绝。
- ✅ Guard 结果增加 `ownerIds`，可区分 `tool:{sessionId}:{toolCallId}` 与 `patch-*` 手动 scope。
- ✅ 面板新增“智能分级”策略选项。

下一步可做：把 smart 策略的审批场景升级为二次确认，例如手动 Patch scope 冲突需要额外 confirm。

### 13.9 Workspace Isolation 手动 Patch 二次确认更新（2026-04-25）

- ✅ `smart` 策略下，手动 `patch-*` scope 冲突不直接拒绝，但会要求二次确认。
- ✅ 二次确认标记从 Policy Decision 传递到 Approval Pending，再由审批弹窗执行 `window.confirm`。
- ✅ 二次确认文案明确提示“可能覆盖手动记录的 Patch 范围 / 同事或外部修改”。
- ✅ 同 session 工具冲突仍保持普通审批；跨 session 工具冲突仍直接拒绝。

下一步可做：把二次确认从 `window.confirm` 升级为自定义 UI，支持展示冲突 owner、路径和建议操作。

### 13.10 Workspace Isolation 自定义二次确认 UI 更新（2026-04-25）

- ✅ 手动 Patch scope 冲突的二次确认已从 `window.confirm` 升级为审批弹窗内联 UI。
- ✅ 第一次点击“确认允许”只展开“需要二次确认”风险区，不会立即放行。
- ✅ 第二次点击“再次确认允许”才会真正 resolve allow。
- ✅ 二次确认区展示覆盖手动 Patch 范围、可能影响同事或外部修改的风险说明。
- ✅ 该机制复用现有 Approval Pending，不新增全局弹窗状态。

下一步可做：在二次确认区展示具体冲突路径和 owner 列表，而不仅是风险说明。

### 13.11 阶段四 Plan 变更历史更新（2026-04-25）

- ✅ `AiPlan` 增加 `changes`，统一记录 created / updated / approved / started / completed / abandoned / step_status_changed / active_changed。
- ✅ Plan Store 生命周期操作会自动追加变更历史，`updatePlan` 不允许外部 patch 覆盖历史记录。
- ✅ `buildPlanSummary()` 增加最近变更摘要，`formatPlanSummaryForContext()` 会注入 `Last change`，为压缩后恢复当前计划进度提供依据。
- ✅ 新增 `getPlanChanges(planId)`，对外返回复制后的变更记录，避免 UI 或调用方误改内部状态。
- ✅ 已补充 Plan Store 单测，覆盖创建、审批、启动、步骤完成/失败、放弃、active 切换、摘要注入和历史 copy 保护。

当前边界：
- Plan 变更历史仍在前端内存态，刷新后不保留；后续需要接后端持久化或 session store。
- 变更历史已进入摘要，但还没有独立 UI 时间线；后续可在 `AiPlanPanel` 增加“最近变更/全部历史”折叠区。
- Task 关联仍未完成，后续应把 Plan step 与 Background Job / Verification Job / Workflow Run ID 建立关联。

### 13.12 阶段四 Plan 最近变更 UI 更新（2026-04-26）

- ✅ `AiPlanPanel` 增加“最近变更”区块，展示当前 active plan 最近 5 条变更。
- ✅ 变更区块显示类型标签、摘要和时间，覆盖创建、批准、启动、步骤状态变化、完成/放弃、active 切换等记录。
- ✅ 保持轻量内联展示，不改变原有 Plan 审批、终止、重新规划流程。
- ✅ 补充面板测试，覆盖最近变更渲染和最多 5 条限制。

当前边界：
- UI 目前只展示最近 5 条，不提供全量时间线、筛选或详情展开。
- 变更历史仍未持久化；刷新后历史是否保留取决于后续 Plan Store 持久化方案。

### 13.13 阶段四 Plan 轻量持久化更新（2026-04-26）

- ✅ Plan Store 增加 localStorage 快照：`devforge.ai.plans.v1`，保存 plans 与 session active plan 映射。
- ✅ 所有 Plan 生命周期变更、步骤状态变更、active 切换、删除和清空都会同步保存快照。
- ✅ Plan Store 查询入口会懒加载恢复快照，刷新后可恢复 active plan、步骤状态和变更历史。
- ✅ 恢复逻辑带 schema 校验，损坏 JSON 或非法 plan/step/change 会被忽略，不阻塞主链路。
- ✅ 持久化最多保留最近 50 个计划，避免 localStorage 长期膨胀。
- ✅ 补充单测覆盖保存/恢复、空 store 清理、损坏数据忽略和变更历史恢复。

当前边界：
- 这是轻量前端持久化，不是后端 session store；跨设备、跨用户、长历史审计仍需后端化。
- 运行中的 Plan 恢复后不会自动继续执行，只恢复可见状态和历史记录。

### 13.14 阶段四 Plan-Verification 任务证据链更新（2026-04-26）

- ✅ `AiPlanStep` 增加 `jobRefs`，可记录后台任务/验证任务的 jobId、kind、status、结果摘要和错误信息。
- ✅ Plan Store 增加任务关联 API：可把 job 挂到 active plan 当前步骤，并按 jobId 回写状态。
- ✅ Verification Job 提交时会自动关联 active plan 当前步骤，记录第一条命令作为任务标题。
- ✅ Background Job 状态变化会同步回写 Plan jobRef，覆盖 running / succeeded / failed / cancelled 等状态。
- ✅ `AiPlanPanel` 在步骤下展示关联任务标签，例如 `verification:running` / `verification:succeeded`。
- ✅ 任务关联和状态回写进入 Plan 变更历史，压缩后可通过最近变更看到任务证据。
- ✅ 单测覆盖 Plan jobRef 创建/更新/持久化恢复、面板展示、Background Job 回写和 Verification 自动挂接。

当前边界：
- 当前只自动接入 Verification Job；Schema Compare、ERP、Resource Scan 等后台任务还未按业务步骤自动挂接。
- jobRef 仍是前端状态证据链，不替代后端审计表；完整团队审计仍需后端持久化。

### 13.15 阶段四 Plan-后台任务证据链扩展（2026-04-26）

- ✅ Background Job Store 提交入口统一自动挂接可作为业务证据的任务：`verification`、`schema_compare`、`schema_compare_sql`、`erp_module_load`、`resource_scan`。
- ✅ Compact / Auto Compact 等上下文维护任务默认不挂接 Plan，避免污染业务步骤证据。
- ✅ Schema 对比、迁移 SQL、ERP 模块加载、资源扫描会进入 active plan 当前步骤的 `jobRefs`。
- ✅ 后台任务 running / succeeded / failed / cancelled 状态继续统一回写 Plan jobRef。
- ✅ 补充单测覆盖自动挂接业务任务、排除 compact 任务、状态回写和 Verification 提交链路。

当前边界：
- 自动挂接只知道任务类型和 session，暂未带上业务上下文标题，例如具体库表、资源路径或 ERP 模块名。
- 后续如果后台任务 payload 标准化，可把 payload 摘要写入 jobRef title/resultSummary。

### 13.16 阶段四后台任务上下文标题更新（2026-04-26）

- ✅ `submitJob()` 增加可选 `title/contextSummary`，不会破坏旧调用。
- ✅ Schema Compare 提交时写入 `Schema 对比：源库 → 目标库`，并记录连接/库名摘要。
- ✅ Schema 迁移 SQL 提交时写入 `生成迁移 SQL：源库 → 目标库`。
- ✅ ER/ERP 全量加载提交时写入 `ERP 模块加载：数据库名` 和连接/库名摘要。
- ✅ Plan jobRef 更新时保留已有 title/resultSummary，避免后续 running/succeeded 状态回写把上下文冲掉。
- ✅ Background Jobs 面板显示自定义任务标题和上下文摘要。
- ✅ Plan 面板任务标签从 `kind:status` 升级为 `title:status`。
- ✅ 补充单测覆盖任务标题、上下文摘要、面板展示和状态回写不覆盖标题。

当前边界：
- Resource Scan 目前只有 session/path 类信息，尚未找到统一业务入口传入更完整 payload。
- 后端 Background Job DTO 暂未持久化 title/contextSummary；当前主要服务前端 Plan 证据链和 UI 展示。

### 13.17 阶段四压缩后 Plan 证据注入更新（2026-04-26）

- ✅ `AiPlanSummary` 增加 active step jobRefs、最近变更摘要、需关注任务摘要。
- ✅ `buildPlanSummary()` 会提取当前步骤最近任务、running/queued/failed 任务和最近 3 条变更。
- ✅ `formatPlanSummaryForContext()` 会注入 `Recent plan changes`、`Current step jobs`、`Plan jobs needing attention`。
- ✅ Auto Compact 原有 active plan 注入链路无需改动，自动带上增强后的 Plan 证据。
- ✅ Plan Runtime 的 `formatPlanContext()` 同步获得增强摘要，可用于后续非 compact 的恢复上下文。
- ✅ 单测覆盖 jobRefs、失败任务、最近变更进入 compact context。

当前边界：
- 当前仍是文本摘要注入，不是结构化 JSON 注入；后续可根据模型提示策略改成更稳定的 XML/JSON 块。
- 注入最多保留少量最近任务和变更，避免 compact 后上下文再次膨胀。

### 13.18 阶段四 Plan 完整历史筛选更新（2026-04-26）

- ✅ `AiPlanPanel` 保留最近 5 条变更快速视图，同时在历史超过 5 条时提供“完整历史”折叠区。
- ✅ 完整历史支持按 `全部 / 状态 / 步骤 / 任务 / 其他` 筛选，任务筛选覆盖 `job_attached` 与 `job_updated`。
- ✅ 完整历史默认最多展示最近 20 条，避免长计划变更记录直接撑爆面板。
- ✅ 历史项继续复用现有类型标签、摘要和时间格式，不改变 Plan 数据结构和持久化 schema。
- ✅ 补充面板单测，覆盖最近 5 条截断、完整历史展示和任务筛选。

当前边界：
- 完整历史目前只展示摘要，不提供单条变更详情展开或 metadata 查看。
- 历史仍基于前端 Plan Store 快照；后端审计和跨设备历史需要后续 session/event store 承接。

### 13.19 阶段四 Transcript Event Store 轻量持久化更新（2026-04-26）

- ✅ `TranscriptStore` 增加 localStorage 快照：`devforge.ai.transcript.events.v1`，支持显式 `save/load`。
- ✅ Transcript 持久化限制最近 20 个 session、每个 session 最近 500 条事件，避免长期膨胀。
- ✅ 恢复逻辑带基础 schema 校验，非法 session、非法 event type、payload 不匹配会被忽略。
- ✅ `useAiChat` 使用持久化 Transcript Store，并在初始化时自动恢复快照。
- ✅ `createTranscriptHookIntegration` 支持动态 sessionId resolver，修复会话切换后事件仍写入旧 session 的隐患。
- ✅ 补充单测覆盖 Transcript 保存/恢复、空快照清理、非法数据忽略和动态 session 记录。

当前边界：
- 当前仍是前端轻量持久化，不是后端 event store；跨设备审计、团队协作审计仍需后端承接。
- Transcript 还没有独立可视化时间线面板；目前主要服务诊断导出、搜索和后续 Plan/Workflow 证据链。

### 13.20 阶段四 Transcript 时间线面板更新（2026-04-26）

- ✅ 新增 `AiTranscriptTimelinePanel`，在 DevMode 诊断区展示当前会话最近 transcript 事件。
- ✅ 时间线展示事件类型、时间、turnId、摘要，并按最新事件倒序显示。
- ✅ 顶部展示事件类型计数，便于快速判断当前会话是否集中在 tool/error/routing/plan。
- ✅ `useAiChat` 暴露只读 `getTranscriptEvents()` / `getTranscriptEventCount()`，不暴露 store 可变对象。
- ✅ 面板接入 `AiChatView` 右侧任务轨 DevMode 区域，避免挤占主对话滚动区和底部输入区。
- ✅ 补充组件单测覆盖事件计数、倒序渲染、摘要和空状态。

当前边界：
- 当前时间线只做最近事件观察，不支持交互筛选、详情展开、导出单条事件。
- Standalone AI 页面暂未接入该面板；如果后续需要统一诊断体验，可复用同一组件。

### 13.21 对话区 v2 原型 1:1 视觉落地（2026-04-26）

- ✅ 按 `validated-gathering-lighthouse.md` 与 `ai-chat-module-redesign-v2.html` 方向重塑主对话区：无头像、timeline turn、轻量 turn header、普通 AI 文本无大框。
- ✅ 将 `Status / MCP / Context Budget / File Change / Patch Review / Workflow Runtime / Workspace Isolation / Plan / Diagnostics / Transcript` 迁入右侧 `Run Inspector`，主对话流只保留需要用户决策的 Plan Gate，避免运行面板继续挤压正文和 composer。
- ✅ 结构化内容保留明确边界：代码块、文件卡片、工具结果、文件操作卡片统一为暗色边界卡片，视觉接近 v2 原型的 code/tool/diff 区域。
- ✅ Composer 改为 v2 中等高度暗色渐变容器，工具栏 chip 化，保持底部固定可见，不被运行面板遮挡。
- ✅ 右侧 Inspector 保留原有 task rail 交互契约：运行/阻塞任务自动展开，完成任务默认折叠但可手动打开；DevMode 有对话时自动显示诊断面板。

验证结果：
- ✅ `pnpm vitest run src/views/__tests__/AiChatView.interaction.test.ts src/components/ai/__tests__/AiMessageBubble.test.ts src/components/ai/__tests__/AiMessageListVirtual.test.ts`
- ✅ `pnpm test:typecheck`

当前边界：
- Standalone AI 页面暂未同步完整 v2 样式。
- Inspector 内部各子面板仍保留各自局部布局，只通过外层容器和深层宽度规则做统一收口；后续可逐个子面板做 1:1 精修。
