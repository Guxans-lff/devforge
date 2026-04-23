# Context

目标是在 `D:/Project/DevForge/devforge` 中落地一个可维护的“提示词处理模块”，复用 `prompt-optimizer-develop` 的产品边界与架构思想，但不直接迁移其 AGPL-3.0-only 代码、模板文本或实现细节。`prompt-optimizer-develop` 的高价值部分在于三层抽象：提示词编排（PromptService）、模板渲染（TemplateProcessor）和可扩展的优化模式（optimize / iterate / context-message-optimize）；而 DevForge 已经具备可复用的 AI provider、流式会话、配置持久化和测试基建。此次集成的目标不是把另一个项目整包搬入，而是在 DevForge 现有 Tauri2 + Vue3 + Rust AI 架构下，重写一个最小闭环的提示词优化能力：用户输入原始提示词，系统输出优化后的版本，并为未来自定义规则、多模板、多模型接入预留扩展点。

本 v2 版本基于对原方案的系统性评估修订：

- **事实准确性**：原方案关于 Tauri2 + Vue3 + Rust、`aiChatStream(...)`、`ai_chat_stream`、AGPL 风险和 `AiPromptEnhancer.vue` 当前硬编码提示词的判断基本准确；但原方案拟新增 `src/services/ai/*` 与当前仓库实际 AI 前端编排主要位于 `src/composables/ai/*` 的事实不匹配。
- **逻辑一致性**：原方案同时把 `iterate` 放入第一阶段能力，又在第二阶段才增加“继续优化”交互，阶段边界不一致；v2 将第一阶段收敛为 `optimizePrompt` 最小闭环，`iteratePrompt` 明确后移到第二阶段。
- **方案最优性**：原方案方向正确，但首版引入 template registry、iterate、多模式预留和潜在后端 API 的范围偏大；v2 采用“先抽离当前硬编码能力，再按真实需求扩展”的路径，减少一次性改动面积。
- **可操作性**：原方案任务拆分较完整，但取消/重入、测试路径、真实脚本和验收边界不够具体；v2 明确使用独立 `sessionId`、`aiAbortStream(sessionId)`、本地 request token/`AbortSignal` 处理旧流污染，并使用当前 `package.json` 中存在的验证脚本。

## 推荐方案

### 1. 集成策略

采用“**前端先落地、后端能力复用、模板驱动重写、最小闭环优先**”的方式实现首版：

- **不直接复制** `prompt-optimizer-develop` 的 `packages/core`、默认模板、类型定义或测试，只借鉴其分层思想。
- **首期不新增 Rust 新命令**，优先复用 DevForge 已有的 `ai_chat_stream` 调用链，避免在 `src-tauri/src/commands/ai.rs` 里复制一套 prompt optimize 流程。
- 在 DevForge 前端新增独立的 **Prompt Optimizer composable + template registry**，把当前 [AiPromptEnhancer.vue](../src/components/ai/AiPromptEnhancer.vue) 中硬编码的 `ENHANCE_PROMPT` 和 AI 调用逻辑抽出。
- 新增代码优先放在 `src/composables/ai/*`，与当前 AI 编排模块保持一致；暂不新增 `src/services/ai/*`，除非项目后续统一引入 services 分层。
- `AiPromptEnhancer.vue` 保留为展示层，负责输入/输出、loading、错误、接受结果、关闭/重试时取消请求，不再承载模板策略。
- 第一阶段只实现“通用优化”最小闭环：`optimizePrompt(...)` + `general-optimize` 模板。
- “基于反馈继续优化（iterate）”作为第二阶段能力，第二阶段再实现 `iteratePrompt(...)`、`iterate` 模板和对应反馈输入 UI。
- “基于上下文的消息优化（context-message-optimize）”暂不实现接口和 UI，只在命名、模板结构和目录组织上避免阻塞未来扩展。

### 2. 需要复用的现有能力

#### 来自 prompt-optimizer-develop（仅借鉴思想，不复制实现）

- `packages/core/src/services/prompt/service.ts`
  - 借鉴能力边界：`optimizePrompt` / `iteratePrompt` / `optimizeMessage`
  - 借鉴输入校验、结果校验、模型调用与历史/模板解耦的思想
- `packages/core/src/services/template/processor.ts`
  - 借鉴点：模板与变量上下文分离、字符串模板与消息模板分层
  - 不直接迁移 Mustache 实现；DevForge 首期只需要最小变量替换
- `packages/core/src/services/template/default-templates/*`
  - 借鉴点：按场景拆模板，而非把系统提示词硬编码在组件中
  - 不复制任何默认模板文本，避免 AGPL 派生风险

#### DevForge 现有可复用实现

- 前端 AI API：`D:/Project/DevForge/devforge/src/api/ai.ts`
  - 复用 `aiChatStream(...)`
  - 复用 `aiAbortStream(sessionId)` 处理中断
- 前端 AI 编排参考：`D:/Project/DevForge/devforge/src/composables/ai/chatSessionRunner.ts`
  - 参考其 `AbortSignal -> aiAbortStream(sessionId)` 的取消模式
  - 不直接复用完整 chat runner，避免引入工具循环、历史持久化和压缩逻辑
- 前端组件：`D:/Project/DevForge/devforge/src/components/ai/AiPromptEnhancer.vue`
  - 作为现有提示词优化入口进行改造
- 凭据读取：`D:/Project/DevForge/devforge/src/api/connection` 中 `getCredential(...)`
  - 沿用现有 provider key 读取方式
  - 建议继续由组件或上层交互层读取 `apiKey` 后传入 optimizer，保持 `promptOptimizer.ts` 更易测试
- 统一错误处理：`D:/Project/DevForge/devforge/src/api/base.ts`
  - `aiChatStream(...)` 内部已沿用 `invokeCommand(..., { source: 'AI' })`
- Rust AI 管线：`D:/Project/DevForge/devforge/src-tauri/src/commands/ai.rs`
  - 继续复用 `ai_chat_stream`
- 测试 mock 基建：
  - `D:/Project/DevForge/devforge/src/__tests__/setup.ts`
  - `D:/Project/DevForge/devforge/src/__tests__/mocks/tauri.ts`
- 现有组件测试参考：
  - `D:/Project/DevForge/devforge/src/components/ai/__tests__/AiPromptEnhancer.test.ts`
- 当前验证脚本：
  - `pnpm test`
  - `pnpm test:typecheck`
  - `pnpm check:rust`

### 3. 目标架构

#### 3.1 新增前端服务层

新增目录与文件：

- `D:/Project/DevForge/devforge/src/composables/ai/promptOptimizer.ts`
- `D:/Project/DevForge/devforge/src/composables/ai/promptOptimizerTemplates.ts`

其中：

**`promptOptimizerTemplates.ts`**
- 定义 DevForge 自有模板注册表，不复用外部模板文本
- 模板建议结构：
  - `id`
  - `title`
  - `systemTemplate`
  - `userTemplate`
- 首期内置模板：
  - `general-optimize`
- 第二阶段再增加模板：
  - `iterate`
- 提供最小模板渲染函数：
  - 仅支持 `{{name}}` 变量替换
  - 缺失变量替换为空字符串
  - 非字符串变量通过 `String(value)` 安全转字符串
  - 不做循环、条件、表达式执行或 HTML 渲染，控制复杂度和安全面

**`promptOptimizer.ts`**
- 定义输入/输出类型，例如：
  - `OptimizePromptInput`
  - `PromptOptimizerOptions`
  - `PromptOptimizerResult`
  - 第二阶段再增加 `IteratePromptInput`
- 第一阶段对外暴露：
  - `optimizePrompt(...)`
  - `abortPromptOptimization(sessionId)`
- 第二阶段再对外暴露：
  - `iteratePrompt(...)`
- 内部职责：
  - 选择模板
  - 填充变量
  - 构造 `systemPrompt` 和 `messages`
  - 调用 `aiChatStream(...)`
  - 强制 `enableTools: false`
  - 通过回调输出流式结果
  - 聚合最终文本并返回
  - 支持传入 `sessionId`，未传入时生成 `prompt-opt-${Date.now()}-${random}` 格式的独立会话 ID
  - 支持传入 `AbortSignal`；信号触发时调用 `aiAbortStream(sessionId)`，并忽略后续旧 chunk

首期建议的调用边界：

```ts
interface OptimizePromptInput {
  prompt: string
  providerType: string
  model: string
  apiKey: string
  endpoint?: string
  extraInstruction?: string
  sessionId?: string
  signal?: AbortSignal
}

interface PromptOptimizerOptions {
  onDelta?: (delta: string) => void
  onEvent?: (event: AiStreamEvent) => void
}

interface PromptOptimizerResult {
  text: string
  sessionId: string
}
```

#### 3.2 改造现有组件

修改：

- `D:/Project/DevForge/devforge/src/components/ai/AiPromptEnhancer.vue`

改造方式：
- 移除组件内部的硬编码 `ENHANCE_PROMPT`
- 改为调用 `promptOptimizer.ts` 中的 `optimizePrompt(...)`
- 继续在组件层完成 provider/model 输入校验和 `getCredential(...)` 读取，避免 optimizer 隐式依赖 Pinia/store/UI 状态
- 保留现有能力：
  - 输入原始提示词
  - 流式显示优化结果
  - 错误提示
  - 接受优化结果
  - regenerate
- 增强现有能力：
  - 打开弹窗时只触发一次当前输入的优化请求
  - 点击 regenerate 时先取消上一次请求，再开始新请求
  - 关闭弹窗时取消当前请求，避免旧 chunk 继续写入已关闭 UI
  - 用本地 `requestId` 或 `activeSessionId` 判断当前 chunk 是否仍属于最新请求
- 第一阶段不增加“额外优化要求”输入框，避免 UI 范围扩张；仅在 `OptimizePromptInput.extraInstruction` 中预留可选字段，第二阶段再决定是否展示。

#### 3.3 后端 API 策略

首期 **不新增独立 RESTful/Tauri prompt optimize 命令**，而是通过已有 AI API 间接实现语义化服务：

- 前端交互层调用 `promptOptimizer.ts`
- `promptOptimizer.ts` 调用 `src/api/ai.ts` 中的 `aiChatStream(...)`
- `aiChatStream(...)` 经由 `invokeCommand('ai_chat_stream', ...)`
- Rust 侧继续走 `src-tauri/src/commands/ai.rs` 的 `ai_chat_stream`

这样做的原因：
- DevForge 当前是桌面端 Tauri 架构，不是典型 Spring REST 后端；“清晰后端 API”在这里应理解为**清晰的 Tauri command / API 封装边界**。
- 现有 provider、流式返回、用量统计、错误处理都在该链路中，直接复用改动最小。
- 提示词优化首期不需要工具调用、文件访问、会话历史保存或数据库 schema 变更。

第二阶段或第三阶段如需更明确的“后端 prompt optimize API”，再考虑新增：
- `ai_optimize_prompt_stream`
- `ai_iterate_prompt_stream`

但其内部仍应复用 `ai_chat_stream` 的 provider 管线，而不是复制 provider 调用逻辑。

### 4. 与现有风格、配置、权限的兼容方式

#### 4.1 代码风格兼容

- 前端继续沿用现有 Vue 3 + TypeScript 组合式风格。
- AI 编排代码继续放在 `src/composables/ai/*`，与现有 `chatSessionRunner.ts`、`chatToolLoop.ts`、`chatSendPreparation.ts` 保持一致。
- API 调用继续使用 `src/api/ai.ts` / `invokeCommand` 风格。
- 组件职责保持轻量：UI、输入校验、凭据读取、请求生命周期管理在组件层；模板选择、流式调用、chunk 聚合在 optimizer 层。
- 命名沿用 DevForge AI 模块习惯：
  - 前端函数使用 `camelCase`
  - Rust 命令如后续新增则使用 `snake_case`
- 不新增外部模板引擎依赖，首期使用本地最小 `renderTemplate()`。

#### 4.2 数据结构与持久化兼容

首期功能不需要新增数据库表。

原因：
- 当前只实现“输入原始提示词 -> 输出优化版本”的即时交互。
- 优化结果由前端展示并由用户选择是否应用，不需要独立落库。
- 提示词可能包含用户代码、数据库语句、内部路径或业务信息，默认不保存更符合最小隐私原则。
- 如果未来需要保存模板、偏好、历史，可复用：
  - 工作区配置：`src/stores/ai-chat.ts` + `.devforge/config.json`
  - 全局设置：`src/stores/settings.ts`
  - AI 记忆：`src/stores/ai-memory.ts`

#### 4.3 权限系统兼容

DevForge 当前 AI 模块没有类似服务端 RBAC 的权限体系，而是通过：
- 凭据管理（provider key）
- workDir / tool use 约束
- 前端功能入口控制

因此首期提示词优化模块应：
- 延续现有 provider/model 选择与 credential 获取逻辑
- 不新增文件写入、文件读取或命令执行权限
- 不传入 workDir
- 默认且强制 `enableTools: false`
- 只作为普通 AI 文本生成能力的一种 UI 封装

### 5. 数据流图

#### 5.1 首期通用优化数据流

```text
用户输入原始提示词
  -> AiPromptEnhancer.vue
    -> 校验 provider/model/originalText
    -> getCredential(`ai-provider-${provider.id}`)
    -> 创建 AbortController + requestId/sessionId
    -> promptOptimizer.ts::optimizePrompt()
      -> promptOptimizerTemplates.ts 选择 general-optimize 模板
      -> 渲染 systemPrompt/user message
      -> src/api/ai.ts::aiChatStream(...)
        -> invokeCommand('ai_chat_stream', ...)
          -> src-tauri/src/commands/ai.rs::ai_chat_stream
            -> src-tauri/src/services/ai/* provider
              -> 模型返回流式文本
          -> Channel 回传 AiStreamEvent
        -> onEvent(TextDelta)
      -> promptOptimizer.ts 聚合 chunk
    -> AiPromptEnhancer.vue 判断 requestId 是否仍有效
    -> AiPromptEnhancer.vue 实时展示 enhancedText
  -> 用户点击“使用优化结果”
    -> emit('accept', enhancedText)
```

关闭或重试时的取消数据流：

```text
用户关闭弹窗 / 点击 regenerate
  -> AiPromptEnhancer.vue abort 当前 AbortController
    -> promptOptimizer.ts 捕获 signal abort
      -> src/api/ai.ts::aiAbortStream(sessionId)
        -> invokeCommand('ai_abort_stream', ...)
  -> AiPromptEnhancer.vue 增加 requestId
  -> 后续旧 TextDelta 因 requestId 不匹配被忽略
```

#### 5.2 二阶段 iterate 数据流

```text
用户已有优化版本 + 输入反馈
  -> AiPromptEnhancer.vue 或后续独立 UI
    -> promptOptimizer.ts::iteratePrompt()
      -> promptOptimizerTemplates.ts 选择 iterate 模板
      -> 构造 systemPrompt/user message
      -> aiChatStream(...)
      -> 流式返回新的优化版本
  -> 用户接受新的优化版本
```

第二阶段开始前必须先明确：
- 是否在同一个弹窗中展示 feedback 输入框
- 是否保留原始版本、上一版优化结果和反馈的三栏关系
- 是否需要保存用户的优化偏好

### 6. 文件变更清单

#### 新增文件

1. `D:/Project/DevForge/devforge/src/composables/ai/promptOptimizer.ts`
   - 提示词优化服务封装
   - 第一阶段负责 `optimizePrompt(...)`
   - 封装 `aiChatStream(...)`、`aiAbortStream(sessionId)`、chunk 聚合和取消保护

2. `D:/Project/DevForge/devforge/src/composables/ai/promptOptimizerTemplates.ts`
   - DevForge 自有模板注册表
   - 最小变量渲染函数
   - 第一阶段只包含 `general-optimize`

3. `D:/Project/DevForge/devforge/src/composables/__tests__/promptOptimizer.test.ts`
   - optimizer 层单测

4. `D:/Project/DevForge/devforge/src/composables/__tests__/promptOptimizerTemplates.test.ts`
   - 模板渲染单测

#### 修改文件

1. `D:/Project/DevForge/devforge/src/components/ai/AiPromptEnhancer.vue`
   - 删除硬编码增强 prompt
   - 改为调用 `promptOptimizer.ts`
   - 增加关闭/重试时的取消保护
   - 保留现有 UI 结构，避免首版 UI 范围扩张

2. `D:/Project/DevForge/devforge/src/components/ai/__tests__/AiPromptEnhancer.test.ts`
   - 增加 optimizer 调用、流式输出、错误态、关闭取消、重试覆盖旧结果测试

3. `D:/Project/DevForge/devforge/src/locales/zh-CN.ts`
   - 仅当新增 UI 文案时修改
   - 第一阶段如不新增 UI 字段，原则上无需修改

4. `D:/Project/DevForge/devforge/src/locales/en.ts`
   - 仅当新增 UI 文案时修改
   - 第一阶段如不新增 UI 字段，原则上无需修改

#### 暂不修改

- `D:/Project/DevForge/devforge/src/api/ai.ts`
- `D:/Project/DevForge/devforge/src-tauri/src/commands/ai.rs`
- `D:/Project/DevForge/devforge/src-tauri/src/services/ai/*`
- 数据库 schema / SQLite 表
- `D:/Project/DevForge/devforge/src/services/*`

### 7. 阶段化实施步骤

#### 阶段 1：最小可用闭环

1. 新建 `promptOptimizerTemplates.ts`
   - 定义 `general-optimize` 模板
   - 重写 DevForge 自有模板文本
   - 实现最小 `renderTemplate()`
   - 不引入 Mustache 或其他模板依赖

2. 新建 `promptOptimizer.ts`
   - 定义输入/输出类型
   - 实现 `optimizePrompt()`
   - 内部复用 `aiChatStream()`
   - 强制 `enableTools: false`
   - 支持 `sessionId`、`AbortSignal`、`onDelta`
   - 提供 `abortPromptOptimization(sessionId)` 或内部 abort helper

3. 改造 `AiPromptEnhancer.vue`
   - UI 保持原有结构
   - 将提示词模板和 AI 调用迁移到 optimizer
   - 保留流式展示与 accept 行为
   - 关闭弹窗时取消当前请求
   - regenerate 时取消旧请求并清空旧结果
   - 使用 requestId/activeSessionId 防止旧 chunk 污染新结果

4. 编写/更新测试
   - 模板渲染测试
   - optimizer 测试
   - 组件交互测试

5. 运行验证
   - `pnpm exec vitest run src/composables/__tests__/promptOptimizerTemplates.test.ts src/composables/__tests__/promptOptimizer.test.ts src/components/ai/__tests__/AiPromptEnhancer.test.ts`
   - `pnpm test:typecheck`
   - 若未改 Rust，可不强制运行 `pnpm check:rust`；若碰到 Tauri command 参数调整，必须运行 `pnpm check:rust`

阶段 1 验收标准：
- 原提示词优化弹窗仍能打开并自动生成结果
- provider/model 缺失和 api key 缺失仍有明确错误
- 流式文本能逐步显示
- 点击“使用优化结果”仍能 emit `accept`
- 关闭或重试不会出现旧结果继续追加
- `AiPromptEnhancer.vue` 不再包含硬编码系统提示词文本

#### 阶段 2：交互增强

1. 在优化弹窗中增加“额外优化要求”输入框，接入 `extraInstruction`
2. 增加“继续优化”反馈输入框
3. 新增 `iterate` 模板
4. 实现 `iteratePrompt()`
5. 增加模板模式选择（如“通用优化/代码任务优化/总结写作优化”）
6. 若有必要，将模板偏好保存到：
   - 全局设置：`src/stores/settings.ts`
   - 或工作区配置：`.devforge/config.json`

阶段 2 开始前的前置条件：
- 阶段 1 已有稳定测试覆盖
- 已确认用户确实需要二次反馈优化，而不是只需要 regenerate
- 已确认 UI 不会因额外输入项变得过重

#### 阶段 3：后端语义化 API（可选）

在存在以下需求时再做：
- 统计区分 prompt optimize 与普通 chat
- 后端统一管理模板
- 多入口共享同一 prompt optimization command
- 需要后端审计、用量归类或跨端复用

届时新增：
- `ai_optimize_prompt_stream`
- `ai_iterate_prompt_stream`
- 但内部仍复用现有 provider 管线

### 8. 测试与验证

#### 8.1 单元测试

**模板渲染测试**
文件：`src/composables/__tests__/promptOptimizerTemplates.test.ts`

覆盖：
- `{{prompt}}` 等变量替换成功
- 缺失变量替换为空字符串
- 重复变量全部替换
- 特殊字符 / Markdown / 代码块不被破坏
- 非字符串变量安全转字符串
- 不执行表达式、不支持循环/条件，避免模板能力超出首期设计

**optimizer 测试**
文件：`src/composables/__tests__/promptOptimizer.test.ts`

覆盖：
- `optimizePrompt()` 正确构造 `systemPrompt` 和 `messages`
- 调用了 `aiChatStream(...)`
- `enableTools` 固定为 `false`
- provider/model/apiKey/endpoint 参数正确透传
- 流式 `TextDelta` chunk 回调被正确透传并聚合
- 空 prompt 时不会发起请求
- `AbortSignal` 触发时调用 `aiAbortStream(sessionId)`
- abort 后旧 chunk 不会继续污染最终结果
- 不依赖 `getCredential(...)`，便于独立单测

第二阶段增加：
- `iteratePrompt()` 正确携带 `originalPrompt` / `optimizedPrompt` / `feedback`
- `iterate` 模板变量渲染正确

#### 8.2 组件测试

文件：`src/components/ai/__tests__/AiPromptEnhancer.test.ts`

覆盖：
- 未选 provider/model 时直接提示错误，不请求 AI
- 原始提示词为空时提示错误
- api key 缺失时提示错误
- 打开弹窗后进入 loading 状态
- 同一次打开只触发一次请求
- 流式结果逐步展示
- 错误态显示后可通过 regenerate 恢复
- regenerate 会清空旧结果并取消上一请求
- 关闭弹窗会取消当前请求
- 旧请求返回的 chunk 不会污染新请求
- 点击“使用优化结果”后发出 `accept` 事件

#### 8.3 类型与构建验证

- `pnpm exec vitest run src/composables/__tests__/promptOptimizerTemplates.test.ts src/composables/__tests__/promptOptimizer.test.ts src/components/ai/__tests__/AiPromptEnhancer.test.ts`
- `pnpm test:typecheck`
- `pnpm test`
- `pnpm check:rust`（仅 Rust/Tauri command 有改动，或发布前全量验收时执行）

#### 8.4 手工验证

1. 在 DevForge 中打开 AI 提示词优化弹窗
2. 输入中文 prompt，确认输出仍为中文
3. 输入英文 prompt，确认输出仍为英文
4. provider 未选择时，确认提示明确错误
5. model 未选择时，确认提示明确错误
6. provider 未配置 key 时，确认提示明确错误
7. 流式过程中关闭弹窗，确认旧结果不会继续追加
8. 流式过程中点击 regenerate，确认旧请求被取消，新结果从空内容开始
9. 点击“使用优化结果”，确认结果正确回填上游输入框/回调
10. 确认不会触发文件工具、不会读取 workDir、不会产生数据库 schema 变更

### 9. 风险与控制

1. **AGPL 风险**
   - 不复制 `prompt-optimizer-develop` 的代码、模板文本、测试
   - 仅复用功能边界和架构思想
   - DevForge 模板文本必须重新编写

2. **目录分层偏离现有仓库**
   - 首期使用 `src/composables/ai/*`
   - 不新增 `src/services/ai/*`
   - 如果未来要引入 services 分层，应单独做架构迁移，而不是由 prompt optimizer 单点引入

3. **UI 与逻辑耦合继续蔓延**
   - 必须把模板和 AI 调用抽离出 `AiPromptEnhancer.vue`
   - 组件只保留 UI 状态、输入校验、credential 获取和请求生命周期管理

4. **Provider 差异导致 prompt 行为不一致**
   - 继续通过 DevForge 现有 provider 适配层处理 system prompt
   - 首期不在组件层做 provider 分支逻辑
   - 模板文案保持模型无关，避免绑定特定 provider 格式

5. **并发/重入导致旧 chunk 污染**
   - 每次请求生成独立 `sessionId`
   - 关闭/重试时调用 `aiAbortStream(sessionId)`
   - 组件层维护 requestId/activeSessionId，旧请求回调必须被忽略
   - 测试覆盖重复点击、关闭弹窗和重试场景

6. **首版过度设计**
   - 阶段 1 只做 `optimizePrompt`
   - `iteratePrompt`、多模板选择、偏好持久化全部后移
   - 只有出现第二个真实调用方或明确产品需求时，才扩大模板注册和模式选择能力

7. **提示词内容隐私**
   - 首期不保存优化历史
   - 不写入数据库
   - 不写入 `.devforge/config.json`
   - 不接入 AI 记忆

8. **输出格式不稳定**
   - 系统提示词要求只输出优化后的提示词本身
   - 首期只做轻量 `trim()`，不做激进后处理，避免误删用户需要的内容
   - 手工验证中覆盖中文、英文、代码生成类 prompt

### 10. 关键代码路径

**参考分析来源（只借鉴，不复制）**
- `D:/Project/prompt-optimizer-develop/packages/core/src/services/prompt/service.ts`
- `D:/Project/prompt-optimizer-develop/packages/core/src/services/template/processor.ts`
- `D:/Project/prompt-optimizer-develop/packages/core/src/services/template/default-templates/*`

**DevForge 实际实施核心路径**
- `D:/Project/DevForge/devforge/src/components/ai/AiPromptEnhancer.vue`
- `D:/Project/DevForge/devforge/src/components/ai/__tests__/AiPromptEnhancer.test.ts`
- `D:/Project/DevForge/devforge/src/api/ai.ts`
- `D:/Project/DevForge/devforge/src/api/connection.ts`
- `D:/Project/DevForge/devforge/src/composables/ai/chatSessionRunner.ts`
- `D:/Project/DevForge/devforge/src/__tests__/mocks/tauri.ts`
- `D:/Project/DevForge/devforge/src-tauri/src/commands/ai.rs`

**拟新增路径**
- `D:/Project/DevForge/devforge/src/composables/ai/promptOptimizer.ts`
- `D:/Project/DevForge/devforge/src/composables/ai/promptOptimizerTemplates.ts`
- `D:/Project/DevForge/devforge/src/composables/__tests__/promptOptimizer.test.ts`
- `D:/Project/DevForge/devforge/src/composables/__tests__/promptOptimizerTemplates.test.ts`

**不建议首期新增的路径**
- `D:/Project/DevForge/devforge/src/services/ai/promptOptimizer.ts`
- `D:/Project/DevForge/devforge/src/services/ai/promptOptimizerTemplates.ts`
- `D:/Project/DevForge/devforge/src/services/ai/__tests__/promptOptimizer.test.ts`
- `D:/Project/DevForge/devforge/src/services/ai/__tests__/promptOptimizerTemplates.test.ts`
