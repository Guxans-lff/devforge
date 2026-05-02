import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiProviderProfileBundle } from '@/types/ai'
import {
  createProviderProfileBundleSnapshot,
  exportProviderProfileBundleSnapshot,
  importProviderProfileBundleSnapshot,
  loadProviderProfileBundleSnapshot,
  PROVIDER_PROFILE_BUNDLE_STATE_KEY,
  saveProviderProfileBundleSnapshot,
} from '@/api/provider-profile-bundle'
import { getAppStateJson, setAppStateJson } from '@/api/app-state'

vi.mock('@/api/app-state', () => ({
  getAppStateJson: vi.fn(),
  setAppStateJson: vi.fn(),
}))

function makeProfile(): AiProviderProfileBundle {
  return {
    id: 'profile-1',
    name: '主力配置',
    providerId: 'provider-1',
    modelId: 'model-1',
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('provider-profile-bundle api', () => {
  beforeEach(() => {
    vi.mocked(getAppStateJson).mockReset()
    vi.mocked(setAppStateJson).mockReset()
  })

  it('creates a serializable snapshot', () => {
    const snapshot = createProviderProfileBundleSnapshot([makeProfile()], [], 100)

    expect(snapshot).toMatchObject({
      exportedAt: 100,
      schemaVersion: 1,
      profiles: [{ id: 'profile-1' }],
      backups: [],
    })
  })

  it('loads normalized snapshot from app state', async () => {
    vi.mocked(getAppStateJson).mockResolvedValue({
      profiles: [makeProfile()],
      backups: [],
      exportedAt: 100,
      schemaVersion: 1,
    })

    const snapshot = await loadProviderProfileBundleSnapshot()

    expect(getAppStateJson).toHaveBeenCalledWith(PROVIDER_PROFILE_BUNDLE_STATE_KEY)
    expect(snapshot?.profiles[0]?.id).toBe('profile-1')
  })

  it('saves snapshot to app state with version', async () => {
    const snapshot = createProviderProfileBundleSnapshot([makeProfile()], [], 100)

    await saveProviderProfileBundleSnapshot(snapshot)

    expect(setAppStateJson).toHaveBeenCalledWith(
      PROVIDER_PROFILE_BUNDLE_STATE_KEY,
      snapshot,
      1,
    )
  })

  it('exports and imports profile snapshots', () => {
    const snapshot = createProviderProfileBundleSnapshot([makeProfile()], [], 100)
    const raw = exportProviderProfileBundleSnapshot(snapshot)
    const imported = importProviderProfileBundleSnapshot(raw)

    expect(imported.profiles[0]?.id).toBe('profile-1')
    expect(imported.schemaVersion).toBe(1)
  })

  it('rejects invalid imported profiles', () => {
    expect(() => importProviderProfileBundleSnapshot('{bad')).toThrow('合法 JSON')
    expect(() => importProviderProfileBundleSnapshot(JSON.stringify({
      profiles: [{ id: 'broken' }],
      backups: [],
    }))).toThrow('缺少必要字段')
  })
})
