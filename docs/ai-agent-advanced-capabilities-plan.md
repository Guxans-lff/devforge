# DevForge AI 能力增强补充规划（三）：高级协作、代码智能与质量闭环

日期：2026-04-24
参考项目：`D:\Project\claude-code-main`
关联文档：

- `docs/ai-agent-architecture-upgrade-plan.md`
- `docs/ai-agent-productization-upgrade-plan.md`

## 1. 文档目标

前两份文档分别覆盖：

1. AI 主链路与 Agent Runtime。
2. 工程化与产品化能力。

本文继续深挖 Claude Code 中更高级的能力：多 Agent 规划、代码智能、质量验证、沙箱隔离、远程协作、浏览器/外部环境、工作流自动化等。

这类能力不是马上全部实现，但可以作为 DevForge 中长期演进方向，让 AI 从“对话助手”升级为“可协作、可验证、可治理的开发执行系统”。

## 2. 第三批值得学习的能力

### 2.1 Ultraplan：多方案规划与 Critique

Claude Code 中有 `ultraplan`，支持不同 prompt 模式：

- `simple_plan`
- `visual_plan`
- `three_subagents_with_critique`

其思路是：复杂任务不直接执行，而是先生成方案、允许编辑/评论、再执行。高级模式还会引入多代理 critique。

DevForge 可借鉴为“高级规划模式”：

```ts
interface AiPlanningSession {
  id: string
  sessionId: string
  mode: 'simple' | 'visual' | 'multi_agent_critique'
  status: 'drafting' | 'reviewing' | 'approved' | 'executing' | 'cancelled'
  proposals: AiPlanProposal[]
  critiques: AiPlanCritique[]
  selectedProposalId?: string
}
```

适用场景：

- 大型重构
- ERP 模块设计
- 数据库迁移方案
- 多文件性能优化
- 架构升级
- 安全审计

DevForge 落地建议：

- 普通 Plan Mode：生成一个计划。
- Advanced Plan：生成 2-3 个方案并列对比。
- Critique：AI 自评风险和遗漏。
- 用户可编辑计划步骤。
- 批准后转为任务队列。

优先级：P2。

### 2.2 Verification Agent：验证型子代理

Claude Code 里有“不要自己给自己判分”的思想：复杂任务完成后，验证代理独立检查结果。

DevForge 可以引入轻量验证链路：

```ts
interface AiVerificationJob {
  id: string
  sourceSessionId: string
  targetChanges: string[]
  checklist: string[]
  status: 'pending' | 'running' | 'passed' | 'failed' | 'partial'
  report?: string
}
```

触发条件：

- 修改超过 N 个文件。
- 执行了数据库迁移。
- 改动涉及安全/权限/认证。
- 测试失败后修复。
- 用户要求“仔细检查”。

验证内容：

- 是否满足用户原始需求。
- 是否有无关改动。
- 是否有遗漏测试。
- 是否引入危险操作。
- 是否破坏已有约束。

DevForge 不需要一开始做真正并行代理，可以先做“验证回合”：主任务完成后，用独立 prompt 审查 diff 和测试输出。

优先级：P1/P2。

### 2.3 LSP Tool：代码智能工具

Claude Code 有 LSP 工具，用于：

- hover
- definition
- references
- symbols
- diagnostics

这比纯文本 grep 更可靠，尤其适合大型 TS/Rust 项目。

DevForge 可做自己的代码智能层：

```ts
interface CodeIntelTool {
  hover(file: string, line: number, column: number): Promise<HoverResult>
  definition(file: string, line: number, column: number): Promise<Location[]>
  references(file: string, line: number, column: number): Promise<Location[]>
  symbols(query: string): Promise<SymbolResult[]>
  diagnostics(file?: string): Promise<Diagnostic[]>
}
```

收益：

- AI 能更准确找类型定义。
- 减少“全文搜索猜测”。
- 修 TS/Rust 编译错误更快。
- 支持“解释这个函数引用关系”。

DevForge 当前是 Tauri + Vue + Rust，很适合接入：

- TypeScript LSP
- rust-analyzer
- Vue language server

优先级：P1。

### 2.4 Workflow Tool：可复用工作流

Claude Code 有 Workflow 相关能力和权限 UI。核心思想：把一串步骤封装成可审查、可复用的 workflow，而不是每次让模型临场发挥。

DevForge 可设计：

```ts
interface AiWorkflow {
  id: string
  name: string
  description: string
  steps: AiWorkflowStep[]
  requiredPermissions: ToolRiskLevel[]
  inputs: AiWorkflowInput[]
}
```

示例工作流：

- “修复 Rust 编译错误”
  1. 跑 `pnpm check:rust`
  2. 解析错误
  3. 定位文件
  4. 修复
  5. 重跑检查

- “数据库迁移审查”
  1. 读取 schema diff
  2. 生成迁移 SQL
  3. 风险分类
  4. 要求用户确认

- “前端卡顿排查”
  1. 找组件
  2. 查渲染列表
  3. 查 watcher/computed
  4. 添加虚拟化/节流

优先级：P2。

### 2.5 Dream / Background Ideation：后台构思任务

Claude Code 有 DreamTask 这类“后台构思”能力。它不是立即改代码，而是让 AI 在后台想方案，完成后通知主会话。

DevForge 可用于：

- 架构方案调研
- 新功能设计备选方案
- UI 交互优化建议
- 代码质量审查报告
- 产品路线分析

设计：

```ts
interface AiIdeationTask {
  id: string
  topic: string
  constraints: string[]
  outputType: 'plan' | 'report' | 'comparison' | 'risk_review'
  status: AiTaskStatus
  result?: string
}
```

优点：

- 不阻塞当前对话。
- 可以低优先级运行。
- 结果以任务通知形式回到主会话。

优先级：P3。

### 2.6 Batch / Loop Skill：批量自动化

Claude Code 有 batch、loop 等 skill。DevForge 可以学习其“让 AI 对一组目标重复执行同一任务”的能力。

场景：

- 批量检查多个 Vue 组件性能。
- 批量生成数据库表说明。
- 批量审查 API 接口权限。
- 批量修复相同 lint 问题。
- 批量给文档补目录。

设计：

```ts
interface AiBatchJob {
  id: string
  targets: AiBatchTarget[]
  instruction: string
  concurrency: number
  stopOnError: boolean
  progress: AiBatchProgress
}
```

需要配套：

- 并发限制
- 失败汇总
- 每项结果摘要
- 批量任务可暂停/继续

优先级：P2/P3。

### 2.7 Monitor Task：持续监控型任务

Claude Code 有 MonitorMcpTask、LocalShellTask 等任务类型。DevForge 可做监控型 AI 任务：

- 监控 dev server 编译错误。
- 监控 Rust cargo check 输出。
- 监控数据库连接状态。
- 监控日志文件错误。
- 监控测试 runner。

设计：

```ts
interface AiMonitorTask {
  id: string
  source: 'terminal' | 'file' | 'process' | 'database' | 'http'
  matcher: string | RegExp
  action: 'notify' | 'summarize' | 'ask_ai' | 'run_workflow'
  enabled: boolean
}
```

收益：

- 编译错误出现时自动提醒。
- 后台服务挂了能提示。
- 长任务完成后总结结果。

优先级：P2。

### 2.8 Browser / Chrome Context

Claude Code 有 Chrome/浏览器相关能力。DevForge 可学习但需结合桌面应用定位。

可做轻量版：

- 浏览器截图导入 AI 对话。
- 当前网页 DOM/URL/选中文本作为上下文。
- Web 控制台错误导入 DevForge。
- 从浏览器发送“帮我分析这个页面问题”到 DevForge。

与 DevForge 现有截图标注能力结合：

- 截图 -> 标注 -> AI 分析 -> 生成前端修复建议。

优先级：P3。

### 2.9 MCP / 外部工具协议

Claude Code 深度支持 MCP。DevForge 可以逐步兼容 MCP 思想，而不是一开始全量实现。

阶段化建议：

1. 内部工具 registry 先抽象成 MCP-like schema。
2. 支持本地 MCP server 配置读取。
3. 支持工具列表动态刷新。
4. 支持 MCP 工具权限控制。
5. 支持工具结果预算。

接口形态：

```ts
interface ExternalToolServer {
  id: string
  name: string
  transport: 'stdio' | 'http' | 'websocket'
  tools: AiToolDefinition[]
  status: 'connected' | 'disconnected' | 'error'
}
```

优先级：P2/P3。

### 2.10 Remote Bridge 与工作区隔离

Claude Code remote bridge 中有 `SpawnMode`：

- `single-session`
- `worktree`
- `same-dir`

这对 DevForge 很有启发：当多个 AI 任务并发执行时，是否共享同一工作区非常关键。

DevForge 可引入“任务执行隔离策略”：

```ts
type WorkspaceIsolationMode =
  | 'same_dir'
  | 'git_worktree'
  | 'temp_copy'
  | 'read_only_snapshot'
```

场景：

- 普通问答：`same_dir`
- 并行代码改造：`git_worktree`
- 风险分析：`read_only_snapshot`
- 自动实验：`temp_copy`

优先级：P2。

### 2.11 Webhook / 外部事件入口

Claude Code 有 webhook sanitizer，说明外部输入必须清洗后进入会话。

DevForge 可支持外部事件：

- GitHub PR opened
- GitHub issue comment
- CI failed
- 数据库告警
- 监控 webhook
- 定时任务触发

必须配套：

- 内容 sanitize
- 来源签名校验
- 默认只读处理
- 高风险操作回到 UI 确认

优先级：P3。

### 2.12 Share / 诊断包 / 可复现问题

Claude Code 有 share transcript 的思想。DevForge 可做更适合桌面产品的“诊断包”：

内容：

- 会话 transcript 摘要
- 最近错误日志
- provider 配置脱敏
- tool call 列表
- compact 历史
- 环境信息
- git diff summary
- 测试命令输出

用途：

- 用户反馈 bug。
- 团队协作排查。
- AI 自我诊断。
- 生成 issue 模板。

优先级：P1。

### 2.13 Patch / Diff 审核体验

Claude Code 很重视工具改动和权限确认。DevForge 作为桌面 IDE，可以进一步增强 Diff UX：

功能：

- AI 改动按 turn 分组。
- 每个 turn 可查看 diff。
- 支持接受/拒绝单个文件。
- 支持回滚某个 turn。
- 支持“让 AI 解释这段 diff”。
- 支持生成 commit message。

设计：

```ts
interface AiPatchSet {
  id: string
  sessionId: string
  turnId: string
  files: AiFilePatch[]
  status: 'pending' | 'accepted' | 'rejected' | 'partially_accepted'
}
```

优先级：P1/P2。

### 2.14 Prompt Classifier 与模式自动切换

Claude Code 有 auto-mode classifier、permission classifier 的思路。

DevForge 可做轻量分类器：

分类目标：

- 用户是在问答、规划、执行、调试还是数据操作？
- 是否需要进入 Plan Mode？
- 是否涉及高风险操作？
- 是否需要附加数据库上下文？
- 是否需要代码智能工具？

实现阶段：

1. 规则分类。
2. 小模型分类。
3. 允许用户纠正分类结果。
4. 将纠正写入偏好。

优先级：P2。

### 2.15 Native 能力与多模态输入

Claude Code 有 native/image processor 相关包。DevForge 已有截图标注，可以继续强化：

- 图片 OCR
- 截图区域识别
- UI bug 标注转任务
- 数据库 ER 图截图识别
- 终端错误截图解析
- 拖拽图片作为上下文

优先级：P2/P3。

## 3. DevForge 第三阶段建议新增模块

```text
src/composables/ai-agent/
  planning-advanced/
    multiPlanRunner.ts
    critiqueRunner.ts
    planComparison.ts
  verification/
    verificationJobStore.ts
    verificationPrompt.ts
    verificationRunner.ts
  code-intel/
    lspClient.ts
    symbolSearch.ts
    diagnosticsTool.ts
  workflows/
    workflowRegistry.ts
    workflowRunner.ts
    workflowPermission.ts
  monitors/
    monitorTaskStore.ts
    terminalMonitor.ts
    fileLogMonitor.ts
  external-tools/
    mcpRegistry.ts
    externalToolServer.ts
  isolation/
    workspaceIsolation.ts
    gitWorktreeManager.ts
    snapshotManager.ts
  diagnostics/
    shareDiagnosticBundle.ts
    bugReportBuilder.ts
  patches/
    patchSetStore.ts
    patchReviewRuntime.ts
  classifiers/
    promptIntentClassifier.ts
    riskClassifier.ts
```

## 4. 最值得优先落地的高级能力

### 4.1 LSP Code Intelligence（P1）

原因：

- 立即提升代码理解能力。
- 比继续堆 prompt 更有效。
- 对 TS/Rust/Vue 错误修复帮助最大。

最小版本：

- `definition`
- `references`
- `diagnostics`
- `symbol search`

### 4.2 诊断包 Share（P1）

原因：

- 当前频繁出现“卡死/没反应/不确定谁报错”。
- 诊断包能快速定位问题，降低沟通成本。

最小版本：

- 最近一个 turn 的 stream/tool/compact 日志。
- 当前前端状态。
- 后端日志片段。
- 脱敏 provider 信息。

### 4.3 Patch Review（P1/P2）

原因：

- DevForge 是开发工具，AI 改动可信度非常重要。
- Diff 审核比纯聊天更能建立信任。

最小版本：

- AI 修改文件后生成 patch set。
- 用户按文件接受/拒绝。
- 每个 patch set 可回滚。

### 4.4 Verification Job（P2）

原因：

- 大改动需要独立检查。
- 可以减少“修了一个 bug 引入另一个 bug”。

最小版本：

- 修改完成后 AI 自检 diff。
- 检查是否满足用户需求。
- 检查是否有无关改动。
- 建议需要运行的测试。

### 4.5 Workspace Isolation（P2）

原因：

- 并发任务越来越多后，同目录互相覆盖会变严重。
- 之前用户已经反馈资源管理/覆盖类问题。

最小版本：

- 后台实验任务默认 read-only。
- 并行改代码可选 git worktree。
- 合并前走 patch review。

## 5. 与前两份文档的边界

第一份：主链路稳定。

- Agent Runtime
- Compact Boundary
- ToolUseContext
- Provider Adapter
- Recovery

第二份：产品工程化。

- Transcript
- Plan
- Task
- Permission
- Skill
- Memory
- Diagnostics

第三份：高级协作与质量闭环。

- Multi-plan / Critique
- Verification Agent
- LSP Code Intelligence
- Workflow
- Monitor
- MCP
- Remote Bridge
- Patch Review
- Workspace Isolation

## 6. 推荐路线图

```text
阶段 A：先稳住
  1. Compact Boundary
  2. Agent Runtime 状态机
  3. 诊断包
  4. 权限模式

阶段 B：提升代码能力
  5. LSP Code Intelligence
  6. Tool Result Budget
  7. Patch Review
  8. Context Budget 面板

阶段 C：提升协作能力
  9. Plan 对象化
  10. Verification Job
  11. Task Notification Center
  12. Workflow Registry

阶段 D：生态与自动化
  13. Skill Registry
  14. MCP-like External Tools
  15. Workspace Isolation
  16. Scheduled/Monitor Tasks
```

## 7. 不建议短期投入的能力

- 完整 Remote Bridge：安全和运维成本高。
- 完整多 Agent 团队：没有 workspace isolation 和 patch review 前容易互相覆盖。
- 完整 Marketplace：先做内部 skill registry。
- 浏览器控制自动化：先做截图/DOM 上下文导入即可。
- AI 自动提交/推送：必须等 patch review 和权限系统成熟。

## 8. 结论

DevForge 如果想让 AI 明显变强，下一阶段不应只关注“模型更强”或“prompt 更长”，更应该补齐：

- 代码智能工具
- 可验证的改动链路
- 可诊断的运行时
- 可隔离的任务执行环境
- 可复用的工作流
- 可治理的权限系统

这些能力会让 DevForge 从“AI 聊天 + 工具调用”升级成真正的 AI 开发工作台。
