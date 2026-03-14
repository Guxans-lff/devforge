<script setup lang="ts">
/**
 * 字段编辑表格组件
 * 从 TableEditorPanel.vue 拆分，负责字段列表的展示与编辑交互
 * 所有修改通过 emit 通知父组件，自身为纯展示组件
 */
import type { ColumnDefinition } from '@/types/table-editor'
import { NO_LENGTH_TYPES } from '@/types/table-editor-constants'
import { GripVertical, Key, X, Loader2 } from 'lucide-vue-next'

// ===== Props =====
const props = defineProps<{
  columns: ColumnDefinition[]
  filteredColumnIndices: number[]
  selectedRowIdx: number | null
  selectedRows: Set<number>
  allSelected: boolean
  isMysql: boolean
  isAlterMode: boolean
  originalColumns: ColumnDefinition[]
  dragIdx: number | null
  dragOverIdx: number | null
  typeDropdownIdx: number | null
  typeSearchQuery: string
  filteredTypes: string[]
  loading: boolean
  validationErrors: { row: number; field: string; message: string }[]
}>()

// ===== Emits =====
const emit = defineEmits<{
  selectRow: [idx: number]
  toggleRowSelect: [idx: number]
  toggleSelectAll: []
  updateColumn: [idx: number, field: keyof ColumnDefinition, value: unknown]
  removeColumn: [idx: number]
  openTypeDropdown: [idx: number]
  closeTypeDropdown: []
  'update:typeSearchQuery': [value: string]
  onGripMouseDown: [e: MouseEvent, idx: number]
  contextmenu: [e: MouseEvent, idx: number]
}>()

// ===== 纯计算辅助函数 =====

/** 判断字段的变更类型（新增/修改/无变化） */
function getColumnChangeType(col: ColumnDefinition, _idx: number): 'add' | 'modify' | null {
  if (!props.isAlterMode) return null
  const orig = props.originalColumns.find(c => c.name === col.name)
  if (!orig) return 'add'
  if (JSON.stringify(orig) !== JSON.stringify(col)) return 'modify'
  return null
}

/** 判断指定行+字段是否存在校验错误 */
function hasError(idx: number, field: string): boolean {
  return props.validationErrors.some(e => e.row === idx && e.field === field)
}

/** 获取指定行+字段的错误消息 */
function getError(idx: number, field: string): string {
  return props.validationErrors.find(e => e.row === idx && e.field === field)?.message ?? ''
}

/** 类型搜索输入回车：选中第一个匹配项 */
function onTypeSearchEnter(idx: number) {
  if (props.filteredTypes.length > 0) {
    emit('updateColumn', idx, 'dataType', props.filteredTypes[0])
    emit('closeTypeDropdown')
  }
}

/** 选择类型并关闭下拉 */
function selectType(idx: number, type: string) {
  emit('updateColumn', idx, 'dataType', type)
  emit('closeTypeDropdown')
}
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <!-- 加载状态 -->
    <div v-if="loading" class="flex flex-1 items-center justify-center">
      <Loader2 class="size-5 animate-spin text-muted-foreground" />
    </div>

    <!-- 字段表格 -->
    <div v-else class="flex-1 min-h-0 overflow-auto">
      <table class="w-full border-collapse text-xs">
        <thead class="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
          <tr class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
            <th class="border-b border-border px-1 py-1.5 w-10 text-center">
              <label class="inline-flex items-center justify-center size-3.5 rounded border cursor-pointer transition-colors" :class="allSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-border hover:border-foreground/30'">
                <input type="checkbox" :checked="allSelected" class="sr-only" @change="emit('toggleSelectAll')" />
                <span v-if="allSelected" class="text-[8px] font-bold leading-none">✓</span>
              </label>
            </th>
            <th class="border-b border-border px-2 py-1.5 min-w-[130px]">名称</th>
            <th class="border-b border-border px-2 py-1.5 min-w-[120px]">类型</th>
            <th class="border-b border-border px-2 py-1.5 w-16 text-center">长度</th>
            <th class="border-b border-border px-2 py-1.5 w-10 text-center">主键</th>
            <th class="border-b border-border px-2 py-1.5 w-10 text-center">非空</th>
            <th class="border-b border-border px-2 py-1.5 w-10 text-center">自增</th>
            <th class="border-b border-border px-2 py-1.5 min-w-[90px]">默认值</th>
            <th v-if="isMysql" class="border-b border-border px-2 py-1.5 min-w-[90px]">更新时</th>
            <th class="border-b border-border px-2 py-1.5 min-w-[130px]">注释</th>
            <th class="border-b border-border px-2 py-1.5 w-7" />
          </tr>
        </thead>
        <tbody>
          <!-- 空状态 -->
          <tr v-if="filteredColumnIndices.length === 0">
            <td :colspan="isMysql ? 11 : 10" class="text-center text-muted-foreground/60 py-8 text-xs">
              {{ columns.length === 0 ? '暂无字段，点击上方「添加」按钮' : '无匹配字段' }}
            </td>
          </tr>

          <!-- 字段行 -->
          <tr
            v-for="idx in filteredColumnIndices" :key="idx"
            class="group transition-colors relative cursor-pointer"
            :class="[
              selectedRowIdx === idx ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : (idx % 2 === 0 ? 'bg-transparent' : 'bg-muted/20'),
              getColumnChangeType(columns[idx] as ColumnDefinition, idx) === 'add' ? 'border-l-2 border-l-green-500' : '',
              getColumnChangeType(columns[idx] as ColumnDefinition, idx) === 'modify' ? 'border-l-2 border-l-orange-500' : '',
              dragOverIdx === idx && dragIdx !== idx ? 'ring-1 ring-inset ring-primary/40' : '',
              dragIdx === idx ? 'opacity-40' : '',
            ]"
            @click="emit('selectRow', idx)"
            @contextmenu="emit('contextmenu', $event, idx)"
          >
            <!-- 勾选 + 拖拽 -->
            <td class="border-b border-border/50 px-0.5 py-0.5 text-center">
              <div class="flex items-center justify-center gap-0.5">
                <label class="inline-flex items-center justify-center size-3.5 rounded border cursor-pointer transition-colors shrink-0" :class="selectedRows.has(idx) ? 'bg-primary border-primary text-primary-foreground' : 'border-border/60 hover:border-foreground/30'" @click.stop>
                  <input type="checkbox" :checked="selectedRows.has(idx)" class="sr-only" @change="emit('toggleRowSelect', idx)" />
                  <span v-if="selectedRows.has(idx)" class="text-[8px] font-bold leading-none">✓</span>
                </label>
                <GripVertical class="size-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 cursor-grab active:cursor-grabbing" @mousedown="emit('onGripMouseDown', $event, idx)" />
              </div>
            </td>
            <!-- 字段名 -->
            <td class="border-b border-border/50 p-0.5">
              <input :value="columns[idx]?.name" class="w-full h-6 px-1.5 text-xs font-mono bg-transparent border rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60" :class="hasError(idx, 'name') ? 'border-red-500/60' : 'border-transparent'" :title="getError(idx, 'name')" @input="emit('updateColumn', idx, 'name', ($event.target as HTMLInputElement).value)" />
            </td>
            <!-- 类型选择 -->
            <td class="border-b border-border/50 p-0.5 relative">
              <button
                class="w-full h-6 px-1.5 text-xs font-mono bg-transparent border border-transparent rounded hover:border-border/60 focus:border-primary/50 focus:outline-none text-left truncate"
                :class="[hasError(idx, 'dataType') ? 'border-red-500/60' : '', !columns[idx]?.dataType ? 'text-muted-foreground/40' : '']"
                @click.stop="emit('openTypeDropdown', idx)"
              >
                {{ columns[idx]?.dataType || '选择类型' }}
              </button>
              <!-- 类型下拉面板 -->
              <div v-if="typeDropdownIdx === idx" class="absolute left-0 top-7 z-30 bg-popover border border-border rounded-md shadow-lg min-w-[160px] max-h-56 flex flex-col" @click.stop>
                <div class="p-1 border-b border-border">
                  <input
                    :value="typeSearchQuery"
                    class="type-search-input w-full h-6 px-2 text-xs font-mono bg-background border border-border rounded focus:border-primary/50 focus:outline-none"
                    placeholder="搜索类型..."
                    @input="emit('update:typeSearchQuery', ($event.target as HTMLInputElement).value)"
                    @keydown.enter.prevent="onTypeSearchEnter(idx)"
                    @keydown.escape="emit('closeTypeDropdown')"
                  />
                </div>
                <div class="overflow-auto flex-1 py-1">
                  <button
                    v-for="type in filteredTypes" :key="type"
                    class="w-full px-3 py-1 text-left text-xs font-mono hover:bg-accent"
                    :class="columns[idx]?.dataType === type ? 'bg-accent/50 text-primary' : ''"
                    @click="selectType(idx, type)"
                  >
                    {{ type }}
                  </button>
                  <div v-if="filteredTypes.length === 0" class="px-3 py-2 text-xs text-muted-foreground/60">无匹配类型</div>
                </div>
              </div>
            </td>
            <!-- 长度 -->
            <td class="border-b border-border/50 p-0.5">
              <input :value="columns[idx].length ?? ''" :disabled="NO_LENGTH_TYPES.has(columns[idx].dataType.toUpperCase())" class="w-full h-6 px-1 text-xs font-mono bg-transparent border border-transparent rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60 text-center disabled:opacity-30 disabled:cursor-not-allowed" :placeholder="NO_LENGTH_TYPES.has(columns[idx].dataType.toUpperCase()) ? '' : '-'" @input="emit('updateColumn', idx, 'length', ($event.target as HTMLInputElement).value || null)" />
            </td>
            <!-- 主键 -->
            <td class="border-b border-border/50 px-1 py-0.5 text-center">
              <label class="inline-flex items-center justify-center size-4 rounded border cursor-pointer transition-colors" :class="columns[idx].isPrimaryKey ? 'bg-primary border-primary text-primary-foreground' : 'border-border hover:border-foreground/30'">
                <input type="checkbox" :checked="columns[idx].isPrimaryKey" class="sr-only" @change="emit('updateColumn', idx, 'isPrimaryKey', ($event.target as HTMLInputElement).checked)" />
                <Key v-if="columns[idx].isPrimaryKey" class="size-2.5" />
              </label>
            </td>
            <!-- 非空 -->
            <td class="border-b border-border/50 px-1 py-0.5 text-center">
              <label class="inline-flex items-center justify-center size-4 rounded border cursor-pointer transition-colors" :class="!columns[idx].nullable ? 'bg-orange-500/80 border-orange-500/80 text-white' : 'border-border hover:border-foreground/30'">
                <input type="checkbox" :checked="!columns[idx].nullable" class="sr-only" @change="emit('updateColumn', idx, 'nullable', !($event.target as HTMLInputElement).checked)" />
                <span v-if="!columns[idx].nullable" class="text-[9px] font-bold leading-none">!</span>
              </label>
            </td>
            <!-- 自增 -->
            <td class="border-b border-border/50 px-1 py-0.5 text-center">
              <label class="inline-flex items-center justify-center size-4 rounded border cursor-pointer transition-colors" :class="columns[idx].autoIncrement ? 'bg-blue-500/80 border-blue-500/80 text-white' : 'border-border hover:border-foreground/30'">
                <input type="checkbox" :checked="columns[idx].autoIncrement" class="sr-only" @change="emit('updateColumn', idx, 'autoIncrement', ($event.target as HTMLInputElement).checked)" />
                <span v-if="columns[idx].autoIncrement" class="text-[9px] font-bold leading-none">+</span>
              </label>
            </td>
            <!-- 默认值 -->
            <td class="border-b border-border/50 p-0.5">
              <input :value="columns[idx].defaultValue ?? ''" class="w-full h-6 px-1.5 text-xs font-mono bg-transparent border border-transparent rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60" placeholder="NULL" @input="emit('updateColumn', idx, 'defaultValue', ($event.target as HTMLInputElement).value || null)" />
            </td>
            <!-- 更新时（仅 MySQL） -->
            <td v-if="isMysql" class="border-b border-border/50 p-0.5">
              <input :value="columns[idx].onUpdate ?? ''" class="w-full h-6 px-1.5 text-xs font-mono bg-transparent border border-transparent rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60 text-muted-foreground" placeholder="-" @input="emit('updateColumn', idx, 'onUpdate', ($event.target as HTMLInputElement).value || null)" />
            </td>
            <!-- 注释 -->
            <td class="border-b border-border/50 p-0.5">
              <input :value="columns[idx].comment ?? ''" class="w-full h-6 px-1.5 text-xs bg-transparent border border-transparent rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60 text-muted-foreground" placeholder="-" @input="emit('updateColumn', idx, 'comment', ($event.target as HTMLInputElement).value || null)" />
            </td>
            <!-- 删除按钮 -->
            <td class="border-b border-border/50 px-0.5 py-0.5 text-center">
              <button class="size-5 inline-flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all" @click="emit('removeColumn', idx)">
                <X class="size-3" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
