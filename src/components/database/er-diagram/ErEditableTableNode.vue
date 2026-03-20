<script setup lang="ts">
/**
 * 可编辑表节点 — 建模模式专用
 *
 * 基于 ErTableNode 扩展，增加内联编辑、右键菜单和连接锚点。
 */
import { ref, computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { KeyRound, Pencil, Plus, Trash2, Columns3 } from 'lucide-vue-next'
import type { ModelTable } from '@/types/er-modeling'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

const props = defineProps<{
  data: {
    table: ModelTable
    isSelected: boolean
  }
}>()

const emit = defineEmits<{
  /** 重命名表 */
  renameTable: [tableId: string, newName: string]
  /** 删除表 */
  deleteTable: [tableId: string]
  /** 打开列编辑器 */
  openColumnEditor: [tableId: string]
  /** 添加列 */
  addColumn: [tableId: string]
  /** 选中表 */
  selectTable: [tableId: string]
}>()

/** 是否正在内联编辑表名 */
const isEditingName = ref(false)
const editNameValue = ref('')

/** 主键列排在最前面 */
const sortedColumns = computed(() => {
  const cols = props.data.table.columns
  const pk = cols.filter(c => c.isPrimaryKey)
  const others = cols.filter(c => !c.isPrimaryKey)
  return [...pk, ...others]
})

/** 最多显示的列数 */
const MAX_VISIBLE = 15
const visibleColumns = computed(() =>
  sortedColumns.value.length <= MAX_VISIBLE
    ? sortedColumns.value
    : sortedColumns.value.slice(0, MAX_VISIBLE),
)
const hiddenCount = computed(() =>
  Math.max(0, sortedColumns.value.length - MAX_VISIBLE),
)

/** 开始编辑表名 */
function startEditName() {
  editNameValue.value = props.data.table.name
  isEditingName.value = true
}

/** 完成编辑表名 */
function finishEditName() {
  isEditingName.value = false
  const trimmed = editNameValue.value.trim()
  if (trimmed && trimmed !== props.data.table.name) {
    emit('renameTable', props.data.table.id, trimmed)
  }
}

/** 点击节点选中表 */
function handleClick() {
  emit('selectTable', props.data.table.id)
}

/** 生成列类型显示文本 */
function formatType(col: { dataType: string; length?: number }): string {
  if (col.length != null && col.length > 0) {
    return `${col.dataType}(${col.length})`
  }
  return col.dataType
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div
        class="min-w-[200px] max-w-[300px] rounded-lg border bg-background shadow-md transition-all cursor-pointer"
        :class="[
          data.isSelected
            ? 'ring-2 ring-primary border-primary'
            : 'border-border hover:border-primary/50',
        ]"
        @click="handleClick"
      >
        <!-- 表头 -->
        <div class="flex items-center gap-2 rounded-t-lg border-b border-border bg-muted/50 px-3 py-2">
          <template v-if="isEditingName">
            <input
              v-model="editNameValue"
              class="h-5 flex-1 bg-transparent text-xs font-bold outline-none ring-1 ring-primary rounded px-1"
              @blur="finishEditName"
              @keydown.enter="finishEditName"
              @keydown.escape="isEditingName = false"
              @click.stop
              autofocus
            />
          </template>
          <template v-else>
            <span
              class="text-xs font-bold text-foreground truncate flex-1"
              @dblclick.stop="startEditName"
            >
              {{ data.table.name }}
            </span>
          </template>
          <span
            v-if="data.table.comment && !isEditingName"
            class="text-[9px] text-muted-foreground/60 truncate max-w-[80px]"
            :title="data.table.comment"
          >
            {{ data.table.comment }}
          </span>
        </div>

        <!-- 列列表 -->
        <div class="py-1">
          <div
            v-for="col in visibleColumns"
            :key="col.id"
            class="flex items-center gap-1.5 px-3 py-0.5 text-[11px] hover:bg-muted/30"
          >
            <KeyRound
              v-if="col.isPrimaryKey"
              class="h-3 w-3 shrink-0 text-amber-500"
            />
            <span v-else class="h-3 w-3 shrink-0" />
            <span
              class="font-mono truncate"
              :class="col.isPrimaryKey ? 'font-bold text-foreground' : 'text-foreground/80'"
            >
              {{ col.name }}
            </span>
            <span class="ml-auto text-[9px] text-muted-foreground/50 font-mono shrink-0">
              {{ formatType(col) }}
            </span>
            <span v-if="col.nullable" class="text-[8px] text-muted-foreground/40 shrink-0">?</span>
          </div>
          <div
            v-if="hiddenCount > 0"
            class="px-3 py-0.5 text-[10px] text-muted-foreground/50 italic"
          >
            ... 还有 {{ hiddenCount }} 列
          </div>
        </div>

        <!-- 连接锚点（用于拖拽创建外键关系） -->
        <Handle id="right" type="source" :position="Position.Right" class="!bg-primary !w-2.5 !h-2.5 !border-2 !border-background" />
        <Handle id="left" type="target" :position="Position.Left" class="!bg-primary !w-2.5 !h-2.5 !border-2 !border-background" />
        <Handle id="bottom" type="source" :position="Position.Bottom" class="!bg-primary !w-2.5 !h-2.5 !border-2 !border-background" />
        <Handle id="top" type="target" :position="Position.Top" class="!bg-primary !w-2.5 !h-2.5 !border-2 !border-background" />
      </div>
    </ContextMenuTrigger>

    <!-- 右键菜单 -->
    <ContextMenuContent class="w-48">
      <ContextMenuItem @click="startEditName">
        <Pencil class="mr-2 h-3.5 w-3.5" />
        重命名表
      </ContextMenuItem>
      <ContextMenuItem @click="emit('openColumnEditor', data.table.id)">
        <Columns3 class="mr-2 h-3.5 w-3.5" />
        编辑列
      </ContextMenuItem>
      <ContextMenuItem @click="emit('addColumn', data.table.id)">
        <Plus class="mr-2 h-3.5 w-3.5" />
        添加列
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem class="text-destructive" @click="emit('deleteTable', data.table.id)">
        <Trash2 class="mr-2 h-3.5 w-3.5" />
        删除表
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
