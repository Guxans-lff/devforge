<script setup lang="ts">
/**
 * 列编辑侧边栏 — 建模模式
 *
 * 以 Sheet 形式展示选中表的所有列，支持编辑列属性和添加/删除列。
 */
import { computed } from 'vue'
import { Plus, Trash2, GripVertical } from 'lucide-vue-next'
import type { ModelTable, ModelColumn } from '@/types/er-modeling'
import { MYSQL_DATA_TYPES, TYPES_WITH_LENGTH } from '@/types/er-modeling'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'

const props = defineProps<{
  /** 是否打开 */
  open: boolean
  /** 当前编辑的表 */
  table: ModelTable | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  /** 更新表属性 */
  updateTable: [tableId: string, partial: Partial<ModelTable>]
  /** 更新列 */
  updateColumn: [tableId: string, columnId: string, partial: Partial<ModelColumn>]
  /** 添加列 */
  addColumn: [tableId: string]
  /** 删除列 */
  removeColumn: [tableId: string, columnId: string]
}>()

/** 当前表的列列表 */
const columns = computed(() => props.table?.columns ?? [])

/** 判断该数据类型是否需要长度参数 */
function needsLength(dataType: string): boolean {
  return TYPES_WITH_LENGTH.has(dataType.toUpperCase())
}

/** 处理 Sheet 关闭 */
function handleOpenChange(val: boolean) {
  emit('update:open', val)
}
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent side="right" class="w-[520px] sm:w-[600px] overflow-y-auto">
      <SheetHeader>
        <SheetTitle>
          {{ table ? `编辑表: ${table.name}` : '列编辑器' }}
        </SheetTitle>
        <SheetDescription>
          编辑表的列定义，包括名称、类型、约束等属性。
        </SheetDescription>
      </SheetHeader>

      <div v-if="table" class="mt-4 space-y-6">
        <!-- 表属性区域 -->
        <div class="space-y-3">
          <h4 class="text-sm font-medium text-foreground">表属性</h4>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <Label class="text-xs">表名</Label>
              <Input
                :model-value="table.name"
                class="h-7 text-xs"
                @update:model-value="(v: string | number) => emit('updateTable', table!.id, { name: String(v) })"
              />
            </div>
            <div class="space-y-1">
              <Label class="text-xs">注释</Label>
              <Input
                :model-value="table.comment ?? ''"
                class="h-7 text-xs"
                placeholder="表注释..."
                @update:model-value="(v: string | number) => emit('updateTable', table!.id, { comment: String(v) || undefined })"
              />
            </div>
            <div class="space-y-1">
              <Label class="text-xs">引擎</Label>
              <Select
                :model-value="table.engine ?? 'InnoDB'"
                @update:model-value="(v) => emit('updateTable', table!.id, { engine: String(v) })"
              >
                <SelectTrigger class="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="InnoDB">InnoDB</SelectItem>
                  <SelectItem value="MyISAM">MyISAM</SelectItem>
                  <SelectItem value="MEMORY">MEMORY</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1">
              <Label class="text-xs">字符集</Label>
              <Select
                :model-value="table.charset ?? 'utf8mb4'"
                @update:model-value="(v) => emit('updateTable', table!.id, { charset: String(v) })"
              >
                <SelectTrigger class="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="utf8mb4">utf8mb4</SelectItem>
                  <SelectItem value="utf8">utf8</SelectItem>
                  <SelectItem value="latin1">latin1</SelectItem>
                  <SelectItem value="gbk">gbk</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <!-- 列定义区域 -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-medium text-foreground">列定义</h4>
            <Button
              variant="outline"
              size="sm"
              class="h-6 text-xs gap-1"
              @click="emit('addColumn', table!.id)"
            >
              <Plus class="h-3 w-3" />
              添加列
            </Button>
          </div>

          <!-- 列表头 -->
          <div class="grid grid-cols-[24px_1fr_100px_50px_32px_32px_32px_32px_32px] gap-1 px-1 text-[10px] text-muted-foreground font-medium">
            <span />
            <span>列名</span>
            <span>类型</span>
            <span>长度</span>
            <span title="主键" class="text-center">PK</span>
            <span title="允许空值" class="text-center">NULL</span>
            <span title="自增" class="text-center">AI</span>
            <span title="唯一" class="text-center">UQ</span>
            <span />
          </div>

          <!-- 列行 -->
          <div class="space-y-1">
            <div
              v-for="col in columns"
              :key="col.id"
              class="grid grid-cols-[24px_1fr_100px_50px_32px_32px_32px_32px_32px] gap-1 items-center rounded px-1 py-0.5 hover:bg-muted/30"
            >
              <!-- 拖拽手柄（占位） -->
              <GripVertical class="h-3 w-3 text-muted-foreground/40 cursor-grab" />

              <!-- 列名 -->
              <Input
                :model-value="col.name"
                class="h-6 text-xs font-mono"
                @update:model-value="(v: string | number) => emit('updateColumn', table!.id, col.id, { name: String(v) })"
              />

              <!-- 数据类型 -->
              <Select
                :model-value="col.dataType.toUpperCase()"
                @update:model-value="(v) => emit('updateColumn', table!.id, col.id, { dataType: String(v) })"
              >
                <SelectTrigger class="h-6 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent class="max-h-[240px]">
                  <SelectItem
                    v-for="dt in MYSQL_DATA_TYPES"
                    :key="dt"
                    :value="dt"
                  >
                    {{ dt }}
                  </SelectItem>
                </SelectContent>
              </Select>

              <!-- 长度 -->
              <Input
                v-if="needsLength(col.dataType)"
                type="number"
                :model-value="col.length ?? ''"
                class="h-6 text-xs"
                placeholder="—"
                @update:model-value="(v: string | number) => emit('updateColumn', table!.id, col.id, { length: v ? Number(v) : undefined })"
              />
              <span v-else class="text-center text-muted-foreground/30 text-xs">—</span>

              <!-- PK -->
              <div class="flex justify-center">
                <Checkbox
                  :checked="col.isPrimaryKey"
                  class="h-4 w-4"
                  @update:checked="(v: boolean) => emit('updateColumn', table!.id, col.id, { isPrimaryKey: v })"
                />
              </div>

              <!-- NULL -->
              <div class="flex justify-center">
                <Checkbox
                  :checked="col.nullable"
                  class="h-4 w-4"
                  @update:checked="(v: boolean) => emit('updateColumn', table!.id, col.id, { nullable: v })"
                />
              </div>

              <!-- AI -->
              <div class="flex justify-center">
                <Checkbox
                  :checked="col.isAutoIncrement"
                  class="h-4 w-4"
                  @update:checked="(v: boolean) => emit('updateColumn', table!.id, col.id, { isAutoIncrement: v })"
                />
              </div>

              <!-- UQ -->
              <div class="flex justify-center">
                <Checkbox
                  :checked="col.isUnique"
                  class="h-4 w-4"
                  @update:checked="(v: boolean) => emit('updateColumn', table!.id, col.id, { isUnique: v })"
                />
              </div>

              <!-- 删除 -->
              <Button
                variant="ghost"
                size="sm"
                class="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                @click="emit('removeColumn', table!.id, col.id)"
              >
                <Trash2 class="h-3 w-3" />
              </Button>
            </div>
          </div>

          <!-- 无列提示 -->
          <div
            v-if="columns.length === 0"
            class="text-center text-xs text-muted-foreground py-4"
          >
            暂无列，点击「添加列」开始定义表结构
          </div>
        </div>

        <!-- 列详情编辑区（默认值、注释） -->
        <div class="space-y-3">
          <h4 class="text-sm font-medium text-foreground">列详情</h4>
          <div class="space-y-2">
            <div
              v-for="col in columns"
              :key="`detail-${col.id}`"
              class="grid grid-cols-[1fr_1fr_1fr] gap-2 items-end text-xs"
            >
              <div>
                <Label class="text-[10px] text-muted-foreground">{{ col.name }} - 默认值</Label>
                <Input
                  :model-value="col.defaultValue ?? ''"
                  class="h-6 text-xs"
                  placeholder="无"
                  @update:model-value="(v: string | number) => emit('updateColumn', table!.id, col.id, { defaultValue: String(v) || undefined })"
                />
              </div>
              <div class="col-span-2">
                <Label class="text-[10px] text-muted-foreground">注释</Label>
                <Input
                  :model-value="col.comment ?? ''"
                  class="h-6 text-xs"
                  placeholder="列注释..."
                  @update:model-value="(v: string | number) => emit('updateColumn', table!.id, col.id, { comment: String(v) || undefined })"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 未选中表 -->
      <div v-else class="flex items-center justify-center h-40 text-sm text-muted-foreground">
        请先选中一张表
      </div>
    </SheetContent>
  </Sheet>
</template>
