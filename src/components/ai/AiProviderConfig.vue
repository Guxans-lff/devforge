<script setup lang="ts">
/**
 * AI Provider 配置管理组件
 *
 * 在 AI 模块内提供 Provider 的新增、编辑、删除功能。
 * 支持预设常用 Provider 和自定义配置，品牌卡片式设计。
 */
import { ref, computed, reactive } from 'vue'
import { useAiChatStore } from '@/stores/ai-chat'
import { saveCredential } from '@/api/connection'
import type { ProviderConfig, ModelConfig, ProviderType } from '@/types/ai'
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
  MessageSquare,
  Shield,
} from 'lucide-vue-next'

const emit = defineEmits<{
  back: []
}>()

const store = useAiChatStore()

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
        id: 'claude-opus-4-6',
        name: 'Claude Opus 4.6',
        capabilities: {
          streaming: true, vision: true, thinking: true, toolUse: true,
          maxContext: 1000000, maxOutput: 32000,
          pricing: { inputPer1m: 15, outputPer1m: 75, currency: 'USD' },
        },
      },
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
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

// ─────────────────────── 模型编辑 ───────────────────────

const showModelDialog = ref(false)
const editingModelIndex = ref<number>(-1)
const modelForm = reactive({
  id: '',
  name: '',
  streaming: true,
  vision: false,
  thinking: false,
  toolUse: false,
  maxContext: 128000,
  maxOutput: 4096,
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
  return PRESETS.custom
}

// ─────────────────────── 模型管理 ───────────────────────

function openAddModel() {
  editingModelIndex.value = -1
  modelForm.id = ''
  modelForm.name = ''
  modelForm.streaming = true
  modelForm.vision = false
  modelForm.thinking = false
  modelForm.toolUse = false
  modelForm.maxContext = 128000
  modelForm.maxOutput = 4096
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
        <h2 class="text-base font-semibold">AI 服务商配置</h2>
        <p class="text-[11px] text-muted-foreground mt-0.5">管理 AI 模型服务商的连接和 API 密钥</p>
      </div>
    </div>

    <ScrollArea class="flex-1 min-h-0">
      <div class="px-6 py-6 space-y-8 max-w-3xl mx-auto">

        <!-- ==================== 已配置的 Provider ==================== -->
        <section v-if="store.providers.length > 0" class="space-y-3">
          <div class="flex items-center gap-2">
            <div class="h-1 w-1 rounded-full bg-emerald-500" />
            <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">已启用</h3>
            <span class="text-[10px] text-muted-foreground/60">{{ store.providers.length }} 个服务商</span>
          </div>

          <div class="space-y-2">
            <div
              v-for="provider in store.providers"
              :key="provider.id"
              class="group relative rounded-xl border border-border/40 bg-card/50 backdrop-blur-sm overflow-hidden transition-all duration-200 hover:border-border hover:shadow-sm"
            >
              <!-- 品牌色条 -->
              <div class="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl" :class="getProviderBrand(provider).brandBg.replace('/10', '')" />

              <div class="flex items-center gap-4 pl-5 pr-4 py-3.5">
                <!-- 品牌图标 -->
                <div class="flex h-10 w-10 items-center justify-center rounded-xl shrink-0 text-sm font-bold" :class="[getProviderBrand(provider).brandBg, getProviderBrand(provider).brandColor]">
                  {{ getProviderBrand(provider).brandInitial }}
                </div>

                <!-- 信息 -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold">{{ provider.name }}</span>
                    <Badge v-if="provider.isDefault" variant="outline" class="h-4 px-1.5 text-[9px] border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5">
                      默认
                    </Badge>
                    <Badge variant="secondary" class="h-4 px-1.5 text-[9px]">
                      {{ provider.providerType === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容' }}
                    </Badge>
                  </div>
                  <div class="flex items-center gap-3 mt-1">
                    <span class="text-[11px] text-muted-foreground font-mono truncate">{{ provider.endpoint }}</span>
                    <span class="text-[10px] text-muted-foreground/60">{{ provider.models.length }} 个模型</span>
                  </div>
                </div>

                <!-- 操作按钮 -->
                <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <Button
                    v-if="!provider.isDefault"
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8 text-muted-foreground hover:text-amber-500"
                    title="设为默认"
                    @click="setDefault(provider)"
                  >
                    <Star class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8 text-muted-foreground"
                    title="编辑"
                    @click="editProvider(provider)"
                  >
                    <Pencil class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    v-if="deleteConfirm !== provider.id"
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title="删除"
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
                    确认删除
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
            <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">添加服务商</h3>
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
                  {{ (key as string) === 'custom' ? '自定义' : preset.name }}
                </p>
                <p class="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                  {{ preset.description }}
                </p>
              </div>

              <!-- 模型数量 -->
              <div v-if="preset.models.length > 0" class="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                <Cpu class="h-3 w-3" />
                {{ preset.models.length }} 个预设模型
              </div>
            </button>
          </div>
        </section>
      </div>
    </ScrollArea>

    <!-- ==================== 编辑 Provider 对话框 ==================== -->
    <Dialog :open="showEditDialog" @update:open="showEditDialog = $event">
      <DialogContent class="sm:max-w-[640px] gap-0 p-0">
        <DialogHeader class="px-7 pt-6 pb-5 border-b border-border/20">
          <DialogTitle class="text-base">{{ editMode === 'create' ? '添加服务商' : '编辑服务商' }}</DialogTitle>
          <DialogDescription class="text-xs mt-1.5">配置 AI 服务商的连接信息和可用模型。</DialogDescription>
        </DialogHeader>

        <ScrollArea class="max-h-[65vh]">
          <div class="px-7 py-6 space-y-7">
            <!-- 基本信息 -->
            <div class="space-y-4">
              <div class="flex items-center gap-2.5 text-xs font-semibold text-foreground/70">
                <div class="flex h-6 w-6 items-center justify-center rounded-md bg-primary/8">
                  <Globe class="h-3.5 w-3.5 text-primary/70" />
                </div>
                连接配置
              </div>
              <div class="grid grid-cols-2 gap-4 pl-8">
                <div class="space-y-2">
                  <Label class="text-xs">服务商名称</Label>
                  <Input v-model="form.name" placeholder="如 DeepSeek" class="h-10 text-sm" />
                </div>
                <div class="space-y-2">
                  <Label class="text-xs">协议类型</Label>
                  <Select
                    :model-value="form.providerType"
                    @update:model-value="(v: unknown) => form.providerType = String(v) as ProviderType"
                  >
                    <SelectTrigger class="h-10 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai_compat">OpenAI 兼容</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div class="space-y-2 pl-8">
                <Label class="text-xs">API 端点</Label>
                <Input v-model="form.endpoint" placeholder="https://api.example.com/v1" class="h-10 text-sm font-mono" />
              </div>
            </div>

            <!-- 认证 -->
            <div class="space-y-4">
              <div class="flex items-center gap-2.5 text-xs font-semibold text-foreground/70">
                <div class="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/8">
                  <Shield class="h-3.5 w-3.5 text-amber-600/70 dark:text-amber-400/70" />
                </div>
                认证信息
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
                  {{ editMode === 'edit' ? '留空保持原有 Key 不变' : 'Key 将安全存储在系统密钥环中' }}
                </p>
              </div>

              <div class="flex items-center gap-3 pl-8 pt-1">
                <Switch
                  :checked="form.isDefault"
                  @update:checked="form.isDefault = $event"
                />
                <Label class="text-xs cursor-pointer" @click="form.isDefault = !form.isDefault">
                  设为默认服务商
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
                  模型列表
                  <span class="text-[10px] text-muted-foreground/50">({{ form.models.length }})</span>
                </div>
                <Button variant="outline" size="sm" class="h-8 text-xs gap-1.5" @click="openAddModel">
                  <Plus class="h-3.5 w-3.5" />
                  添加模型
                </Button>
              </div>

              <div v-if="form.models.length === 0" class="ml-8 rounded-lg border border-dashed border-border/40 p-8 text-center">
                <Cpu class="h-7 w-7 text-muted-foreground/20 mx-auto mb-2.5" />
                <p class="text-xs text-muted-foreground">暂无模型，请添加至少一个模型</p>
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
                        思考
                      </Badge>
                      <Badge v-if="model.capabilities.vision" variant="outline" class="h-[18px] px-1.5 text-[9px] border-blue-500/20 text-blue-500 bg-blue-500/5">
                        <ImageIcon class="h-2.5 w-2.5 mr-0.5" />
                        视觉
                      </Badge>
                      <Badge v-if="model.capabilities.toolUse" variant="outline" class="h-[18px] px-1.5 text-[9px] border-green-500/20 text-green-500 bg-green-500/5">
                        <Wrench class="h-2.5 w-2.5 mr-0.5" />
                        工具
                      </Badge>
                      <Badge v-if="model.capabilities.streaming" variant="outline" class="h-[18px] px-1.5 text-[9px] border-border/40 text-muted-foreground bg-muted/30">
                        <Zap class="h-2.5 w-2.5 mr-0.5" />
                        流式
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
          <Button variant="outline" size="sm" class="h-9" @click="showEditDialog = false">取消</Button>
          <Button size="sm" class="h-9 min-w-[80px]" :disabled="!canSave || saving" @click="handleSave">
            {{ saving ? '保存中…' : '保存' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- ==================== 编辑模型对话框 ==================== -->
    <Dialog :open="showModelDialog" @update:open="showModelDialog = $event">
      <DialogContent class="sm:max-w-[540px] gap-0 p-0">
        <DialogHeader class="px-7 pt-6 pb-5 border-b border-border/20">
          <DialogTitle class="text-base">{{ editingModelIndex >= 0 ? '编辑模型' : '添加模型' }}</DialogTitle>
          <DialogDescription class="text-xs mt-1.5">配置模型的 ID、能力和定价信息。</DialogDescription>
        </DialogHeader>

        <div class="px-7 py-6 space-y-6">
          <!-- 基本信息 -->
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label class="text-xs">模型 ID</Label>
              <Input v-model="modelForm.id" placeholder="model-name" class="h-10 text-sm font-mono" />
            </div>
            <div class="space-y-2">
              <Label class="text-xs">显示名称</Label>
              <Input v-model="modelForm.name" placeholder="Model Name" class="h-10 text-sm" />
            </div>
          </div>

          <!-- 模型能力 -->
          <div class="space-y-3.5">
            <Label class="text-xs font-semibold text-foreground/70">模型能力</Label>
            <div class="grid grid-cols-2 gap-x-6 gap-y-3.5">
              <label class="flex items-center gap-3 text-sm cursor-pointer">
                <Switch :checked="modelForm.streaming" @update:checked="modelForm.streaming = $event" />
                <span class="flex items-center gap-1.5"><Zap class="h-3.5 w-3.5 text-muted-foreground" /> 流式输出</span>
              </label>
              <label class="flex items-center gap-3 text-sm cursor-pointer">
                <Switch :checked="modelForm.vision" @update:checked="modelForm.vision = $event" />
                <span class="flex items-center gap-1.5"><ImageIcon class="h-3.5 w-3.5 text-muted-foreground" /> 图片输入</span>
              </label>
              <label class="flex items-center gap-3 text-sm cursor-pointer">
                <Switch :checked="modelForm.thinking" @update:checked="modelForm.thinking = $event" />
                <span class="flex items-center gap-1.5"><Brain class="h-3.5 w-3.5 text-muted-foreground" /> 思考过程</span>
              </label>
              <label class="flex items-center gap-3 text-sm cursor-pointer">
                <Switch :checked="modelForm.toolUse" @update:checked="modelForm.toolUse = $event" />
                <span class="flex items-center gap-1.5"><Wrench class="h-3.5 w-3.5 text-muted-foreground" /> 工具调用</span>
              </label>
            </div>
          </div>

          <!-- 上下文限制 -->
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label class="text-xs">最大上下文</Label>
              <Input v-model.number="modelForm.maxContext" type="number" class="h-10 text-sm" />
            </div>
            <div class="space-y-2">
              <Label class="text-xs">最大输出</Label>
              <Input v-model.number="modelForm.maxOutput" type="number" class="h-10 text-sm" />
            </div>
          </div>

          <!-- 定价 -->
          <div class="space-y-3.5">
            <label class="flex items-center gap-3 text-sm cursor-pointer">
              <Switch :checked="modelForm.pricingEnabled" @update:checked="modelForm.pricingEnabled = $event" />
              启用定价计费
            </label>
            <div v-if="modelForm.pricingEnabled" class="grid grid-cols-3 gap-3 pl-8">
              <div class="space-y-2">
                <Label class="text-[11px]">输入/百万 Token</Label>
                <Input v-model.number="modelForm.inputPer1m" type="number" step="0.01" class="h-9 text-sm" />
              </div>
              <div class="space-y-2">
                <Label class="text-[11px]">输出/百万 Token</Label>
                <Input v-model.number="modelForm.outputPer1m" type="number" step="0.01" class="h-9 text-sm" />
              </div>
              <div class="space-y-2">
                <Label class="text-[11px]">币种</Label>
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
          <Button variant="outline" size="sm" class="h-9" @click="showModelDialog = false">取消</Button>
          <Button size="sm" class="h-9 min-w-[80px]" :disabled="!modelForm.id.trim() || !modelForm.name.trim()" @click="saveModel">
            {{ editingModelIndex >= 0 ? '更新' : '添加' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
