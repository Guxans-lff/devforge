<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Lock, FlaskConical } from 'lucide-vue-next'
import type { EnvironmentType } from '@/types/environment'
import { ENV_PRESETS } from '@/types/environment'

const props = defineProps<{
  /** 环境类型 */
  environment: EnvironmentType
  /** 连接名称 */
  connectionName?: string
  /** 主机地址 */
  host?: string
  /** 是否只读模式 */
  readOnly?: boolean
}>()

const { t } = useI18n()

/** 是否显示横幅（仅 production/staging 或只读模式） */
const visible = computed(() =>
  props.environment === 'production' ||
  props.environment === 'staging' ||
  props.readOnly,
)

/** 横幅背景色 */
const bannerClass = computed(() => {
  if (props.readOnly) return 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400'
  if (props.environment === 'production') return 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
  if (props.environment === 'staging') return 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
  return ''
})

/** 横幅文案 */
const bannerText = computed(() => {
  const parts: string[] = []
  if (props.readOnly) {
    parts.push(t('environment.readOnlyMode'))
  }
  parts.push(t(`environment.${props.environment}`))
  if (props.connectionName) {
    parts.push(`- ${props.connectionName}`)
  }
  if (props.host) {
    parts.push(`(${props.host})`)
  }
  return parts.join(' ')
})
</script>

<template>
  <div
    v-if="visible"
    class="flex items-center gap-2 px-3 py-1 text-[10px] font-bold border-b select-none shrink-0"
    :class="bannerClass"
  >
    <Lock v-if="readOnly" class="h-3 w-3 shrink-0" />
    <AlertTriangle v-else-if="environment === 'production'" class="h-3 w-3 shrink-0" />
    <FlaskConical v-else-if="environment === 'staging'" class="h-3 w-3 shrink-0" />
    <span class="truncate">{{ bannerText }}</span>
    <div
      class="ml-auto h-1.5 w-1.5 rounded-full animate-pulse shrink-0"
      :style="{ backgroundColor: ENV_PRESETS[environment]?.color }"
    ></div>
  </div>
</template>
