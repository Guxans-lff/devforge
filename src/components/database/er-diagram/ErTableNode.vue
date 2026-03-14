<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { KeyRound } from 'lucide-vue-next'
import type { ErTableNodeData } from '@/types/er-diagram'

const props = defineProps<{
  data: ErTableNodeData
  selected?: boolean
}>()

const emit = defineEmits<{
  openTableEditor: [tableName: string, database: string]
}>()

/** 主键列排在最前面 */
const sortedColumns = computed(() => {
  const pk = props.data.columns.filter(c => c.isPrimaryKey)
  const others = props.data.columns.filter(c => !c.isPrimaryKey)
  return [...pk, ...others]
})

/** 最多显示的列数（超过时折叠） */
const MAX_VISIBLE_COLUMNS = 20
const showAll = computed(() => sortedColumns.value.length <= MAX_VISIBLE_COLUMNS)
const visibleColumns = computed(() =>
  showAll.value ? sortedColumns.value : sortedColumns.value.slice(0, MAX_VISIBLE_COLUMNS),
)
const hiddenCount = computed(() => sortedColumns.value.length - MAX_VISIBLE_COLUMNS)
</script>

<template>
  <div
    class="min-w-[200px] max-w-[300px] rounded-lg border bg-background shadow-md transition-all"
    :class="[
      selected ? 'ring-2 ring-primary border-primary' : 'border-border',
      data.highlighted ? 'ring-2 ring-amber-400 border-amber-400' : '',
    ]"
    @dblclick="emit('openTableEditor', data.tableName, data.database)"
  >
    <!-- 表头 -->
    <div class="flex items-center gap-2 rounded-t-lg border-b border-border bg-muted/50 px-3 py-2">
      <span class="text-xs font-bold text-foreground truncate">
        {{ data.tableName }}
      </span>
      <span
        v-if="data.comment"
        class="ml-auto text-[9px] text-muted-foreground/60 truncate max-w-[100px]"
        :title="data.comment"
      >
        {{ data.comment }}
      </span>
    </div>

    <!-- 列列表 -->
    <div class="py-1">
      <div
        v-for="col in visibleColumns"
        :key="col.name"
        class="flex items-center gap-1.5 px-3 py-0.5 text-[11px] hover:bg-muted/30"
      >
        <KeyRound
          v-if="col.isPrimaryKey"
          class="h-3 w-3 shrink-0 text-amber-500"
        />
        <span v-else class="h-3 w-3 shrink-0" />
        <span class="font-mono truncate" :class="col.isPrimaryKey ? 'font-bold text-foreground' : 'text-foreground/80'">
          {{ col.name }}
        </span>
        <span class="ml-auto text-[9px] text-muted-foreground/50 font-mono shrink-0">
          {{ col.dataType }}
        </span>
        <span v-if="col.nullable" class="text-[8px] text-muted-foreground/40 shrink-0">?</span>
      </div>
      <div
        v-if="!showAll"
        class="px-3 py-0.5 text-[10px] text-muted-foreground/50 italic"
      >
        ... 还有 {{ hiddenCount }} 列
      </div>
    </div>

    <!-- 连接点 -->
    <Handle type="source" :position="Position.Right" class="!bg-primary !w-2 !h-2" />
    <Handle type="target" :position="Position.Left" class="!bg-primary !w-2 !h-2" />
    <Handle type="source" :position="Position.Bottom" class="!bg-primary !w-2 !h-2" />
    <Handle type="target" :position="Position.Top" class="!bg-primary !w-2 !h-2" />
  </div>
</template>
