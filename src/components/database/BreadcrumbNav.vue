<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight, Table2, Play, FileUp } from 'lucide-vue-next'
import type { EnvironmentType } from '@/types/environment'
import { ENV_PRESETS } from '@/types/environment'
import type { InnerTabType } from '@/types/database-workspace'

const props = defineProps<{
  /** 连接名称 */
  connectionName: string
  /** 当前数据库 */
  database?: string
  /** 当前表名 */
  table?: string
  /** 当前操作类型（对应内部标签页类型） */
  operation?: InnerTabType
  /** 环境类型 */
  environment?: EnvironmentType
}>()

const emit = defineEmits<{
  selectDatabase: [database: string]
  selectTable: [table: string]
}>()

/** 环境色 */
const envColor = computed(() =>
  props.environment ? ENV_PRESETS[props.environment]?.color : undefined,
)

/** 操作名称映射 */
const operationLabels: Partial<Record<InnerTabType, string>> = {
  query: 'Query',
  'table-editor': 'Editor',
  import: 'Import',
  'schema-compare': 'Compare',
  performance: 'Performance',
  'user-management': 'Users',
  'er-diagram': 'ER Diagram',
}

/** 操作图标映射 */
const operationIcons: Partial<Record<InnerTabType, typeof Play>> = {
  query: Play,
  'table-editor': Table2,
  import: FileUp,
}
</script>

<template>
  <div class="flex items-center gap-1 px-3 py-1 text-[10px] text-muted-foreground select-none overflow-hidden shrink-0 border-b border-border/30 bg-muted/10">
    <!-- 环境色点 -->
    <div
      v-if="envColor"
      class="h-1.5 w-1.5 rounded-full shrink-0"
      :style="{ backgroundColor: envColor }"
    />

    <!-- 连接名 -->
    <span class="font-semibold text-foreground/70 truncate max-w-[120px]">
      {{ connectionName }}
    </span>

    <!-- 数据库 -->
    <template v-if="database">
      <ChevronRight class="h-3 w-3 shrink-0 opacity-30" />
      <button
        class="font-medium text-foreground/60 hover:text-primary truncate max-w-[120px] transition-colors"
        @click="emit('selectDatabase', database)"
      >
        {{ database }}
      </button>
    </template>

    <!-- 表名 -->
    <template v-if="table">
      <ChevronRight class="h-3 w-3 shrink-0 opacity-30" />
      <button
        class="font-medium text-foreground/60 hover:text-primary truncate max-w-[120px] transition-colors"
        @click="emit('selectTable', table)"
      >
        {{ table }}
      </button>
    </template>

    <!-- 操作类型 -->
    <template v-if="operation && operationLabels[operation]">
      <ChevronRight class="h-3 w-3 shrink-0 opacity-30" />
      <div class="flex items-center gap-1 text-muted-foreground/50">
        <component
          :is="operationIcons[operation]"
          v-if="operationIcons[operation]"
          class="h-3 w-3"
        />
        <span>{{ operationLabels[operation] }}</span>
      </div>
    </template>
  </div>
</template>
