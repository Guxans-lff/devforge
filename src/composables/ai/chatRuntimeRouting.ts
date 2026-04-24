import type { ModelConfig, ProviderConfig } from '@/types/ai'

const PROVIDER_CIRCUIT_THRESHOLD = 2
const PROVIDER_CIRCUIT_COOLDOWN_MS = 120_000

interface ProviderRuntimeHealth {
  transientFailureCount: number
  openedAt: number | null
}

interface RoutingStores {
  providerHealthById: Map<string, ProviderRuntimeHealth>
}

const runtimeStores: RoutingStores = {
  providerHealthById: new Map(),
}

export interface RuntimeRouteResolution {
  provider: ProviderConfig
  model: ModelConfig
  rerouted: boolean
  reason?: 'provider_circuit_open'
}

export interface RuntimeFallbackResolution {
  provider: ProviderConfig
  model: ModelConfig
  rerouted: boolean
  reason?: 'downgrade_model' | 'switch_provider'
}

function getProviderHealth(providerId: string): ProviderRuntimeHealth {
  let existing = runtimeStores.providerHealthById.get(providerId)
  if (!existing) {
    existing = {
      transientFailureCount: 0,
      openedAt: null,
    }
    runtimeStores.providerHealthById.set(providerId, existing)
  }
  return existing
}

function isProviderCircuitOpen(providerId: string, now = Date.now()): boolean {
  const state = getProviderHealth(providerId)
  if (!state.openedAt) return false
  if (now - state.openedAt >= PROVIDER_CIRCUIT_COOLDOWN_MS) {
    state.openedAt = null
    state.transientFailureCount = 0
    return false
  }
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

function pickStableFallbackModel(
  provider: ProviderConfig,
  model: ModelConfig,
): ModelConfig | null {
  if (!model.capabilities.thinking) return null

  const candidates = provider.models.filter(candidate =>
    candidate.id !== model.id
    && !candidate.capabilities.thinking
    && supportsModelRequirements(candidate, model),
  )
  if (candidates.length === 0) return null

  return candidates
    .slice()
    .sort((left, right) =>
      (right.capabilities.maxContext - left.capabilities.maxContext)
      || (right.capabilities.maxOutput - left.capabilities.maxOutput),
    )[0] ?? null
}

function pickAlternateProviderRoute(
  providers: ProviderConfig[],
  currentProvider: ProviderConfig,
  currentModel: ModelConfig,
  now = Date.now(),
): { provider: ProviderConfig; model: ModelConfig } | null {
  for (const provider of providers) {
    if (provider.id === currentProvider.id) continue
    if (provider.providerType !== currentProvider.providerType) continue
    if (isProviderCircuitOpen(provider.id, now)) continue

    const sameModel = provider.models.find(candidate =>
      candidate.id === currentModel.id && supportsModelRequirements(candidate, currentModel),
    )
    if (sameModel) {
      return { provider, model: sameModel }
    }

    const stableFallback = provider.models
      .filter(candidate =>
        !candidate.capabilities.thinking
        && supportsModelRequirements(candidate, currentModel),
      )
      .sort((left, right) =>
        Number(right.capabilities.toolUse === currentModel.capabilities.toolUse) - Number(left.capabilities.toolUse === currentModel.capabilities.toolUse)
        || (right.capabilities.maxContext - left.capabilities.maxContext)
        || (right.capabilities.maxOutput - left.capabilities.maxOutput),
      )
      [0]

    if (stableFallback) {
      return { provider, model: stableFallback }
    }
  }

  return null
}

export function resolveRuntimeRoute(
  providers: ProviderConfig[],
  provider: ProviderConfig,
  model: ModelConfig,
  now = Date.now(),
): RuntimeRouteResolution {
  if (!isProviderCircuitOpen(provider.id, now)) {
    return { provider, model, rerouted: false }
  }

  const alternate = pickAlternateProviderRoute(providers, provider, model, now)
  if (!alternate) {
    return { provider, model, rerouted: false }
  }

  return {
    ...alternate,
    rerouted: true,
    reason: 'provider_circuit_open',
  }
}

export function resolveRetryableFailureFallback(
  providers: ProviderConfig[],
  provider: ProviderConfig,
  model: ModelConfig,
  now = Date.now(),
): RuntimeFallbackResolution {
  const downgradedModel = pickStableFallbackModel(provider, model)
  if (downgradedModel) {
    return {
      provider,
      model: downgradedModel,
      rerouted: true,
      reason: 'downgrade_model',
    }
  }

  const alternate = pickAlternateProviderRoute(providers, provider, model, now)
  if (alternate) {
    return {
      ...alternate,
      rerouted: true,
      reason: 'switch_provider',
    }
  }

  return { provider, model, rerouted: false }
}

export function recordProviderSuccess(providerId: string): void {
  const state = getProviderHealth(providerId)
  state.transientFailureCount = 0
  state.openedAt = null
}

export function recordProviderTransientFailure(providerId: string, now = Date.now()): void {
  const state = getProviderHealth(providerId)
  state.transientFailureCount += 1
  if (state.transientFailureCount >= PROVIDER_CIRCUIT_THRESHOLD) {
    state.openedAt = now
  }
}

export function resetProviderRuntimeRoutingForTests(): void {
  runtimeStores.providerHealthById.clear()
}
