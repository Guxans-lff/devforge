<script setup lang="ts">
/** 索引编辑表格组件 — 从 TableEditorPanel 拆分，负责索引增删改 */
import { Loader2, X } from 'lucide-vue-next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { INDEX_TYPES } from '@/types/table-editor-constants'
import type { IndexDefinition } from '@/types/table-editor'

defineProps<{
  indexes: IndexDefinition[]
  columnNames: string[]
  indexColumnDropdown: number | null
  loading: boolean
}>()

const emit = defineEmits<{
  updateIndex: [idx: number, field: keyof IndexDefinition, value: unknown]
  removeIndex: [idx: number]
  toggleIndexColumn: [idxIdx: number, colName: string]
  'update:indexColumnDropdown': [value: number | null]
}>()
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <div v-if="loading" class="flex flex-1 items-center justify-center">
      <Loader2 class="size-5 animate-spin text-muted-foreground" />
    </div>
    <div v-else class="flex-1 min-h-0 overflow-auto">
      <table class="w-full border-collapse text-xs">
        <thead class="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
          <tr class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
            <th class="border-b border-border px-2 py-1.5 w-7 text-center">#</th>
            <th class="border-b border-border px-2 py-1.5 min-w-[160px]">名称</th>
            <th class="border-b border-border px-2 py-1.5 min-w-[120px]">类型</th>
            <th class="border-b border-border px-2 py-1.5 min-w-[220px]">列</th>
            <th class="border-b border-border px-2 py-1.5 w-7" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="indexes.length === 0">
            <td colspan="5" class="text-center text-muted-foreground/60 py-8 text-xs">暂无索引，点击上方「添加」按钮</td>
          </tr>
          <tr
            v-for="(ix, idx) in indexes" :key="idx"
            class="group transition-colors"
            :class="idx % 2 === 0 ? 'bg-transparent' : 'bg-muted/20'"
          >
            <td class="border-b border-border/50 px-2 py-0.5 text-center text-[10px] text-muted-foreground/40 tabular-nums">{{ idx + 1 }}</td>
            <td class="border-b border-border/50 p-0.5">
              <input :value="ix.name" class="w-full h-6 px-1.5 text-xs font-mono bg-transparent border border-transparent rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60" @input="emit('updateIndex', idx, 'name', ($event.target as HTMLInputElement).value)" />
            </td>
            <td class="border-b border-border/50 p-0.5">
              <Select :model-value="ix.indexType" @update:model-value="emit('updateIndex', idx, 'indexType', $event)">
                <SelectTrigger class="h-6 text-xs font-mono border-transparent hover:border-border/60 focus:border-primary/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="t in INDEX_TYPES" :key="t" :value="t" class="text-xs font-mono">{{ t }}</SelectItem>
                </SelectContent>
              </Select>
            </td>
            <td class="border-b border-border/50 p-0.5 relative">
              <button
                class="w-full h-6 px-1.5 text-xs font-mono bg-transparent border border-transparent rounded hover:border-border/60 focus:border-primary/50 focus:outline-none text-left truncate"
                :class="ix.columns.length === 0 ? 'text-muted-foreground/40' : ''"
                @click="emit('update:indexColumnDropdown', indexColumnDropdown === idx ? null : idx)"
              >
                {{ ix.columns.length > 0 ? ix.columns.join(', ') : '选择列...' }}
              </button>
              <div v-if="indexColumnDropdown === idx" class="absolute left-0 top-7 z-30 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[180px] max-h-48 overflow-auto">
                <div v-if="columnNames.length === 0" class="px-3 py-2 text-xs text-muted-foreground/60">暂无可用字段</div>
                <button
                  v-for="cn in columnNames" :key="cn"
                  class="w-full px-3 py-1 text-left text-xs font-mono hover:bg-accent flex items-center gap-2"
                  @click.stop="emit('toggleIndexColumn', idx, cn)"
                >
                  <span class="size-3.5 border rounded flex items-center justify-center shrink-0" :class="ix.columns.includes(cn) ? 'bg-primary border-primary text-primary-foreground' : 'border-border'">
                    <span v-if="ix.columns.includes(cn)" class="text-[10px]">✓</span>
                  </span>
                  {{ cn }}
                </button>
              </div>
            </td>
            <td class="border-b border-border/50 px-0.5 py-0.5 text-center">
              <button class="size-5 inline-flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all" @click="emit('removeIndex', idx)">
                <X class="size-3" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
