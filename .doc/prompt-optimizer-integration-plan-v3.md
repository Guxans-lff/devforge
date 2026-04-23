# prompt-optimizer 集成方案评估与优化（v3）

## 1. 评估结论摘要

对 [prompt-optimizer-integration-plan-v2.md](./prompt-optimizer-integration-plan-v2.md) 的整体判断：**方向正确，已明显优于 v1，但仍不是最优方案**。

v2 的主要优点：
- 已修正 v1 中 `src/services/ai/*` 与 DevForge 现有 `src/composables/ai/*` 分层不一致的问题。
- 已把第一阶段收敛为 `optimizePrompt` 最小闭环，避免首版范围过大。
- 已补充取消/重试/旧流污染控制，和当前 [chatSessionRunner.ts](../src/composables/ai/chatSessionRunner.ts) 的 abort 模式一致。
- 已明确 AGPL 风险与“只借鉴架构、不复制实现”的边界。

v2 的主要不足：
- **目标仍偏定性，缺少可量化验收标准**。
- **步骤虽然完整，但阶段边界与实施顺序还可以再压缩、再具体**。
- **存在轻度冗余与职责边界摇摆**，尤其是组件层和 composable 层的“请求生命周期管理”职责表述重复。
- **边界条件考虑较多，但异常分级、超时策略、输出后处理策略还不够明确**。

因此，v3 的目标不是推翻 v2，而是在 v2 的基础上做三件事：
1. 把目标改成**可验收、可量化**；
2. 把步骤改成**更收敛的执行清单**；
3. 把边界条件、异常处理、职责划分再收紧，降低实施歧义。

---

## 2. 按四项标准逐项评估 v2

### 2.1 目标是否清晰且可量化？

**结论：部分清晰，但量化不足。**

#### v2 的优点
- 已明确第一阶段只做 `optimizePrompt(...)` 最小闭环。
- 已明确首期不改 Rust、不改数据库、不引入工具调用。
- 已写出阶段 1 的验收标准，如：
  - 弹窗能打开并自动生成结果
  - provider/model/api key 缺失时有错误
  - 关闭或重试不会出现旧结果污染
  - `AiPromptEnhancer.vue` 不再包含硬编码系统提示词

#### v2 的问题
1. **“最小闭环”仍缺少量化定义**
   - 没定义“自动生成结果”的判定方式。
   - 没定义“明确错误”的 UI 呈现标准。
   - 没定义“无旧流污染”的可验证条件。

2. **缺少性能/交互层的可量化目标**
   - 未规定一次打开弹窗是否只允许一次请求。
   - 未规定 regenerate 后旧请求必须在多长时间内被中断或忽略。
   - 未规定空输入、空输出、异常输出的明确处理结果。

3. **测试目标与验收目标未完全对齐**
   - 测试列得比较多，但没有明确“通过哪些测试 = 阶段 1 完成”。

#### v3 优化要求
把阶段 1 目标压成 6 条明确验收条件：

1. **功能目标**：打开优化弹窗后，若 `provider/model/apiKey/originalText` 均有效，则会发起且仅发起 1 次优化请求。
2. **正确性目标**：返回文本只展示优化结果，不追加本地拼接说明。
3. **取消目标**：关闭弹窗或点击 regenerate 时，旧请求必须被中止，旧流事件不得继续写入 UI。
4. **隔离目标**：`AiPromptEnhancer.vue` 中不再出现硬编码优化模板文本。
5. **兼容目标**：不修改 Rust command、不修改数据库 schema、不启用 tool use。
6. **验证目标**：以下命令通过：
   - `pnpm exec vitest run src/composables/__tests__/promptOptimizerTemplates.test.ts src/composables/__tests__/promptOptimizer.test.ts src/components/ai/__tests__/AiPromptEnhancer.test.ts`
   - `pnpm test:typecheck`

> 这样目标才能真正做到“能否完成，一眼就能判定”。

---

### 2.2 步骤是否完整且逻辑连贯？

**结论：整体完整，逻辑基本连贯，但还能再收敛。**

#### v2 的优点
- 先抽模板，再抽 optimizer，再改组件，再补测试，这条主线是对的。
- 已将 `iterate` 后移到第二阶段，避免第一阶段 scope 膨胀。
- 已把后端语义化 API 放到可选后续阶段，避免抢跑。

#### v2 的问题
1. **“新增前端服务层”标题与实际路径不一致**
   - 标题写“服务层”，实际落在 `src/composables/ai/*`。
   - 这容易让执行人误以为要引入新分层概念。

2. **组件与 composable 的职责拆分还不够锐利**
   - v2 同时写了：
     - 组件层负责请求生命周期管理
     - optimizer 层也支持 `AbortSignal`、`sessionId`、abort helper
   - 这不是错，但如果不收紧，实施时容易出现“双重状态管理”。

3. **实施顺序还能更具体**
   - 更合理的顺序应该是：
     1. 先写模板注册与渲染测试
     2. 再写 optimizer 测试
     3. 再实现 optimizer
     4. 再改组件
     5. 再补组件测试
   - 这样更符合低风险迭代。

#### v3 优化后的推荐顺序

### 阶段 1 执行顺序（最优版）

1. 新增 `src/composables/ai/promptOptimizerTemplates.ts`
2. 先写 `src/composables/__tests__/promptOptimizerTemplates.test.ts`
3. 新增 `src/composables/ai/promptOptimizer.ts`
4. 先写 `src/composables/__tests__/promptOptimizer.test.ts`
5. 实现 `optimizePrompt(...)`
6. 改造 `src/components/ai/AiPromptEnhancer.vue`
7. 更新 `src/components/ai/__tests__/AiPromptEnhancer.test.ts`
8. 跑定向 Vitest
9. 跑 `pnpm test:typecheck`
10. 如触及 API 类型或 Tauri 参数，再补 `pnpm check:rust`

这样顺序更利于逐步锁定错误范围。

---

### 2.3 是否存在冗余、遗漏或潜在冲突？

**结论：存在轻度冗余，少量遗漏，潜在冲突可控但需要收口。**

#### 冗余点
1. **取消逻辑描述重复**
   - 在“目标架构”“数据流图”“测试与验证”“风险与控制”里多次重复“关闭/重试取消 + requestId 防污染”。
   - 这说明该点重要，但文档可以收敛为一个统一规则：
     - “所有优化请求必须具备 sessionId + AbortSignal + activeRequestId 三重保护。”

2. **是否修改 locale 的描述略冗余**
   - `zh-CN.ts` / `en.ts` 的“仅当新增 UI 文案时修改”可以压缩为一句，不必单列两次。

#### 遗漏点
1. **缺少“输出为空字符串”的明确处理规则**
   - 如果模型返回空内容，当前是提示错误、保留旧结果、还是展示空白？
   - 这应写进异常处理。

2. **缺少“输出不符合预期格式”的处理规则**
   - 比如模型输出“优化后提示词如下：...”这种带说明前缀的内容。
   - 首版是否允许轻量清洗？还是直接原样显示？v2 没定死。

3. **缺少超时策略**
   - 如果 provider 一直不返回、也不结束，UI 应该怎么办？
   - 当前 DevForge AI 体系可能已有上层超时，但 v2 没说明 prompt optimizer 是否额外处理。

4. **缺少 regenerate 期间按钮状态约束**
   - regenerate 是否可重复连点？
   - loading 状态是否禁用 accept？
   - 虽然组件已有部分行为，但 v2 没把它变成明确要求。

5. **缺少文件命名最终规范**
   - 文档提了 v1/v2/v3，但实施文档命名和产物命名还可以更统一。

#### 潜在冲突点
1. **组件层与 composable 层同时关心 abort**
   - 如果两边都维护状态，容易出现：
     - composable 已 abort，但组件还认为请求活着；
     - 组件已切换 requestId，但 composable 还在累加文本。

2. **“不修改 api.ts”与“可能需要新的类型/参数”之间的张力**
   - v2 说首期不改 `src/api/ai.ts`，这是合理默认。
   - 但如果实现中发现 `aiChatStream` 类型签名对 `signal` 或事件转发不够清晰，应允许最小变更，不能把“不修改”写成铁律。

#### v3 的处理原则
- **唯一取消规则**：
  - 组件维护 `activeRequestId` 和 `AbortController`
  - composable 只负责响应 `signal.aborted` 并调用 `aiAbortStream(sessionId)`
  - composable 不保存长期 UI 状态
- **唯一输出规则**：
  - 空输出视为失败
  - 非空输出仅做 `trim()`
  - 首版不做“去前缀/去总结”的激进后处理，避免误删内容
- **唯一 API 原则**：
  - 默认不改 `src/api/ai.ts`
  - 只有当类型不够用时，才允许最小补充

---

### 2.4 是否考虑了边界条件和异常处理？

**结论：考虑得比 v1 完整，但仍可进一步结构化。**

#### v2 已考虑到的边界
- provider 未选
- model 未选
- api key 缺失
- 空输入
- 关闭弹窗中断请求
- regenerate 取消旧请求
- 旧 chunk 污染防护
- 不启用 tools
- 不传 workDir
- 不落库，避免隐私问题

#### v2 还不够明确的边界
1. **模型返回空串**
   - 应作为错误处理：`优化结果为空，请重试`。

2. **模型返回非 TextDelta、只返回结束事件**
   - 最终没有 accumulated text 时，要走失败分支。

3. **abort 与正常错误的区分**
   - `abort` 不应显示为 destructive error；
   - 应静默结束或恢复到可再次点击状态。

4. **快速重复打开/关闭弹窗**
   - 组件 watch 触发可能很频繁；
   - 必须保证同一时刻只有一个激活请求。

5. **多语言模板行为**
   - 目前策略是“尽量与输入语言一致”，但需要明确写入模板设计要求。

6. **provider endpoint 为空值**
   - 当前 `AiPromptEnhancer.vue` 用 `props.provider.endpoint ?? ''`，应保留兼容。

7. **流结束但 enhancedText 为空**
   - 必须有用户可见错误，而不是看起来像成功但什么都没生成。

#### v3 的异常处理分级

### A. 输入校验错误
由组件层直接拦截，不发请求：
- provider 缺失
- model 缺失
- originalText 为空
- apiKey 为空

### B. 运行时取消
由组件 + composable 协同处理：
- 关闭弹窗
- 点击 regenerate
- 新请求覆盖旧请求

处理要求：
- 不弹红色错误
- UI 从 loading 恢复
- 旧流事件全部忽略

### C. AI 运行错误
由 composable 抛出，由组件展示：
- 网络错误
- provider 错误
- endpoint 错误
- 模型错误
- invoke 错误

处理要求：
- 展示错误文案
- 保留重试入口
- 不保留半截旧结果作为最终结果

### D. 结果异常
- 返回空串
- 仅空白字符
- 流结束但没有实际文本

处理要求：
- 统一视为失败
- 提示“优化结果为空，请重试”

---

## 3. v3 最优方案

## 3.1 目标（量化版）

阶段 1 的唯一目标是：

> 将 [AiPromptEnhancer.vue](../src/components/ai/AiPromptEnhancer.vue) 中的硬编码提示词优化逻辑抽离为可测试的 `promptOptimizer` composable，并在不修改 Rust command、不引入 tool use、不新增数据库表的前提下，保持现有用户体验不退化。

### 阶段 1 验收标准

必须同时满足：

1. 打开优化弹窗后，在 `provider/model/apiKey/originalText` 均有效时，**只发起 1 次**优化请求。
2. 关闭弹窗或点击 regenerate 时，旧请求被中止，旧流事件**不会继续写入**当前结果。
3. `AiPromptEnhancer.vue` 中**不再包含**硬编码优化模板文本。
4. 优化结果成功时，用户仍可点击“使用优化结果”并触发 `accept` 事件。
5. 输入校验错误、运行错误、空结果错误均有明确 UI 反馈。
6. 以下验证通过：
   - `pnpm exec vitest run src/composables/__tests__/promptOptimizerTemplates.test.ts src/composables/__tests__/promptOptimizer.test.ts src/components/ai/__tests__/AiPromptEnhancer.test.ts`
   - `pnpm test:typecheck`

---

## 3.2 推荐实施方案

### 新增文件

1. [promptOptimizerTemplates.ts](../src/composables/ai/promptOptimizerTemplates.ts)
   - 只提供：
     - `general-optimize` 模板
     - `renderTemplate()`

2. [promptOptimizer.ts](../src/composables/ai/promptOptimizer.ts)
   - 只提供：
     - `optimizePrompt(input, options)`
     - `abortPromptOptimization(sessionId)`

3. [promptOptimizerTemplates.test.ts](../src/composables/__tests__/promptOptimizerTemplates.test.ts)
4. [promptOptimizer.test.ts](../src/composables/__tests__/promptOptimizer.test.ts)

### 修改文件

1. [AiPromptEnhancer.vue](../src/components/ai/AiPromptEnhancer.vue)
   - 移除硬编码 `ENHANCE_PROMPT`
   - 改为调用 `optimizePrompt(...)`
   - 组件保留：
     - 输入校验
     - `getCredential(...)`
     - `AbortController`
     - `activeRequestId`
     - UI 展示与 emit

2. [AiPromptEnhancer.test.ts](../src/components/ai/__tests__/AiPromptEnhancer.test.ts)
   - 补齐：
     - 打开后发起请求
     - 缺参时不发请求
     - regenerate 取消旧请求
     - 关闭取消旧请求
     - 旧 chunk 不污染新结果
     - accept 事件

### 暂不修改

- [ai.ts](../src/api/ai.ts)
- [ai.rs](../src-tauri/src/commands/ai.rs)
- 数据库存储和配置存储
- locale 文件（除非新增 UI 文案）

---

## 3.3 职责划分（最终版）

### 组件层：AiPromptEnhancer.vue
负责：
- 接收 `open / originalText / provider / model`
- 做输入校验
- 获取 `apiKey`
- 生成 `AbortController`
- 维护 `activeRequestId`
- 调用 `optimizePrompt(...)`
- 展示 loading / error / enhancedText
- 处理 accept / close / regenerate

### composable 层：promptOptimizer.ts
负责：
- 选择模板
- 渲染模板变量
- 调用 `aiChatStream(...)`
- 响应 `AbortSignal`
- 调用 `aiAbortStream(sessionId)`
- 聚合最终文本
- 对“空结果”抛出统一错误

### API 层：ai.ts
负责：
- 保持现有 Tauri 调用封装，不新增业务语义

### Rust 层：ai.rs + services/ai/*
负责：
- 继续提供现有流式 chat 能力
- 首期不感知“prompt optimizer”业务语义

---

## 3.4 边界条件与异常处理（最终版）

### 输入前校验
- provider 缺失：提示错误，不请求
- model 缺失：提示错误，不请求
- originalText 为空：提示错误，不请求
- apiKey 缺失：提示错误，不请求

### 请求中断
- 关闭弹窗：abort 当前请求
- regenerate：先 abort 旧请求，再启动新请求
- 再次打开：旧请求不得污染当前结果

### 运行错误
- invoke 报错
- provider/network/model 报错
- endpoint 异常

统一策略：
- 显示错误
- 停止 loading
- 保留重新生成入口

### 结果错误
- 流结束但为空
- 仅空白字符

统一策略：
- 视为失败
- 提示“优化结果为空，请重试”

### 输出后处理
- 首版仅做 `trim()`
- 不做“去前缀/删总结”之类激进文本清洗
- 避免误伤用户真实内容

---

## 3.5 测试清单（最终版）

### 单元测试

#### [promptOptimizerTemplates.test.ts](../src/composables/__tests__/promptOptimizerTemplates.test.ts)
- 基础变量替换
- 缺失变量为空
- 重复变量替换
- 非字符串变量转字符串
- Markdown / 代码块保留

#### [promptOptimizer.test.ts](../src/composables/__tests__/promptOptimizer.test.ts)
- 构造正确 `systemPrompt`
- 调用 `aiChatStream(...)`
- `enableTools === false`
- 参数透传正确
- `TextDelta` 正确聚合
- abort 时调用 `aiAbortStream(sessionId)`
- 空结果抛错

### 组件测试

#### [AiPromptEnhancer.test.ts](../src/components/ai/__tests__/AiPromptEnhancer.test.ts)
- provider/model 缺失错误
- apiKey 缺失错误
- 打开后只发一次请求
- 流式结果逐步显示
- regenerate 会取消旧请求
- close 会取消旧请求
- 旧 chunk 不污染新请求
- accept 正常发出

---

## 3.6 后续扩展策略

### 第二阶段
仅在阶段 1 稳定后再做：
- `extraInstruction`
- `iteratePrompt(...)`
- `iterate` 模板
- feedback 输入框

### 第三阶段
仅在真实需求出现后再做：
- 后端语义化 prompt optimize command
- 优化历史持久化
- 模板偏好存储
- 多模板模式切换

---

## 4. 最终结论

v2 **不是错误方案**，但还不是“最优方案”。

它最大的问题不是方向错，而是：
- 目标量化还不够；
- 组件/composable 的职责还可以再收紧；
- 异常处理还需要更明确地分级；
- 执行顺序还能更利于落地。

v3 的最终建议是：

> **保留 v2 的整体方向，但把首期方案进一步压缩为“一个 composable、一个模板文件、一个组件改造、三组测试、两条验收命令”的最小闭环。**

如果你要，我下一步可以直接把这份 v3 覆盖写到：
[.doc/prompt-optimizer-integration-plan-v3.md](./prompt-optimizer-integration-plan-v3.md)
