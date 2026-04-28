import { getCredential } from '@/api/connection'
import type { FallbackCandidate } from '@/ai-gateway/router'

export async function collectFallbackApiKeys(
  primaryProviderId: string,
  fallbackChain?: FallbackCandidate[],
): Promise<Record<string, string | undefined> | undefined> {
  const providerIds = [...new Set((fallbackChain ?? []).map(candidate => candidate.provider.id))]
    .filter(providerId => providerId !== primaryProviderId)
  if (providerIds.length === 0) return undefined

  return Object.fromEntries(await Promise.all(
    providerIds.map(async providerId => [providerId, await getCredential(`ai-provider-${providerId}`) ?? undefined]),
  ))
}

