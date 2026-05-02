import type {
  AiProviderProfileBackup,
  AiProviderProfileBundle,
  AiGatewayPolicyConfig,
  AiProviderProfilePreview,
  ProviderConfig,
  WorkspaceConfig,
} from '@/types/ai'
import type { OutputStyle } from '@/composables/useOutputStyles'
import { normalizeWorkspaceSkills, validateWorkspaceSkills } from '@/ai-gui/workspaceSkills'
import { describeGatewayPolicyValue, normalizeGatewayPolicy } from '@/ai-gateway/gatewayPolicy'

const STORAGE_KEY = 'devforge.ai.providerProfileBundles.v1'
const BACKUP_STORAGE_KEY = 'devforge.ai.providerProfileBackups.v1'
const MAX_BACKUPS_PER_PROFILE = 12

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface ProfileBundleApplyResult {
  workspaceConfig: WorkspaceConfig
  providerConfig?: ProviderConfig
  selectedProviderId: string
  selectedModelId: string
  outputStyleId?: string
  backup: AiProviderProfileBackup
}

export interface ProviderProfileBundleDraft {
  id?: string
  name: string
  description?: string
  providerId: string
  modelId: string
  outputStyleId?: string
  workspaceConfig?: WorkspaceConfig
  security?: ProviderConfig['security']
  gatewayPolicy?: AiGatewayPolicyConfig
  tags?: string[]
}

function nowId(prefix: string, now = Date.now()): string {
  return `${prefix}-${now}-${Math.random().toString(36).slice(2, 7)}`
}

function safeParseArray<T>(raw: string | null): T[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function cloneWorkspaceConfig(config?: WorkspaceConfig): WorkspaceConfig | undefined {
  if (!config) return undefined
  return JSON.parse(JSON.stringify(config)) as WorkspaceConfig
}

function cloneGatewayPolicy(policy?: AiGatewayPolicyConfig): AiGatewayPolicyConfig | undefined {
  const normalized = normalizeGatewayPolicy(policy)
  return normalized ? JSON.parse(JSON.stringify(normalized)) as AiGatewayPolicyConfig : undefined
}

function normalizeTags(tags?: string[]): string[] | undefined {
  const normalized = [...new Set((tags ?? []).map(tag => tag.trim()).filter(Boolean))]
  return normalized.length > 0 ? normalized : undefined
}

export function normalizeProviderProfileBundle(
  draft: ProviderProfileBundleDraft,
  existing?: AiProviderProfileBundle,
  now = Date.now(),
): AiProviderProfileBundle {
  const name = draft.name.trim()
  if (!name) throw new Error('Profile 名称不能为空')
  if (!draft.providerId.trim()) throw new Error('Profile 必须绑定 Provider')
  if (!draft.modelId.trim()) throw new Error('Profile 必须绑定 Model')

  return {
    id: draft.id?.trim() || existing?.id || nowId('profile', now),
    name,
    description: draft.description?.trim() || undefined,
    providerId: draft.providerId.trim(),
    modelId: draft.modelId.trim(),
    outputStyleId: draft.outputStyleId?.trim() || undefined,
    workspaceConfig: cloneWorkspaceConfig(draft.workspaceConfig),
    security: draft.security ? { ...draft.security } : undefined,
    gatewayPolicy: cloneGatewayPolicy(draft.gatewayPolicy),
    tags: normalizeTags(draft.tags),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

export function loadProviderProfileBundles(
  storage: StorageLike | undefined = globalThis.localStorage,
): AiProviderProfileBundle[] {
  return safeParseArray<AiProviderProfileBundle>(storage?.getItem(STORAGE_KEY) ?? null)
}

export function saveProviderProfileBundles(
  profiles: AiProviderProfileBundle[],
  storage: StorageLike | undefined = globalThis.localStorage,
): void {
  if (!storage) return
  storage.setItem(STORAGE_KEY, JSON.stringify(profiles))
}

export function upsertProviderProfileBundle(
  profiles: AiProviderProfileBundle[],
  draft: ProviderProfileBundleDraft,
  now = Date.now(),
): AiProviderProfileBundle[] {
  const existing = draft.id ? profiles.find(profile => profile.id === draft.id) : undefined
  const profile = normalizeProviderProfileBundle(draft, existing, now)
  const next = profiles.filter(item => item.id !== profile.id)
  return [profile, ...next].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function removeProviderProfileBundle(
  profiles: AiProviderProfileBundle[],
  profileId: string,
): AiProviderProfileBundle[] {
  return profiles.filter(profile => profile.id !== profileId)
}

export function loadProviderProfileBackups(
  storage: StorageLike | undefined = globalThis.localStorage,
): AiProviderProfileBackup[] {
  return safeParseArray<AiProviderProfileBackup>(storage?.getItem(BACKUP_STORAGE_KEY) ?? null)
}

export function saveProviderProfileBackups(
  backups: AiProviderProfileBackup[],
  storage: StorageLike | undefined = globalThis.localStorage,
): void {
  if (!storage) return
  storage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(backups))
}

export function createProviderProfileBackup(
  profile: AiProviderProfileBundle,
  reason: AiProviderProfileBackup['reason'] = 'manual',
  now = Date.now(),
): AiProviderProfileBackup {
  return {
    id: nowId('profile-backup', now),
    profileId: profile.id,
    snapshot: JSON.parse(JSON.stringify(profile)) as AiProviderProfileBundle,
    reason,
    createdAt: now,
  }
}

export function upsertProviderProfileBackup(
  backups: AiProviderProfileBackup[],
  backup: AiProviderProfileBackup,
): AiProviderProfileBackup[] {
  const next = [backup, ...backups.filter(item => item.id !== backup.id)]
  const grouped = new Map<string, AiProviderProfileBackup[]>()
  for (const item of next) {
    const list = grouped.get(item.profileId) ?? []
    list.push(item)
    grouped.set(item.profileId, list)
  }
  return [...grouped.values()]
    .flatMap(list => list.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_BACKUPS_PER_PROFILE))
    .sort((a, b) => b.createdAt - a.createdAt)
}

function formatBool(value: boolean | undefined): string {
  if (value === undefined) return '未配置'
  return value ? '启用' : '关闭'
}

function formatList(value: Array<{ path: string; reason?: string }> | string[] | undefined): string {
  if (!value?.length) return '未配置'
  return value.map(item => typeof item === 'string' ? item : item.path).join(', ')
}

function formatSkills(config?: WorkspaceConfig | null): string {
  const skills = normalizeWorkspaceSkills(config?.skills)
  if (skills.length === 0) return '未配置'
  const enabled = skills.filter(skill => skill.enabled !== false).length
  return `${enabled}/${skills.length} 个启用`
}

function workspaceValue(config: WorkspaceConfig | null | undefined, key: keyof WorkspaceConfig): string {
  switch (key) {
    case 'preferredModel':
    case 'systemPromptExtra':
    case 'dispatcherPrompt':
    case 'outputStyleId':
      return String(config?.[key]?.trim() || '未配置')
    case 'contextFiles':
      return formatList(config?.contextFiles)
    case 'planGateEnabled':
      return formatBool(config?.planGateEnabled)
    case 'dispatcherMaxParallel':
      return `${config?.dispatcherMaxParallel ?? 3} 路`
    case 'dispatcherAutoRetryCount':
      return `${config?.dispatcherAutoRetryCount ?? 1} 次`
    case 'dispatcherDefaultMode':
      return config?.dispatcherDefaultMode === 'tab' ? '新建 Tab' : 'Headless'
    case 'features':
      return config?.features ? `${Object.keys(config.features).length} 个开关` : '未配置'
    case 'skills':
      return formatSkills(config)
    default:
      return config?.[key] == null ? '未配置' : JSON.stringify(config[key])
  }
}

function securityValue(security: ProviderConfig['security'] | undefined, key: keyof NonNullable<ProviderConfig['security']>): string {
  switch (key) {
    case 'allowlist':
      return security?.allowlist?.length ? security.allowlist.join(', ') : '默认 allowlist'
    case 'allowLocalhost':
      return formatBool(security?.allowLocalhost)
    case 'allowPrivateIP':
      return formatBool(security?.allowPrivateIP)
  }
}

export function buildProviderProfilePreview(input: {
  profile: AiProviderProfileBundle
  providers: ProviderConfig[]
  outputStyles?: OutputStyle[]
  currentWorkspaceConfig?: WorkspaceConfig | null
}): AiProviderProfilePreview {
  const provider = input.providers.find(item => item.id === input.profile.providerId)
  const model = provider?.models.find(item => item.id === input.profile.modelId)
  const outputStyle = input.outputStyles?.find(item => item.id === input.profile.outputStyleId)
  const workspaceKeys: Array<{ key: keyof WorkspaceConfig; label: string }> = [
    { key: 'preferredModel', label: '首选模型' },
    { key: 'systemPromptExtra', label: '项目提示词' },
    { key: 'outputStyleId', label: '输出风格' },
    { key: 'contextFiles', label: '上下文文件' },
    { key: 'skills', label: 'Workspace Skills' },
    { key: 'planGateEnabled', label: 'Plan Gate' },
    { key: 'dispatcherPrompt', label: 'Dispatcher Prompt' },
    { key: 'dispatcherMaxParallel', label: 'Dispatcher 并发' },
    { key: 'dispatcherAutoRetryCount', label: 'Dispatcher 重试' },
    { key: 'dispatcherDefaultMode', label: 'Dispatcher 模式' },
    { key: 'features', label: '项目功能开关' },
  ]
  const securityKeys: Array<{ key: 'allowlist' | 'allowLocalhost' | 'allowPrivateIP'; label: string }> = [
    { key: 'allowlist', label: 'SSRF Allowlist' },
    { key: 'allowLocalhost', label: '允许 localhost' },
    { key: 'allowPrivateIP', label: '允许私网地址' },
  ]
  const gatewayPolicyKeys: Array<{ key: 'fallbackEnabled' | 'fallbackProviderIds' | 'routingStrategy' | 'rateLimit'; label: string }> = [
    { key: 'fallbackEnabled', label: 'Fallback 开关' },
    { key: 'fallbackProviderIds', label: 'Fallback Provider' },
    { key: 'routingStrategy', label: '路由策略' },
    { key: 'rateLimit', label: '限流策略' },
  ]

  const workspaceChanges = workspaceKeys.map(item => {
    const before = workspaceValue(input.currentWorkspaceConfig, item.key)
    const after = workspaceValue(input.profile.workspaceConfig, item.key)
    return { ...item, before, after, changed: before !== after }
  })
  const securityChanges = securityKeys.map(item => {
    const before = securityValue(provider?.security, item.key)
    const after = securityValue(input.profile.security, item.key)
    return { ...item, before, after, changed: before !== after }
  })
  const gatewayPolicyChanges = gatewayPolicyKeys.map(item => {
    const before = describeGatewayPolicyValue(input.currentWorkspaceConfig?.gatewayPolicy, item.key, input.providers)
    const after = describeGatewayPolicyValue(input.profile.gatewayPolicy, item.key, input.providers)
    return { ...item, before, after, changed: before !== after }
  })
  const warnings: AiProviderProfilePreview['warnings'] = []

  if (!provider) {
    warnings.push({ key: 'missing-provider', level: 'danger', message: 'Profile 绑定的 Provider 不存在，无法应用。' })
  } else if (!model) {
    warnings.push({ key: 'missing-model', level: 'danger', message: 'Profile 绑定的模型不存在，无法应用。' })
  }
  if (input.profile.outputStyleId && !outputStyle) {
    warnings.push({ key: 'missing-output-style', level: 'warning', message: '绑定的 Output Style 不存在，将只应用 Provider 和 Workspace 配置。' })
  }
  const skillRisks = validateWorkspaceSkills(normalizeWorkspaceSkills(input.profile.workspaceConfig?.skills))
  for (const issue of skillRisks.issues.filter(issue => issue.level !== 'info')) {
    warnings.push({ key: `skill-${issue.code}-${issue.skillId}`, level: issue.level, message: issue.message })
  }
  if (input.profile.security?.allowPrivateIP) {
    warnings.push({ key: 'private-ip', level: 'warning', message: 'Profile 允许私网地址，请确认只用于可信内网 Provider。' })
  }
  if (input.profile.gatewayPolicy?.fallbackEnabled === false) {
    warnings.push({ key: 'fallback-disabled', level: 'warning', message: 'Profile 已关闭 fallback，Provider 瞬时故障时不会自动切换备用模型。' })
  }
  const missingFallbackProviderIds = (input.profile.gatewayPolicy?.fallbackProviderIds ?? [])
    .filter(providerId => !input.providers.some(provider => provider.id === providerId))
  if (missingFallbackProviderIds.length > 0) {
    warnings.push({
      key: 'missing-fallback-provider',
      level: 'warning',
      message: `Fallback Provider 不存在：${missingFallbackProviderIds.join(', ')}`,
    })
  }

  return {
    profileId: input.profile.id,
    profileName: input.profile.name,
    providerName: provider?.name ?? input.profile.providerId,
    modelName: model?.name ?? input.profile.modelId,
    outputStyleName: outputStyle?.name,
    workspaceChanges,
    securityChanges,
    gatewayPolicyChanges,
    warnings,
  }
}

export function applyProviderProfileBundle(input: {
  profile: AiProviderProfileBundle
  providers: ProviderConfig[]
  currentWorkspaceConfig?: WorkspaceConfig | null
  now?: number
}): ProfileBundleApplyResult {
  const provider = input.providers.find(item => item.id === input.profile.providerId)
  if (!provider) throw new Error('Profile 绑定的 Provider 不存在')
  const model = provider.models.find(item => item.id === input.profile.modelId)
  if (!model) throw new Error('Profile 绑定的模型不存在')

  const workspaceConfig: WorkspaceConfig = {
    ...(input.currentWorkspaceConfig ?? {}),
    ...(input.profile.workspaceConfig ?? {}),
    preferredModel: input.profile.modelId,
    outputStyleId: input.profile.outputStyleId,
    gatewayPolicy: cloneGatewayPolicy(input.profile.gatewayPolicy),
  }
  const providerConfig = input.profile.security
    ? { ...provider, security: { ...input.profile.security } }
    : undefined

  return {
    workspaceConfig,
    providerConfig,
    selectedProviderId: provider.id,
    selectedModelId: model.id,
    outputStyleId: input.profile.outputStyleId,
    backup: createProviderProfileBackup(input.profile, 'before-apply', input.now),
  }
}

export function rollbackProviderProfileBundle(
  profiles: AiProviderProfileBundle[],
  backup: AiProviderProfileBackup,
  now = Date.now(),
): AiProviderProfileBundle[] {
  const snapshot = {
    ...backup.snapshot,
    updatedAt: now,
  }
  return [snapshot, ...profiles.filter(profile => profile.id !== snapshot.id)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
