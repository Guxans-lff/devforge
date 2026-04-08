<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { KeyRound, X, CheckSquare, Square } from 'lucide-vue-next'
import type { SqlBuilderNodeData } from '@/types/sql-builder'

const props = defineProps<{
  data: SqlBuilderNodeData
  selected?: boolean
}>()

const emit = defineEmits<{
  toggleColumn: [column: string]
  selectAll: []
  deselectAll: []
  removeTable: []
}>()

/** 主键列排前面 */
const sortedColumns = computed(() => {
  const pk = props.data.columns.filter(c => c.isPrimaryKey)
  const others = props.data.columns.filter(c => !c.isPrimaryKey)
  return [...pk, ...others]
})

const MAX_VISIBLE = 20
const visibleColumns = computed(() =>
  sortedColumns.value.length <= MAX_VISIBLE
    ? sortedColumns.value
    : sortedColumns.value.slice(0, MAX_VISIBLE),
)
const hiddenCount = computed(() => Math.max(0, sortedColumns.value.length - MAX_VISIBLE))

const allSelected = computed(() =>
  props.data.columns.length > 0 && props.data.selectedColumns.length === props.data.columns.length,
)

function toggleAll() {
  if (allSelected.value) {
    emit('deselectAll')
  } else {
    emit('selectAll')
  }
}
</script>

<template>
  <div
    class="min-w-[220px] max-w-[300px] rounded-lg border bg-background shadow-md transition-[border-color,box-shadow]"
    :class="selected ? 'ring-2 ring-primary border-primary' : 'border-border'"
  >
    <!-- 表头 -->
    <div class="flex items-center gap-1.5 rounded-t-lg border-b border-border bg-muted/50 px-2.5 py-1.5">
      <!-- 全选切换 -->
      <button
        class="shrink-0 text-muted-foreground hover:text-foreground"
        :title="allSelected ? '取消全选' : '全选'"
        @click.stop="toggleAll"
      >
        <CheckSquare v-if="allSelected" class="h-3.5 w-3.5" />
        <Square v-else class="h-3.5 w-3.5" />
      </button>
      <span class="text-xs font-bold text-foreground truncate">
        {{ data.tableName }}
      </span>
      <span class="text-[9px] text-primary/70 font-mono shrink-0">
        {{ data.alias }}
      </span>
      <!-- 移除按钮 -->
      <button
        class="ml-auto shrink-0 text-muted-foreground/50 hover:text-destructive"
        title="移除表"
        @click.stop="emit('removeTable')"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- 列列表 -->
    <div class="py-0.5">
      <div
        v-for="col in visibleColumns"
        :key="col.name"
        class="flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] cursor-pointer hover:bg-accent/40"
        :class="data.selectedColumns.includes(col.name) ? 'bg-primary/5' : ''"
        @click.stop="emit('toggleColumn', col.name)"
      >
        <!-- 勾选框 -->
        <CheckSquare
          v-if="data.selectedColumns.includes(col.name)"
          class="h-3 w-3 shrink-0 text-primary"
        />
        <Square v-else class="h-3 w-3 shrink-0 text-muted-foreground/40" />
        <!-- 主键图标 -->
        <KeyRound
          v-if="col.isPrimaryKey"
          class="h-3 w-3 shrink-0 text-df-warning"
        />
        <span
          class="font-mono truncate"
          :class="col.isPrimaryKey ? 'font-bold text-foreground' : 'text-foreground/80'"
        >
          {{ col.name }}
        </span>
        <span class="ml-auto text-[9px] text-muted-foreground/50 font-mono shrink-0">
          {{ col.dataType }}
        </span>
      </div>
      <div
        v-if="hiddenCount > 0"
        class="px-2.5 py-0.5 text-[10px] text-muted-foreground/50 italic"
      >
        ... 还有 {{ hiddenCount }} 列
      </div>
    </div>

    <!-- 连接点 -->
    <Handle id="right" type="source" :position="Position.Right" class="!bg-primary !w-2.5 !h-2.5" />
    <Handle id="left" type="target" :position="Position.Left" class="!bg-primary !w-2.5 !h-2.5" />
    <Handle id="bottom" type="source" :position="Position.Bottom" class="!bg-primary !w-2.5 !h-2.5" />
    <Handle id="top" type="target" :position="Position.Top" class="!bg-primary !w-2.5 !h-2.5" />
  </div>
</template>
