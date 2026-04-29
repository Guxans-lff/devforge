<script setup lang="ts">
/**
 * AI Provider 配置管理组件
 *
 * 在 AI 模块内提供 Provider 的新增、编辑、删除功能。
 * 支持预设常用 Provider 和自定义配置，品牌卡片式设计。
 */
import { ref, computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAiChatStore } from '@/stores/ai-chat'
import { saveCredential } from '@/api/connection'
import type { ProviderConfig, ModelConfig, ProviderType, ThinkingEffort, WorkspaceConfig } from '@/types/ai'
import AiProviderProfileBundlePanel from '@/components/ai/AiProviderProfileBundlePanel.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
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
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Star,
  Eye,
  EyeOff,
  X,
  Check,
  Cpu,
  Zap,
  Globe,
  Wrench,
  Brain,
  ImageIcon,
  Shield,
} from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  currentProviderId?: string | null
  currentModelId?: string | null
}>(), {
  currentProviderId: null,
  currentModelId: null,
})

const emit = defineEmits<{
  back: []
  applyProfile: [payload: {
    workspaceConfig: WorkspaceConfig
    providerConfig?: ProviderConfig
    selectedProviderId: string
    selectedModelId: string
    outputStyleId?: string
  }]
}>()

const store = useAiChatStore()
const { t } = useI18n()
const THINKING_EFFORTS: ThinkingEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const DISPATCHER_MODES: Array<'headless' | 'tab'> = ['headless', 'tab']

// ─────────────────────── 预设 Provider 模板 ───────────────────────

interface ProviderPreset {
  name: string
  providerType: ProviderType
  endpoint: string
  /** 品牌色（Tailwind class） */
  brandColor: string
  /** 品牌色背景 */
  brandBg: string
  /** 品牌标识首字母 */
  brandInitial: string
  /** 简短描述 */
  description: string
  models: ModelConfig[]
}

const PRESETS: Record<string, ProviderPreset> = {
  deepseek: {
    name: 'DeepSeek',
    providerType: 'openai_compat',
    endpoint: 'https://api.deepseek.com',
    brandColor: 'text-blue-600 dark:text-blue-400',
    brandBg: 'bg-blue-500/10',
    brandInitial: 'D',
    description: '国产顶尖推理模型',
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek V3',
        capabilities: {
          streaming: true, vision: false, thinking: false, toolUse: true,
          maxContext: 65536, maxOutput: 8192,
          pricing: { inputPer1m: 0.27, outputPer1m: 1.10, currency: 'CNY' },
        },
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek R1',
        capabilities: {
          streaming: true, vision: false, thinking: true, toolUse: false,
          maxContext: 65536, maxOutput: 8192,
          pricing: { inputPer1m: 0.55, outputPer1m: 2.19, currency: 'CNY' },
        },
      },
    ],
  },
  zhipu: {
    name: '智谱 AI',
    providerType: 'openai_compat',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    brandColor: 'text-emerald-600 dark:text-emerald-400',
    brandBg: 'bg-emerald-500/10',
    brandInitial: '智',
    description: '清华 GLM 系列模型',
    models: [
      {
        id: 'glm-4-plus',
        name: 'GLM-4 Plus',
        capabilities: {
          streaming: true, vision: false, thinking: false, toolUse: true,
          maxContext: 128000, maxOutput: 4096,
          pricing: { inputPer1m: 50, outputPer1m: 50, currency: 'CNY' },
        },
      },
      {
        id: 'glm-4v-plus',
        name: 'GLM-4V Plus',
        capabilities: {
          streaming: true, vision: true, thinking: false, toolUse: false,
          maxContext: 8192, maxOutput: 1024,
          pricing: { inputPer1m: 10, outputPer1m: 10, currency: 'CNY' },
        },
      },
    ],
  },
  openai: {
    name: 'OpenAI',
    providerType: 'openai_compat',
    endpoint: 'https://api.openai.com/v1',
    brandColor: 'text-green-600 dark:text-green-400',
    brandBg: 'bg-green-500/10',
    brandInitial: 'O',
    description: 'GPT-5 系列旗舰模型',
    models: [
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        capabilities: {
          streaming: true, vision: true, thinking: true, toolUse: true,
          maxContext: 1050000, maxOutput: 128000,
          pricing: { inputPer1m: 2.5, outputPer1m: 10, currency: 'USD' },
        },
      },
      {
        id: 'gpt-5.4-mini',
        name: 'GPT-5.4 Mini',
        capabilities: {
          streaming: true, vision: true, thinking: true, toolUse: true,
          maxContext: 400000, maxOutput: 128000,
          pricing: { inputPer1m: 0.3, outputPer1m: 1.2, currency: 'USD' },
        },
      },
      {
        id: 'gpt-5.4-nano',
        name: 'GPT-5.4 Nano',
        capabilities: {
          streaming: true, vision: true, thinking: false, toolUse: true,
          maxContext: 400000, maxOutput: 128000,
          pricing: { inputPer1m: 0.1, outputPer1m: 0.4, currency: 'USD' },
        },
      },
    ],
  },
  anthropic: {
    name: 'Anthropic',
    providerType: 'anthropic',
    endpoint: 'https://api.anthropic.com',
    brandColor: 'text-amber-600 dark:text-amber-400',
    brandBg: 'bg-amber-500/10',
    brandInitial: 'A',
    description: 'Claude 4.6 系列最新模型',
    models: [
      {
        id: 'claude-opus-4-7',
        name: 'Claude Opus 4.7',
        thinkingEffort: 'high',
        capabilities: {
          streaming: true, vision: true, thinking: true, toolUse: true,
          maxContext: 1000000, maxOutput: 32000,
          pricing: { inputPer1m: 15, outputPer1m: 75, currency: 'USD' },
        },
      },
      {
        id: 'claude-opus-4-6',
        name: 'Claude Opus 4.6',
        thinkingEffort: 'high',
        capabilities: {
          streaming: true, vision: true, thinking: true, toolUse: true,
          maxContext: 1000000, maxOutput: 32000,
          pricing: { inputPer1m: 15, outputPer1m: 75, currency: 'USD' },
        },
      },
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        thinkingEffort: 'high',
        capabilities: {
          streaming: true, vision: true, thinking: true, toolUse: true,
          maxContext: 200000, maxOutput: 16384,
          pricing: { inputPer1m: 3, outputPer1m: 15, currency: 'USD' },
        },
      },
      {
        id: 'claude-haiku-4-5-20251001',
        name: 'Claude Haiku 4.5',
        capabilities: {
          streaming: true, vision: true, thinking: false, toolUse: true,
          maxContext: 200000, maxOutput: 8192,
          pricing: { inputPer1m: 0.8, outputPer1m: 4, currency: 'USD' },
        },
      },
    ],
  },
  moonshot: {
    name: 'Moonshot',
    providerType: 'openai_compat',
    endpoint: 'https://api.moonshot.cn/v1',
    brandColor: 'text-purple-600 dark:text-purple-400',
    brandBg: 'bg-purple-500/10',
    brandInitial: 'M',
    description: 'Kimi 系列长上下文模型',
    models: [
      {
        id: 'moonshot-v1-32k',
        name: 'Moonshot V1 32K',
        capabilities: {
          streaming: true, vision: false, thinking: false, toolUse: true,
          maxContext: 32000, maxOutput: 4096,
          pricing: { inputPer1m: 24, outputPer1m: 24, currency: 'CNY' },
        },
      },
      {
        id: 'moonshot-v1-128k',
        name: 'Moonshot V1 128K',
        capabilities: {
          streaming: true, vision: false, thinking: false, toolUse: true,
          maxContext: 128000, maxOutput: 4096,
          pricing: { inputPer1m: 60, outputPer1m: 60, currency: 'CNY' },
        },
      },
    ],
  },
  custom: {
    name: '',
    providerType: 'openai_compat',
    endpoint: '',
    brandColor: 'text-slate-600 dark:text-slate-400',
    brandBg: 'bg-slate-500/10',
    brandInitial: '+',
    description: '任意 OpenAI 兼容端点',
    models: [],
  },
}

/** 判断某个预设是否已被添加 */
function isPresetAdded(presetKey: string): boolean {
  const preset = PRESETS[presetKey]
  if (!preset || presetKey === 'custom') return false
  return store.providers.some(p => p.endpoint === preset.endpoint)
}

// ─────────────────────── 编辑状态 ───────────────────────

const showEditDialog = ref(false)
const editMode = ref<'create' | 'edit'>('create')
const editingId = ref<string | null>(null)

/** 表单数据 */
const form = reactive({
  name: '',
  providerType: 'openai_compat' as ProviderType,
  endpoint: '',
  apiKey: '',
  isDefault: false,
  models: [] as ModelConfig[],
})

/** API Key 是否可见 */
const showApiKey = ref(false)

/** 保存中状态 */
const saving = ref(false)

/** 保存错误提示 */
const saveError = ref<string | null>(null)

/** 删除确认 */
const deleteConfirm = ref<string | null>(null)
const workspaceSaving = ref(false)
const workspaceSaveError = ref<string | null>(null)

const workspaceDispatcher = reactive({
  maxParallel: 3,
  autoRetryCount: 1,
  defaultMode: 'headless' as 'headless' | 'tab',
})

const currentWorkDir = computed(() => store.currentWorkDir)
const hasCurrentWorkDir = computed(() => !!currentWorkDir.value)

watch(
  () => store.currentWorkspaceConfig,
  (config) => {
    workspaceDispatcher.maxParallel = Math.max(1, config?.dispatcherMaxParallel ?? 3)
    workspaceDispatcher.autoRetryCount = Math.max(0, config?.dispatcherAutoRetryCount ?? 1)
    workspaceDispatcher.defaultMode = config?.dispatcherDefaultMode ?? 'headless'
    workspaceSaveError.value = null
  },
  { immediate: true, deep: true },
)

// ─────────────────────── 模型编辑 ───────────────────────

const showModelDialog = ref(false)
const editingModelIndex = ref<number>(-1)
const modelForm = reactive({
  id: '',
  name: '',
  streaming: true,
  vision: false,
  thinking: false,
  thinkingEffort: 'high' as ThinkingEffort,
  toolUse: false,
  maxContext: 200000,
  maxOutput: 16384,
  pricingEnabled: false,
  inputPer1m: 0,
  outputPer1m: 0,
  currency: 'CNY',
})

// ─────────────────────── 操作 ───────────────────────

/** 从预设创建 */
function createFromPreset(presetKey: string) {
  const preset = PRESETS[presetKey]
  if (!preset) return

  editMode.value = 'create'
  editingId.value = null
  form.name = preset.name
  form.providerType = preset.providerType
  form.endpoint = preset.endpoint
  form.apiKey = ''
  form.isDefault = store.providers.length === 0
  form.models = JSON.parse(JSON.stringify(preset.models))
  showApiKey.value = false
  saveError.value = null
  showEditDialog.value = true
}

/** 编辑已有 Provider */
function editProvider(provider: ProviderConfig) {
  editMode.value = 'edit'
  editingId.value = provider.id
  form.name = provider.name
  form.providerType = provider.providerType
  form.endpoint = provider.endpoint
  form.apiKey = ''
  form.isDefault = provider.isDefault
  form.models = JSON.parse(JSON.stringify(provider.models))
  showApiKey.value = false
  saveError.value = null
  showEditDialog.value = true
}

/** 保存 Provider */
async function handleSave() {
  if (!form.name.trim() || !form.endpoint.trim()) return

  saving.value = true
  saveError.value = null

  try {
    const config: ProviderConfig = {
      id: editingId.value ?? `provider-${Date.now()}`,
      name: form.name.trim(),
      providerType: form.providerType,
      endpoint: form.endpoint.trim(),
      models: form.models,
      isDefault: form.isDefault,
      createdAt: Date.now(),
    }

    await store.saveProvider(config)

    // API Key 保存到系统密钥环
    if (form.apiKey.trim()) {
      await saveCredential(`ai-provider-${config.id}`, form.apiKey.trim())
    }

    showEditDialog.value = false
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

/** 删除 Provider */
async function handleDelete(id: string) {
  await store.removeProvider(id)
  deleteConfirm.value = null
}

async function handleSaveWorkspaceDispatcher(): Promise<void> {
  if (!currentWorkDir.value) return

  workspaceSaving.value = true
  workspaceSaveError.value = null

  try {
    const nextConfig: WorkspaceConfig = {
      ...(store.currentWorkspaceConfig ?? {}),
      dispatcherMaxParallel: Math.max(1, Math.trunc(workspaceDispatcher.maxParallel || 1)),
      dispatcherAutoRetryCount: Math.max(0, Math.trunc(workspaceDispatcher.autoRetryCount || 0)),
      dispatcherDefaultMode: workspaceDispatcher.defaultMode,
    }
    await store.saveWorkspaceConfig(currentWorkDir.value, nextConfig)
  } catch (error) {
    workspaceSaveError.value = error instanceof Error ? error.message : String(error)
  } finally {
    workspaceSaving.value = false
  }
}

async function handleApplyProfile(payload: {
  workspaceConfig: WorkspaceConfig
  providerConfig?: ProviderConfig
  selectedProviderId: string
  selectedModelId: string
  outputStyleId?: string
}): Promise<void> {
  if (payload.providerConfig) {
    await store.saveProvider(payload.providerConfig)
  }
  if (currentWorkDir.value) {
    await store.saveWorkspaceConfig(currentWorkDir.value, payload.workspaceConfig)
  }
  emit('applyProfile', payload)
}

/** 设为默认 */
async function setDefault(provider: ProviderConfig) {
  for (const p of store.providers) {
    if (p.isDefault && p.id !== provider.id) {
      await store.saveProvider({ ...p, isDefault: false })
    }
  }
  await store.saveProvider({ ...provider, isDefault: true })
}

/** 获取 Provider 对应的品牌配置（先匹配名称，再匹配 endpoint） */
function getProviderBrand(provider: ProviderConfig) {
  const nameLower = provider.name.toLowerCase()
  // 按名称关键词匹配
  const nameMap: Record<string, string> = {
    openai: 'openai', gpt: 'openai',
    anthropic: 'anthropic', claude: 'anthropic',
    deepseek: 'deepseek',
    zhipu: 'zhipu', '智谱': 'zhipu', '智普': 'zhipu', glm: 'zhipu',
    moonshot: 'moonshot', kimi: 'moonshot',
  }
  for (const [keyword, presetKey] of Object.entries(nameMap)) {
    if (nameLower.includes(keyword)) {
      return PRESETS[presetKey]!
    }
  }
  // 再按 endpoint 域名匹配
  for (const [, preset] of Object.entries(PRESETS)) {
    try {
      if (preset.endpoint && provider.endpoint.includes(new URL(preset.endpoint).hostname)) {
        return preset
      }
    } catch {
      // 无效 URL，跳过
    }
  }
  return PRESETS.custom!
}

function getProviderBrandClasses(provider: ProviderConfig) {
  const brand = getProviderBrand(provider)
  return {
    brandBg: brand.brandBg,
    brandColor: brand.brandColor,
    brandInitial: brand.brandInitial,
  }
}

function getProviderTypeLabel(providerType: ProviderType) {
  return providerType === 'anthropic'
    ? t('ai.providerConfig.providerTypes.anthropic')
    : t('ai.providerConfig.providerTypes.openaiCompat')
}

function getPresetTitle(presetKey: string, preset: ProviderPreset) {
  if (presetKey === 'custom') {
    return t('ai.providerConfig.presets.custom.name')
  }
  if (presetKey === 'zhipu') {
    return t('ai.providerConfig.presets.zhipu.name')
  }
  return preset.name
}

function getPresetDescription(presetKey: string) {
  return t(`ai.providerConfig.presets.${presetKey}.description`)
}

// ─────────────────────── 模型管理 ───────────────────────

function openAddModel() {
  editingModelIndex.value = -1
  modelForm.id = ''
  modelForm.name = ''
  modelForm.streaming = true
  modelForm.vision = false
  modelForm.thinking = false
  modelForm.thinkingEffort = 'high'
  modelForm.toolUse = false
  modelForm.maxContext = 200000
  modelForm.maxOutput = 16384
  modelForm.pricingEnabled = false
  modelForm.inputPer1m = 0
  modelForm.outputPer1m = 0
  modelForm.currency = 'CNY'
  showModelDialog.value = true
}

function openEditModel(index: number) {
  const m = form.models[index]
  if (!m) return
  editingModelIndex.value = index
  modelForm.id = m.id
  modelForm.name = m.name
  modelForm.streaming = m.capabilities.streaming
  modelForm.vision = m.capabilities.vision
  modelForm.thinking = m.capabilities.thinking
  modelForm.thinkingEffort = m.thinkingEffort ?? 'high'
  modelForm.toolUse = m.capabilities.toolUse
  modelForm.maxContext = m.capabilities.maxContext
  modelForm.maxOutput = m.capabilities.maxOutput
  modelForm.pricingEnabled = !!m.capabilities.pricing
  modelForm.inputPer1m = m.capabilities.pricing?.inputPer1m ?? 0
  modelForm.outputPer1m = m.capabilities.pricing?.outputPer1m ?? 0
  modelForm.currency = m.capabilities.pricing?.currency ?? 'CNY'
  showModelDialog.value = true
}

function saveModel() {
  if (!modelForm.id.trim() || !modelForm.name.trim()) return

  const model: ModelConfig = {
    id: modelForm.id.trim(),
    name: modelForm.name.trim(),
    thinkingEffort: modelForm.thinking ? modelForm.thinkingEffort : undefined,
    capabilities: {
      streaming: modelForm.streaming,
      vision: modelForm.vision,
      thinking: modelForm.thinking,
      toolUse: modelForm.toolUse,
      maxContext: modelForm.maxContext,
      maxOutput: modelForm.maxOutput,
      pricing: modelForm.pricingEnabled ? {
        inputPer1m: modelForm.inputPer1m,
        outputPer1m: modelForm.outputPer1m,
        currency: modelForm.currency,
      } : undefined,
    },
  }

  if (editingModelIndex.value >= 0) {
    form.models = form.models.map((m, i) => i === editingModelIndex.value ? model : m)
  } else {
    form.models = [...form.models, model]
  }
  showModelDialog.value = false
}

function removeModel(index: number) {
  form.models = form.models.filter((_, i) => i !== index)
}

/** 表单是否可保存 */
const canSave = computed(() =>
  form.name.trim().length > 0 &&
  form.endpoint.trim().length > 0 &&
  form.models.length > 0,
)
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶栏 -->
    <div class="flex items-center gap-3 px-6 py-4 border-b border-border/30">
      <Button variant="ghost" size="icon" class="h-8 w-8" @click="emit('back')">
        <ArrowLeft class="h-4 w-4" />
      </Button>
      <div>
        <h2 class="text-base font-semibold">{{ t('ai.providerConfig.title') }}</h2>
        <p class="text-[11px] text-muted-foreground mt-0.5">{{ t('ai.providerConfig.subtitle') }}</p>
      </div>
    </div>

    <ScrollArea class="flex-1 min-h-0">
      <div class="px-6 py-6 space-y-8 max-w-3xl mx-auto">

        <!-- ==================== 已配置的 Provider ==================== -->
        <section v-if="store.providers.length > 0" class="space-y-3">
          <div class="flex items-center gap-2">
            <div class="h-1 w-1 rounded-full bg-emerald-500" />
            <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{{ t('ai.providerConfig.enabledTitle') }}</h3>
            <span class="text-[10px] text-muted-foreground/60">{{ t('ai.providerConfig.providerCount', { count: store.providers.length }) }}</span>
          </div>

          <div class="space-y-2">
            <div
              v-for="provider in store.providers"
              :key="provider.id"
              class="group relative rounded-xl border border-border/40 bg-card/50 backdrop-blur-sm overflow-hidden transition-all duration-200 hover:border-border hover:shadow-sm"
            >
              <!-- 品牌色条 -->
              <div class="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl" :class="getProviderBrandClasses(provider).brandBg.replace('/10', '')" />

              <div class="flex items-center gap-4 pl-5 pr-4 py-3.5">
                <!-- 品牌图标 -->
                <div class="flex h-10 w-10 items-center justify-center rounded-xl shrink-0 text-sm font-bold" :class="[getProviderBrandClasses(provider).brandBg, getProviderBrandClasses(provider).brandColor]">
                  {{ getProviderBrandClasses(provider).brandInitial }}
                </div>

                <!-- 信息 -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold">{{ provider.name }}</span>
                    <Badge v-if="provider.isDefault" variant="outline" class="h-4 px-1.5 text-[9px] border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5">
                      {{ t('ai.providerConfig.defaultBadge') }}
                    </Badge>
                    <Badge variant="secondary" class="h-4 px-1.5 text-[9px]">
                      {{ getProviderTypeLabel(provider.providerType) }}
                    </Badge>
                  </div>
                  <div class="flex items-center gap-3 mt-1">
                    <span class="text-[11px] text-muted-foreground font-mono truncate">{{ provider.endpoint }}</span>
                    <span class="text-[10px] text-muted-foreground/60">{{ t('ai.providerConfig.modelCount', { count: provider.models.length }) }}</span>
                  </div>
                </div>

                <!-- 操作按钮 -->
                <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <Button
                    v-if="!provider.isDefault"
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8 text-muted-foreground hover:text-amber-500"
                    :title="t('ai.providerConfig.actions.setDefault')"
                    @click="setDefault(provider)"
                  >
                    <Star class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8 text-muted-foreground"
                    :title="t('common.edit')"
                    @click="editProvider(provider)"
                  >
                    <Pencil class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    v-if="deleteConfirm !== provider.id"
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8 text-muted-foreground hover:text-destructive"
                    :title="t('common.delete')"
                    @click="deleteConfirm = provider.id"
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    v-else
                    variant="destructive"
                    size="sm"
                    class="h-8 text-[11px] px-3"
                    @click="handleDelete(provider.id)"
                  >
                    {{ t('ai.providerConfig.actions.confirmDelete') }}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ==================== 添加服务商 — 品牌卡片 ==================== -->
        <section class="space-y-3">
          <div class="flex items-center gap-2">
            <div class="h-1 w-1 rounded-full bg-primary" />
            <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{{ t('ai.providerConfig.addTitle') }}</h3>
          </div>

          <div class="grid grid-cols-3 gap-3">
            <button
              v-for="(preset, key) in PRESETS"
              :key="key"
              class="group relative flex flex-col items-center gap-3 rounded-xl border border-border/30 bg-card/30 p-5 text-center transition-all duration-200 hover:border-primary/30 hover:bg-primary/[0.03] hover:shadow-sm"
              :class="{ 'opacity-50 pointer-events-none': isPresetAdded(key as string) }"
              @click="createFromPreset(key as string)"
            >
              <!-- 已添加标记 -->
              <div
                v-if="isPresetAdded(key as string)"
                class="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10"
              >
                <Check class="h-3 w-3 text-emerald-500" />
              </div>

              <!-- 品牌图标 -->
              <div
                class="flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-bold transition-transform duration-200 group-hover:scale-110"
                :class="[preset.brandBg, preset.brandColor]"
              >
                {{ (key as string) === 'custom' ? '+' : preset.brandInitial }}
              </div>

              <!-- 名称 & 描述 -->
              <div>
                <p class="text-sm font-semibold">
                  {{ getPresetTitle(key as string, preset) }}
                </p>
                <p class="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                  {{ getPresetDescription(key as string) }}
                </p>
              </div>

              <!-- 模型数量 -->
              <div v-if="preset.models.length > 0" class="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                <Cpu class="h-3 w-3" />
                {{ t('ai.providerConfig.presetModelCount', { count: preset.models.length }) }}
              </div>
            </button>
          </div>
        </section>

        <AiProviderProfileBundlePanel
          :providers="store.providers"
          :current-workspace-config="store.currentWorkspaceConfig"
          :current-provider-id="props.currentProviderId ?? store.defaultProvider?.id"
          :current-model-id="props.currentModelId ?? store.currentWorkspaceConfig?.preferredModel"
          @apply="handleApplyProfile"
        />

        <section class="space-y-4 rounded-xl border border-border/40 bg-card/40 p-5">
          <div class="flex items-start justify-between gap-4">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <div class="h-1 w-1 rounded-full bg-cyan-500" />
                <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {{ t('ai.providerConfig.workspaceDispatcher.title') }}
                </h3>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ t('ai.providerConfig.workspaceDispatcher.description') }}
              </p>
              <p class="max-w-[560px] truncate text-[11px] text-muted-foreground/70">
                {{ currentWorkDir || t('ai.providerConfig.workspaceDispatcher.emptyWorkdir') }}
              </p>
            </div>
          </div>

          <div class="grid gap-4 sm:grid-cols-3">
            <div class="space-y-2">
              <Label class="text-xs">{{ t('ai.providerConfig.workspaceDispatcher.fields.maxParallel') }}</Label>
              <Input
                v-model.number="workspaceDispatcher.maxParallel"
                type="number"
                min="1"
                step="1"
                class="h-10 text-sm"
                :disabled="!hasCurrentWorkDir || workspaceSaving"
              />
            </div>
            <div class="space-y-2">
              <Label class="text-xs">{{ t('ai.providerConfig.workspaceDispatcher.fields.autoRetryCount') }}</Label>
              <Input
                v-model.number="workspaceDispatcher.autoRetryCount"
                type="number"
                min="0"
                step="1"
                class="h-10 text-sm"
                :disabled="!hasCurrentWorkDir || workspaceSaving"
              />
            </div>
            <div class="space-y-2">
              <Label class="text-xs">{{ t('ai.providerConfig.workspaceDispatcher.fields.defaultMode') }}</Label>
              <Select
                :model-value="workspaceDispatcher.defaultMode"
                :disabled="!hasCurrentWorkDir || workspaceSaving"
                @update:model-value="(v: unknown) => workspaceDispatcher.defaultMode = String(v) as 'headless' | 'tab'"
              >
                <SelectTrigger class="h-10 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="mode in DISPATCHER_MODES"
                    :key="mode"
                    :value="mode"
                  >
                    {{ t(`ai.providerConfig.workspaceDispatcher.modes.${mode}`) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div class="flex items-center justify-between gap-3">
            <p class="text-[11px] text-muted-foreground">
              {{ t('ai.providerConfig.workspaceDispatcher.hint') }}
            </p>
            <Button
              size="sm"
              class="h-9 min-w-[96px]"
              :disabled="!hasCurrentWorkDir || workspaceSaving"
              @click="handleSaveWorkspaceDispatcher"
            >
              {{ workspaceSaving ? t('ai.providerConfig.workspaceDispatcher.saving') : t('ai.providerConfig.workspaceDispatcher.save') }}
            </Button>
          </div>
          <p v-if="workspaceSaveError" class="text-xs text-destructive">
            {{ workspaceSaveError }}
          </p>
        </section>
      </div>
    </ScrollArea>

    <!-- ==================== 编辑 Provider 对话框 ==================== -->
    <Dialog :open="showEditDialog" @update:open="showEditDialog = $event">
      <DialogContent class="sm:max-w-[640px] gap-0 p-0">
        <DialogHeader class="px-7 pt-6 pb-5 border-b border-border/20">
          <DialogTitle class="text-base">{{ editMode === 'create' ? t('ai.providerConfig.dialog.addProviderTitle') : t('ai.providerConfig.dialog.editProviderTitle') }}</DialogTitle>
          <DialogDescription class="text-xs mt-1.5">{{ t('ai.providerConfig.dialog.providerDescription') }}</DialogDescription>
        </DialogHeader>

        <ScrollArea class="max-h-[65vh]">
          <div class="px-7 py-6 space-y-7">
            <!-- 基本信息 -->
            <div class="space-y-4">
              <div class="flex items-center gap-2.5 text-xs font-semibold text-foreground/70">
                <div class="flex h-6 w-6 items-center justify-center rounded-md bg-primary/8">
                  <Globe class="h-3.5 w-3.5 text-primary/70" />
                </div>
                {{ t('ai.providerConfig.sections.connection') }}
              </div>
              <div class="grid grid-cols-2 gap-4 pl-8">
                <div class="space-y-2">
                  <Label class="text-xs">{{ t('ai.providerConfig.fields.providerName') }}</Label>
                  <Input v-model="form.name" :placeholder="t('ai.providerConfig.placeholders.providerName')" class="h-10 text-sm" />
                </div>
                <div class="space-y-2">
                  <Label class="text-xs">{{ t('ai.providerConfig.fields.providerType') }}</Label>
                  <Select
                    :model-value="form.providerType"
                    @update:model-value="(v: unknown) => form.providerType = String(v) as ProviderType"
                  >
                    <SelectTrigger class="h-10 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai_compat">{{ t('ai.providerConfig.providerTypes.openaiCompat') }}</SelectItem>
                      <SelectItem value="anthropic">{{ t('ai.providerConfig.providerTypes.anthropic') }}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div class="space-y-2 pl-8">
                <Label class="text-xs">{{ t('ai.providerConfig.fields.endpoint') }}</Label>
                <Input v-model="form.endpoint" placeholder="https://api.example.com/v1" class="h-10 text-sm font-mono" />
              </div>
            </div>

            <!-- 认证 -->
            <div class="space-y-4">
              <div class="flex items-center gap-2.5 text-xs font-semibold text-foreground/70">
                <div class="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/8">
                  <Shield class="h-3.5 w-3.5 text-amber-600/70 dark:text-amber-400/70" />
                </div>
                {{ t('ai.providerConfig.sections.auth') }}
              </div>
              <div class="space-y-2 pl-8">
                <Label class="text-xs">API Key</Label>
                <div class="relative">
                  <Input
                    v-model="form.apiKey"
                    :type="showApiKey ? 'text' : 'password'"
                    placeholder="sk-..."
                    class="h-10 text-sm font-mono pr-10"
                  />
                  <button
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    @click="showApiKey = !showApiKey"
                  >
                    <component :is="showApiKey ? EyeOff : Eye" class="h-4 w-4" />
                  </button>
                </div>
                <p class="text-[11px] text-muted-foreground mt-1">
                  {{ editMode === 'edit' ? t('ai.providerConfig.apiKeyKeepHint') : t('ai.providerConfig.apiKeySaveHint') }}
                </p>
              </div>

              <div class="flex items-center gap-3 pl-8 pt-1">
                <Switch v-model="form.isDefault" />
                <Label class="text-xs cursor-pointer" @click="form.isDefault = !form.isDefault">
                  {{ t('ai.providerConfig.fields.setDefault') }}
                </Label>
              </div>
            </div>

            <!-- 模型列表 -->
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2.5 text-xs font-semibold text-foreground/70">
                  <div class="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/8">
                    <Cpu class="h-3.5 w-3.5 text-emerald-600/70 dark:text-emerald-400/70" />
                  </div>
                  {{ t('ai.providerConfig.sections.models') }}
                  <span class="text-[10px] text-muted-foreground/50">({{ form.models.length }})</span>
                </div>
                <Button variant="outline" size="sm" class="h-8 text-xs gap-1.5" @click="openAddModel">
                  <Plus class="h-3.5 w-3.5" />
                  {{ t('ai.providerConfig.actions.addModel') }}
                </Button>
              </div>

              <div v-if="form.models.length === 0" class="ml-8 rounded-lg border border-dashed border-border/40 p-8 text-center">
                <Cpu class="h-7 w-7 text-muted-foreground/20 mx-auto mb-2.5" />
                <p class="text-xs text-muted-foreground">{{ t('ai.providerConfig.emptyModels') }}</p>
              </div>

              <div v-else class="pl-8 space-y-2">
                <div
                  v-for="(model, idx) in form.models"
                  :key="model.id"
                  class="group flex items-center gap-3 rounded-lg border border-border/30 bg-muted/20 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="text-xs font-semibold">{{ model.name }}</span>
                      <code class="text-[10px] text-muted-foreground/60 font-mono">{{ model.id }}</code>
                    </div>
                    <div class="flex items-center gap-1.5 mt-1.5">
                      <Badge v-if="model.capabilities.thinking" variant="outline" class="h-[18px] px-1.5 text-[9px] border-violet-500/20 text-violet-500 bg-violet-500/5">
                        <Brain class="h-2.5 w-2.5 mr-0.5" />
                        {{ t('ai.providerConfig.capabilities.thinking') }}
                      </Badge>
                      <Badge v-if="model.capabilities.vision" variant="outline" class="h-[18px] px-1.5 text-[9px] border-blue-500/20 text-blue-500 bg-blue-500/5">
                        <ImageIcon class="h-2.5 w-2.5 mr-0.5" />
                        {{ t('ai.providerConfig.capabilities.vision') }}
                      </Badge>
                      <Badge v-if="model.capabilities.toolUse" variant="outline" class="h-[18px] px-1.5 text-[9px] border-green-500/20 text-green-500 bg-green-500/5">
                        <Wrench class="h-2.5 w-2.5 mr-0.5" />
                        {{ t('ai.providerConfig.capabilities.tools') }}
                      </Badge>
                      <Badge v-if="model.capabilities.streaming" variant="outline" class="h-[18px] px-1.5 text-[9px] border-border/40 text-muted-foreground bg-muted/30">
                        <Zap class="h-2.5 w-2.5 mr-0.5" />
                        {{ t('ai.providerConfig.capabilities.streaming') }}
                      </Badge>
                      <span class="text-[10px] text-muted-foreground/50 ml-1">{{ (model.capabilities.maxContext / 1000).toFixed(0) }}K</span>
                    </div>
                  </div>
                  <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button class="p-1.5 rounded-md hover:bg-muted" @click="openEditModel(idx)">
                      <Pencil class="h-3 w-3 text-muted-foreground" />
                    </button>
                    <button class="p-1.5 rounded-md hover:bg-destructive/10" @click="removeModel(idx)">
                      <X class="h-3 w-3 text-destructive/60" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter class="px-7 py-4 border-t border-border/20">
          <div v-if="saveError" class="mr-auto flex items-center gap-1.5 text-xs text-destructive">
            <X class="h-3 w-3" />
            <span class="truncate max-w-[280px]">{{ saveError }}</span>
          </div>
          <Button variant="outline" size="sm" class="h-9" @click="showEditDialog = false">{{ t('common.cancel') }}</Button>
          <Button size="sm" class="h-9 min-w-[80px]" :disabled="!canSave || saving" @click="handleSave">
            {{ saving ? t('ai.providerConfig.saving') : t('common.save') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- ==================== 编辑模型对话框 ==================== -->
    <Dialog :open="showModelDialog" @update:open="showModelDialog = $event">
      <DialogContent class="sm:max-w-[540px] gap-0 p-0">
        <DialogHeader class="px-7 pt-6 pb-5 border-b border-border/20">
          <DialogTitle class="text-base">{{ editingModelIndex >= 0 ? t('ai.providerConfig.dialog.editModelTitle') : t('ai.providerConfig.dialog.addModelTitle') }}</DialogTitle>
          <DialogDescription class="text-xs mt-1.5">{{ t('ai.providerConfig.dialog.modelDescription') }}</DialogDescription>
        </DialogHeader>

        <div class="px-7 py-6 space-y-6">
          <!-- 基本信息 -->
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label class="text-xs">{{ t('ai.providerConfig.fields.modelId') }}</Label>
              <Input v-model="modelForm.id" placeholder="model-name" class="h-10 text-sm font-mono" />
            </div>
            <div class="space-y-2">
              <Label class="text-xs">{{ t('ai.providerConfig.fields.displayName') }}</Label>
              <Input v-model="modelForm.name" :placeholder="t('ai.providerConfig.placeholders.modelName')" class="h-10 text-sm" />
            </div>
          </div>

          <!-- 模型能力 -->
          <div class="space-y-3.5">
            <Label class="text-xs font-semibold text-foreground/70">{{ t('ai.providerConfig.sections.modelCapabilities') }}</Label>
            <div class="grid grid-cols-2 gap-x-6 gap-y-3.5">
              <label class="flex items-center gap-3 text-sm cursor-pointer">
                <Switch v-model="modelForm.streaming" />
                <span class="flex items-center gap-1.5"><Zap class="h-3.5 w-3.5 text-muted-foreground" /> {{ t('ai.providerConfig.capabilityToggles.streaming') }}</span>
              </label>
              <label class="flex items-center gap-3 text-sm cursor-pointer">
                <Switch v-model="modelForm.vision" />
                <span class="flex items-center gap-1.5"><ImageIcon class="h-3.5 w-3.5 text-muted-foreground" /> {{ t('ai.providerConfig.capabilityToggles.vision') }}</span>
              </label>
              <label class="flex items-center gap-3 text-sm cursor-pointer">
                <Switch v-model="modelForm.thinking" />
                <span class="flex items-center gap-1.5"><Brain class="h-3.5 w-3.5 text-muted-foreground" /> {{ t('ai.providerConfig.capabilityToggles.thinking') }}</span>
              </label>
              <label class="flex items-center gap-3 text-sm cursor-pointer">
                <Switch v-model="modelForm.toolUse" />
                <span class="flex items-center gap-1.5"><Wrench class="h-3.5 w-3.5 text-muted-foreground" /> {{ t('ai.providerConfig.capabilityToggles.tools') }}</span>
              </label>
            </div>
          </div>

          <div v-if="modelForm.thinking" class="space-y-2">
            <Label class="text-xs">{{ t('ai.providerConfig.fields.thinkingEffort') }}</Label>
            <Select
              :model-value="modelForm.thinkingEffort"
              @update:model-value="(v: unknown) => modelForm.thinkingEffort = String(v) as ThinkingEffort"
            >
              <SelectTrigger class="h-10 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="effort in THINKING_EFFORTS"
                  :key="effort"
                  :value="effort"
                >
                  {{ effort }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-[11px] text-muted-foreground">
              {{ t('ai.providerConfig.thinkingEffortHint') }}
            </p>
          </div>

          <!-- 上下文限制 -->
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label class="text-xs">{{ t('ai.providerConfig.fields.maxContext') }}</Label>
              <Input v-model.number="modelForm.maxContext" type="number" class="h-10 text-sm" />
            </div>
            <div class="space-y-2">
              <Label class="text-xs">{{ t('ai.providerConfig.fields.maxOutput') }}</Label>
              <Input v-model.number="modelForm.maxOutput" type="number" class="h-10 text-sm" />
            </div>
          </div>

          <!-- 定价 -->
          <div class="space-y-3.5">
            <label class="flex items-center gap-3 text-sm cursor-pointer">
              <Switch v-model="modelForm.pricingEnabled" />
              {{ t('ai.providerConfig.fields.enablePricing') }}
            </label>
            <div v-if="modelForm.pricingEnabled" class="grid grid-cols-3 gap-3 pl-8">
              <div class="space-y-2">
                <Label class="text-[11px]">{{ t('ai.providerConfig.fields.inputPer1m') }}</Label>
                <Input v-model.number="modelForm.inputPer1m" type="number" step="0.01" class="h-9 text-sm" />
              </div>
              <div class="space-y-2">
                <Label class="text-[11px]">{{ t('ai.providerConfig.fields.outputPer1m') }}</Label>
                <Input v-model.number="modelForm.outputPer1m" type="number" step="0.01" class="h-9 text-sm" />
              </div>
              <div class="space-y-2">
                <Label class="text-[11px]">{{ t('ai.providerConfig.fields.currency') }}</Label>
                <Select
                  :model-value="modelForm.currency"
                  @update:model-value="(v: unknown) => modelForm.currency = String(v)"
                >
                  <SelectTrigger class="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CNY">CNY</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter class="px-7 py-4 border-t border-border/20">
          <Button variant="outline" size="sm" class="h-9" @click="showModelDialog = false">{{ t('common.cancel') }}</Button>
          <Button size="sm" class="h-9 min-w-[80px]" :disabled="!modelForm.id.trim() || !modelForm.name.trim()" @click="saveModel">
            {{ editingModelIndex >= 0 ? t('ai.providerConfig.actions.updateModel') : t('common.add') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
