# DevForge AI 当前阶段进度与可并行任务

日期：2026-04-26  
用途：作为阶段一到阶段五的当前验收口径、实际完成情况和下一步并行任务清单，避免后续实施时重复判断“哪些已经完成、哪些还能做”。

---

## 1. 总体结论

当前项目已经具备继续推进阶段四的基础。

- 阶段一 Agent 主链路：基本完成，可作为后续能力承载层。
- 阶段二 工程治理 / GUI 体验：主体完成，能支撑后台任务、诊断、Feature Gate 和性能治理。
- 阶段三 Provider Gateway：P0 已完成并通过主链路验收，P1 进入可视化和策略分层打磨，当前不阻塞阶段四。
- 阶段四 产品化能力：已有多个 MVP，但需要从“面板和轻量 runtime”深化为“可恢复、可审计、可治理 runtime”。
- 阶段五 高级智能：已经启动低风险子集，完整 Multi-Agent / 强隔离 / 真实 LSP 仍不建议过早铺开。

建议当前工作策略：

1. 同事继续推进阶段四主线。
2. 我们并行补阶段四地基和阶段三验收文档。
3. 暂不启动完整阶段五大能力，避免权限、隔离、任务恢复体系未成熟时扩大风险面。

---

## 2. 阶段实际进度

| 阶段 | 当前状态 | 实际完成度 | 主要说明 |
| --- | --- | --- | --- |
| 阶段一 Agent 主链路 | ✅ 基本完成 | 约 90% | Compact、Tool Runtime、Hook、消息滚动、Enter 提交、压缩卡死等核心问题已处理。 |
| 阶段二 工程治理 / GUI 体验 | ✅ 主体完成 | 约 85% | Background Job、诊断包、Backpressure、Feature Gate、StatusPanel、ERP/Schema/资源后台化已落地。 |
| 阶段三 Provider Gateway | ✅ P0 验收完成，P1 打磨 | 约 85% | Gateway 已统一覆盖 chat / compact / prompt optimize，fallback、usage/cost、rate limit、SSRF、Provider Adapter、配置切换基础已接入。 |
| 阶段四 产品化能力 | 🟡 MVP 已有，深度化进行中 | 约 79% | Prompt、Skill、Memory、Output、Workflow、Plan、Transcript 均有基础；Output Style、Skill Manifest、Memory 治理字段、Workflow 中断恢复、Plan 变更历史、最近变更 UI、完整历史筛选、Plan localStorage 持久化、Plan-后台任务证据链、任务上下文标题、压缩后 Plan 证据注入、Transcript Event Store/Search/Diagnostic/轻量持久化/时间线面板已完成第一版闭环，多数模块仍需完整后端持久化 runtime。 |
| 阶段五 高级智能 | 🔵 低风险子集启动 | 约 25% | Patch Review、Verification、Code Intelligence、Workspace Isolation 预备能力已做，完整高级能力未完成。 |

---

## 3. 阶段三验收口径

阶段三当前可以按“P0 已验收完成，P1 继续打磨可视化、策略分层和 SLA/成本分析”处理。

### 3.1 已完成能力

- `executeGatewayRequest` 已进入主 chat 链路，并已覆盖 compact 与 prompt optimize。
- Gateway 支持 requestId、context、usage、cost、token estimate、rate limit。
- fallback chain 已支持跨 provider / model 切换。
- fallback 跨 provider 时已支持 `apiKeysByProvider`，避免备用 provider 复用主 provider key。
- chat、compact、prompt optimize 已补 fallback key 收集链路，并有 Gateway 覆盖测试守护。
- SSRF 安全检查已接入 provider profile 级 `security` 配置。
- Provider 配置 UI 已支持 allowlist、localhost、private IP 设置。
- Provider security 已写入前端类型、Rust 模型和 SQLite 持久化。
- fallback 成功后诊断包可通过 `recentFallbacks` 看到实际 provider/model、原始 provider/model、fallback reason。

### 3.2 验证结果

- `pnpm vitest run src/composables/ai-agent/transcript/__tests__ src/ai-gateway/__tests__ src/composables/__tests__/chatAbort.test.ts src/composables/__tests__/chatSessionRunner.test.ts src/composables/__tests__/useAiChatViewState.test.ts src/composables/__tests__/promptOptimizer.test.ts src/composables/__tests__/useAutoCompact.test.ts`：通过，16 个测试文件 / 155 条用例。
- `pnpm test:typecheck`：通过。
- `pnpm test`：通过，122 个测试文件 / 987 条用例。
- `cargo check`：通过。

### 3.3 当前边界

- fallback 实际落点目前主要在诊断导出中可见，尚未做成独立可视化 Gateway 面板。
- Provider Gateway 已能承载主链路，但还缺更完整的 gateway dashboard、provider SLA 趋势和成本分析视图。
- SSRF allowlist 已可配置，但还没有按 workspace / environment 做策略分层。
- Rust 侧仍有少量历史 warning，不阻塞当前功能。

---

## 4. 阶段四实际完成情况

阶段四不要简单判断为“已完成”。当前更准确的状态是：基础能力已出现，但产品化深度还不够。

| 模块 | 当前状态 | 已有能力 | 主要缺口 |
| --- | --- | --- | --- |
| Prompt | 🟡 MVP 可用 | Prompt 优化、模板、项目 Prompt 注入 | 缺版本管理、变更历史、效果评测、按 workspace/profile 绑定。 |
| Skill | ✅ 第一版治理闭环完成 | Workspace Skill 管理、配置摘要、启用状态、权限声明、Manifest 风险摘要、配置总览风险提示 | 仍缺真实 manifest 文件读取、schema 版本化、运行隔离与权限执行闭环。 |
| Memory | 🟡 治理字段第一版完成 | Memory store、Drawer、Review 面板、来源类型、来源引用、置信度、审核状态、使用次数、召回使用更新 | 仍缺冲突合并、变更历史、批量治理和 UI 级筛选。 |
| Output Style | ✅ 第一版闭环完成 | 内置 markdown 同源加载、设置页选择、发送请求注入 system prompt、诊断包记录当前风格 | 仍缺会话级绑定、workspace/profile 级默认值和自定义风格目录加载。 |
| Workflow | 🟡 MVP+ | 前端 runtime、localStorage 恢复、运行中刷新标记 interrupted、暂停/恢复/取消、Verification 联动 | 缺后端队列、任务级持久化、跨进程恢复、结构化事件流。 |
| Plan / Task | 🟡 基础可用+ | Plan Store、Parser、Runtime、面板、生命周期变更历史、最近变更摘要注入、面板最近变更展示、完整历史时间线筛选、localStorage 恢复、Verification/Schema/ERP/Resource 后台任务关联与状态回写、Schema/ERP 任务上下文标题、压缩后 jobRefs/最近变更注入 | 缺后端持久化、更多任务 payload 标准化、历史详情展开、后端审计闭环。 |
| Transcript | 🟡 地基可用+ | Event Store、Hook Integration、Search、Diagnostic Export、localStorage 轻量恢复、右侧任务轨 DevMode 时间线面板，覆盖 turn/message/tool/compact/permission/plan/usage/routing | 缺后端 event store、跨设备审计、更多筛选/详情展开、与后台任务/Workflow 的完整事件投影。 |

---

## 5. 当前最适合我们并行做的事情

以下任务尽量避开同事阶段四主线，优先做地基、验收、闭环，不大面积改同事正在写的业务 UI。

### 5.1 优先级 P0：阶段四验收清单

目标：把阶段四拆成可验收条目，方便同事实施后逐项检查。

建议输出：

- Prompt 验收清单。
- Skill 验收清单。
- Memory 验收清单。
- Output Style 验收清单。
- Workflow Runtime 验收清单。
- Plan / Task 验收清单。
- Transcript / Event Store 验收清单。

收益：低风险、高收益，不容易和代码实现冲突。

### 5.2 优先级 P0：Output Style 闭环

目标：把现有 `src/ai/output-styles/builtin/*.md` 从静态文件变成真实可用能力。

状态：✅ 第一版已完成。

建议实现：

- ✅ 增加 output style 列表读取和选择状态。
- ⏳ 支持会话级或 workspace 级默认 output style。
- ✅ 在发送 AI 请求时把选中的 output style 注入 system prompt。
- ✅ 诊断包记录当前使用的 output style。

收益：范围小、容易验收、对阶段四产品感知明显。

### 5.3 优先级 P1：Transcript / Event Store 骨架

目标：先建立事件流数据结构，不急着全量替换现有消息系统。

状态：✅ 第一版地基已完成。

已实现：

```ts
interface AiTranscriptEvent {
  id: string
  sessionId: string
  turnId?: string
  type: 'message' | 'tool_call' | 'tool_result' | 'compact' | 'permission' | 'error' | 'task' | 'plan'
  payload: unknown
  createdAt: number
}
```

已完成能力：

- ✅ 类型定义。
- ✅ 内存 store。
- ✅ append / list / clear 基础 API。
- ✅ 按 session、turn、event type 查询。
- ✅ 支持全文、工具、错误、时间范围和分页搜索。
- ✅ 导出诊断 JSON，包含 turn/tool/error/compact/routing/plan 时间线。
- ✅ localStorage 轻量恢复，限制 session 与事件数量，避免长期膨胀。
- ✅ DevMode 时间线面板，展示最近事件、类型计数和摘要。
- ✅ 单测。
- ✅ 不强行改主 chat 渲染链路。

收益：为阶段四深度化提供统一地基，也为后续恢复、搜索、诊断、任务追踪做准备。

### 5.4 优先级 P1：Memory 治理字段增强

目标：让 Memory 从“保存内容”升级为“可治理知识”。

状态：✅ 第一版已完成。

建议字段：

- ✅ `sourceType`：manual / chat / tool / file / workflow / compact。
- ✅ `sourceRef`：来源会话、文件、工具调用或 workflow id。
- ✅ `confidence`：0 到 1。
- ✅ `reviewStatus`：pending / approved / rejected / archived。
- ✅ `lastUsedAt`。
- ✅ `usageCount`。

注意：当前只做类型、store、编辑保留字段和测试，避免与同事 Memory UI 主线冲突。

### 5.5 优先级 P1：Skill Manifest 校验

目标：为后续 MCP / Plugin 做权限地基。

状态：✅ 第一版已完成。

建议实现：

- ✅ 定义 Workspace Skill 权限声明类型。
- ✅ 校验 name、description、path、permissions。
- ✅ 权限声明支持 read/write/execute/network/mcp。
- ✅ 在 Workspace Skill 面板展示风险摘要，并在 Workspace 配置总览同步提示高风险权限。

收益：后续接 MCP 和 Plugin 时不会无边界扩展。

---

## 6. 暂不建议现在做的事情

以下任务虽然重要，但当前不建议抢跑。

- 完整 Multi-Agent：依赖强 workspace isolation、任务恢复、冲突合并，现在做容易互相覆盖。
- Remote Bridge：依赖权限、认证、网络安全、任务状态同步，风险偏高。
- 真实 LSP 深接入：可以继续做轻量 code intelligence，但完整 LSP 需要单独设计生命周期和性能边界。
- 后端 daemon/supervisor：适合阶段四后半或阶段五，不建议现在和同事阶段四 UI 主线同时重构。
- 自动提交 / 自动推送：权限风险高，应等 Patch Review、Verification、Workspace Isolation 更成熟后再做。

---

## 7. 推荐接下来三步

### 第一步：补阶段四验收清单

先把阶段四每个模块的验收标准写清楚，作为同事实现后的检查依据。

### 第二步：做 Output Style 闭环

实现成本低，用户感知明显，也不太会和阶段四其他模块冲突。

### 第三步：搭 Transcript / Event Store 骨架

只做类型、store、测试，不强改 UI 渲染，作为后续产品化 runtime 的底座。

---

## 8. 当前验收关注点

后续每次同事说“已完成”，建议按下面口径检查：

1. 是否有明确数据模型，而不是只有 UI。
2. 是否能持久化或至少可恢复。
3. 是否有诊断包字段或日志可追踪。
4. 是否有单测覆盖核心逻辑。
5. 是否考虑权限、安全和失败状态。
6. 是否能和 Gateway / Job Runtime / Feature Gate 协同。
7. 是否不会破坏 compact、fallback、工具调用主链路。

---

## 9. 当前状态一句话

DevForge AI 当前已经从“能聊天、能调用工具”的阶段，进入“需要把 AI 能力产品化、可治理化”的阶段。阶段四可以继续推进，但重点不应只是加面板，而是把 Prompt、Skill、Memory、Workflow、Plan、Output Style 接到统一的持久化、诊断、权限和事件流体系中。
