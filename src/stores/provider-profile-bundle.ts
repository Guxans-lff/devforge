import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  createProviderProfileBundleSnapshot,
  exportProviderProfileBundleSnapshot,
  importProviderProfileBundleSnapshot,
  loadProviderProfileBundleSnapshot,
  saveProviderProfileBundleSnapshot,
} from '@/api/provider-profile-bundle'
import type {
  AiProviderProfileBackup,
  AiProviderProfileBundle,
  ProviderConfig,
  WorkspaceConfig,
} from '@/types/ai'
import type { OutputStyle } from '@/composables/useOutputStyles'
import {
  applyProviderProfileBundle,
  buildProviderProfilePreview,
  createProviderProfileBackup,
  loadProviderProfileBackups,
  loadProviderProfileBundles,
  removeProviderProfileBundle,
  rollbackProviderProfileBundle,
  saveProviderProfileBackups,
  saveProviderProfileBundles,
  upsertProviderProfileBackup,
  upsertProviderProfileBundle,
  type ProviderProfileBundleDraft,
  type ProfileBundleApplyResult,
} from '@/ai-gui/providerProfileBundle'

export const useProviderProfileBundleStore = defineStore('provider-profile-bundle', () => {
  const profiles = ref<AiProviderProfileBundle[]>(loadProviderProfileBundles())
  const backups = ref<AiProviderProfileBackup[]>(loadProviderProfileBackups())
  const activeProfileId = ref<string | null>(null)
  const backendHydrated = ref(false)
  const backendSyncError = ref<string | null>(null)

  const activeProfile = computed(() =>
    profiles.value.find(profile => profile.id === activeProfileId.value) ?? null,
  )

  function persistBackendSnapshot(): void {
    const snapshot = createProviderProfileBundleSnapshot(profiles.value, backups.value)
    saveProviderProfileBundleSnapshot(snapshot)
      .then(() => {
        backendSyncError.value = null
      })
      .catch(error => {
        backendSyncError.value = error instanceof Error ? error.message : String(error)
      })
  }

  function persistProfiles(): void {
    saveProviderProfileBundles(profiles.value)
    persistBackendSnapshot()
  }

  function persistBackups(): void {
    saveProviderProfileBackups(backups.value)
    persistBackendSnapshot()
  }

  function reload(): void {
    profiles.value = loadProviderProfileBundles()
    backups.value = loadProviderProfileBackups()
  }

  async function hydrateFromBackend(): Promise<void> {
    try {
      const snapshot = await loadProviderProfileBundleSnapshot()
      backendHydrated.value = true
      backendSyncError.value = null
      if (!snapshot) {
        persistBackendSnapshot()
        return
      }

      const shouldUseBackend = snapshot.profiles.length > 0
        && (profiles.value.length === 0
          || Math.max(...snapshot.profiles.map(profile => profile.updatedAt)) >= Math.max(...profiles.value.map(profile => profile.updatedAt)))
      if (!shouldUseBackend) return

      profiles.value = snapshot.profiles
      backups.value = snapshot.backups
      saveProviderProfileBundles(profiles.value)
      saveProviderProfileBackups(backups.value)
      activeProfileId.value = profiles.value[0]?.id ?? activeProfileId.value
    } catch (error) {
      backendHydrated.value = true
      backendSyncError.value = error instanceof Error ? error.message : String(error)
    }
  }

  function exportSnapshot(): string {
    return exportProviderProfileBundleSnapshot(
      createProviderProfileBundleSnapshot(profiles.value, backups.value),
    )
  }

  function importSnapshot(raw: string): void {
    const snapshot = importProviderProfileBundleSnapshot(raw)
    profiles.value = snapshot.profiles
    backups.value = snapshot.backups
    activeProfileId.value = profiles.value[0]?.id ?? null
    saveProviderProfileBundles(profiles.value)
    saveProviderProfileBackups(backups.value)
    persistBackendSnapshot()
  }

  function saveProfile(draft: ProviderProfileBundleDraft): AiProviderProfileBundle {
    const existing = draft.id ? profiles.value.find(profile => profile.id === draft.id) : undefined
    if (existing) {
      backups.value = upsertProviderProfileBackup(
        backups.value,
        createProviderProfileBackup(existing, 'before-update'),
      )
      persistBackups()
    }
    profiles.value = upsertProviderProfileBundle(profiles.value, draft)
    persistProfiles()
    const saved = profiles.value.find(profile => profile.id === (draft.id ?? profiles.value[0]?.id))
      ?? profiles.value[0]
    if (!saved) throw new Error('保存 Provider Profile 失败')
    activeProfileId.value = saved.id
    return saved
  }

  function removeProfile(profileId: string): void {
    const existing = profiles.value.find(profile => profile.id === profileId)
    if (existing) {
      backups.value = upsertProviderProfileBackup(
        backups.value,
        createProviderProfileBackup(existing, 'manual'),
      )
      persistBackups()
    }
    profiles.value = removeProviderProfileBundle(profiles.value, profileId)
    persistProfiles()
    if (activeProfileId.value === profileId) {
      activeProfileId.value = profiles.value[0]?.id ?? null
    }
  }

  function backupProfile(profileId: string): AiProviderProfileBackup {
    const profile = profiles.value.find(item => item.id === profileId)
    if (!profile) throw new Error('Provider Profile 不存在')
    const backup = createProviderProfileBackup(profile, 'manual')
    backups.value = upsertProviderProfileBackup(backups.value, backup)
    persistBackups()
    return backup
  }

  function rollbackProfile(backupId: string): AiProviderProfileBundle {
    const backup = backups.value.find(item => item.id === backupId)
    if (!backup) throw new Error('Provider Profile 备份不存在')
    const current = profiles.value.find(profile => profile.id === backup.profileId)
    if (current) {
      backups.value = upsertProviderProfileBackup(
        backups.value,
        createProviderProfileBackup(current, 'rollback'),
      )
      persistBackups()
    }
    profiles.value = rollbackProviderProfileBundle(profiles.value, backup)
    persistProfiles()
    activeProfileId.value = backup.profileId
    const restored = profiles.value.find(profile => profile.id === backup.profileId)
    if (!restored) throw new Error('Provider Profile 回滚失败')
    return restored
  }

  function previewProfile(input: {
    profileId: string
    providers: ProviderConfig[]
    outputStyles?: OutputStyle[]
    currentWorkspaceConfig?: WorkspaceConfig | null
  }) {
    const profile = profiles.value.find(item => item.id === input.profileId)
    if (!profile) throw new Error('Provider Profile 不存在')
    return buildProviderProfilePreview({
      profile,
      providers: input.providers,
      outputStyles: input.outputStyles,
      currentWorkspaceConfig: input.currentWorkspaceConfig,
    })
  }

  function applyProfile(input: {
    profileId: string
    providers: ProviderConfig[]
    currentWorkspaceConfig?: WorkspaceConfig | null
  }): ProfileBundleApplyResult {
    const profile = profiles.value.find(item => item.id === input.profileId)
    if (!profile) throw new Error('Provider Profile 不存在')
    const result = applyProviderProfileBundle({
      profile,
      providers: input.providers,
      currentWorkspaceConfig: input.currentWorkspaceConfig,
    })
    backups.value = upsertProviderProfileBackup(backups.value, result.backup)
    persistBackups()
    activeProfileId.value = profile.id
    return result
  }

  return {
    profiles,
    backups,
    activeProfileId,
    activeProfile,
    backendHydrated,
    backendSyncError,
    reload,
    hydrateFromBackend,
    exportSnapshot,
    importSnapshot,
    saveProfile,
    removeProfile,
    backupProfile,
    rollbackProfile,
    previewProfile,
    applyProfile,
  }
})
