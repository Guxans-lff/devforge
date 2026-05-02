<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Archive, Check, Download, Eye, RotateCcw, Save, Trash2, Upload } from 'lucide-vue-next'
import type { AiProviderProfileBundle, ProviderConfig, WorkspaceConfig } from '@/types/ai'
import { auditGatewayPolicy } from '@/ai-gateway/gatewayPolicyAudit'
import { useProviderProfileBundleStore } from '@/stores/provider-profile-bundle'
import { useOutputStyles } from '@/composables/useOutputStyles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'

const props = defineProps<{
  providers: ProviderConfig[]
  currentWorkspaceConfig?: WorkspaceConfig | null
  currentProviderId?: string | null
  currentModelId?: string | null
  currentOutputStyleId?: string | null
}>()

const emit = defineEmits<{
  apply: [payload: {
    profile: AiProviderProfileBundle
    workspaceConfig: WorkspaceConfig
    providerConfig?: ProviderConfig
    selectedProviderId: string
    selectedModelId: string
    outputStyleId?: string
  }]
}>()

const store = useProviderProfileBundleStore()
const outputStyles = useOutputStyles()
const selectedProfileId = ref<string | null>(store.profiles[0]?.id ?? null)
const previewOpen = ref(false)
const rollbackOpen = ref(false)
const importOpen = ref(false)
const message = ref('')
const importText = ref('')

const form = reactive({
  name: '',
  description: '',
  providerId: '',
  modelId: '',
  outputStyleId: '',
  fallbackEnabled: true,
  fallbackProviderIdsText: '',
  routingStrategy: 'default' as 'default' | 'cost' | 'speed' | 'capability',
  rateLimitEnabled: false,
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 30,
  systemPromptExtra: '',
  planGateEnabled: false,
  dispatcherMaxParallel: 3,
  dispatcherAutoRetryCount: 1,
  dispatcherDefaultMode: 'headless' as 'headless' | 'tab',
  allowlist: '',
  allowLocalhost: false,
  allowPrivateIP: false,
})

const selectedProfile = computed(() =>
  store.profiles.find(profile => profile.id === selectedProfileId.value) ?? null,
)

const selectedProvider = computed(() =>
  props.providers.find(provider => provider.id === form.providerId)
  ?? props.providers.find(provider => provider.id === props.currentProviderId)
  ?? props.providers[0],
)

const availableModels = computed(() => selectedProvider.value?.models ?? [])
const selectedFallbackProviderIds = computed(() => parseProviderIdsText(form.fallbackProviderIdsText))
const fallbackProviderOptions = computed(() =>
  props.providers.filter(provider => provider.id !== form.providerId),
)
const unknownFallbackProviderIds = computed(() =>
  selectedFallbackProviderIds.value.filter(providerId =>
    !props.providers.some(provider => provider.id === providerId),
  ),
)
const gatewayPolicyIssues = computed(() =>
  auditGatewayPolicy({
    policy: buildGatewayPolicy(),
    providers: props.providers,
    primaryProviderId: form.providerId,
    primaryProvider: selectedProvider.value,
  }),
)

const preview = computed(() => {
  if (!selectedProfile.value) return null
  return store.previewProfile({
    profileId: selectedProfile.value.id,
    providers: props.providers,
    outputStyles: outputStyles.allStyles.value,
    currentWorkspaceConfig: props.currentWorkspaceConfig,
  })
})

const profileBackups = computed(() =>
  selectedProfile.value
    ? store.backups.filter(backup => backup.profileId === selectedProfile.value!.id)
    : [],
)

const backendStatusText = computed(() => {
  if (!store.backendHydrated) return '后端配置同步中'
  if (store.backendSyncError) return `后端同步失败，本地兜底：${store.backendSyncError}`
  return '已同步到后端配置存储'
})

function resetFormFromCurrent(): void {
  const provider = props.providers.find(item => item.id === props.currentProviderId) ?? props.providers[0]
  const model = provider?.models.find(item => item.id === props.currentModelId) ?? provider?.models[0]
  const config = props.currentWorkspaceConfig ?? {}

  form.name = provider && model ? `${provider.name} / ${model.name}` : '新 Profile'
  form.description = ''
  form.providerId = provider?.id ?? ''
  form.modelId = model?.id ?? ''
  form.outputStyleId = props.currentOutputStyleId ?? outputStyles.getDefaultStyle().id
  form.fallbackEnabled = config.gatewayPolicy?.fallbackEnabled !== false
  form.fallbackProviderIdsText = config.gatewayPolicy?.fallbackProviderIds?.join(', ') ?? ''
  form.routingStrategy = config.gatewayPolicy?.routingStrategy ?? 'default'
  form.rateLimitEnabled = !!config.gatewayPolicy?.rateLimit
  form.rateLimitWindowMs = config.gatewayPolicy?.rateLimit?.windowMs ?? 60000
  form.rateLimitMaxRequests = config.gatewayPolicy?.rateLimit?.maxRequests ?? 30
  form.systemPromptExtra = config.systemPromptExtra ?? ''
  form.planGateEnabled = config.planGateEnabled === true
  form.dispatcherMaxParallel = config.dispatcherMaxParallel ?? 3
  form.dispatcherAutoRetryCount = config.dispatcherAutoRetryCount ?? 1
  form.dispatcherDefaultMode = config.dispatcherDefaultMode ?? 'headless'
  form.allowlist = provider?.security?.allowlist?.join(', ') ?? ''
  form.allowLocalhost = provider?.security?.allowLocalhost === true
  form.allowPrivateIP = provider?.security?.allowPrivateIP === true
}

function loadProfileToForm(profile: AiProviderProfileBundle): void {
  form.name = profile.name
  form.description = profile.description ?? ''
  form.providerId = profile.providerId
  form.modelId = profile.modelId
  form.outputStyleId = profile.outputStyleId ?? outputStyles.getDefaultStyle().id
  form.fallbackEnabled = profile.gatewayPolicy?.fallbackEnabled !== false
  form.fallbackProviderIdsText = profile.gatewayPolicy?.fallbackProviderIds?.join(', ') ?? ''
  form.routingStrategy = profile.gatewayPolicy?.routingStrategy ?? 'default'
  form.rateLimitEnabled = !!profile.gatewayPolicy?.rateLimit
  form.rateLimitWindowMs = profile.gatewayPolicy?.rateLimit?.windowMs ?? 60000
  form.rateLimitMaxRequests = profile.gatewayPolicy?.rateLimit?.maxRequests ?? 30
  form.systemPromptExtra = profile.workspaceConfig?.systemPromptExtra ?? ''
  form.planGateEnabled = profile.workspaceConfig?.planGateEnabled === true
  form.dispatcherMaxParallel = profile.workspaceConfig?.dispatcherMaxParallel ?? 3
  form.dispatcherAutoRetryCount = profile.workspaceConfig?.dispatcherAutoRetryCount ?? 1
  form.dispatcherDefaultMode = profile.workspaceConfig?.dispatcherDefaultMode ?? 'headless'
  form.allowlist = profile.security?.allowlist?.join(', ') ?? ''
  form.allowLocalhost = profile.security?.allowLocalhost === true
  form.allowPrivateIP = profile.security?.allowPrivateIP === true
}

function buildWorkspaceConfig(): WorkspaceConfig {
  return {
    ...(props.currentWorkspaceConfig ?? {}),
    preferredModel: form.modelId,
    outputStyleId: form.outputStyleId || undefined,
    systemPromptExtra: form.systemPromptExtra.trim() || undefined,
    planGateEnabled: form.planGateEnabled || undefined,
    dispatcherMaxParallel: Math.max(1, Math.trunc(form.dispatcherMaxParallel || 1)),
    dispatcherAutoRetryCount: Math.max(0, Math.trunc(form.dispatcherAutoRetryCount || 0)),
    dispatcherDefaultMode: form.dispatcherDefaultMode,
  }
}

function parseProviderIdsText(value: string): string[] {
  return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))]
}

function buildGatewayPolicy() {
  return {
    fallbackEnabled: form.fallbackEnabled,
    fallbackProviderIds: parseProviderIdsText(form.fallbackProviderIdsText),
    routingStrategy: form.routingStrategy,
    rateLimit: form.rateLimitEnabled
      ? {
          windowMs: Math.max(1000, Math.trunc(form.rateLimitWindowMs || 1000)),
          maxRequests: Math.max(1, Math.trunc(form.rateLimitMaxRequests || 1)),
        }
      : undefined,
  }
}

function toggleFallbackProvider(providerId: string, enabled: boolean): void {
  const ids = new Set(selectedFallbackProviderIds.value)
  if (enabled) ids.add(providerId)
  else ids.delete(providerId)
  form.fallbackProviderIdsText = [...ids].join(', ')
}

function clearFallbackProviders(): void {
  form.fallbackProviderIdsText = ''
}

function saveProfile(): void {
  const profile = store.saveProfile({
    id: selectedProfile.value?.id,
    name: form.name,
    description: form.description,
    providerId: form.providerId,
    modelId: form.modelId,
    outputStyleId: form.outputStyleId,
    workspaceConfig: buildWorkspaceConfig(),
    gatewayPolicy: buildGatewayPolicy(),
    security: {
      allowlist: form.allowlist.split(',').map(item => item.trim()).filter(Boolean),
      allowLocalhost: form.allowLocalhost,
      allowPrivateIP: form.allowPrivateIP,
    },
  })
  selectedProfileId.value = profile.id
  message.value = 'Profile 已保存'
}

function createNewProfile(): void {
  selectedProfileId.value = null
  resetFormFromCurrent()
  message.value = ''
}

function selectProfile(profileId: string): void {
  selectedProfileId.value = profileId
  const profile = selectedProfile.value
  if (profile) loadProfileToForm(profile)
  message.value = ''
}

function confirmApplyProfileRisks(): boolean {
  const warnings = preview.value?.warnings ?? []
  if (warnings.length === 0) return true
  const summary = warnings
    .slice(0, 5)
    .map(item => `- ${item.message}`)
    .join('\n')
  const suffix = warnings.length > 5 ? `\n- 还有 ${warnings.length - 5} 条风险，请先查看预览。` : ''
  return window.confirm(`应用该 Profile 会带来以下风险：\n${summary}${suffix}\n\n是否继续应用？`)
}

function applyProfile(): boolean {
  const profile = selectedProfile.value
  if (!profile) return false
  if (!confirmApplyProfileRisks()) {
    message.value = '已取消应用 Profile'
    return false
  }
  const result = store.applyProfile({
    profileId: profile.id,
    providers: props.providers,
    currentWorkspaceConfig: props.currentWorkspaceConfig,
  })
  emit('apply', { profile, ...result })
  message.value = 'Profile 已应用'
  return true
}

function applyProfileFromPreview(): void {
  if (applyProfile()) {
    previewOpen.value = false
  }
}

function backupProfile(): void {
  if (!selectedProfile.value) return
  store.backupProfile(selectedProfile.value.id)
  message.value = 'Profile 备份已创建'
}

function rollbackProfile(backupId: string): void {
  const backup = profileBackups.value.find(item => item.id === backupId)
  const backupName = backup?.snapshot.name ?? selectedProfile.value?.name ?? '当前 Profile'
  if (!window.confirm(`确认回滚 Profile「${backupName}」？当前版本会先自动备份，但工作区配置可能被恢复到旧状态。`)) {
    message.value = '已取消回滚 Profile'
    return
  }
  const restored = store.rollbackProfile(backupId)
  selectedProfileId.value = restored.id
  loadProfileToForm(restored)
  rollbackOpen.value = false
  message.value = 'Profile 已回滚'
}

function removeProfile(): void {
  if (!selectedProfile.value) return
  const profileName = selectedProfile.value.name
  if (!window.confirm(`确认删除 Profile「${profileName}」？该操作不会删除历史备份，但会从当前配置列表移除。`)) {
    message.value = '已取消删除 Profile'
    return
  }
  store.removeProfile(selectedProfile.value.id)
  selectedProfileId.value = store.profiles[0]?.id ?? null
  if (selectedProfile.value) loadProfileToForm(selectedProfile.value)
  else resetFormFromCurrent()
  message.value = 'Profile 已删除'
}

async function exportProfiles(): Promise<void> {
  const content = store.exportSnapshot()
  await navigator.clipboard?.writeText(content)
  message.value = 'Profile JSON 已复制，可用于团队共享'
}

function importProfiles(): void {
  if (!importText.value.trim()) return
  if (!window.confirm('导入会覆盖当前 Profile Bundle 与备份，是否继续？')) return
  try {
    store.importSnapshot(importText.value)
    selectedProfileId.value = store.profiles[0]?.id ?? null
    const profile = selectedProfile.value
    if (profile) loadProfileToForm(profile)
    importOpen.value = false
    importText.value = ''
    message.value = 'Profile JSON 已导入'
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  }
}

resetFormFromCurrent()
if (selectedProfile.value) loadProfileToForm(selectedProfile.value)

onMounted(() => {
  store.hydrateFromBackend().then(() => {
    if (!selectedProfileId.value) selectedProfileId.value = store.profiles[0]?.id ?? null
    const profile = selectedProfile.value
    if (profile) loadProfileToForm(profile)
  })
})
</script>

<template>
  <section class="space-y-5 rounded-2xl border border-border/40 bg-card/45 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.14)]">
    <div class="flex items-start justify-between gap-4 rounded-xl border border-border/25 bg-gradient-to-br from-violet-500/[0.08] via-transparent to-cyan-500/[0.05] px-4 py-3.5">
      <div class="min-w-0 space-y-1">
        <div class="flex items-center gap-2">
          <div class="h-1 w-1 rounded-full bg-violet-500" />
          <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Provider Profile Bundle
          </h3>
        </div>
        <p class="max-w-3xl text-xs leading-relaxed text-muted-foreground">
          把 Provider / Model / Output Style / Workspace Prompt / 安全策略打成可预览、可备份、可回滚的配置包。
        </p>
        <p class="text-[10px]" :class="store.backendSyncError ? 'text-amber-400' : 'text-muted-foreground/70'">
          {{ backendStatusText }}
        </p>
      </div>
      <Button variant="outline" size="sm" class="h-8 shrink-0 text-xs" @click="createNewProfile">
        新建
      </Button>
    </div>

    <div class="space-y-5">
      <div class="flex gap-2 overflow-x-auto pb-1">
        <button
          v-for="profile in store.profiles"
          :key="profile.id"
          class="min-w-[220px] max-w-[280px] rounded-xl border px-3.5 py-2.5 text-left text-xs transition-colors"
          :class="selectedProfileId === profile.id ? 'border-primary/45 bg-primary/7 text-foreground shadow-sm' : 'border-border/30 bg-muted/18 text-muted-foreground hover:bg-muted/35'"
          @click="selectProfile(profile.id)"
        >
          <div class="truncate font-medium">{{ profile.name }}</div>
          <div class="mt-1 truncate text-[10px] opacity-70">{{ profile.providerId }} / {{ profile.modelId }}</div>
        </button>
        <div v-if="store.profiles.length === 0" class="min-w-[260px] rounded-xl border border-dashed border-border/40 bg-muted/10 p-4 text-xs text-muted-foreground">
          暂无 Profile，先从当前选择创建一个。
        </div>
      </div>

      <div class="space-y-5">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div class="space-y-1.5">
            <Label class="text-xs">名称</Label>
            <Input v-model="form.name" class="h-9 text-sm" placeholder="例如：主力编码配置" />
          </div>
          <div class="space-y-1.5">
            <Label class="text-xs">说明</Label>
            <Input v-model="form.description" class="h-9 text-sm" placeholder="用途、成本、风险说明" />
          </div>
          <div class="space-y-1.5">
            <Label class="text-xs">Provider</Label>
            <Select
              :model-value="form.providerId"
              @update:model-value="(value: unknown) => { form.providerId = String(value); form.modelId = selectedProvider?.models[0]?.id ?? '' }"
            >
              <SelectTrigger class="h-9 text-sm">
                <SelectValue placeholder="选择 Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="provider in providers" :key="provider.id" :value="provider.id">
                  {{ provider.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <Label class="text-xs">Model</Label>
            <Select :model-value="form.modelId" @update:model-value="(value: unknown) => form.modelId = String(value)">
              <SelectTrigger class="h-9 text-sm">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="model in availableModels" :key="model.id" :value="model.id">
                  {{ model.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <Label class="text-xs">Output Style</Label>
            <Select :model-value="form.outputStyleId" @update:model-value="(value: unknown) => form.outputStyleId = String(value)">
              <SelectTrigger class="h-9 text-sm">
                <SelectValue placeholder="选择输出风格" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="style in outputStyles.allStyles.value" :key="style.id" :value="style.id">
                  {{ style.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <Label class="text-xs">SSRF Allowlist</Label>
            <Input v-model="form.allowlist" class="h-9 text-sm font-mono" placeholder="api.openai.com, api.example.com" />
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-3">
          <label class="flex min-h-10 items-center gap-2 rounded-lg border border-border/30 bg-muted/20 px-3 py-2 text-xs">
            <input v-model="form.planGateEnabled" type="checkbox" class="h-3.5 w-3.5">
            Plan Gate
          </label>
          <label class="flex min-h-10 items-center gap-2 rounded-lg border border-border/30 bg-muted/20 px-3 py-2 text-xs">
            <input v-model="form.allowLocalhost" type="checkbox" class="h-3.5 w-3.5">
            允许 localhost
          </label>
          <label class="flex min-h-10 items-center gap-2 rounded-lg border border-border/30 bg-muted/20 px-3 py-2 text-xs">
            <input v-model="form.allowPrivateIP" type="checkbox" class="h-3.5 w-3.5">
            允许私网地址
          </label>
        </div>

        <div class="space-y-3 rounded-xl border border-border/30 bg-muted/15 p-3">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-xs font-medium">Gateway 策略</div>
              <p class="mt-1 text-[11px] text-muted-foreground">
                随 Profile 应用到 chat / compact / prompt optimize，控制 fallback、路由偏好和限流。
              </p>
            </div>
            <label class="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <input v-model="form.fallbackEnabled" type="checkbox" class="h-3.5 w-3.5">
              启用 fallback
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-3">
            <div class="space-y-1.5">
              <Label class="text-xs">路由策略</Label>
              <Select :model-value="form.routingStrategy" @update:model-value="(value: unknown) => form.routingStrategy = String(value) as 'default' | 'cost' | 'speed' | 'capability'">
                <SelectTrigger class="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">默认策略</SelectItem>
                  <SelectItem value="cost">成本优先</SelectItem>
                  <SelectItem value="speed">速度优先</SelectItem>
                  <SelectItem value="capability">能力优先</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1.5 md:col-span-2">
              <div class="flex items-center justify-between gap-2">
                <Label class="text-xs">允许 fallback Provider</Label>
                <button
                  v-if="selectedFallbackProviderIds.length"
                  type="button"
                  class="text-[11px] text-muted-foreground hover:text-foreground"
                  @click="clearFallbackProviders"
                >
                  清空，改为自动选择
                </button>
              </div>
              <div class="rounded-lg border border-border/30 bg-background/35 p-2">
                <div v-if="fallbackProviderOptions.length" class="grid gap-2 md:grid-cols-2">
                  <label
                    v-for="provider in fallbackProviderOptions"
                    :key="provider.id"
                    class="flex min-h-9 items-center gap-2 rounded-md border border-border/20 bg-muted/15 px-2.5 py-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      class="h-3.5 w-3.5"
                      :checked="selectedFallbackProviderIds.includes(provider.id)"
                      @change="toggleFallbackProvider(provider.id, ($event.target as HTMLInputElement).checked)"
                    >
                    <span class="min-w-0 flex-1 truncate">{{ provider.name }}</span>
                    <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{{ provider.id }}</span>
                  </label>
                </div>
                <div v-else class="text-[11px] text-muted-foreground">
                  暂无可选备用 Provider；留空时 Gateway 会尝试同 Provider 降级模型。
                </div>
                <div v-if="unknownFallbackProviderIds.length" class="mt-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                  未找到的 Provider ID：{{ unknownFallbackProviderIds.join(', ') }}。保存后预览会继续提示，请检查团队共享配置。
                </div>
                <Input
                  v-model="form.fallbackProviderIdsText"
                  class="mt-2 h-8 text-xs font-mono"
                  placeholder="高级：手动填写 Provider ID，多个用英文逗号分隔；留空表示自动选择"
                />
                <div v-if="gatewayPolicyIssues.length" class="mt-2 space-y-1.5">
                  <div
                    v-for="issue in gatewayPolicyIssues"
                    :key="issue.key"
                    class="rounded border px-2 py-1.5 text-[11px]"
                    :class="issue.level === 'danger' ? 'border-destructive/30 bg-destructive/5 text-destructive' : issue.level === 'warning' ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300' : 'border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300'"
                  >
                    {{ issue.message }}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <label class="flex min-h-10 items-center gap-2 rounded-lg border border-border/30 bg-background/40 px-3 py-2 text-xs">
            <input v-model="form.rateLimitEnabled" type="checkbox" class="h-3.5 w-3.5">
            启用 Profile 限流覆盖
          </label>
          <div v-if="form.rateLimitEnabled" class="grid gap-3 md:grid-cols-2">
            <div class="space-y-1.5">
              <Label class="text-xs">窗口毫秒</Label>
              <Input v-model.number="form.rateLimitWindowMs" type="number" min="1000" class="h-9 text-sm" />
            </div>
            <div class="space-y-1.5">
              <Label class="text-xs">窗口内最大请求数</Label>
              <Input v-model.number="form.rateLimitMaxRequests" type="number" min="1" class="h-9 text-sm" />
            </div>
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-3">
          <div class="space-y-1.5">
            <Label class="text-xs">Dispatcher 并发</Label>
            <Input v-model.number="form.dispatcherMaxParallel" type="number" min="1" class="h-9 text-sm" />
          </div>
          <div class="space-y-1.5">
            <Label class="text-xs">自动重试</Label>
            <Input v-model.number="form.dispatcherAutoRetryCount" type="number" min="0" class="h-9 text-sm" />
          </div>
          <div class="space-y-1.5">
            <Label class="text-xs">执行模式</Label>
            <Select :model-value="form.dispatcherDefaultMode" @update:model-value="(value: unknown) => form.dispatcherDefaultMode = String(value) as 'headless' | 'tab'">
              <SelectTrigger class="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="headless">Headless</SelectItem>
                <SelectItem value="tab">新建 Tab</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div class="space-y-1.5">
          <Label class="text-xs">Workspace Prompt</Label>
          <textarea
            v-model="form.systemPromptExtra"
            rows="3"
            class="w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary/50"
            placeholder="项目级提示词，会随 Profile 一起应用"
          />
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Button size="sm" class="h-8 gap-1.5 text-xs" :disabled="!form.providerId || !form.modelId" @click="saveProfile">
            <Save class="h-3.5 w-3.5" />
            保存 Profile
          </Button>
          <Button variant="outline" size="sm" class="h-8 gap-1.5 text-xs" :disabled="!selectedProfile" @click="previewOpen = true">
            <Eye class="h-3.5 w-3.5" />
            预览
          </Button>
          <Button variant="outline" size="sm" class="h-8 gap-1.5 text-xs" :disabled="!selectedProfile" @click="applyProfile">
            <Check class="h-3.5 w-3.5" />
            应用
          </Button>
          <Button variant="outline" size="sm" class="h-8 gap-1.5 text-xs" :disabled="!selectedProfile" @click="backupProfile">
            <Archive class="h-3.5 w-3.5" />
            备份
          </Button>
          <Button variant="outline" size="sm" class="h-8 gap-1.5 text-xs" :disabled="profileBackups.length === 0" @click="rollbackOpen = true">
            <RotateCcw class="h-3.5 w-3.5" />
            回滚
          </Button>
          <Button variant="outline" size="sm" class="h-8 gap-1.5 text-xs" :disabled="store.profiles.length === 0" @click="exportProfiles">
            <Download class="h-3.5 w-3.5" />
            导出
          </Button>
          <Button variant="outline" size="sm" class="h-8 gap-1.5 text-xs" @click="importOpen = true">
            <Upload class="h-3.5 w-3.5" />
            导入
          </Button>
          <Button variant="ghost" size="sm" class="h-8 gap-1.5 text-xs text-destructive" :disabled="!selectedProfile" @click="removeProfile">
            <Trash2 class="h-3.5 w-3.5" />
            删除
          </Button>
          <span v-if="message" class="text-xs text-muted-foreground">{{ message }}</span>
        </div>
      </div>
    </div>

    <Dialog :open="previewOpen" @update:open="previewOpen = $event">
      <DialogContent class="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Profile 应用预览</DialogTitle>
          <DialogDescription>
            应用前检查 Provider、Model、Workspace Prompt 与安全策略变化。
          </DialogDescription>
        </DialogHeader>
        <div v-if="preview" class="max-h-[60vh] space-y-4 overflow-auto pr-1 text-xs">
          <div class="rounded-lg border border-border/40 bg-muted/20 p-3">
            <div class="font-medium">{{ preview.profileName }}</div>
            <div class="mt-1 text-muted-foreground">{{ preview.providerName }} / {{ preview.modelName }} / {{ preview.outputStyleName || '未绑定 Output Style' }}</div>
          </div>
          <div v-if="preview.warnings.length" class="space-y-1">
            <div v-for="warning in preview.warnings" :key="warning.key" class="rounded border px-3 py-2" :class="warning.level === 'danger' ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'">
              {{ warning.message }}
            </div>
          </div>
          <div class="space-y-2">
            <div class="font-medium">Workspace 变化</div>
            <div v-for="item in preview.workspaceChanges.filter(change => change.changed)" :key="String(item.key)" class="rounded border border-border/30 p-2">
              <div class="font-medium">{{ item.label }}</div>
              <div class="mt-1 text-muted-foreground">当前：{{ item.before }}</div>
              <div class="text-foreground">应用后：{{ item.after }}</div>
            </div>
          </div>
          <div class="space-y-2">
            <div class="font-medium">安全策略变化</div>
            <div v-for="item in preview.securityChanges.filter(change => change.changed)" :key="item.key" class="rounded border border-border/30 p-2">
              <div class="font-medium">{{ item.label }}</div>
              <div class="mt-1 text-muted-foreground">当前：{{ item.before }}</div>
              <div class="text-foreground">应用后：{{ item.after }}</div>
            </div>
          </div>
          <div class="space-y-2">
            <div class="font-medium">Gateway 策略变化</div>
            <div v-for="item in preview.gatewayPolicyChanges.filter(change => change.changed)" :key="item.key" class="rounded border border-border/30 p-2">
              <div class="font-medium">{{ item.label }}</div>
              <div class="mt-1 text-muted-foreground">当前：{{ item.before }}</div>
              <div class="text-foreground">应用后：{{ item.after }}</div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="previewOpen = false">关闭</Button>
          <Button :disabled="!selectedProfile" @click="applyProfileFromPreview">应用 Profile</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="rollbackOpen" @update:open="rollbackOpen = $event">
      <DialogContent class="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>回滚 Profile</DialogTitle>
          <DialogDescription>选择一个备份快照恢复，会自动为当前版本再创建一份回滚前备份。</DialogDescription>
        </DialogHeader>
        <div class="max-h-[50vh] space-y-2 overflow-auto">
          <button
            v-for="backup in profileBackups"
            :key="backup.id"
            class="w-full rounded-lg border border-border/30 px-3 py-2 text-left text-xs hover:bg-muted/40"
            @click="rollbackProfile(backup.id)"
          >
            <div class="font-medium">{{ new Date(backup.createdAt).toLocaleString() }} · {{ backup.reason }}</div>
            <div class="mt-1 text-muted-foreground">{{ backup.snapshot.name }} / {{ backup.snapshot.modelId }}</div>
          </button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog :open="importOpen" @update:open="importOpen = $event">
      <DialogContent class="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>导入 Profile JSON</DialogTitle>
          <DialogDescription>粘贴从其他工作区导出的 Provider Profile Bundle。不会包含 API Key。</DialogDescription>
        </DialogHeader>
        <textarea
          v-model="importText"
          rows="12"
          class="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary/50"
          placeholder="{ profiles: [], backups: [] }"
        />
        <DialogFooter>
          <Button variant="outline" @click="importOpen = false">取消</Button>
          <Button :disabled="!importText.trim()" @click="importProfiles">确认导入</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
</template>
