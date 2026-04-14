<script setup lang="ts">
/**
 * AI Provider + Model 级联选择器
 *
 * 选择 Provider 后显示其可用模型列表。
 */
import { computed } from 'vue'
import type { ProviderConfig, ModelConfig } from '@/types/ai'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const props = defineProps<{
  providers: ProviderConfig[]
  selectedProviderId: string | null
  selectedModelId: string | null
}>()

const emit = defineEmits<{
  'update:selectedProviderId': [id: string]
  'update:selectedModelId': [id: string]
}>()

/** 当前选中的 Provider */
const currentProvider = computed(() =>
  props.providers.find(p => p.id === props.selectedProviderId) ?? null,
)

/** 当前 Provider 的模型列表 */
const availableModels = computed<ModelConfig[]>(() =>
  currentProvider.value?.models ?? [],
)

/** 切换 Provider 时自动选中第一个模型 */
function handleProviderChange(value: unknown) {
  const providerId = String(value)
  emit('update:selectedProviderId', providerId)
  const provider = props.providers.find(p => p.id === providerId)
  if (provider) {
    const firstModel = provider.models[0]
    if (firstModel) {
      emit('update:selectedModelId', firstModel.id)
    }
  }
}
</script>

<template>
  <div class="flex items-center gap-2">
    <!-- Provider 选择 -->
    <Select
      :model-value="selectedProviderId ?? undefined"
      @update:model-value="handleProviderChange"
    >
      <SelectTrigger class="h-8 w-[140px] text-xs">
        <SelectValue placeholder="选择服务商" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem
          v-for="p in providers"
          :key="p.id"
          :value="p.id"
        >
          {{ p.name }}
        </SelectItem>
      </SelectContent>
    </Select>

    <!-- Model 选择 -->
    <Select
      :model-value="selectedModelId ?? undefined"
      :disabled="!currentProvider"
      @update:model-value="(v: unknown) => emit('update:selectedModelId', String(v))"
    >
      <SelectTrigger class="h-8 w-[180px] text-xs">
        <SelectValue placeholder="选择模型" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem
          v-for="m in availableModels"
          :key="m.id"
          :value="m.id"
        >
          <div class="flex items-center gap-2">
            <span>{{ m.name }}</span>
            <span
              v-if="m.capabilities.thinking"
              class="text-[9px] px-1 py-0.5 rounded bg-violet-500/10 text-violet-500"
            >
              思考
            </span>
            <span
              v-if="m.capabilities.vision"
              class="text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-500"
            >
              视觉
            </span>
          </div>
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
