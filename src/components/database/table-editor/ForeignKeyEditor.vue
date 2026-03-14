<script setup lang="ts">
/**
 * 外键编辑表格组件
 * 支持外键的增删改，包含 ON DELETE / ON UPDATE 动作选择
 */
import { X } from 'lucide-vue-next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FK_ACTIONS } from '@/types/table-editor-constants'
import type { ForeignKeyDefinition } from '@/types/table-editor'

defineProps<{ foreignKeys: ForeignKeyDefinition[] }>()
const emit = defineEmits<{
  updateForeignKey: [idx: number, field: keyof ForeignKeyDefinition, value: unknown]
  removeForeignKey: [idx: number]
}>()

/** 解析逗号分隔的列名字符串为数组 */
const parseColumns = (raw: string) => raw.split(',').map(s => s.trim()).filter(Boolean)

const inputCls = 'w-full h-6 px-1.5 text-xs font-mono bg-transparent border border-transparent rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60'
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <div class="flex-1 min-h-0 overflow-auto">
      <table class="w-full border-collapse text-xs">
        <thead class="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
          <tr class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
            <th class="border-b border-border px-2 py-1.5 w-7 text-center">#</th>
            <th class="border-b border-border px-2 py-1.5 min-w-[140px]">名称</th>
            <th class="border-b border-border px-2 py-1.5 min-w-[140px]">本表列</th>
            <th class="border-b border-border px-2 py-1.5 min-w-[120px]">引用表</th>
            <th class="border-b border-border px-2 py-1.5 min-w-[120px]">引用列</th>
            <th class="border-b border-border px-2 py-1.5 w-24">ON DELETE</th>
            <th class="border-b border-border px-2 py-1.5 w-24">ON UPDATE</th>
            <th class="border-b border-border px-2 py-1.5 w-7" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="foreignKeys.length === 0">
            <td colspan="8" class="text-center text-muted-foreground/60 py-8 text-xs">暂无外键，点击上方「添加」按钮</td>
          </tr>
          <tr
            v-for="(fk, idx) in foreignKeys" :key="idx"
            class="group transition-colors"
            :class="idx % 2 === 0 ? 'bg-transparent' : 'bg-muted/20'"
          >
            <td class="border-b border-border/50 px-2 py-0.5 text-center text-[10px] text-muted-foreground/40 tabular-nums">{{ idx + 1 }}</td>
            <td class="border-b border-border/50 p-0.5">
              <input :value="fk.name" :class="inputCls" @input="emit('updateForeignKey', idx, 'name', ($event.target as HTMLInputElement).value)" />
            </td>
            <td class="border-b border-border/50 p-0.5">
              <input :value="fk.columns.join(', ')" :class="inputCls" placeholder="col1, col2" @input="emit('updateForeignKey', idx, 'columns', parseColumns(($event.target as HTMLInputElement).value))" />
            </td>
            <td class="border-b border-border/50 p-0.5">
              <input :value="fk.refTable" :class="inputCls" placeholder="表名" @input="emit('updateForeignKey', idx, 'refTable', ($event.target as HTMLInputElement).value)" />
            </td>
            <td class="border-b border-border/50 p-0.5">
              <input :value="fk.refColumns.join(', ')" :class="inputCls" placeholder="col1" @input="emit('updateForeignKey', idx, 'refColumns', parseColumns(($event.target as HTMLInputElement).value))" />
            </td>
            <td class="border-b border-border/50 p-0.5">
              <Select :model-value="fk.onDelete ?? 'NO ACTION'" @update:model-value="emit('updateForeignKey', idx, 'onDelete', $event)">
                <SelectTrigger class="h-6 text-xs font-mono border-transparent hover:border-border/60 focus:border-primary/50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="a in FK_ACTIONS" :key="a" :value="a" class="text-xs font-mono">{{ a }}</SelectItem>
                </SelectContent>
              </Select>
            </td>
            <td class="border-b border-border/50 p-0.5">
              <Select :model-value="fk.onUpdate ?? 'NO ACTION'" @update:model-value="emit('updateForeignKey', idx, 'onUpdate', $event)">
                <SelectTrigger class="h-6 text-xs font-mono border-transparent hover:border-border/60 focus:border-primary/50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="a in FK_ACTIONS" :key="a" :value="a" class="text-xs font-mono">{{ a }}</SelectItem>
                </SelectContent>
              </Select>
            </td>
            <td class="border-b border-border/50 px-0.5 py-0.5 text-center">
              <button class="size-5 inline-flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all" @click="emit('removeForeignKey', idx)">
                <X class="size-3" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
