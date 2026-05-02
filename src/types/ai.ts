// AI 模块类型定义

// ─────────────────────────────────── 多模态内容块 ───────────────────────────────────

/** 多模态内容块类型 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

/** 图片源数据 */
export interface ImageSource {
  type: 'base64'
  media_type: string  // "image/png", "image/jpeg", etc.
  data: string        // base64 编码数据
}

/** ChatMessage 接口（与后端通信） */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | null  // 保留现有字段用于向后兼容
  contentBlocks?: ContentBlock[]  // 新增：结构化内容块
  name?: string
  toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  toolCallId?: string
  reasoningContent?: string
}

// ─────────────────────────────────── Provider 配置 ───────────────────────────────────

/** Provider 类型 */
export type ProviderType = 'openai_compat' | 'anthropic'

/** 模型定价信息 */
export interface ModelPricing {
  /** 每百万输入 token 价格 */
  inputPer1m: number
  /** 每百万输出 token 价格 */
  outputPer1m: number
  /** 币种（如 "USD"、"CNY"） */
  currency: string
}

/** 模型能力描述 */
export interface ModelCapabilities {
  /** 是否支持流式输出 */
  streaming: boolean
  /** 是否支持图片输入（Vision） */
  vision: boolean
  /** 是否支持思考过程（Thinking/Reasoning） */
  thinking: boolean
  /** 是否支持工具调用 */
  toolUse: boolean
  /** 最大上下文 token 数 */
  maxContext: number
  /** 最大输出 token 数 */
  maxOutput: number
  /** 定价信息 */
  pricing?: ModelPricing
}

export type ThinkingEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type AiPermissionBehavior = 'allow' | 'ask' | 'deny'

export interface AiPermissionRuleConfig {
  behavior: AiPermissionBehavior
  toolName: string
  pattern?: string
  reason?: string
}

export type AiWorkspaceIsolationStrength = 'off' | 'session' | 'agent' | 'strict'

export interface AiWorkspaceIsolationConfig {
  strength?: AiWorkspaceIsolationStrength
  allowedPaths?: string[]
  blockedPaths?: string[]
}

export type AiGatewayRoutingStrategy = 'default' | 'cost' | 'speed' | 'capability'

export interface AiGatewayPolicyConfig {
  fallbackEnabled?: boolean
  fallbackProviderIds?: string[]
  routingStrategy?: AiGatewayRoutingStrategy
  rateLimit?: {
    windowMs: number
    maxRequests: number
  }
}

/** 单个模型配置 */
export interface ModelConfig {
  /** 模型 ID（API 调用使用） */
  id: string
  /** 模型显示名称 */
  name: string
  /** 模型能力 */
  capabilities: ModelCapabilities
  thinkingEffort?: ThinkingEffort
}

/** Provider 配置 */
export interface ProviderConfig {
  id: string
  name: string
  providerType: ProviderType
  endpoint: string
  models: ModelConfig[]
  isDefault: boolean
  createdAt: number
  health?: AiProviderHealth
  security?: {
    allowlist?: string[]
    allowLocalhost?: boolean
    allowPrivateIP?: boolean
  }
}

export interface AiProviderProfileBundle {
  id: string
  name: string
  description?: string
  providerId: string
  modelId: string
  outputStyleId?: string
  workspaceConfig?: WorkspaceConfig
  security?: ProviderConfig['security']
  gatewayPolicy?: AiGatewayPolicyConfig
  tags?: string[]
  createdAt: number
  updatedAt: number
}

export interface AiProviderProfileBackup {
  id: string
  profileId: string
  snapshot: AiProviderProfileBundle
  reason: 'manual' | 'before-update' | 'before-apply' | 'rollback'
  createdAt: number
}

export interface AiProviderProfilePreview {
  profileId: string
  profileName: string
  providerName: string
  modelName: string
  outputStyleName?: string
  workspaceChanges: Array<{
    key: keyof WorkspaceConfig
    label: string
    before: string
    after: string
    changed: boolean
  }>
  securityChanges: Array<{
    key: 'allowlist' | 'allowLocalhost' | 'allowPrivateIP'
    label: string
    before: string
    after: string
    changed: boolean
  }>
  gatewayPolicyChanges: Array<{
    key: 'fallbackEnabled' | 'fallbackProviderIds' | 'routingStrategy' | 'rateLimit'
    label: string
    before: string
    after: string
    changed: boolean
  }>
  warnings: Array<{
    key: string
    level: 'info' | 'warning' | 'danger'
    message: string
  }>
}

export interface AiProviderHealth {
  status: 'unknown' | 'healthy' | 'degraded' | 'unhealthy'
  checkedAt: number | null
  latencyMs: number | null
  supportsStream: boolean | null
  supportsTools: boolean | null
  supportsUsage: boolean | null
  lastError: string | null
}

// ─────────────────────────────────── 流式事件 ───────────────────────────────────

/** AI 流式事件（tagged union，与 Rust 端 AiStreamEvent 对应） */
export type AiStreamEvent =
  | { type: 'TextDelta'; delta: string }
  | { type: 'ThinkingDelta'; delta: string }
  | { type: 'ToolCall'; id: string; name: string; arguments: string }
  | { type: 'ToolCallDelta'; index: number; id?: string; name?: string; arguments_delta: string }
  | { type: 'Usage'; prompt_tokens: number; completion_tokens: number; cache_read_tokens?: number }
  | { type: 'Done'; finish_reason: string }
  | { type: 'Error'; message: string; retryable: boolean }

// ─────────────────────────────────── 对话结果 ───────────────────────────────────

/** 单次对话调用结果 */
export interface ChatResult {
  content: string
  model: string
  promptTokens: number
  completionTokens: number
  finishReason: string
}

export type AiSessionStatus = 'idle' | 'streaming' | 'waiting_tool' | 'background_job' | 'error'

// ─────────────────────────────────── 会话 ───────────────────────────────────

/** AI 会话 */
export interface AiSession {
  id: string
  title: string
  providerId: string
  model: string
  systemPrompt?: string
  messageCount: number
  totalTokens: number
  estimatedCost: number
  tags?: string[]
  createdAt: number
  updatedAt: number
  workDir?: string
  goal?: string
  status?: AiSessionStatus
  lastCompactSummary?: string
}

/** AI 消息（持久化记录） */
export interface AiMessageRecord {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  contentType: string
  tokens: number
  cost: number
  parentId?: string
  success?: boolean
  toolName?: string
  createdAt: number
  type?: 'divider' | 'compact-boundary' | 'rewind-boundary'
  compactMetadata?: AiMessage['compactMetadata']
  rewindMetadata?: AiMessage['rewindMetadata']
}

export interface AiSessionDetail {
  session: AiSession
  messages: AiMessageRecord[]
  totalRecords: number
  loadedRecords: number
  truncated: boolean
}

/** AI 对话消息（运行时 UI 使用） */
export interface AiMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'error'
  content: string
  thinking?: string
  timestamp: number
  tokens?: number
  promptTokens?: number
  completionTokens?: number
  cacheReadTokens?: number
  totalTokens?: number
  isStreaming?: boolean
  /** 工具调用列表（assistant 消息携带） */
  toolCalls?: ToolCallInfo[]
  /** 工具执行结果（内嵌到 assistant 消息中展示） */
  toolResults?: ToolResultInfo[]
  /** 消息持久化状态（仅 assistant/user 消息关心） */
  saveStatus?: 'saving' | 'saved' | 'error'
  /** 分割线类型（换模型/手动标记），此类消息不参与 AI 上下文 */
  type?: 'divider' | 'compact-boundary' | 'rewind-boundary'
  /** 分割线显示文本 */
  dividerText?: string
  /** 分割线元数据（历史恢复窗口等） */
  dividerMeta?: {
    kind: 'history-window'
    loadedRecords: number
    totalRecords: number
    remainingRecords: number
  }
  compactMetadata?: {
    trigger: 'manual' | 'auto' | 'recovery'
    preTokens: number
    summarizedMessages: number
    createdAt: number
    summaryMessageId: string
    source: 'ai' | 'local'
  }
  rewindMetadata?: {
    targetMessageId: string
    targetMessageRole: 'user' | 'assistant' | 'system' | 'error'
    hiddenMessages: number
    createdAt: number
  }
  /** 系统提示横幅（如工具调用超限、流被中断等），独立于 content 渲染 */
  notice?: {
    kind: 'warn' | 'error' | 'info'
    code?: 'tool_loop_limit' | 'stream_interrupted' | 'runtime_warning' | 'runtime_error'
    title?: string
    text: string
    actionHint?: string
  }
  /** 历史恢复时的工具操作摘要。只用于 UI 展示，不进入模型上下文 */
  historyToolSummary?: ToolActivitySummary
}

// ─────────────────────────────────── Tool Use ───────────────────────────────────

export type ToolActivityCategory =
  | 'read'
  | 'search'
  | 'write'
  | 'command'
  | 'web'
  | 'database'
  | 'todo'
  | 'agent'
  | 'other'

export interface ToolActivityBucket {
  category: ToolActivityCategory
  label: string
  count: number
  successCount: number
  errorCount: number
  pendingCount: number
  toolNames: string[]
}

export interface ToolActivitySummary {
  callCount: number
  resultCount: number
  successCount: number
  errorCount: number
  pendingCount: number
  toolNames: string[]
  buckets: ToolActivityBucket[]
  hasWrite: boolean
  hasCommand: boolean
  hasFailure: boolean
}

/** 工具调用信息（前端运行时） */
export interface ToolCallInfo {
  id: string
  name: string
  arguments: string
  /** 解析后的参数对象 */
  parsedArgs?: Record<string, unknown>
  /** 执行状态 */
  status: 'pending' | 'running' | 'success' | 'error' | 'streaming'
  /** 流式累积进度（status='streaming' 时实时增长，单位字符） */
  streamingChars?: number
  /** 流式累积索引（OpenAI streaming tool_call index，仅流式阶段使用） */
  streamingIndex?: number
  /** 执行结果 */
  result?: string
  /** 错误信息 */
  error?: string
  /**
   * 审批状态（仅 write_file / edit_file / bash / web_fetch 可能出现）
   * - awaiting: 等待用户点击按钮（UI 内嵌审批条）
   * - allowed:  用户已点"允许一次"或"信任"
   * - denied:   用户已拒绝
   * - undefined: 无需审批 / 尚未进入审批流
   */
  approvalState?: 'awaiting' | 'allowed' | 'denied'
  /** Scheduler/runtime metadata for diagnostics and performance tuning. */
  execution?: ToolExecutionMetadata
}

/** AI 文件操作信息 */
export interface FileOperation {
  /** 操作类型 */
  op: 'create' | 'modify' | 'delete'
  /** 文件路径 */
  path: string
  /** 文件名 */
  fileName: string
  /** 旧内容（modify 时存在） */
  oldContent?: string
  /** 新内容（create/modify 时存在） */
  newContent?: string
  /** 操作状态 */
  status: 'pending' | 'applied' | 'rejected' | 'error'
  /** 错误信息 */
  errorMessage?: string
  /** 关联的 toolCall ID */
  toolCallId: string
}

/** 工具执行结果（用于展示） */
export interface ToolResultInfo {
  toolCallId: string
  toolName: string
  success: boolean
  content: string
  metadata?: ToolResultMetadata
}

export type ToolExecutionClass = 'write' | 'bash' | 'web' | 'read' | 'other'

export interface ToolExecutionMetadata {
  class: ToolExecutionClass
  queue: 'read-other' | 'web' | 'write' | 'bash'
  lockKey?: string
  queuedAt: number
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  waitMs?: number
  attempt: number
  maxAttempts: number
  retryCount: number
  timeoutMs: number
  hardTimeout: boolean
  timedOut?: boolean
  cancelled?: boolean
  errorKind?: 'timeout' | 'cancelled' | 'tool_error' | 'exception' | 'circuit_open' | 'user_rejected' | 'permission_denied'
}

export interface ToolResultMetadata {
  class: ToolExecutionClass
  queue: ToolExecutionMetadata['queue']
  lockKey?: string
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  waitMs?: number
  attempts: number
  retryCount: number
  timeoutMs: number
  timedOut?: boolean
  cancelled?: boolean
  errorKind?: ToolExecutionMetadata['errorKind']
}

/** 工具定义（后端返回） */
export interface ToolDefinition {
  type: string
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface McpServerRuntimeStatus {
  name: string
  transport: 'stdio' | 'sse' | 'http' | 'unknown' | string
  command?: string
  url?: string
  disabled: boolean
  status: 'configured' | 'disabled' | 'unknown' | 'connected' | 'error' | string
  message?: string
}

export interface McpStatusResult {
  configPath?: string | null
  configExists: boolean
  parseError?: string | null
  servers: McpServerRuntimeStatus[]
}

/** 工具执行结果（后端返回） */
export interface ToolExecResult {
  success: boolean
  content: string
}

// ─────────────────────────────────── 用量统计 ───────────────────────────────────

/** 每日用量统计 */
export interface DailyUsage {
  date: string
  providerId: string
  model: string
  requestCount: number
  promptTokens: number
  completionTokens: number
  estimatedCost: number
}

// ─────────────────────────────────── 文件附件 ───────────────────────────────────

/** 文件附件（用户选文件 → 读取 → 附带发送） */
export interface FileAttachment {
  /** 唯一 ID */
  id: string
  /** 文件名 */
  name: string
  /** 本地绝对路径 */
  path: string
  /** 文件大小（字节） */
  size: number
  /** 文件内容（文本或 base64） */
  content?: string
  /** 行数（文本文件有效，图片为 1） */
  lines?: number
  /** 文件类型 */
  type?: 'text' | 'image'
  /** 读取状态 */
  status: 'pending' | 'reading' | 'ready' | 'error'
  /** 错误信息 */
  error?: string
}

// ─────────────────────────────────── Workspace 配置 ───────────────────────────────────

/**
 * 工作区级 AI 配置（存储在 .devforge/config.json）
 *
 * 优先级高于全局 Provider 设置。
 */
export interface WorkspaceConfig {
  /** 首选模型 ID（覆盖全局设置） */
  preferredModel?: string
  /** 系统提示覆盖（追加到全局系统提示后） */
  systemPromptExtra?: string
  /** 输出风格 ID（来自内置或自定义 Output Style） */
  outputStyleId?: string
  /** 上下文注入文件路径列表（相对于工作区根目录或绝对路径） */
  contextFiles?: Array<{ path: string; reason?: string }>
  /** 是否启用 Plan Gate（默认 false） */
  planGateEnabled?: boolean
  /** Dispatcher 模式系统提示覆盖 */
  dispatcherPrompt?: string
  /** Dispatcher 最大并发数，默认 3 */
  dispatcherMaxParallel?: number
  /** Dispatcher 自动重试次数，默认 1 */
  dispatcherAutoRetryCount?: number
  /** Dispatcher 默认执行形态，默认 headless */
  dispatcherDefaultMode?: 'headless' | 'tab'
  /** Project 级工具权限规则 */
  permissionRules?: AiPermissionRuleConfig[]
  /** Project 级 Workspace 强隔离边界 */
  workspaceIsolation?: AiWorkspaceIsolationConfig
  /** Project/Profile 级 Gateway 策略 */
  gatewayPolicy?: AiGatewayPolicyConfig
  features?: Record<string, boolean>
  skills?: WorkspaceSkillConfig[]
}

export interface WorkspaceSkillConfig {
  id: string
  name: string
  description?: string
  path?: string
  permissions?: WorkspaceSkillPermission[]
  enabled?: boolean
}

export type WorkspaceSkillPermission = 'read' | 'write' | 'execute' | 'network' | 'mcp'


/** 旧版 AI 配置（保留兼容） */
export interface AiConfig {
  provider: string
  model: string
  endpoint: string
  maxTokens: number
}

/** 旧版 AI 结果 */
export interface AiResult {
  content: string
  model: string
  promptTokens: number
  completionTokens: number
}

// ─────────────────────────────────── 记忆系统 ───────────────────────────────────

/** 记忆类型 */
export type MemoryType =
  | 'summary'
  | 'knowledge'
  | 'preference'
  | 'project_rule'
  | 'architecture_decision'
  | 'bug_lesson'
  | 'user_preference'
  | 'domain_knowledge'

export type MemorySourceType = 'manual' | 'chat' | 'tool' | 'file' | 'workflow' | 'compact'
export type MemoryReviewStatus = 'pending' | 'approved' | 'rejected' | 'archived'

/** 记忆条目 */
export interface AiMemory {
  id: string
  workspaceId: string
  type: MemoryType
  title: string
  content: string
  tags: string
  sourceSessionId?: string
  sourceType?: MemorySourceType
  sourceRef?: string
  confidence?: number
  reviewStatus?: MemoryReviewStatus
  weight: number
  lastUsedAt?: number
  usageCount?: number
  createdAt: number
  updatedAt: number
}

/** 压缩记录 */
export interface AiCompaction {
  id: string
  sessionId: string
  summary: string
  originalCount: number
  originalTokens: number
  createdAt: number
}

/** 压缩规则配置 */
export interface CompactRule {
  /** P0-必须保留的内容描述 */
  p0: string
  /** P1-尽量保留的内容描述 */
  p1: string
  /** P2-立即丢弃的内容描述 */
  p2: string
  /** 压缩比目标（如 0.2 表示压缩到 20%） */
  ratio: number
}

export type AiWorkflowStepType = 'inspect' | 'edit' | 'test' | 'summarize' | 'send'

export interface AiWorkflowStep {
  type: AiWorkflowStepType
  prompt?: string
  command?: string
}

export interface AiWorkflowScript {
  id: string
  name: string
  description: string
  steps: AiWorkflowStep[]
}

export type AiProactiveTaskStatus = 'idle' | 'waiting' | 'running' | 'paused' | 'done' | 'failed'

export interface AiProactiveTask {
  id: string
  sessionId: string
  objective: string
  tickIntervalMs: number
  maxTicks: number
  tickCount: number
  nextTickAt: number
  allowedTools: string[]
  stopConditions: string[]
  status: AiProactiveTaskStatus
  createdAt: number
  updatedAt: number
  lastTickSummary?: string
  error?: string
}
