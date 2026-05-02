import type { AiGatewayPolicyConfig, ProviderConfig } from '@/types/ai'

export type GatewayPolicyIssueLevel = 'info' | 'warning' | 'danger'

export interface GatewayPolicyIssue {
  key: string
  level: GatewayPolicyIssueLevel
  message: string
}

export interface GatewayPolicyAuditInput {
  policy?: AiGatewayPolicyConfig | null
  providers: ProviderConfig[]
  primaryProviderId?: string | null
  primaryProvider?: ProviderConfig | null
  gatewayErrorCount?: number
  singleProviderLevel?: GatewayPolicyIssueLevel
  primaryFallbackMessage?: string
}

export function auditGatewayPolicy(input: GatewayPolicyAuditInput): GatewayPolicyIssue[] {
  const policy = input.policy
  const providers = input.providers
  const issues: GatewayPolicyIssue[] = []
  const fallbackProviderIds = policy?.fallbackProviderIds ?? []
  const primaryProvider = input.primaryProvider
    ?? providers.find(provider => provider.id === input.primaryProviderId)
    ?? null

  if (policy?.fallbackEnabled === false && (input.gatewayErrorCount ?? 0) > 0) {
    issues.push({
      key: 'fallback-disabled-with-errors',
      level: 'danger',
      message: '当前 Profile 已关闭 fallback，且 Gateway 已出现错误；建议恢复 fallback 或切换 Provider。',
    })
  } else if (policy?.fallbackEnabled === false) {
    issues.push({
      key: 'fallback-disabled',
      level: 'warning',
      message: '当前 Profile 已关闭 fallback，Provider 瞬时故障时不会自动切换备用模型。',
    })
  }

  const missingProviderIds = fallbackProviderIds.filter(providerId =>
    !providers.some(provider => provider.id === providerId),
  )
  if (missingProviderIds.length > 0) {
    issues.push({
      key: 'missing-fallback-provider',
      level: 'warning',
      message: `Fallback Provider 不存在：${missingProviderIds.join(', ')}`,
    })
  }

  if (primaryProvider && fallbackProviderIds.includes(primaryProvider.id)) {
    issues.push({
      key: 'primary-fallback-provider',
      level: 'info',
      message: input.primaryFallbackMessage
        ?? 'Fallback 列表包含当前主 Provider，Gateway 会优先尝试同 Provider 降级模型。',
    })
  }

  const fallbackProviders = fallbackProviderIds
    .map(providerId => providers.find(provider => provider.id === providerId))
    .filter((provider): provider is ProviderConfig => !!provider)
  const weakFallbackProviders = fallbackProviders
    .filter(provider => !fallbackModelCompatible(primaryProvider, provider))
    .map(provider => provider.name || provider.id)
  if (weakFallbackProviders.length > 0) {
    issues.push({
      key: 'weak-fallback-capability',
      level: 'warning',
      message: `Fallback Provider 模型能力可能不足：${weakFallbackProviders.join(', ')}`,
    })
  }

  if (policy?.fallbackEnabled !== false && providers.length <= 1) {
    issues.push({
      key: 'single-provider-fallback',
      level: input.singleProviderLevel ?? 'info',
      message: '当前只有一个 Provider，fallback 只能尝试同 Provider 的其他模型。',
    })
  }

  if (policy?.rateLimit) {
    const { windowMs, maxRequests } = policy.rateLimit
    if (windowMs < 10_000 && maxRequests > 20) {
      issues.push({
        key: 'aggressive-rate-limit',
        level: 'warning',
        message: 'Profile 限流窗口较短且请求数偏高，可能无法有效保护 Provider 配额。',
      })
    }
  }

  return issues
}

function fallbackModelCompatible(primary: ProviderConfig | null | undefined, fallback: ProviderConfig): boolean {
  if (!primary?.models.length) return true
  const primaryBest = primary.models.reduce((best, model) =>
    model.capabilities.maxContext > best.capabilities.maxContext ? model : best,
  )
  return fallback.models.some(model =>
    model.capabilities.streaming
    && model.capabilities.maxContext >= Math.min(primaryBest.capabilities.maxContext, 128_000),
  )
}
