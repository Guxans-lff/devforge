# Context

目标是在 `D:/Project/DevForge/devforge` 中落地一个可维护的“提示词处理模块”，复用 `prompt-optimizer-develop` 的产品边界与架构思想，但不直接迁移其 AGPL-3.0-only 代码、模板文本或实现细节。`prompt-optimizer-develop` 的高价值部分在于三层抽象：提示词编排（PromptService）、模板渲染（TemplateProcessor）和可扩展的优化模式（optimize / iterate / context-message-optimize）；而 DevForge 已经具备可复用的 AI provider、流式会话、配置持久化和测试基建。此次集成的目标不是把另一个项目整包搬入，而是在 DevForge 现有 Tauri2 + Vue3 + Rust AI 架构下，重写一个最小闭环的提示词优化能力：用户输入原始提示词，系统输出优化后的版本，并为未来自定义规则、多模板、多模型接入预留扩展点。

## 推荐方案

### 1. 集成策略

采用“**前端先落地、后端能力复用、模板驱动重写**”的方式实现首版：

- **不直接复制** `prompt-optimizer-develop` 的 `packages/core`、默认模板或类型定义，只借鉴其分层思想。
- **首期不新增 Rust 新命令**，优先复用 DevForge 已有的 `ai_chat_stream` 调用链，避免在 `src-tauri/src/commands/ai.rs` 里复制一套 prompt optimize 流程。
- 在 DevForge 前端新增独立的 **Prompt Optimizer service + template registry**，把当前 [AiPromptEnhancer.vue](src/components/ai/AiPromptEnhancer.vue) 中硬编码的 `ENHANCE_PROMPT` 和 AI 调用逻辑抽出。
- `AiPromptEnhancer.vue` 保留为展示层，负责输入/输出、loading、错误、接受结果，不再承载模板策略。
- 将“通用优化”和“基于反馈继续优化（iterate）”作为第一阶段能力；“基于上下文的消息优化”先只在接口设计上预留，不急于上线 UI。

### 2. 需要复用的现有能力

#### 来自 prompt-optimizer-develop（仅借鉴思想，不复制实现）

- `packages/core/src/services/prompt/service.ts`
  - 借鉴能力边界：`optimizePrompt` / `iteratePrompt` / `optimizeMessage`
- `packages/core/src/services/template/processor.ts`
  - 借鉴点：模板与变量上下文分离、字符串模板与消息模板分层
- `packages/core/src/services/template/default-templates/*`
  - 借鉴点：按场景拆模板，而非把系统提示词硬编码在组件中

#### DevForge 现有可复用实现

- 前端 AI API：`D:/Project/DevForge/devforge/src/api/ai.ts`
  - 复用 `aiChatStream(...)`
- 前端组件：`D:/Project/DevForge/devforge/src/components/ai/AiPromptEnhancer.vue`
  - 作为现有提示词优化入口进行改造
- 凭据读取：`D:/Project/DevForge/devforge/src/api/connection` 中 `getCredential(...)`
- 统一错误处理：`D:/Project/DevForge/devforge/src/api/base.ts`
  - 继续沿用 `invokeCommand(..., { source: 'AI' })`
- Rust AI 管线：`D:/Project/DevForge/devforge/src-tauri/src/commands/ai.rs`
  - 继续复用 `ai_chat_stream`
- 测试 mock 基建：
  - `D:/Project/DevForge/devforge/src/__tests__/setup.ts`
  - `D:/Project/DevForge/devforge/src/__tests__/mocks/tauri.ts`
- 现有组件测试参考：
  - `D:/Project/DevForge/devforge/src/components/ai/__tests__/AiPromptEnhancer.test.ts`

### 3. 目标架构

#### 3.1 新增前端服务层

新增目录与文件：

- `D:/Project/DevForge/devforge/src/services/ai/promptOptimizer.ts`
- `D:/Project/DevForge/devforge/src/services/ai/promptOptimizerTemplates.ts`

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
  - `iterate`
- 提供最小模板渲染函数：仅支持 `{{name}}` 变量替换，不做循环/条件渲染，控制复杂度

**`promptOptimizer.ts`**
- 定义输入/输出类型，例如：
  - `OptimizePromptInput`
  - `IteratePromptInput`
  - `PromptOptimizerOptions`
- 对外暴露：
  - `optimizePrompt(...)`
  - `iteratePrompt(...)`
- 内部职责：
  - 选择模板
  - 填充变量
  - 构造 `system` / `user` message
  - 调用 `aiChatStream(...)`
  - 通过回调输出流式结果

#### 3.2 改造现有组件

修改：

- `D:/Project/DevForge/devforge/src/components/ai/AiPromptEnhancer.vue`

改造方式：
- 移除组件内部的硬编码 `ENHANCE_PROMPT`
- 改为调用 `promptOptimizer.ts` 中的 `optimizePrompt(...)`
- 保留现有能力：
  - 输入原始提示词
  - 流式显示优化结果
  - 错误提示
  - 接受优化结果
  - regenerate
- 第一阶段可选增加一个“额外优化要求”输入框（例如“更简洁”“更适合代码生成”）；如果不想动 UI 过多，则先只在 service 层保留字段，组件暂时不展示

#### 3.3 后端 API 策略

首期 **不新增独立 RESTful/Tauri prompt optimize 命令**，而是通过已有 AI API 间接实现语义化服务：

- 前端交互层调用 `promptOptimizer.ts`
- `promptOptimizer.ts` 调用 `src/api/ai.ts` 中的 `aiChatStream(...)`
- `aiChatStream(...)` 经由 `invokeCommand('ai_chat_stream', ...)`
- Rust 侧继续走 `src-tauri/src/commands/ai.rs` 的 `ai_chat_stream`

这样做的原因：
- DevForge 当前是桌面端 Tauri 架构，不是典型 Spring REST 后端；用户提到的“清晰后端 API”在这里应理解为**清晰的 Tauri command / API 封装边界**。
- 现有 provider、流式返回、用量统计、错误处理都在该链路中，直接复用改动最小。

第二阶段如需更明确的“后端 prompt optimize API”，再考虑新增：
- `ai_optimize_prompt_stream`
- `ai_iterate_prompt_stream`

但其内部仍应复用 `ai_chat_stream` 的 provider 管线，而不是复制 provider 调用逻辑。

### 4. 与现有风格、配置、权限的兼容方式

#### 4.1 代码风格兼容

- 前端继续沿用现有 Vue 3 + TypeScript 组合式风格
- API 调用继续使用 `src/api/ai.ts` / `invokeCommand` 风格
- 组件职责保持轻量：UI 和 service 解耦
- 命名沿用 DevForge AI 模块习惯：
  - 前端 service 使用 `camelCase`
  - Rust 命令如后续新增则使用 `snake_case`

#### 4.2 数据结构与持久化兼容

首期功能不需要新增数据库表。

原因：
- 当前只实现“输入原始提示词 -> 输出优化版本”的即时交互
- 优化结果由前端展示并由用户选择是否应用，不需要独立落库
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
- 不新增文件写入/命令执行权限
- 默认 `enableTools: false`
- 只作为普通 AI 文本生成能力的一种 UI 封装

### 5. 数据流图

#### 5.1 首期通用优化数据流

```text
用户输入原始提示词
  -> AiPromptEnhancer.vue
    -> promptOptimizer.ts::optimizePrompt()
      -> promptOptimizerTemplates.ts 选择 general-optimize 模板
      -> 渲染 system/user messages
      -> src/api/ai.ts::aiChatStream(...)
        -> invokeCommand('ai_chat_stream', ...)
          -> src-tauri/src/commands/ai.rs::ai_chat_stream
            -> src-tauri/src/services/ai/* provider
              -> 模型返回流式文本
          -> Channel 回传 AiStreamEvent
        -> onEvent(TextDelta)
      -> promptOptimizer.ts 聚合 chunk
    -> AiPromptEnhancer.vue 实时展示 enhancedText
  -> 用户点击“使用优化结果”
    -> emit('accept', enhancedText)
```

#### 5.2 二阶段 iterate 数据流

```text
用户已有优化版本 + 输入反馈
  -> promptOptimizer.ts::iteratePrompt()
    -> 选择 iterate 模板
    -> 构造 messages
    -> aiChatStream(...)
    -> 流式返回新的优化版本
```

### 6. 文件变更清单

#### 新增文件

1. `D:/Project/DevForge/devforge/src/services/ai/promptOptimizer.ts`
   - 提示词优化服务封装
   - 负责 optimize / iterate 能力

2. `D:/Project/DevForge/devforge/src/services/ai/promptOptimizerTemplates.ts`
   - DevForge 自有模板注册表
   - 最小变量渲染函数

3. `D:/Project/DevForge/devforge/src/services/ai/__tests__/promptOptimizer.test.ts`
   - service 层单测

4. `D:/Project/DevForge/devforge/src/services/ai/__tests__/promptOptimizerTemplates.test.ts`
   - 模板渲染单测

#### 修改文件

1. `D:/Project/DevForge/devforge/src/components/ai/AiPromptEnhancer.vue`
   - 删除硬编码增强 prompt
   - 改为调用 `promptOptimizer.ts`
   - 如需最小 UI 增强，可增加额外要求输入框

2. `D:/Project/DevForge/devforge/src/components/ai/__tests__/AiPromptEnhancer.test.ts`
   - 增加 service 调用、流式输出、错误态测试

3. `D:/Project/DevForge/devforge/src/api/ai.ts`
   - 首期原则上无需结构性变更；仅在 `promptOptimizer.ts` 使用上发现参数不足时，再做最小补充

#### 暂不修改

- `D:/Project/DevForge/devforge/src-tauri/src/commands/ai.rs`
- `D:/Project/DevForge/devforge/src-tauri/src/services/ai/*`
- 数据库 schema / SQLite 表

### 7. 阶段化实施步骤

#### 阶段 1：最小可用闭环

1. 新建 `promptOptimizerTemplates.ts`
   - 定义 `general-optimize` / `iterate` 两个模板
   - 重写 DevForge 自有模板文本
   - 实现最小 `renderTemplate()`

2. 新建 `promptOptimizer.ts`
   - 定义输入类型
   - 实现 `optimizePrompt()`
   - 实现 `iteratePrompt()`
   - 内部复用 `aiChatStream()`

3. 改造 `AiPromptEnhancer.vue`
   - UI 保持原有结构
   - 将 AI 调用迁移到 service
   - 保留流式展示与 accept 行为

4. 编写/更新测试
   - 模板渲染测试
   - service 测试
   - 组件交互测试

5. 运行验证
   - `pnpm test`
   - `pnpm test:typecheck`
   - `pnpm check:rust`

#### 阶段 2：交互增强

1. 在优化弹窗中增加“额外优化要求”输入框
2. 增加“继续优化”反馈输入框，接 `iteratePrompt()`
3. 增加模板模式选择（如“通用优化/代码任务优化/总结写作优化”）
4. 若有必要，将模板偏好保存到：
   - 全局设置：`src/stores/settings.ts`
   - 或工作区配置：`.devforge/config.json`

#### 阶段 3：后端语义化 API（可选）

在存在以下需求时再做：
- 统计区分 prompt optimize 与普通 chat
- 后端统一管理模板
- 多入口共享同一 prompt optimization command

届时新增：
- `ai_optimize_prompt_stream`
- `ai_iterate_prompt_stream`
- 但内部仍复用现有 provider 管线

### 8. 测试与验证

#### 8.1 单元测试

**模板渲染测试**
文件：`src/services/ai/__tests__/promptOptimizerTemplates.test.ts`

覆盖：
- `{{prompt}}` 等变量替换成功
- 缺失变量替换为空字符串
- 重复变量全部替换
- 特殊字符 / Markdown / 代码块不被破坏
- 非字符串变量安全转字符串

**service 测试**
文件：`src/services/ai/__tests__/promptOptimizer.test.ts`

覆盖：
- `optimizePrompt()` 正确构造 `system` / `user` messages
- `iteratePrompt()` 正确携带 `originalPrompt` / `optimizedPrompt` / `feedback`
- 调用了 `aiChatStream(...)`
- 流式 chunk 回调被正确透传
- 空 prompt 时不会发起请求

#### 8.2 组件测试

文件：`src/components/ai/__tests__/AiPromptEnhancer.test.ts`

覆盖：
- 未选 provider/model 时直接提示错误，不请求 AI
- 原始提示词为空时提示错误
- 点击/打开后进入 loading 状态
- 流式结果逐步展示
- 错误态显示后恢复正常
- 点击“使用优化结果”后发出 `accept` 事件
- 若支持 regenerate，二次请求可覆盖旧结果

#### 8.3 类型与构建验证

- `pnpm test:typecheck`
- `pnpm test`
- `pnpm check:rust`

#### 8.4 手工验证

1. 在 DevForge 中打开 AI 提示词优化弹窗
2. 输入中文 prompt，确认输出仍为中文
3. 输入英文 prompt，确认输出仍为英文
4. provider 未配置 key 时，确认提示明确错误
5. 流式过程中关闭或重试，确认旧结果不会继续污染新请求
6. 点击“使用优化结果”，确认结果正确回填上游输入框/回调

### 9. 风险与控制

1. **AGPL 风险**
   - 不复制 `prompt-optimizer-develop` 的代码、模板文本、测试
   - 仅复用功能边界和架构思想

2. **UI 与逻辑耦合继续蔓延**
   - 必须把模板和 AI 调用抽离出 `AiPromptEnhancer.vue`

3. **Provider 差异导致 prompt 行为不一致**
   - 继续通过 DevForge 现有 provider 适配层处理 system prompt
   - 首期不在组件层做 provider 分支逻辑

4. **并发/重入导致旧 chunk 污染**
   - 实现时需要引入 requestId 或 AbortController 控制旧请求失效
   - 测试覆盖重复点击和重试场景

5. **后续扩展受限**
   - 所以首期就要把模板、service、UI 三层拆开，而不是继续在组件里塞逻辑

### 10. 关键代码路径

**参考分析来源（只借鉴，不复制）**
- `D:/Project/prompt-optimizer-develop/packages/core/src/services/prompt/service.ts`
- `D:/Project/prompt-optimizer-develop/packages/core/src/services/template/processor.ts`
- `D:/Project/prompt-optimizer-develop/packages/core/src/services/template/default-templates/*`

**DevForge 实际实施核心路径**
- `D:/Project/DevForge/devforge/src/components/ai/AiPromptEnhancer.vue`
- `D:/Project/DevForge/devforge/src/api/ai.ts`
- `D:/Project/DevForge/devforge/src/__tests__/mocks/tauri.ts`
- `D:/Project/DevForge/devforge/src/components/ai/__tests__/AiPromptEnhancer.test.ts`
- `D:/Project/DevForge/devforge/src-tauri/src/commands/ai.rs`

**拟新增路径**
- `D:/Project/DevForge/devforge/src/services/ai/promptOptimizer.ts`
- `D:/Project/DevForge/devforge/src/services/ai/promptOptimizerTemplates.ts`
- `D:/Project/DevForge/devforge/src/services/ai/__tests__/promptOptimizer.test.ts`
- `D:/Project/DevForge/devforge/src/services/ai/__tests__/promptOptimizerTemplates.test.ts`
