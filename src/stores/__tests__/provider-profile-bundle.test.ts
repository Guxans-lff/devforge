import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProviderProfileBundleStore } from '@/stores/provider-profile-bundle'
import type { ProviderConfig } from '@/types/ai'

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>()
  get length(): number { return this.data.size }
  clear(): void { this.data.clear() }
  getItem(key: string): string | null { return this.data.get(key) ?? null }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null }
  removeItem(key: string): void { this.data.delete(key) }
  setItem(key: string, value: string): void { this.data.set(key, value) }
}

function makeProvider(): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'OpenAI',
    providerType: 'openai_compat',
    endpoint: 'https://api.openai.com/v1',
    isDefault: true,
    createdAt: 1,
    models: [{
      id: 'gpt-5.4',
      name: 'GPT-5.4',
      capabilities: {
        streaming: true,
        vision: true,
        thinking: true,
        toolUse: true,
        maxContext: 1000000,
        maxOutput: 128000,
      },
    }],
  }
}

describe('provider-profile-bundle store', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    setActivePinia(createPinia())
  })

  it('saves profiles and creates update backups', () => {
    const store = useProviderProfileBundleStore()
    const profile = store.saveProfile({
      name: '主力编码',
      providerId: 'provider-1',
      modelId: 'gpt-5.4',
    })

    store.saveProfile({
      id: profile.id,
      name: '主力编码 v2',
      providerId: 'provider-1',
      modelId: 'gpt-5.4',
    })

    expect(store.profiles).toHaveLength(1)
    expect(store.profiles[0]?.name).toBe('主力编码 v2')
    expect(store.backups[0]).toMatchObject({
      profileId: profile.id,
      reason: 'before-update',
    })
  })

  it('previews and applies a profile', () => {
    const store = useProviderProfileBundleStore()
    const profile = store.saveProfile({
      name: '安全配置',
      providerId: 'provider-1',
      modelId: 'gpt-5.4',
      workspaceConfig: { planGateEnabled: true },
    })

    const preview = store.previewProfile({
      profileId: profile.id,
      providers: [makeProvider()],
      currentWorkspaceConfig: {},
    })
    const applied = store.applyProfile({
      profileId: profile.id,
      providers: [makeProvider()],
      currentWorkspaceConfig: {},
    })

    expect(preview.workspaceChanges.find(item => item.key === 'planGateEnabled')?.changed).toBe(true)
    expect(applied.workspaceConfig).toMatchObject({
      preferredModel: 'gpt-5.4',
      outputStyleId: undefined,
      planGateEnabled: true,
    })
    expect(store.activeProfileId).toBe(profile.id)
    expect(store.backups[0]?.reason).toBe('before-apply')
  })

  it('rolls back a profile from backup', () => {
    const store = useProviderProfileBundleStore()
    const profile = store.saveProfile({
      name: 'Profile A',
      providerId: 'provider-1',
      modelId: 'gpt-5.4',
    })
    const backup = store.backupProfile(profile.id)

    store.saveProfile({
      id: profile.id,
      name: 'Profile A v2',
      providerId: 'provider-1',
      modelId: 'gpt-5.4',
    })
    const restored = store.rollbackProfile(backup.id)

    expect(restored.name).toBe('Profile A')
    expect(store.profiles[0]?.name).toBe('Profile A')
    expect(store.backups.some(item => item.reason === 'rollback')).toBe(true)
  })
})
