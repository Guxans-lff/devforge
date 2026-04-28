/**
 * AI Gateway Override — 运行时配置覆盖
 *
 * 支持通过环境变量或运行时 API 覆盖 Gateway 请求参数。
 * 用于调试、测试、A/B 测试、紧急路由切换。
 */

import type { ProviderConfig, ModelConfig } from '@/types/ai'

// ─────────────────────────── 类型定义 ───────────────────────────

export interface GatewayOverrides {
  /** 覆盖 endpoint */
  endpoint?: string
  /** 覆盖模型 ID */
  model?: string
  /** 覆盖 API Key */
  apiKey?: string
  /** 覆盖 maxTokens */
  maxTokens?: number
  /** 覆盖 temperature */
  temperature?: number
  /** 覆盖 systemPrompt */
  systemPrompt?: string
}

/** 可覆盖的字段列表 */
export const OVERRIDE_KEYS: (keyof GatewayOverrides)[] = [
  'endpoint',
  'model',
  'apiKey',
  'maxTokens',
  'temperature',
  'systemPrompt',
]

// ─────────────────────────── 运行时覆盖存储 ───────────────────────────

const runtimeOverrides: Partial<GatewayOverrides> = {}

/**
 * 设置单个覆盖值
 */
export function setGatewayOverride<K extends keyof GatewayOverrides>(
  key: K,
  value: GatewayOverrides[K],
): void {
  if (value === undefined) {
    delete runtimeOverrides[key]
  } else {
    runtimeOverrides[key] = value
  }
}

/**
 * 批量设置覆盖值
 */
export function setGatewayOverrides(overrides: Partial<GatewayOverrides>): void {
  Object.assign(runtimeOverrides, overrides)
}

/**
 * 清除单个覆盖值
 */
export function clearGatewayOverride(key: keyof GatewayOverrides): void {
  delete runtimeOverrides[key]
}

/**
 * 清除所有运行时覆盖
 */
export function clearGatewayOverrides(): void {
  for (const key of OVERRIDE_KEYS) {
    delete runtimeOverrides[key]
  }
}

// ─────────────────────────── 环境变量读取 ───────────────────────────

function readEnvOverrides(): Partial<GatewayOverrides> {
  const env: Partial<GatewayOverrides> = {}

  // Vite 环境变量（构建时注入）
  const envEndpoint = import.meta.env.VITE_AI_GATEWAY_ENDPOINT_OVERRIDE
  if (envEndpoint) env.endpoint = String(envEndpoint)

  const envModel = import.meta.env.VITE_AI_GATEWAY_MODEL_OVERRIDE
  if (envModel) env.model = String(envModel)

  const envApiKey = import.meta.env.VITE_AI_GATEWAY_API_KEY_OVERRIDE
  if (envApiKey) env.apiKey = String(envApiKey)

  const envMaxTokens = import.meta.env.VITE_AI_GATEWAY_MAX_TOKENS_OVERRIDE
  if (envMaxTokens) env.maxTokens = Number(envMaxTokens)

  const envTemperature = import.meta.env.VITE_AI_GATEWAY_TEMPERATURE_OVERRIDE
  if (envTemperature) env.temperature = Number(envTemperature)

  const envSystemPrompt = import.meta.env.VITE_AI_GATEWAY_SYSTEM_PROMPT_OVERRIDE
  if (envSystemPrompt) env.systemPrompt = String(envSystemPrompt)

  return env
}

// ─────────────────────────── 合并获取 ───────────────────────────

/**
 * 获取当前生效的所有覆盖（环境变量 + 运行时）
 *
 * 优先级：运行时覆盖 > 环境变量
 */
export function getGatewayOverrides(): Partial<GatewayOverrides> {
  return {
    ...readEnvOverrides(),
    ...runtimeOverrides,
  }
}

/**
 * 检查是否有任何覆盖生效
 */
export function hasActiveOverrides(): boolean {
  return Object.keys(getGatewayOverrides()).length > 0
}

// ─────────────────────────── 应用到请求 ───────────────────────────

export interface OverridableRequest {
  provider: ProviderConfig
  model: ModelConfig
  apiKey: string
  maxTokens?: number
  temperature?: number
  systemPrompt?: string
}

export interface OverrideResult {
  /** 原始请求 */
  original: OverridableRequest
  /** 覆盖后的请求 */
  overridden: OverridableRequest
  /** 哪些字段被覆盖了 */
  applied: string[]
}

/**
 * 将覆盖应用到请求，返回覆盖结果
 *
 * 注意：返回的是新对象，不修改原始请求
 */
export function applyGatewayOverrides(request: OverridableRequest): OverrideResult {
  const overrides = getGatewayOverrides()
  const applied: string[] = []

  const overridden: OverridableRequest = {
    provider: { ...request.provider },
    model: { ...request.model },
    apiKey: request.apiKey,
    maxTokens: request.maxTokens,
    temperature: request.temperature,
    systemPrompt: request.systemPrompt,
  }

  if (overrides.endpoint !== undefined) {
    overridden.provider = { ...overridden.provider, endpoint: overrides.endpoint }
    applied.push('endpoint')
  }

  if (overrides.model !== undefined) {
    // 覆盖 model ID，但保持其他 capabilities 不变
    overridden.model = { ...overridden.model, id: overrides.model }
    applied.push('model')
  }

  if (overrides.apiKey !== undefined) {
    overridden.apiKey = overrides.apiKey
    applied.push('apiKey')
  }

  if (overrides.maxTokens !== undefined) {
    overridden.maxTokens = overrides.maxTokens
    applied.push('maxTokens')
  }

  if (overrides.temperature !== undefined) {
    overridden.temperature = overrides.temperature
    applied.push('temperature')
  }

  if (overrides.systemPrompt !== undefined) {
    overridden.systemPrompt = overrides.systemPrompt
    applied.push('systemPrompt')
  }

  return { original: request, overridden, applied }
}
