import type { AiGatewayPolicyConfig, ModelConfig, ProviderConfig } from '@/types/ai'
import type { RateLimitConfig } from './rateLimiter'
import { buildFallbackChain, type FallbackCandidate, type ModelRequirements } from './router'

const MIN_RATE_LIMIT_WINDOW_MS = 1_000
const MAX_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1_000
const MIN_RATE_LIMIT_REQUESTS = 1
const MAX_RATE_LIMIT_REQUESTS = 10_000

export function normalizeGatewayPolicy(
  policy?: AiGatewayPolicyConfig | null,
): AiGatewayPolicyConfig | undefined {
  if (!policy) return undefined

  const fallbackProviderIds = normalizeProviderIds(policy.fallbackProviderIds)
  const rateLimit = normalizeRateLimit(policy.rateLimit)

  return {
    fallbackEnabled: policy.fallbackEnabled !== false,
    fallbackProviderIds,
    routingStrategy: normalizeRoutingStrategy(policy.routingStrategy),
    rateLimit,
  }
}

export function resolveGatewayRateLimit(
  policy?: AiGatewayPolicyConfig | null,
): RateLimitConfig | undefined {
  return normalizeGatewayPolicy(policy)?.rateLimit
}

export function buildPolicyFallbackChain(input: {
  providers: ProviderConfig[]
  primaryProvider: ProviderConfig
  primaryModel: ModelConfig
  policy?: AiGatewayPolicyConfig | null
  requirements?: ModelRequirements
  now?: number
}): FallbackCandidate[] {
  const policy = normalizeGatewayPolicy(input.policy)
  if (policy?.fallbackEnabled === false) return []

  const chain = buildFallbackChain(
    input.providers,
    input.primaryProvider,
    input.primaryModel,
    input.requirements,
    input.now,
  )

  if (!policy) return chain
  if (!policy.fallbackProviderIds?.length) return sortFallbackChainByPolicy(chain, policy)
  const allowedProviderIds = new Set(policy.fallbackProviderIds)
  const filtered = chain.filter(candidate =>
    candidate.provider.id === input.primaryProvider.id || allowedProviderIds.has(candidate.provider.id),
  )
  return sortFallbackChainByPolicy(filtered, policy)
}

export function describeGatewayPolicyValue(
  policy: AiGatewayPolicyConfig | undefined,
  key: 'fallbackEnabled' | 'fallbackProviderIds' | 'routingStrategy' | 'rateLimit',
  providers: ProviderConfig[] = [],
): string {
  const normalized = normalizeGatewayPolicy(policy)
  switch (key) {
    case 'fallbackEnabled':
      return normalized?.fallbackEnabled === false ? '关闭' : '启用'
    case 'fallbackProviderIds':
      if (!normalized?.fallbackProviderIds?.length) return '自动选择'
      return normalized.fallbackProviderIds
        .map(providerId => providers.find(provider => provider.id === providerId)?.name ?? providerId)
        .join(', ')
    case 'routingStrategy':
      return formatRoutingStrategy(normalized?.routingStrategy)
    case 'rateLimit':
      return normalized?.rateLimit
        ? `${normalized.rateLimit.windowMs}ms / ${normalized.rateLimit.maxRequests} 次`
        : '默认限流'
  }
}

function normalizeProviderIds(providerIds?: string[]): string[] | undefined {
  const normalized = [...new Set((providerIds ?? []).map(id => id.trim()).filter(Boolean))]
  return normalized.length > 0 ? normalized : undefined
}

function normalizeRoutingStrategy(
  strategy?: AiGatewayPolicyConfig['routingStrategy'],
): AiGatewayPolicyConfig['routingStrategy'] {
  if (strategy === 'cost' || strategy === 'speed' || strategy === 'capability') return strategy
  return 'default'
}

function normalizeRateLimit(
  rateLimit?: AiGatewayPolicyConfig['rateLimit'],
): AiGatewayPolicyConfig['rateLimit'] | undefined {
  if (!rateLimit) return undefined
  const windowMs = clampInteger(rateLimit.windowMs, MIN_RATE_LIMIT_WINDOW_MS, MAX_RATE_LIMIT_WINDOW_MS)
  const maxRequests = clampInteger(rateLimit.maxRequests, MIN_RATE_LIMIT_REQUESTS, MAX_RATE_LIMIT_REQUESTS)
  return { windowMs, maxRequests }
}

function clampInteger(value: number, min: number, max: number): number {
  const normalized = Math.trunc(Number.isFinite(value) ? value : min)
  return Math.min(max, Math.max(min, normalized))
}

function formatRoutingStrategy(strategy?: AiGatewayPolicyConfig['routingStrategy']): string {
  switch (strategy) {
    case 'cost':
      return '成本优先'
    case 'speed':
      return '速度优先'
    case 'capability':
      return '能力优先'
    default:
      return '默认策略'
  }
}

function sortFallbackChainByPolicy(
  chain: FallbackCandidate[],
  policy: AiGatewayPolicyConfig,
): FallbackCandidate[] {
  const strategy = policy.routingStrategy ?? 'default'
  if (strategy === 'default') return chain
  return chain.slice().sort((a, b) => {
    if (a.provider.id === b.provider.id && a.reason === 'downgrade_model' && b.reason !== 'downgrade_model') return -1
    if (b.provider.id === a.provider.id && b.reason === 'downgrade_model' && a.reason !== 'downgrade_model') return 1
    switch (strategy) {
      case 'cost':
        return scoreCost(a.model) - scoreCost(b.model)
      case 'speed':
        return b.model.capabilities.maxOutput - a.model.capabilities.maxOutput
      case 'capability':
        return scoreCapability(b.model) - scoreCapability(a.model)
      default:
        return 0
    }
  })
}

function scoreCost(model: ModelConfig): number {
  const pricing = model.capabilities.pricing
  if (!pricing) return Infinity
  return pricing.inputPer1m + pricing.outputPer1m * 2
}

function scoreCapability(model: ModelConfig): number {
  let score = 0
  if (model.capabilities.toolUse) score += 100
  if (model.capabilities.vision) score += 80
  if (model.capabilities.thinking) score += 60
  score += model.capabilities.maxContext / 1000
  score += model.capabilities.maxOutput / 1000
  return score
}
