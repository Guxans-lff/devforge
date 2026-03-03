<script setup lang="ts">
import { computed, watch, ref, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import {
  useVueTable,
  getCoreRowModel,
  getSortedRowModel,
  createColumnHelper,
  FlexRender,
} from '@tanstack/vue-table'
import type { ColumnDef as TanstackColumnDef, SortingState } from '@tanstack/vue-table'
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Clock,
  AlertCircle,
  CheckCircle2,
  Hash,
  Download,
  RefreshCw,
  Trash2,
  Filter,
  ShieldAlert,
  WifiOff,
  KeyRound,
  Activity,
  RotateCcw,
} from 'lucide-vue-next'
import type { QueryResult as QueryResultType } from '@/types/database'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile, dbExecuteQuery } from '@/api/database'
import { formatData, getFilters, type ExportFormat } from '@/utils/exportData'
import { useToast } from '@/composables/useToast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

const props = defineProps<{
  result: QueryResultType | null
  loading?: boolean
  loadingMore?: boolean
  hasMoreServerRows?: boolean
  showReconnect?: boolean
  /** 连接 ID，用于执行 UPDATE/DELETE */
  connectionId?: string
  /** 当前浏览的数据库名 */
  database?: string
  /** 当前浏览的表名 */
  tableName?: string
  /** 数据库驱动类型 */
  driver?: string
  /** 是否为表浏览模式（启用服务端过滤/排序） */
  isTableBrowse?: boolean
}>()

const emit = defineEmits<{
  reconnect: []
  loadMore: []
  /** 数据变更后刷新 */
  refresh: []
  /** 服务端过滤（WHERE 子句） */
  serverFilter: [whereClause: string]
  /** 服务端排序（ORDER BY 子句） */
  serverSort: [orderBy: string]
}>()

const { t } = useI18n()
const sorting = ref<SortingState>([])
const toast = useToast()
const CHUNK_SIZE = 100
const visibleCount = ref(CHUNK_SIZE)
const selectedRowIndex = ref<number | null>(null)

function handleCellClick(value: unknown) {
  const text = value === null || value === undefined ? 'NULL' : String(value)
  navigator.clipboard.writeText(text).then(() => {
    toast.success(t('toast.copySuccess'))
  }).catch((err) => {
    console.warn('Failed to copy to clipboard:', err)
  })
}

type RowData = Record<string, unknown> & { __originalIndex: number }

// === 是否可编辑（需要 connectionId + database + tableName） ===
const editable = computed(() => !!props.connectionId && !!props.database && !!props.tableName)

// === 列过滤 ===
const showFilters = ref(false)
const columnFilters = ref<Record<string, string>>({})
const filterOperators = ref<Record<string, string>>({})

function toggleFilters() {
  showFilters.value = !showFilters.value
  if (!showFilters.value) {
    columnFilters.value = {}
    filterOperators.value = {}
    // 表浏览模式下清除过滤时发送空 WHERE
    if (props.isTableBrowse) {
      emit('serverFilter', '')
    }
  }
}

function quoteId(name: string): string {
  return props.driver === 'postgresql' ? `"${name}"` : `\`${name}\``
}

// 构建服务端 WHERE 子句
function buildServerWhereClause(): string {
  const parts: string[] = []
  for (const [colName, filterVal] of Object.entries(columnFilters.value)) {
    const val = filterVal.trim()
    if (!val) continue
    const op = filterOperators.value[colName] || 'LIKE'
    const quoted = quoteId(colName)
    if (op === 'IS NULL') {
      parts.push(`${quoted} IS NULL`)
    } else if (op === 'IS NOT NULL') {
      parts.push(`${quoted} IS NOT NULL`)
    } else if (op === 'LIKE') {
      parts.push(`${quoted} LIKE '%${val.replace(/'/g, "''")}%'`)
    } else if (op === 'IN') {
      const items = val.split(',').map(v => `'${v.trim().replace(/'/g, "''")}'`).join(', ')
      parts.push(`${quoted} IN (${items})`)
    } else {
      parts.push(`${quoted} ${op} '${val.replace(/'/g, "''")}'`)
    }
  }
  return parts.join(' AND ')
}

let filterDebounceTimer: ReturnType<typeof setTimeout> | null = null

function handleFilterChange(colName: string, value: string) {
  columnFilters.value = { ...columnFilters.value, [colName]: value }
  if (props.isTableBrowse) {
    if (filterDebounceTimer) clearTimeout(filterDebounceTimer)
    filterDebounceTimer = setTimeout(() => {
      emit('serverFilter', buildServerWhereClause())
    }, 500)
  }
}

function handleOperatorChange(colName: string, op: string) {
  filterOperators.value = { ...filterOperators.value, [colName]: op }
  // 对于不需要值的操作符，立即触发
  if (props.isTableBrowse && (op === 'IS NULL' || op === 'IS NOT NULL')) {
    emit('serverFilter', buildServerWhereClause())
  }
}

// === 服务端排序 ===
const serverSortCol = ref<string | null>(null)
const serverSortDir = ref<'ASC' | 'DESC' | null>(null)

function handleHeaderClick(columnId: string) {
  if (props.isTableBrowse) {
    // 服务端排序
    if (serverSortCol.value === columnId) {
      if (serverSortDir.value === 'ASC') {
        serverSortDir.value = 'DESC'
      } else if (serverSortDir.value === 'DESC') {
        serverSortCol.value = null
        serverSortDir.value = null
      }
    } else {
      serverSortCol.value = columnId
      serverSortDir.value = 'ASC'
    }
    const orderBy = serverSortCol.value && serverSortDir.value
      ? `${quoteId(serverSortCol.value)} ${serverSortDir.value}`
      : ''
    emit('serverSort', orderBy)
  }
  // 客户端排序（非表浏览模式）由 TanStack Table 处理
}

// === 内联编辑 ===
const editingCell = ref<{ rowIndex: number; colName: string } | null>(null)
const editingValue = ref('')

function startEdit(rowIndex: number, colName: string, currentValue: unknown) {
  if (!editable.value) return
  editingCell.value = { rowIndex, colName }
  editingValue.value = currentValue === null || currentValue === undefined ? '' : String(currentValue)
}

function cancelEdit() {
  editingCell.value = null
  editingValue.value = ''
}

function buildWhereClause(row: unknown[]): string {
  if (!props.result) return '1=0'
  const parts: string[] = []
  props.result.columns.forEach((col, i) => {
    const val = row[i]
    if (val === null || val === undefined) {
      parts.push(`${quoteId(col.name)} IS NULL`)
    } else {
      parts.push(`${quoteId(col.name)} = '${String(val).replace(/'/g, "''")}'`)
    }
  })
  return parts.join(' AND ')
}

function getOriginalRow(displayIndex: number): unknown[] | null {
  const tableRow = table.getRowModel().rows[displayIndex]
  if (!tableRow || !props.result) return null
  const originalIdx = tableRow.original.__originalIndex
  return props.result.rows[originalIdx] ?? null
}

async function saveEdit() {
  if (!editingCell.value || !props.result || !editable.value) return
  const { rowIndex, colName } = editingCell.value
  const row = getOriginalRow(rowIndex)
  if (!row) { cancelEdit(); return }

  // 保存滚动位置
  const scrollTop = tableScrollRef.value?.scrollTop ?? 0
  const scrollLeft = tableScrollRef.value?.scrollLeft ?? 0

  const newVal = editingValue.value === '' ? 'NULL' : `'${editingValue.value.replace(/'/g, "''")}'`
  const where = buildWhereClause(row)
  const sql = `UPDATE ${quoteId(props.database!)}.${quoteId(props.tableName!)} SET ${quoteId(colName)} = ${newVal} WHERE ${where} LIMIT 1`

  try {
    const result = await dbExecuteQuery(props.connectionId!, sql)
    if (result.isError) {
      toast.error(t('database.queryError'), result.error ?? '')
    } else {
      toast.success(t('database.updateSuccess'))
      emit('refresh')
      // 恢复滚动位置
      nextTick(() => {
        if (tableScrollRef.value) {
          tableScrollRef.value.scrollTop = scrollTop
          tableScrollRef.value.scrollLeft = scrollLeft
        }
      })
    }
  } catch (e) {
    toast.error(t('database.queryError'), String(e))
  }
  cancelEdit()
}

// === 行删除 ===
const deleteConfirmOpen = ref(false)
const pendingDeleteIndex = ref<number | null>(null)

function requestDeleteRow(displayIndex: number) {
  pendingDeleteIndex.value = displayIndex
  deleteConfirmOpen.value = true
}

async function confirmDeleteRow() {
  if (pendingDeleteIndex.value === null) return
  await deleteRow(pendingDeleteIndex.value)
  pendingDeleteIndex.value = null
}

async function deleteRow(displayIndex: number) {
  if (!props.result || !editable.value) return
  const row = getOriginalRow(displayIndex)
  if (!row) return

  // 保存滚动位置
  const scrollTop = tableScrollRef.value?.scrollTop ?? 0
  const scrollLeft = tableScrollRef.value?.scrollLeft ?? 0

  const where = buildWhereClause(row)
  const sql = `DELETE FROM ${quoteId(props.database!)}.${quoteId(props.tableName!)} WHERE ${where} LIMIT 1`

  try {
    const result = await dbExecuteQuery(props.connectionId!, sql)
    if (result.isError) {
      toast.error(t('database.queryError'), result.error ?? '')
    } else {
      toast.success(t('database.deleteSuccess'))
      emit('refresh')
      // 恢复滚动位置
      nextTick(() => {
        if (tableScrollRef.value) {
          tableScrollRef.value.scrollTop = scrollTop
          tableScrollRef.value.scrollLeft = scrollLeft
        }
      })
    }
  } catch (e) {
    toast.error(t('database.queryError'), String(e))
  }
}

async function handleExport(format: ExportFormat) {
  if (!props.result || props.result.isError) return

  const filters = getFilters(format)
  const path = await save({
    defaultPath: `export.${format}`,
    filters,
  })

  if (!path) return

  try {
    const content = formatData(props.result, format, 'exported_table')
    await writeTextFile(path, content)
    toast.success(t('toast.exportSuccess'))
  } catch (e) {
    toast.error(t('toast.exportFailed'), String(e))
  }
}

const allTableData = computed<RowData[]>(() => {
  if (!props.result || props.result.isError || props.result.columns.length === 0) return []
  // 先构建带原始索引的行数据
  let indexed = props.result.rows.map((row, originalIdx) => ({ row, originalIdx }))
  // 应用列过滤
  const activeFilters = Object.entries(columnFilters.value).filter(([, v]) => v.trim() !== '')
  if (activeFilters.length > 0) {
    indexed = indexed.filter(({ row }) =>
      activeFilters.every(([colName, filterVal]) => {
        const colIdx = props.result!.columns.findIndex((c) => c.name === colName)
        if (colIdx < 0) return true
        const cellVal = row[colIdx]
        const cellStr = cellVal === null || cellVal === undefined ? 'NULL' : String(cellVal)
        return cellStr.toLowerCase().includes(filterVal.trim().toLowerCase())
      }),
    )
  }
  return indexed.map(({ row, originalIdx }) => {
    const obj: RowData = { __originalIndex: originalIdx }
    props.result!.columns.forEach((col, i) => {
      obj[col.name] = row[i]
    })
    return obj
  })
})

const totalRows = computed(() => allTableData.value.length)
const hasMore = computed(() => visibleCount.value < totalRows.value || !!props.hasMoreServerRows)

const tableData = computed<RowData[]>(() => {
  return allTableData.value.slice(0, visibleCount.value)
})

function loadMore() {
  if (!hasMore.value) return
  visibleCount.value = Math.min(visibleCount.value + CHUNK_SIZE, totalRows.value)
}

// result 变化时：如果是追加数据（行数增加），扩展 visibleCount；否则重置
const prevRowCount = ref(0)
watch(() => props.result, (newResult) => {
  const newCount = newResult?.rows?.length ?? 0
  const oldCount = prevRowCount.value
  if (newCount > oldCount && oldCount > 0) {
    // 追加数据，展示所有新数据
    visibleCount.value = newCount
  } else {
    // 全新查询结果，重置
    visibleCount.value = CHUNK_SIZE
    selectedRowIndex.value = null
  }
  prevRowCount.value = newCount
})

const columns = computed<TanstackColumnDef<RowData, unknown>[]>(() => {
  if (!props.result || props.result.columns.length === 0) return []
  const helper = createColumnHelper<RowData>()
  return props.result.columns.map((col) =>
    helper.accessor(col.name, {
      header: col.name,
      cell: (info) => {
        const val = info.getValue()
        if (val === null || val === undefined) return 'NULL'
        return String(val)
      },
    }),
  )
})

const table = useVueTable({
  get data() {
    return tableData.value
  },
  get columns() {
    return columns.value
  },
  state: {
    get sorting() {
      return sorting.value
    },
  },
  onSortingChange: (updater) => {
    sorting.value = typeof updater === 'function' ? updater(sorting.value) : updater
  },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
})

const tableScrollRef = ref<HTMLDivElement | null>(null)
const ROW_HEIGHT = 28

// 统一的 grid 列宽，确保 header 和 body 对齐
const gridStyle = computed(() => {
  const colCount = columns.value.length
  if (colCount === 0) return {}
  // 第一列（行号）固定 60px，其余列等宽，可编辑时末尾加操作列 40px
  const actionCol = editable.value ? ' 40px' : ''
  return {
    display: 'grid',
    gridTemplateColumns: `60px repeat(${colCount}, minmax(120px, 1fr))${actionCol}`,
  }
})

const rowVirtualizer = useVirtualizer({
  get count() { return table.getRowModel().rows.length },
  getScrollElement: () => tableScrollRef.value,
  estimateSize: () => ROW_HEIGHT,
  overscan: 15,
})

// 无感加载：滚动到底部时自动加载更多
function handleScroll() {
  const el = tableScrollRef.value
  if (!el || !hasMore.value) return
  // 距离底部 200px 时触发加载
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
    if (visibleCount.value < totalRows.value) {
      // 先展示本地已有的数据
      loadMore()
    } else if (props.hasMoreServerRows && !props.loadingMore) {
      // 本地数据已全部展示，从服务端加载更多
      emit('loadMore')
    }
  }
}

// 用 watcher 绑定 scroll 事件（因为 tableScrollRef 是条件渲染的）
watch(tableScrollRef, (el, oldEl) => {
  oldEl?.removeEventListener('scroll', handleScroll)
  el?.addEventListener('scroll', handleScroll, { passive: true })
})

onBeforeUnmount(() => {
  tableScrollRef.value?.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <!-- Status bar -->
    <div
      class="flex items-center gap-4 border-b border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <template v-if="loading">
        <div class="flex items-center gap-1.5">
          <div class="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <span>{{ t('database.executing') }}</span>
        </div>
      </template>
      <template v-else-if="result">
        <template v-if="result.isError" />
        <template v-else>
          <div class="flex items-center gap-1.5">
            <CheckCircle2 class="h-3.5 w-3.5 text-[var(--df-success)]" />
            <span v-if="result.columns.length > 0">
              {{ result.rows.length }} {{ t('database.rows') }}
            </span>
            <span v-else>
              {{ result.affectedRows }} {{ t('database.rowsAffected') }}
            </span>
          </div>
          <div class="flex items-center gap-1.5">
            <Clock class="h-3.5 w-3.5" />
            <span>{{ result.executionTimeMs }}ms</span>
          </div>
          <div v-if="result.columns.length > 0" class="flex items-center gap-1.5">
            <Hash class="h-3.5 w-3.5" />
            <span>{{ result.columns.length }} {{ t('database.columns') }}</span>
          </div>
          <div class="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            class="h-5 gap-1 text-xs px-1.5"
            :class="{ 'text-primary': showFilters }"
            @click="toggleFilters"
          >
            <Filter class="h-3 w-3" />
            {{ t('database.filter') }}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="sm" class="h-5 gap-1 text-xs px-1.5">
                <Download class="h-3 w-3" />
                {{ t('database.export') }}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click="handleExport('csv')">
                {{ t('database.exportCSV') }}
              </DropdownMenuItem>
              <DropdownMenuItem @click="handleExport('json')">
                {{ t('database.exportJSON') }}
              </DropdownMenuItem>
              <DropdownMenuItem @click="handleExport('sql')">
                {{ t('database.exportSQL') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </template>
      </template>
      <template v-else>
        <span>{{ t('database.ready') }}</span>
      </template>
    </div>

    <!-- Table -->
    <div ref="tableScrollRef" class="qr-scroll-area min-h-0 flex-1 overflow-scroll">
      <div
        v-if="result && !result.isError && result.columns.length > 0"
        class="text-sm"
        :style="{ minWidth: `${(result.columns.length + 1) * 120 + (editable ? 40 : 0)}px` }"
      >
        <!-- Header -->
        <div
          class="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm"
        >
          <div class="flex" :style="gridStyle">
            <div
              class="whitespace-nowrap border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-muted-foreground"
            >
              #
            </div>
            <div
              v-for="header in table.getFlatHeaders()"
              :key="header.id"
              class="cursor-pointer select-none whitespace-nowrap border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
              @click="isTableBrowse ? handleHeaderClick(header.column.id) : header.column.getToggleSortingHandler()?.($event)"
            >
              <div class="flex items-center gap-1">
                <FlexRender :render="header.column.columnDef.header" :props="header.getContext()" />
                <template v-if="isTableBrowse">
                  <ArrowUp
                    v-if="serverSortCol === header.column.id && serverSortDir === 'ASC'"
                    class="h-3 w-3 text-primary"
                  />
                  <ArrowDown
                    v-else-if="serverSortCol === header.column.id && serverSortDir === 'DESC'"
                    class="h-3 w-3 text-primary"
                  />
                  <ArrowUpDown v-else class="h-3 w-3 opacity-30" />
                </template>
                <template v-else>
                  <ArrowUp
                    v-if="header.column.getIsSorted() === 'asc'"
                    class="h-3 w-3"
                  />
                  <ArrowDown
                    v-else-if="header.column.getIsSorted() === 'desc'"
                    class="h-3 w-3"
                  />
                  <ArrowUpDown v-else class="h-3 w-3 opacity-30" />
                </template>
              </div>
            </div>
            <div
              v-if="editable"
              class="whitespace-nowrap border-b border-r border-border px-1 py-1.5 text-center text-xs font-medium text-muted-foreground"
            />
          </div>
          <!-- Filter row -->
          <div v-if="showFilters" class="flex" :style="gridStyle">
            <div class="border-b border-r border-border px-1 py-0.5" />
            <div
              v-for="header in table.getFlatHeaders()"
              :key="'filter-' + header.id"
              class="border-b border-r border-border px-1 py-0.5"
            >
              <div v-if="isTableBrowse" class="flex gap-0.5">
                <select
                  :value="filterOperators[header.column.id] || 'LIKE'"
                  class="h-5 w-14 shrink-0 rounded-sm border border-border bg-background text-[9px] outline-none focus:border-primary"
                  @change="handleOperatorChange(header.column.id, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="LIKE">LIKE</option>
                  <option value="=">=</option>
                  <option value="!=">!=</option>
                  <option value=">">&gt;</option>
                  <option value="<">&lt;</option>
                  <option value=">=">>=</option>
                  <option value="<="><=</option>
                  <option value="IN">IN</option>
                  <option value="IS NULL">NULL</option>
                  <option value="IS NOT NULL">!NULL</option>
                </select>
                <input
                  :value="columnFilters[header.column.id] ?? ''"
                  :placeholder="t('database.filterPlaceholder')"
                  :disabled="(filterOperators[header.column.id] === 'IS NULL' || filterOperators[header.column.id] === 'IS NOT NULL')"
                  class="h-5 min-w-0 flex-1 rounded-sm border border-border bg-background px-1 text-[10px] outline-none focus:border-primary disabled:opacity-40"
                  @input="handleFilterChange(header.column.id, ($event.target as HTMLInputElement).value)"
                />
              </div>
              <input
                v-else
                :value="columnFilters[header.column.id] ?? ''"
                :placeholder="t('database.filterPlaceholder')"
                class="h-5 w-full rounded-sm border border-border bg-background px-1.5 text-[10px] outline-none focus:border-primary"
                @input="columnFilters = { ...columnFilters, [header.column.id]: ($event.target as HTMLInputElement).value }"
              />
            </div>
            <div v-if="editable" class="border-b border-r border-border px-1 py-0.5" />
          </div>
        </div>

        <!-- Body (virtual rows) -->
        <div :style="{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }">
          <div
            v-for="vRow in rowVirtualizer.getVirtualItems()"
            :key="vRow.index"
            class="flex transition-colors cursor-pointer absolute left-0 right-0"
            :style="{ height: `${ROW_HEIGHT}px`, transform: `translateY(${vRow.start}px)`, ...gridStyle }"
            :class="selectedRowIndex === vRow.index ? 'bg-primary/10' : 'hover:bg-muted/30'"
            @click="selectedRowIndex = vRow.index"
          >
            <div
              class="whitespace-nowrap border-b border-r border-border px-3 text-xs text-muted-foreground tabular-nums flex items-center"
            >
              {{ vRow.index + 1 }}
            </div>
            <div
              v-for="cell in table.getRowModel().rows[vRow.index]?.getVisibleCells()"
              :key="cell.id"
              class="select-text whitespace-nowrap border-b border-r border-border px-3 font-mono text-xs flex items-center overflow-hidden"
              :class="{
                'text-muted-foreground/50 italic': cell.getValue() === null || cell.getValue() === undefined,
                'cursor-pointer hover:bg-muted/50': !editingCell || editingCell.rowIndex !== vRow.index || editingCell.colName !== cell.column.id,
              }"
              @dblclick="editable ? startEdit(vRow.index, cell.column.id, cell.getValue()) : handleCellClick(cell.getValue())"
            >
              <template v-if="editingCell && editingCell.rowIndex === vRow.index && editingCell.colName === cell.column.id">
                <input
                  :value="editingValue"
                  class="h-full w-full bg-background px-1 text-xs font-mono outline-none border border-primary rounded-sm"
                  autofocus
                  @input="editingValue = ($event.target as HTMLInputElement).value"
                  @keydown.enter="saveEdit"
                  @keydown.escape="cancelEdit"
                  @blur="saveEdit"
                />
              </template>
              <template v-else>
                <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
              </template>
            </div>
            <div
              v-if="editable"
              class="border-b border-r border-border flex items-center justify-center"
            >
              <button
                class="h-5 w-5 flex items-center justify-center rounded-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                :title="t('common.delete')"
                @click.stop="requestDeleteRow(vRow.index)"
              >
                <Trash2 class="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Error state (High Fidelity Card) -->
      <div
        v-else-if="result && result.isError"
        class="absolute inset-0 z-10 flex items-center justify-center bg-background/40 backdrop-blur-[1px] p-6 animate-in fade-in zoom-in-95 duration-500"
      >
        <div class="relative w-full max-w-sm overflow-hidden rounded-2xl border border-border/20 bg-background/80 p-6 shadow-2xl backdrop-blur-xl ring-1 ring-white/5">
          <!-- Background Glow -->
          <div class="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-destructive/10 blur-2xl font-black"></div>
          <div class="absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-primary/5 blur-2xl"></div>

          <div class="relative flex flex-col items-center text-center">
            <!-- Icon Container -->
            <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 ring-1 ring-destructive/20 shadow-[0_8px_16px_rgba(var(--color-destructive),0.1)]">
              <ShieldAlert class="h-7 w-7 text-destructive" />
            </div>

            <h3 class="mb-1 text-base font-bold tracking-tight text-foreground">
              {{ t('database.queryError') }}
            </h3>
            <p class="mb-6 px-4 font-mono text-[11px] font-medium leading-relaxed text-muted-foreground/80 break-all max-h-32 overflow-auto qr-scroll-area">
               {{ result.error }}
            </p>

            <!-- Diagnostic Suggestions -->
            <div class="mb-8 grid w-full grid-cols-1 gap-2 text-left">
               <div class="flex items-start gap-2.5 rounded-lg bg-muted/30 p-2.5 ring-1 ring-border/5 transition-colors hover:bg-muted/50">
                  <WifiOff class="mt-0.5 h-3.5 w-3.5 text-muted-foreground/60" />
                  <div>
                     <p class="text-[10px] font-bold text-foreground/70 uppercase tracking-tighter">{{ t('connection.checkNetwork' as any) || '连接检查' }}</p>
                     <p class="text-[9px] font-medium text-muted-foreground/50">{{ t('connection.checkNetworkDesc' as any) || '确保数据库服务地址/端口可达，检查防火墙/白名单。' }}</p>
                  </div>
               </div>
               <div class="flex items-start gap-2.5 rounded-lg bg-muted/30 p-2.5 ring-1 ring-border/5 transition-colors hover:bg-muted/50">
                  <KeyRound class="mt-0.5 h-3.5 w-3.5 text-muted-foreground/60" />
                  <div>
                     <p class="text-[10px] font-bold text-foreground/70 uppercase tracking-tighter">{{ t('connection.checkAuth' as any) || '配置检查' }}</p>
                     <p class="text-[9px] font-medium text-muted-foreground/50">{{ t('connection.checkAuthDesc' as any) || '检查驱动、用户名、密码或连接池配置。' }}</p>
                  </div>
               </div>
               <div class="flex items-start gap-2.5 rounded-lg bg-muted/30 p-2.5 ring-1 ring-border/5 transition-colors hover:bg-muted/50">
                  <Activity class="mt-0.5 h-3.5 w-3.5 text-muted-foreground/60" />
                  <div>
                     <p class="text-[10px] font-bold text-foreground/70 uppercase tracking-tighter">{{ t('connection.checkServer' as any) || '远程权限' }}</p>
                     <p class="text-[9px] font-medium text-muted-foreground/50">{{ t('connection.checkServerDesc' as any) || '确认该账号具备从当前 IP 远程连接的权限。' }}</p>
                  </div>
               </div>
            </div>

            <!-- Actions -->
            <div class="flex w-full items-center gap-2">
              <Button
                v-if="showReconnect"
                class="flex-1 h-9 bg-primary text-[12px] font-bold shadow-[0_4px_12px_rgba(var(--color-primary),0.3)] hover:shadow-[0_6px_20_rgba(var(--color-primary),0.4)] transition-all active:scale-95"
                @click="emit('reconnect')"
              >
                <RotateCcw class="mr-1.5 h-3.5 w-3.5" />
                {{ t('database.reconnect') }}
              </Button>
              <Button
                variant="outline"
                class="h-9 flex-1 text-[12px] font-medium border-border/40 hover:bg-muted/30 transition-all active:scale-95"
                @click="emit('refresh')"
              >
                {{ t('common.retry' as any) || '重试' }}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-else-if="!loading && (!result || (!result.isError && result.columns.length === 0))"
        class="flex h-full items-center justify-center text-muted-foreground"
      >
        <p class="text-sm">{{ t('database.noResults') }}</p>
      </div>
    </div>

    <!-- Status footer -->
    <div
      v-if="result && !result.isError && result.columns.length > 0"
      class="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground shrink-0"
    >
      <span>
        {{ t('database.showing') }} {{ Math.min(visibleCount, totalRows) }} / {{ result.totalCount ?? totalRows }} {{ t('database.rows') }}
        <template v-if="loadingMore"> ({{ t('database.loadingMore') }}...)</template>
      </span>
      <span v-if="hasMore" class="text-primary/70">{{ t('database.scrollForMore') }}</span>
    </div>

    <!-- 删除确认对话框 -->
    <ConfirmDialog
      v-model:open="deleteConfirmOpen"
      :title="t('database.confirmDeleteRow')"
      :description="t('database.confirmDeleteRowDesc')"
      :confirm-label="t('common.delete')"
      :cancel-label="t('common.cancel')"
      variant="destructive"
      @confirm="confirmDeleteRow"
    />
  </div>
</template>
