<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, ChevronLeft, ChevronRight, ClipboardCopy, Code2 } from 'lucide-vue-next'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/composables/useToast'
import type { ColumnDef } from '@/types/database'

const props = defineProps<{
  /** 是否打开 */
  open: boolean
  /** 列定义 */
  columns: ColumnDef[]
  /** 当前行数据（原始数组格式） */
  row: unknown[] | null
  /** 当前行在结果集中的索引 */
  rowIndex: number
  /** 总行数 */
  totalRows: number
  /** 数据库驱动类型 */
  driver?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  /** 导航到上一行/下一行 */
  navigate: [direction: 'prev' | 'next']
}>()

const { t } = useI18n()
const toast = useToast()

/** 长文本展开状态（key: 列索引） */
const expandedCells = ref<Set<number>>(new Set())

/** 长文本阈值 */
const LONG_TEXT_THRESHOLD = 100

// 切换行时重置展开状态
watch(() => props.rowIndex, () => {
  expandedCells.value = new Set()
})

/** 列值对列表 */
const fieldRows = computed(() => {
  if (!props.row || !props.columns) return []
  return props.columns.map((col, i) => ({
    index: i,
    name: col.name,
    dataType: col.dataType,
    nullable: col.nullable,
    value: props.row![i],
    isNull: props.row![i] === null || props.row![i] === undefined,
    displayValue: formatValue(props.row![i]),
    isLong: isLongText(props.row![i]),
  }))
})

/** 格式化单元格值用于显示 */
function formatValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'object') return JSON.stringify(val, null, 2)
  return String(val)
}

/** 判断是否为长文本 */
function isLongText(val: unknown): boolean {
  if (val === null || val === undefined) return false
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
  return str.length > LONG_TEXT_THRESHOLD
}

/** 切换长文本展开/折叠 */
function toggleExpand(index: number) {
  const next = new Set(expandedCells.value)
  if (next.has(index)) {
    next.delete(index)
  } else {
    next.add(index)
  }
  expandedCells.value = next
}

/** 复制单个字段值 */
function copyValue(val: unknown) {
  const text = formatValue(val)
  navigator.clipboard.writeText(text).then(() => {
    toast.success(t('toast.copySuccess'))
  }).catch((e: unknown) => console.warn('[RowDetail]', e))
}

/** 构建引号标识符 */
function quoteId(name: string): string {
  return props.driver === 'postgresql' ? `"${name}"` : `\`${name}\``
}

/** 复制为 JSON */
function copyAsJson() {
  if (!props.row || !props.columns) return
  const obj: Record<string, unknown> = {}
  props.columns.forEach((col, i) => {
    obj[col.name] = props.row![i]
  })
  navigator.clipboard.writeText(JSON.stringify(obj, null, 2)).then(() => {
    toast.success(t('toast.copySuccess'))
  }).catch((e: unknown) => console.warn('[RowDetail]', e))
}

/** 复制为 SQL INSERT */
function copyAsSqlInsert() {
  if (!props.row || !props.columns) return
  const cols = props.columns.map(c => quoteId(c.name)).join(', ')
  const vals = props.row.map(v => {
    if (v === null || v === undefined) return 'NULL'
    if (typeof v === 'number') return String(v)
    if (typeof v === 'boolean') return v ? '1' : '0'
    return `'${String(v).replace(/'/g, "''")}'`
  }).join(', ')
  const sql = `INSERT INTO (${cols}) VALUES (${vals});`
  navigator.clipboard.writeText(sql).then(() => {
    toast.success(t('toast.copySuccess'))
  }).catch((e: unknown) => console.warn('[RowDetail]', e))
}

/** 导航：上一行 */
function navigatePrev() {
  if (props.rowIndex > 0) {
    emit('navigate', 'prev')
  }
}

/** 导航：下一行 */
function navigateNext() {
  if (props.rowIndex < props.totalRows - 1) {
    emit('navigate', 'next')
  }
}

/** 处理键盘导航 */
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowUp' || (e.key === 'k' && e.ctrlKey)) {
    e.preventDefault()
    navigatePrev()
  } else if (e.key === 'ArrowDown' || (e.key === 'j' && e.ctrlKey)) {
    e.preventDefault()
    navigateNext()
  }
}
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent
      side="right"
      class="w-[420px] sm:max-w-[420px] p-0 flex flex-col"
      @keydown="handleKeydown"
    >
      <!-- 头部：行号 + 导航 -->
      <SheetHeader class="px-4 py-3 border-b border-border shrink-0">
        <div class="flex items-center justify-between">
          <SheetTitle class="text-sm font-semibold">
            行 #{{ rowIndex + 1 }}
            <span class="text-muted-foreground font-normal">/ {{ totalRows }}</span>
          </SheetTitle>
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              class="h-7 w-7 p-0"
              :disabled="rowIndex <= 0"
              @click="navigatePrev"
            >
              <ChevronLeft class="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 w-7 p-0"
              :disabled="rowIndex >= totalRows - 1"
              @click="navigateNext"
            >
              <ChevronRight class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SheetHeader>

      <!-- 字段列表 -->
      <ScrollArea class="flex-1 min-h-0">
        <div class="divide-y divide-border/50">
          <div
            v-for="field in fieldRows"
            :key="field.index"
            class="group px-4 py-2.5 hover:bg-muted/30 transition-colors"
          >
            <!-- 列名行 -->
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-2">
                <span class="text-xs font-semibold text-muted-foreground">
                  {{ field.name }}
                </span>
                <span class="text-[10px] text-muted-foreground/50 font-mono">
                  {{ field.dataType }}
                </span>
              </div>
              <TooltipProvider :delay-duration="300">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button
                      class="h-5 w-5 flex items-center justify-center rounded-sm text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted/50 transition-[opacity,background-color,color]"
                      @click="copyValue(field.value)"
                    >
                      <Copy class="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p class="text-xs">复制值</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <!-- 值行 -->
            <div
              class="text-sm font-mono break-all leading-relaxed"
              :class="{
                'text-muted-foreground/40 italic font-sans text-xs': field.isNull,
                'text-foreground': !field.isNull,
              }"
            >
              <template v-if="field.isNull">
                NULL
              </template>
              <template v-else-if="field.isLong && !expandedCells.has(field.index)">
                <span>{{ field.displayValue.slice(0, LONG_TEXT_THRESHOLD) }}</span>
                <button
                  class="ml-1 text-xs text-primary hover:underline"
                  @click="toggleExpand(field.index)"
                >
                  ...展开 ({{ field.displayValue.length }} 字符)
                </button>
              </template>
              <template v-else>
                <span class="whitespace-pre-wrap">{{ field.displayValue }}</span>
                <button
                  v-if="field.isLong"
                  class="ml-1 text-xs text-primary hover:underline"
                  @click="toggleExpand(field.index)"
                >
                  收起
                </button>
              </template>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="!row" class="flex items-center justify-center h-32 text-muted-foreground text-sm">
          未选择行
        </div>
      </ScrollArea>

      <!-- 底部操作栏 -->
      <div class="px-4 py-2.5 border-t border-border bg-muted/20 shrink-0 flex items-center gap-2">
        <Button variant="outline" size="sm" class="h-7 text-xs gap-1.5" @click="copyAsJson">
          <ClipboardCopy class="h-3 w-3" />
          复制为 JSON
        </Button>
        <Button variant="outline" size="sm" class="h-7 text-xs gap-1.5" @click="copyAsSqlInsert">
          <Code2 class="h-3 w-3" />
          复制为 SQL
        </Button>
      </div>
    </SheetContent>
  </Sheet>
</template>
