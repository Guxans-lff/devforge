/**
 * AI Gateway Router — 模型路由 + 熔断器 + Fallback Chain
 *
 * 纯函数设计：不依赖外部状态，所有 provider 数据由调用方注入。
 * 熔断器状态保存在模块级内存 Map 中（session 生命周期）。
 */

import type { ProviderConfig, ModelConfig } from '@/types/ai'

// ─────────────────────────── 类型定义 ───────────────────────────

export type RoutingStrategy = 'default' | 'cost' | 'speed' | 'capability'

export interface ModelRequirements {
  /** 是否需要工具调用 */
  toolUse?: boolean
  /** 是否需要视觉 */
  vision?: boolean
  /** 是否需要思考过程 */
  thinking?: boolean
  /** 最小上下文需求 */
  minContext?: number
}

export interface FallbackCandidate {
  provider: ProviderConfig
  model: ModelConfig
  reason: string
}

export interface ResolvedRoute {
  provider: ProviderConfig
  model: ModelConfig
  fallbackChain: FallbackCandidate[]
  rerouted: boolean
  reason?: string
}

export interface RouteRequest {
  providers: ProviderConfig[]
  /** 用户首选 provider（如已选中） */
  preferredProvider?: ProviderConfig
  /** 用户首选 model（如已选中） */
  preferredModel?: ModelConfig
  /** 路由策略 */
  strategy?: RoutingStrategy
  /** 模型能力需求 */
  requirements?: ModelRequirements
}

// ─────────────────────────── 熔断器 ───────────────────────────

const PROVIDER_CIRCUIT_THRESHOLD = 2
const PROVIDER_CIRCUIT_COOLDOWN_MS = 120_000

interface CircuitState {
  transientFailureCount: number
  openedAt: number | null
}

const circuitStore = new Map<string, CircuitState>()

function getCircuitState(providerId: string): CircuitState {
  let state = circuitStore.get(providerId)
  if (!state) {
    state = { transientFailureCount: 0, openedAt: null }
    circuitStore.set(providerId, state)
  }
  return state
}

/** 检查 provider 熔断器是否开启 */
export function isCircuitOpen(providerId: string, now = Date.now()): boolean {
  const state = getCircuitState(providerId)
  if (!state.openedAt) return false
  if (now - state.openedAt >= PROVIDER_CIRCUIT_COOLDOWN_MS) {
    state.openedAt = null
    state.transientFailureCount = 0
    return false
  }
  return true
}

/** 记录 provider 成功（关闭熔断器） */
export function recordProviderSuccess(providerId: string): void {
  const state = getCircuitState(providerId)
  state.transientFailureCount = 0
  state.openedAt = null
}

/** 记录 provider 瞬时失败 */
export function recordProviderFailure(providerId: string, now = Date.now()): void {
  const state = getCircuitState(providerId)
  state.transientFailureCount += 1
  if (state.transientFailureCount >= PROVIDER_CIRCUIT_THRESHOLD) {
    state.openedAt = now
  }
}

/** 重置所有熔断器（测试用） */
export function resetCircuitBreakers(): void {
  circuitStore.clear()
}

/** 获取熔断器统计（诊断用） */
export function getCircuitBreakerStats(): Array<{ providerId: string; failureCount: number; openedAt: number | null; open: boolean }> {
  const now = Date.now()
  return Array.from(circuitStore.entries()).map(([providerId, state]) => ({
    providerId,
    failureCount: state.transientFailureCount,
    openedAt: state.openedAt,
    open: isCircuitOpen(providerId, now),
  }))
}

// ─────────────────────────── 能力匹配 ───────────────────────────

function modelMeetsRequirements(model: ModelConfig, req?: ModelRequirements): boolean {
  if (!req) return true
  if (req.toolUse && !model.capabilities.toolUse) return false
  if (req.vision && !model.capabilities.vision) return false
  if (req.thinking && !model.capabilities.thinking) return false
  if (req.minContext && model.capabilities.maxContext < req.minContext) return false
  return true
}

function supportsModelRequirements(candidate: ModelConfig, current: ModelConfig): boolean {
  if (current.capabilities.toolUse && !candidate.capabilities.toolUse) return false
  if (current.capabilities.vision && !candidate.capabilities.vision) return false
  if (candidate.capabilities.maxContext > 0 && current.capabilities.maxContext > 0) {
    if (candidate.capabilities.maxContext < Math.min(current.capabilities.maxContext, 128_000)) {
      return false
    }
  }
  return true
}

// ─────────────────────────── 评分函数 ───────────────────────────

/** 成本评分（越低越好） */
function scoreCost(model: ModelConfig): number {
  const p = model.capabilities.pricing
  if (!p) return Infinity
  // 综合输入+输出成本
  return p.inputPer1m + p.outputPer1m * 2
}

/** 速度评分（越低越好）：基于 maxOutput 推断速度，越大越快 */
function scoreSpeed(model: ModelConfig): number {
  // 简单的启发式：maxOutput 越大通常代表越新的模型，速度越快
  return -model.capabilities.maxOutput
}

/** 能力评分（越高越好） */
function scoreCapability(model: ModelConfig): number {
  let score = 0
  if (model.capabilities.toolUse) score += 100
  if (model.capabilities.vision) score += 80
  if (model.capabilities.thinking) score += 60
  score += model.capabilities.maxContext / 1000
  score += model.capabilities.maxOutput / 1000
  return score
}

/** Provider 健康评分（越高越好） */
function scoreProviderHealth(provider: ProviderConfig): number {
  if (isCircuitOpen(provider.id)) return -Infinity
  const health = provider.health
  if (!health) return 0
  let score = 0
  if (health.status === 'healthy') score += 50
  if (health.latencyMs && health.latencyMs < 1000) score += 30
  if (health.latencyMs && health.latencyMs < 3000) score += 10
  if (health.supportsStream) score += 10
  if (health.supportsTools) score += 10
  return score
}

// ─────────────────────────── 候选排序 ───────────────────────────

function sortModelsByStrategy(models: ModelConfig[], strategy: RoutingStrategy): ModelConfig[] {
  return models.slice().sort((a, b) => {
    switch (strategy) {
      case 'cost':
        return scoreCost(a) - scoreCost(b)
      case 'speed':
        return scoreSpeed(a) - scoreSpeed(b)
      case 'capability':
        return scoreCapability(b) - scoreCapability(a)
      default:
        // default: 优先 thinking > toolUse > maxContext
        return scoreCapability(b) - scoreCapability(a)
    }
  })
}

function sortProvidersByHealth(providers: ProviderConfig[]): ProviderConfig[] {
  return providers.slice().sort((a, b) => scoreProviderHealth(b) - scoreProviderHealth(a))
}

// ─────────────────────────── 路由解析 ───────────────────────────

/**
 * 解析路由：根据策略和需求选择最优 provider + model
 *
 * 如果提供了 preferredProvider/preferredModel，会优先尝试使用，
 * 但如果其熔断器开启或不符合需求，会自动路由到备用。
 */
export function resolveRoute(request: RouteRequest): ResolvedRoute {
  const { providers, preferredProvider, preferredModel, strategy = 'default', requirements } = request

  if (providers.length === 0) {
    throw new Error('No providers available')
  }

  const now = Date.now()

  // 1. 首选检查
  if (preferredProvider && preferredModel) {
    const meetsReq = modelMeetsRequirements(preferredModel, requirements)
    const circuitClosed = !isCircuitOpen(preferredProvider.id, now)
    if (meetsReq && circuitClosed) {
      const chain = buildFallbackChain(providers, preferredProvider, preferredModel, requirements, now)
      return { provider: preferredProvider, model: preferredModel, fallbackChain: chain, rerouted: false }
    }
  }

  // 2. 自动路由：过滤可用 provider → 按健康排序 → 选最优模型
  const availableProviders = sortProvidersByHealth(
    providers.filter(p => !isCircuitOpen(p.id, now)),
  )

  for (const provider of availableProviders) {
    const eligibleModels = provider.models.filter(m => modelMeetsRequirements(m, requirements))
    if (eligibleModels.length === 0) continue

    const sorted = sortModelsByStrategy(eligibleModels, strategy)
    const selected = sorted[0]
    if (!selected) continue
    const chain = buildFallbackChain(providers, provider, selected, requirements, now)
    return {
      provider,
      model: selected,
      fallbackChain: chain,
      rerouted: true,
      reason: preferredProvider ? `preferred_provider_unavailable(${preferredProvider.id})` : 'auto_routed',
    }
  }

  // 3. 所有 provider 都不可用，返回第一个（让调用方决定）
  const fallbackProvider = providers[0]
  if (!fallbackProvider) throw new Error('No providers available')
  const fallbackModel = fallbackProvider.models[0] ?? preferredModel
  if (!fallbackModel) {
    throw new Error(`Provider ${fallbackProvider.name} has no models`)
  }
  return {
    provider: fallbackProvider,
    model: fallbackModel,
    fallbackChain: [],
    rerouted: true,
    reason: 'all_providers_unavailable',
  }
}

// ─────────────────────────── Fallback Chain ───────────────────────────

/**
 * 构建 fallback chain：当前路由失败时的备用候选列表
 *
 * 策略：
 * 1. 同 provider 内降级模型（thinking → non-thinking）
 * 2. 跨 provider 切换（同类型优先）
 */
export function buildFallbackChain(
  providers: ProviderConfig[],
  primaryProvider: ProviderConfig,
  primaryModel: ModelConfig,
  requirements?: ModelRequirements,
  now = Date.now(),
): FallbackCandidate[] {
  const chain: FallbackCandidate[] = []
  const usedKeys = new Set<string>()

  function key(p: ProviderConfig, m: ModelConfig) {
    return `${p.id}::${m.id}`
  }

  usedKeys.add(key(primaryProvider, primaryModel))

  // 1. 同 provider 降级模型
  const sameProviderModels = primaryProvider.models
    .filter(m => m.id !== primaryModel.id && !usedKeys.has(key(primaryProvider, m)))
    .filter(m => modelMeetsRequirements(m, requirements))
    .filter(m => supportsModelRequirements(m, primaryModel))
    .sort((a, b) => {
      // 优先非 thinking（更稳定），再按能力降序
      return Number(a.capabilities.thinking) - Number(b.capabilities.thinking)
        || scoreCapability(b) - scoreCapability(a)
    })

  for (const m of sameProviderModels) {
    chain.push({ provider: primaryProvider, model: m, reason: 'downgrade_model' })
    usedKeys.add(key(primaryProvider, m))
  }

  // 2. 跨 provider 切换
  const otherProviders = sortProvidersByHealth(
    providers.filter(p => p.id !== primaryProvider.id && !isCircuitOpen(p.id, now)),
  )

  for (const provider of otherProviders) {
    // 优先同类型 provider
    if (provider.providerType !== primaryProvider.providerType) continue

    const candidates = provider.models
      .filter(m => !usedKeys.has(key(provider, m)))
      .filter(m => modelMeetsRequirements(m, requirements))
      .filter(m => supportsModelRequirements(m, primaryModel))
      .sort((a, b) => scoreCapability(b) - scoreCapability(a))

    for (const m of candidates.slice(0, 2)) {
      chain.push({ provider, model: m, reason: 'switch_provider' })
      usedKeys.add(key(provider, m))
    }
  }

  // 3. 不同类型 provider 作为最后手段
  for (const provider of otherProviders) {
    if (provider.providerType === primaryProvider.providerType) continue

    const candidates = provider.models
      .filter(m => !usedKeys.has(key(provider, m)))
      .filter(m => modelMeetsRequirements(m, requirements))
      .sort((a, b) => scoreCapability(b) - scoreCapability(a))

    for (const m of candidates.slice(0, 1)) {
      chain.push({ provider, model: m, reason: 'switch_provider_type' })
      usedKeys.add(key(provider, m))
    }
  }

  return chain
}

/**
 * 从 fallback chain 中取下一个候选（用于 executeGatewayRequest 内部重试）
 */
export function nextFallbackCandidate(
  chain: FallbackCandidate[],
  attemptIndex: number,
): FallbackCandidate | undefined {
  return chain[attemptIndex]
}
