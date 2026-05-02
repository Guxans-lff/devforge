import { getAppStateJson, setAppStateJson } from '@/api/app-state'
import type { AiProviderProfileBackup, AiProviderProfileBundle } from '@/types/ai'

export const PROVIDER_PROFILE_BUNDLE_STATE_KEY = 'ai.providerProfileBundle.snapshot.v1'
export const PROVIDER_PROFILE_BUNDLE_STATE_VERSION = 1

export interface ProviderProfileBundleSnapshot {
  profiles: AiProviderProfileBundle[]
  backups: AiProviderProfileBackup[]
  exportedAt: number
  schemaVersion: number
}

function normalizeSnapshot(input: Partial<ProviderProfileBundleSnapshot> | null | undefined): ProviderProfileBundleSnapshot {
  return {
    profiles: Array.isArray(input?.profiles) ? input.profiles : [],
    backups: Array.isArray(input?.backups) ? input.backups : [],
    exportedAt: typeof input?.exportedAt === 'number' ? input.exportedAt : Date.now(),
    schemaVersion: input?.schemaVersion === PROVIDER_PROFILE_BUNDLE_STATE_VERSION
      ? input.schemaVersion
      : PROVIDER_PROFILE_BUNDLE_STATE_VERSION,
  }
}

export function createProviderProfileBundleSnapshot(
  profiles: AiProviderProfileBundle[],
  backups: AiProviderProfileBackup[],
  now = Date.now(),
): ProviderProfileBundleSnapshot {
  return normalizeSnapshot({
    profiles: JSON.parse(JSON.stringify(profiles)) as AiProviderProfileBundle[],
    backups: JSON.parse(JSON.stringify(backups)) as AiProviderProfileBackup[],
    exportedAt: now,
    schemaVersion: PROVIDER_PROFILE_BUNDLE_STATE_VERSION,
  })
}

export async function loadProviderProfileBundleSnapshot(): Promise<ProviderProfileBundleSnapshot | null> {
  const snapshot = await getAppStateJson<ProviderProfileBundleSnapshot>(PROVIDER_PROFILE_BUNDLE_STATE_KEY)
  return snapshot ? normalizeSnapshot(snapshot) : null
}

export async function saveProviderProfileBundleSnapshot(snapshot: ProviderProfileBundleSnapshot): Promise<void> {
  await setAppStateJson(
    PROVIDER_PROFILE_BUNDLE_STATE_KEY,
    normalizeSnapshot(snapshot),
    PROVIDER_PROFILE_BUNDLE_STATE_VERSION,
  )
}

export function exportProviderProfileBundleSnapshot(snapshot: ProviderProfileBundleSnapshot): string {
  return JSON.stringify(normalizeSnapshot(snapshot), null, 2)
}

export function importProviderProfileBundleSnapshot(raw: string): ProviderProfileBundleSnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Provider Profile 导入内容不是合法 JSON')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Provider Profile 导入内容格式无效')
  }
  const snapshot = normalizeSnapshot(parsed as Partial<ProviderProfileBundleSnapshot>)
  if (snapshot.profiles.some(profile => !profile.id || !profile.name || !profile.providerId || !profile.modelId)) {
    throw new Error('Provider Profile 导入内容缺少必要字段')
  }
  return snapshot
}
