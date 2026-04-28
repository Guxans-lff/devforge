# DevForge AI 能力增强补充规划（五）：Provider Gateway、模型治理与安全风控

日期：2026-04-24
参考项目：`D:\Project\new-api-main`
关联文档：

- `docs/ai-agent-architecture-upgrade-plan.md`
- `docs/ai-agent-productization-upgrade-plan.md`
- `docs/ai-agent-advanced-capabilities-plan.md`
- `docs/ai-agent-engineering-governance-plan.md`

## 1. 文档目标

前四份文档主要围绕 DevForge 自身 AI Agent 能力展开：Agent Runtime、产品化能力、高级协作、工程治理和体验稳定性。

本文参考 `new-api-main`，补充另一个关键方向：**AI Provider Gateway 与模型治理**。

`new-api-main` 的优势不是 Agent 智能，而是多上游 AI Provider 的统一接入、渠道调度、重试降级、计费限流、参数覆盖、安全风控和可观测性。DevForge 如果后续要支持更多模型、更多团队场景和更稳定的 AI 体验，这一层非常值得学习。

本文目标：

- 让 DevForge 的 AI Provider 不再只是“保存一个 endpoint + api key”。
- 把 Provider 调用升级为可治理的 Gateway Layer。
- 支持模型路由、fallback、限流、成本统计、请求审计和安全策略。
- 为后续团队版、插件生态、私有模型接入打基础。

## 2. `new-api-main` 值得学习的核心机制

### 2.1 Provider / Channel Adaptor：统一上游适配器

`new-api-main` 用 `Adaptor` 抽象不同上游：

- 初始化请求上下文。
- 构建上游 URL。
- 设置 Header。
- 转换 OpenAI / Claude / Gemini / Image / Audio / Embedding 请求。
- 发送请求。
- 解析响应和 usage。
- 提供模型列表和渠道名称。

参考文件：

- `D:\Project\new-api-main\relay\channel\adapter.go`
- `D:\Project\new-api-main\relay\relay_adaptor.go`
- `D:\Project\new-api-main\relay\channel\openai\adaptor.go`
- `D:\Project\new-api-main\relay\channel\claude\adaptor.go`

DevForge 当前已有 Provider 配置和 Rust 端 OpenAI-compatible / Anthropic 流式调用，但 Provider Adapter 还不够“治理化”。建议升级为：

```ts
interface AiProviderAdapter {
  providerType: AiProviderType
  displayName: string

  buildRequest(input: AiGatewayRequest): Promise<AiUpstreamRequest>
  parseStream(event: unknown): AiStreamEvent[]
  parseFinalResponse(response: unknown): AiGatewayResult
  parseError(error: unknown): AiGatewayError

  getCapabilities(profile: AiProviderProfile): AiProviderCapabilities
  estimateTokens(request: AiGatewayRequest): Promise<AiTokenEstimate>
}
```

对应 Rust 端可保留实际 HTTP 执行能力，但前端和后端都应围绕统一的 Gateway Request / Gateway Result 设计。

建议支持的 Provider 类型：

- `openai_compat`
- `anthropic`
- `gemini`
- `ollama`
- `azure_openai`
- `openrouter`
- `deepseek`
- `kimi`
- `qwen`
- `custom`

### 2.2 RelayInfo：一次 AI 请求的统一上下文对象

`new-api-main` 的 `RelayInfo` 把一次请求里的关键数据集中起来：用户、Token、分组、模型、渠道、流式状态、计费、重试、Header override、请求路径、usage 等。

参考文件：

- `D:\Project\new-api-main\relay\common\relay_info.go`

DevForge 建议引入轻量版 `AiGatewayContext`：

```ts
interface AiGatewayContext {
  requestId: string
  sessionId: string
  turnId?: string
  source: 'chat' | 'compact' | 'tool' | 'prompt_optimize' | 'erp' | 'schema_compare' | 'workflow'

  providerProfileId: string
  providerType: AiProviderType
  model: string
  upstreamModel?: string

  stream: boolean
  retryIndex: number
  fallbackChainId?: string
  lastError?: AiGatewayError

  startedAt: number
  firstTokenAt?: number
  finishedAt?: number

  tokenEstimate?: AiTokenEstimate
  usage?: AiGatewayUsage
  cost?: AiGatewayCost
}
```

收益：

- trace、日志、计费、重试都能围绕 `requestId` 统一关联。
- `/compact`、普通 chat、提示词优化、ERP AI 查询不再各写一套 Provider 调用。
- 后续做诊断包时可以直接导出 Gateway Context。

### 2.3 Channel Selection：模型路由、优先级、权重和 fallback

`new-api-main` 支持 group、priority、weight、auto group、跨组 retry。核心思想是：同一个模型不只绑定一个上游，而是绑定一组候选渠道，根据优先级和权重选择，失败后切换。

参考文件：

- `D:\Project\new-api-main\service\channel_select.go`
- `D:\Project\new-api-main\model\ability.go`
- `D:\Project\new-api-main\model\channel.go`

DevForge 可做简化版：

```ts
interface AiModelRoute {
  id: string
  name: string
  source: AiGatewayContext['source'] | 'default'
  modelAlias: string
  candidates: AiModelRouteCandidate[]
}

interface AiModelRouteCandidate {
  providerProfileId: string
  model: string
  priority: number
  weight: number
  enabled: boolean
  maxRetries?: number
  timeoutMs?: number
}
```

典型路由：

- `default-chat`：日常对话优先高质量模型，失败降级到备用模型。
- `compact`：压缩优先便宜、快、上下文足够的模型。
- `tool-heavy`：工具调用多的任务优先支持 function calling 稳定的模型。
- `erp-query`：ERP 问答优先低延迟模型。
- `schema-review`：数据库审查优先强推理模型。

选择策略：

1. 过滤 disabled / quota exhausted / health bad 的候选。
2. 按 priority 从高到低选择。
3. 同 priority 内按 weight 随机。
4. 请求失败后根据错误类型决定是否 retry。
5. retry 时可以切换同 priority 其他候选，也可以降级到下一 priority。

### 2.4 Channel Affinity：稳定渠道优先复用

`new-api-main` 有 Channel Affinity，用于让相似请求优先复用稳定渠道，降低随机切换导致的失败率和延迟抖动。

参考文件：

- `D:\Project\new-api-main\service\channel_affinity.go`
- `D:\Project\new-api-main\service\channel_affinity_usage_cache_test.go`

DevForge 可做“Provider Affinity”：

```ts
interface AiProviderAffinityEntry {
  key: string
  providerProfileId: string
  model: string
  successCount: number
  failureCount: number
  avgLatencyMs: number
  lastUsedAt: number
  expiresAt: number
}
```

Affinity key 可以由以下字段构成：

- `source`
- `modelAlias`
- `workspaceId`
- `providerType`

适合场景：

- 某个 OpenAI-compatible endpoint 最近表现稳定，优先继续用它。
- 某个模型近期频繁超时，临时降权。
- 同一会话内尽量保持模型一致，减少风格和能力波动。

### 2.5 Param / Header Override：兼容各种 OpenAI-compatible 差异

`new-api-main` 的 override 能按条件修改请求参数和 Header，支持 set、delete、move、copy、append、prepend、replace、regex_replace、return_error、set_header 等操作，并能读取 retry、last_error、request_path、headers 等上下文。

参考文件：

- `D:\Project\new-api-main\relay\common\override.go`

DevForge 也会遇到大量 OpenAI-compatible 差异：

- 有的服务不支持 `stream_options`。
- 有的服务把 `max_tokens` 改成 `max_completion_tokens`。
- 有的服务不支持 `tool_choice`。
- 有的服务需要特殊 Header。
- 有的服务 reasoning 参数叫法不同。
- 有的服务 endpoint path 不完全兼容。

建议新增 Provider Profile 级 override：

```ts
interface AiProviderOverrideRule {
  id: string
  enabled: boolean
  when?: AiProviderOverrideCondition[]
  operations: AiProviderOverrideOperation[]
}

type AiProviderOverrideOperation =
  | { type: 'set_param'; path: string; value: unknown }
  | { type: 'delete_param'; path: string }
  | { type: 'rename_param'; from: string; to: string }
  | { type: 'set_header'; name: string; value: string }
  | { type: 'delete_header'; name: string }
  | { type: 'return_error'; message: string; skipRetry?: boolean }
```

P0 不需要做完整 DSL，先做 UI 可配置的常用项即可：

- 禁用 `stream_options`。
- 禁用 tools。
- 映射模型名。
- 自定义 Header。
- 设置默认 temperature / max_tokens。
- 请求超时。

### 2.6 Billing Session：成本统计、预估和结算

`new-api-main` 有完整计费生命周期：预扣、结算、退款/补扣，支持文本、异步任务、多维价格和 tiered billing。

参考文件：

- `D:\Project\new-api-main\service\billing_session.go`
- `D:\Project\new-api-main\service\billing.go`
- `D:\Project\new-api-main\service\tiered_settle.go`
- `D:\Project\new-api-main\model\pricing.go`

DevForge 不需要做充值系统，但很需要成本治理：

```ts
interface AiCostRecord {
  id: string
  requestId: string
  sessionId?: string
  source: AiGatewayContext['source']
  providerProfileId: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  estimatedCost: number
  currency: 'USD' | 'CNY'
  createdAt: number
}
```

收益：

- 用户知道哪个功能最耗钱。
- `/compact` 可以选择便宜模型。
- 大任务执行前可以预估成本。
- 团队版可做每日/月度预算。
- 诊断时可以发现“模型突然变贵/用量异常”。

### 2.7 Token Estimator：上下文预算不能只靠粗略字符数

`new-api-main` 有 token counter / estimator，用于请求前估算、计费、限额判断。

参考文件：

- `D:\Project\new-api-main\service\token_counter.go`
- `D:\Project\new-api-main\service\token_estimator.go`
- `D:\Project\new-api-main\service\tokenizer.go`

DevForge 当前已经有上下文预算和 compact，但如果 token 估算不准，会导致：

- 该压缩时没压缩，触发 prompt too long。
- 不该压缩时频繁压缩，影响体验。
- 工具结果预算不准，大输出撑爆上下文。

建议新增 `AiTokenEstimator`：

```ts
interface AiTokenEstimator {
  estimateMessage(message: ChatMessage, model: string): number
  estimateMessages(messages: ChatMessage[], model: string): AiTokenEstimate
  estimateToolResult(content: string, model: string): number
}
```

实现策略：

- P0：使用近似算法，按模型族设置 chars/token。
- P1：Rust 端接入 tokenizer 或 wasm tokenizer。
- P2：记录真实 usage，反向校准估算系数。

### 2.8 Model Rate Limit：按模型和来源限流

`new-api-main` 不只是用户限流，还支持模型级限流，避免某个模型或渠道被打爆。

参考文件：

- `D:\Project\new-api-main\middleware\model-rate-limit.go`
- `D:\Project\new-api-main\common\rate-limit.go`

DevForge 可做本地限流：

```ts
interface AiRateLimitRule {
  id: string
  scope: 'provider' | 'model' | 'source' | 'workspace'
  key: string
  maxRequests: number
  windowMs: number
  maxConcurrent?: number
}
```

优先规则：

- `/compact` 同一 session 同时只能有 1 个。
- 同一 provider 同时最多 N 个流式请求。
- ERP AI 查询最多 N 并发。
- 大模型每日成本超过阈值时提醒。
- 失败率过高时临时熔断 provider。

### 2.9 Sensitive / Safety：本地安全策略

`new-api-main` 有敏感词检测、替换等能力，虽然简单，但作为本地安全策略入口很实用。

参考文件：

- `D:\Project\new-api-main\service\sensitive.go`

DevForge 可以把安全策略分为：

- Prompt 输入检查。
- 工具参数检查。
- URL / 文件路径检查。
- 数据库变更检查。
- 输出内容标记。

建议新增：

```ts
interface AiSafetyPolicy {
  id: string
  enabled: boolean
  scope: 'prompt' | 'tool' | 'url' | 'db' | 'file'
  action: 'warn' | 'block' | 'require_confirm' | 'redact'
  patterns: string[]
}
```

这和第一份文档的权限系统可以互补：权限管“能不能做”，Safety 管“内容和参数是否危险”。

### 2.10 SSRF Protection：web_fetch、MCP、远程资源必须防内网探测

`new-api-main` 对 SSRF 做了 URL、IP、私网地址、端口范围等保护。

参考文件：

- `D:\Project\new-api-main\common\ssrf_protection.go`

DevForge 后续如果支持：

- `web_fetch`
- 图片 URL 输入
- 远程 MCP Server
- 插件下载
- 资源管理器远程文件
- ERP 外部接口调用

就必须有 SSRF 防护，避免 AI 或插件访问：

- `127.0.0.1`
- `localhost`
- `169.254.169.254`
- 私有网段 IP
- 非允许端口
- file scheme / gopher scheme 等危险协议

建议 P0 规则：

- 默认只允许 `http` / `https`。
- 默认禁止 localhost 和私网 IP。
- 默认禁止重定向到私网 IP。
- 默认只允许 80 / 443 / 用户显式允许端口。
- 工具结果里记录最终访问 URL 和重定向链。

### 2.11 Channel Test：Provider 配置保存前必须可测试

`new-api-main` 有渠道测试逻辑，用于验证模型、流式、响应、usage 和错误。

参考文件：

- `D:\Project\new-api-main\controller\channel-test.go`

DevForge 当前 Provider 配置如果只保存 endpoint/key，很容易出现“保存成功但一用就失败”。建议新增 Provider Test：

- 测试 API key 是否有效。
- 测试 model 是否存在。
- 测试 stream 是否正常返回 Done。
- 测试 tools 是否支持。
- 测试 usage 是否返回。
- 测试首 token 延迟。
- 测试是否支持 reasoning/thinking。

测试结果存入 Provider Profile：

```ts
interface AiProviderHealth {
  status: 'unknown' | 'healthy' | 'degraded' | 'failed'
  checkedAt: number
  latencyMs?: number
  supportsStream?: boolean
  supportsTools?: boolean
  supportsUsage?: boolean
  lastError?: string
}
```

### 2.12 OpenAI Responses / Compaction 兼容层

`new-api-main` 已经关注 OpenAI Responses 和 compaction 请求结构。

参考文件：

- `D:\Project\new-api-main\dto\openai_compaction.go`
- `D:\Project\new-api-main\dto\openai_responses_compaction_request.go`
- `D:\Project\new-api-main\relay\channel\openai\relay_responses_compact.go`

DevForge 可以借鉴两点：

1. 不要把“聊天接口”当成唯一未来接口。
2. compact 应作为 Gateway 的一种 source / request type，而不是 UI composable 内部私活。

建议定义：

```ts
type AiGatewayRequestKind =
  | 'chat_completions'
  | 'responses'
  | 'compact'
  | 'embedding'
  | 'rerank'
  | 'image'
  | 'audio'
```

这样未来 DevForge 接入 Responses API、embedding、rerank、图片理解、语音输入时，不需要重写 Provider 管理。

## 3. DevForge 推荐架构

### 3.1 新增模块结构

建议新增：

```text
src/ai-gateway/
  types.ts                    # Gateway 请求、结果、错误、usage、cost
  AiGateway.ts                # 统一入口：route -> execute -> retry -> settle
  AiProviderRegistry.ts        # Provider Adapter 注册和能力查询
  AiModelRouter.ts             # 路由、优先级、权重、fallback
  AiProviderHealth.ts          # 健康检查和熔断
  AiTokenEstimator.ts          # token 估算
  AiCostTracker.ts             # 成本记录
  AiRateLimiter.ts             # 本地限流
  AiSafetyPolicy.ts            # 本地安全策略
  overrides/
    applyProviderOverrides.ts  # 参数/Header override
  adapters/
    openaiCompat.ts
    anthropic.ts
    gemini.ts
    ollama.ts
```

Rust 端建议对应：

```text
src-tauri/src/services/ai_gateway/
  mod.rs
  request.rs
  response.rs
  router.rs
  provider.rs
  health.rs
  rate_limit.rs
  ssrf.rs
```

### 3.2 Gateway 调用链路

```text
AI 功能入口
  -> 构建 AiGatewayRequest
  -> AiModelRouter 选择候选 Provider
  -> AiRateLimiter 检查并发/频率
  -> AiSafetyPolicy 检查输入和参数
  -> Provider Override 应用兼容规则
  -> Adapter 构建上游请求
  -> Rust 执行 HTTP / Stream
  -> Adapter 归一化事件和 usage
  -> CostTracker 记录成本
  -> Health 更新成功率/延迟
  -> 失败时按策略 retry / fallback
```

### 3.3 与现有 AI Runtime 的关系

- Agent Runtime 负责“任务怎么执行”。
- Provider Gateway 负责“模型请求怎么选择、怎么发、怎么治理”。
- Tool Runtime 负责“工具怎么执行”。
- Safety / Permission 负责“什么操作可不可以做”。

不要把 Provider Gateway 写进 `useAiChat.ts`，否则后续会继续变大、难测、难复用。

## 4. 分阶段实施计划

### P0：先把 Provider 调用收敛成 Gateway

目标：不改变用户体验，但统一所有 AI 请求入口。

任务：

1. 定义 `AiGatewayRequest / AiGatewayResult / AiGatewayError / AiGatewayContext`。
2. 普通 chat、manual compact、auto compact、prompt optimize 统一走 Gateway。
3. 每次请求生成 `requestId`，记录 provider、model、source、耗时、错误。
4. Provider Profile 增加 health 字段。
5. 增加 Provider 测试按钮。

验收标准：

- 任意 AI 请求都能在诊断里看到 requestId。
- Provider 配置保存后可以一键测试。
- `/compact` 不再直接绕过主 Provider 调用链路。

### P1：模型路由、fallback 和限流

目标：模型失败时自动切换备用模型，避免单点不可用。

任务：

1. 新增 Model Route 配置。
2. 支持 source 级路由：chat / compact / tool / erp / schema。
3. 支持 priority + weight 选择。
4. 支持错误分类：可重试、不可重试、限流、鉴权失败、上下文过长。
5. 支持本地并发限流和 provider 熔断。

验收标准：

- 主模型超时后能切到备用模型。
- 鉴权失败不盲目重试。
- 同一 session 不会并发触发多个 compact。

### P1：成本和 token 预算

目标：让用户知道 AI 成本，并让 compact/tool budget 更准确。

任务：

1. 新增模型价格配置。
2. 记录每次请求 input/output/cache tokens。
3. 显示 session / day / provider 成本统计。
4. Token estimator 接入上下文预算和工具结果预算。
5. 成本异常时提示用户。

验收标准：

- AI 面板能看到本会话用量。
- compact 触发阈值更稳定。
- 大工具结果不会因为估算偏差撑爆上下文。

### P2：Override、安全策略和 SSRF 防护

目标：提升兼容性和安全性。

任务：

1. Provider Profile 支持常用 override。
2. `web_fetch` / URL 类工具接入 SSRF 防护。
3. 安全策略支持 warn / block / require_confirm。
4. 请求诊断包隐藏 key、token、敏感 Header。
5. 高风险错误支持 skip retry。

验收标准：

- OpenAI-compatible 差异可通过配置解决。
- 访问 localhost / 私网 IP 默认被拦截。
- 安全拦截有明确 UI 提示。

## 5. 可直接拆给同事的任务清单

### 任务 A：Gateway 类型和请求追踪 MVP

- 新增 `src/ai-gateway/types.ts`。
- 定义 request/result/error/context/usage/cost。
- 所有 AI 请求生成 `requestId`。
- 日志和诊断包记录 requestId。

### 任务 B：Provider Health Test

- Provider 设置页增加“测试连接”。
- 测试普通非流式或短流式请求。
- 检查首 token、Done、usage、tools 支持。
- 保存 health 状态和最后错误。

### 任务 C：Model Route MVP

- 新增默认路由：chat、compact、prompt_optimize。
- 支持 priority + fallback。
- provider 不健康时跳过。
- 错误分类决定是否重试。

### 任务 D：Token / Cost Tracker

- 记录每次请求 usage。
- 支持模型价格配置。
- 会话级成本展示。
- compact 和工具预算使用统一 estimator。

### 任务 E：SSRF 防护

- URL 工具统一走安全校验。
- 禁止 localhost、私网 IP、metadata IP。
- 检查重定向链。
- 记录被拦截原因。

## 6. 不建议照搬的部分

- 不建议照搬 `new-api-main` 的充值、订阅、用户组、多租户后台，这些不是 DevForge 当前核心。
- 不建议把完整渠道系统一次性搬进桌面端，初期做 Provider Profile + Route + Fallback 即可。
- 不建议让前端直接保存复杂 override DSL，先做常用兼容项。
- 不建议 Provider Gateway 和 Agent Runtime 混在一个 composable 里。
- 不建议为了多 Provider 牺牲本地用户体验，所有慢操作都要可取消、可诊断。

## 7. 结论

`new-api-main` 对 DevForge 最大启发是：AI 能力强不只取决于 Agent，也取决于 Provider 调用是否稳定、可观测、可切换、可限流、可计费、可风控。

DevForge 如果只继续堆 Agent 功能，遇到模型慢、模型挂、endpoint 不兼容、成本失控、安全风险时，用户仍然会觉得“不好用”。

建议把 Provider Gateway 作为 AI 架构的独立地基来做：

1. 先统一所有 AI 请求入口。
2. 再做 Provider health、fallback 和 request trace。
3. 然后补 token/cost/limit/safety。

这样 DevForge 后续无论接入 Claude、OpenAI、Gemini、Ollama、DeepSeek、Kimi、Qwen，还是私有 OpenAI-compatible 服务，都能保持稳定可控。
