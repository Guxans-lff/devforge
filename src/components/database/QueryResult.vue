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
import type { ColumnDef as TanstackColumnDef, SortingState, ColumnResizeMode } from '@tanstack/vue-table'
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
import { useAdaptiveOverscan } from '@/composables/useAdaptiveOverscan'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import ExportDialog from '@/components/database/ExportDialog.vue'

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
const CHUNK_SIZE = 200
const visibleCount = ref(CHUNK_SIZE)
const selectedRowIndex = ref<number | null>(null)
const columnResizeMode = ref<ColumnResizeMode>('onChange')

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

/**
 * 判断当前错误是否为连接类错误（网络/认证/权限）
 * 连接类错误显示网络排查建议，SQL 执行错误显示语法/逻辑排查建议
 */
const isConnectionError = computed(() => {
  const err = props.result?.error?.toLowerCase() ?? ''
  // 连接类错误关键词匹配
  const connectionKeywords = [
    'connection refused', 'connection reset', 'connection timed out',
    'can\'t connect', 'cannot connect', 'unable to connect',
    'broken pipe', 'network', 'timeout', 'timed out',
    'access denied', 'authentication', 'login failed',
    'host is not allowed', 'too many connections',
    'gone away', 'lost connection', 'server has gone away',
    'ssl', 'handshake',
  ]
  return connectionKeywords.some(kw => err.includes(kw))
})

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

// === 多格式导出对话框 ===
const exportDialogOpen = ref(false)

/** 构建导出数据来源（用于 ExportDialog） */
const exportSource = computed(() => {
  if (props.database && props.tableName) {
    return {
      type: 'table' as const,
      database: props.database,
      table: props.tableName,
    }
  }
  // 查询结果导出：使用空 SQL（后端不需要重新执行）
  return {
    type: 'table' as const,
    database: props.database ?? '',
    table: props.tableName ?? 'exported_table',
  }
})

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
  columnResizeMode: columnResizeMode.value,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
})

const tableScrollRef = ref<HTMLDivElement | null>(null)
const ROW_HEIGHT = 28

// 统一的 grid 列宽，确保 header 和 body 对齐
const gridStyle = computed(() => {
  const headers = table.getFlatHeaders()
  const colCount = headers.length
  if (colCount === 0) return {}

  // 动态构建列宽字符串
  const columnWidths = headers.map(header => `${header.getSize()}px`).join(' ')
  const actionCol = editable.value ? ' 40px' : ''

  return {
    display: 'grid',
    gridTemplateColumns: `60px ${columnWidths}${actionCol}`,
  }
})

// 缓存虚拟行基础样式，避免每行都展开 gridStyle 创建新对象
const rowBaseStyle = computed(() => {
  const gs = gridStyle.value
  return {
    ...gs,
    height: `${ROW_HEIGHT}px`,
  }
})

// 自适应 overscan：根据滚动速度动态调整预渲染行数
const { overscan: adaptiveOverscan, attach: attachOverscan, detach: detachOverscan } = useAdaptiveOverscan(
  tableScrollRef,
  { baseOverscan: 20, maxOverscan: 80, rowHeight: ROW_HEIGHT, velocityThreshold: 15, decayDelay: 300 },
)

const rowVirtualizer = useVirtualizer({
  get count() { return table.getRowModel().rows.length },
  getScrollElement: () => tableScrollRef.value,
  estimateSize: () => ROW_HEIGHT,
  get overscan() { return adaptiveOverscan.value },
})

// 无感加载：滚动到底部时自动加载更多
function handleScroll() {
  const el = tableScrollRef.value
  if (!el || !hasMore.value) return
  // 距离底部 500px 时提前触发加载，避免快速滚动时数据断层
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 500) {
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
  // 同步绑定自适应 overscan 的滚动监听
  if (el) attachOverscan()
  else detachOverscan()
})

onBeforeUnmount(() => {
  tableScrollRef.value?.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <!-- Status bar (Sharp text layout) -->
    <div
      class="flex h-8 items-center gap-6 border-b border-border bg-muted/20 px-4 text-[11px] text-muted-foreground transition-colors shrink-0"
    >
      <template v-if="loading">
        <div class="flex items-center gap-2 text-primary animate-pulse">
          <Loader2 class="h-3.5 w-3.5 animate-spin" />
          <span class="font-medium tracking-tight">{{ t('database.executing') }}</span>
        </div>
      </template>
      <template v-else-if="result">
        <template v-if="result.isError" />
        <template v-else>
          <div class="flex items-center gap-1.5 hover:text-foreground transition-colors">
            <CheckCircle2 class="h-3.5 w-3.5 text-green-500" />
            <span v-if="result.columns.length > 0" class="font-medium tracking-tight tabular-nums">
              {{ result.rows.length }} <span class="opacity-60">{{ t('database.rows') }}</span>
            </span>
            <span v-else class="font-medium tracking-tight">
              {{ result.affectedRows }} <span class="opacity-60">{{ t('database.rowsAffected') }}</span>
            </span>
          </div>
          <div class="flex items-center gap-1.5 hover:text-foreground transition-colors">
            <Clock class="h-3.5 w-3.5 opacity-60" />
            <span class="font-medium tracking-tight tabular-nums">{{ result.executionTimeMs }}<span class="text-[10px] opacity-60">ms</span></span>
          </div>
          <div v-if="result.columns.length > 0" class="flex items-center gap-1.5 hover:text-foreground transition-colors">
            <Hash class="h-3.5 w-3.5 opacity-60" />
            <span class="font-medium tracking-tight tabular-nums">{{ result.columns.length }} <span class="opacity-60">{{ t('database.columns') }}</span></span>
          </div>
          <div class="flex-1" />
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              class="h-6 gap-1.5 text-[10px] px-2 hover:bg-muted/50 rounded-md transition-all active:scale-95"
              :class="{ 'text-primary bg-primary/10': showFilters }"
              @click="toggleFilters"
            >
              <Filter class="h-3 w-3" />
              {{ t('database.filter') }}
            </Button>
            <div class="w-px h-3 bg-border/50 mx-1" />
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="sm" class="h-6 gap-1.5 text-[10px] px-2 hover:bg-muted/50 rounded-md transition-all active:scale-95">
                  <Download class="h-3 w-3" />
                  {{ t('database.export') }}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="min-w-[140px]">
                <DropdownMenuItem @click="handleExport('csv')">CSV</DropdownMenuItem>
                <DropdownMenuItem @click="handleExport('json')">JSON</DropdownMenuItem>
                <DropdownMenuItem @click="handleExport('sql')">SQL脚本</DropdownMenuItem>
                <DropdownMenuItem @click="handleExport('markdown')">Markdown</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem v-if="connectionId" @click="exportDialogOpen = true" class="font-medium text-primary">多格式高级导出...</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </template>
      </template>
      <template v-else>
        <span class="opacity-50 italic">{{ t('database.ready') }}</span>
      </template>
    </div>

    <!-- Table -->
    <!-- contain: strict 限制重排范围，避免虚拟滚动区域内的变化触发外部布局重算 -->
    <div ref="tableScrollRef" class="qr-scroll-area relative min-h-0 flex-1 overflow-auto bg-background/30 border-t border-border/50" style="contain: strict">
      <div
        v-if="result && !result.isError && result.columns.length > 0"
        class="text-sm min-w-full inline-block align-top"
        :style="{ width: 'max-content' }"
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
              class="group/header relative select-none whitespace-nowrap border-b border-r border-border px-3 py-1.5 text-left text-xs font-bold text-muted-foreground/80 hover:bg-muted/50 transition-colors"
            >
              <div 
                class="flex items-center gap-1 cursor-pointer"
                @click="isTableBrowse ? handleHeaderClick(header.column.id) : header.column.getToggleSortingHandler()?.($event)"
              >
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
                  <ArrowUpDown v-else class="h-3 w-3 opacity-0 group-hover/header:opacity-30" />
                </template>
                <template v-else>
                  <ArrowUp
                    v-if="header.column.getIsSorted() === 'asc'"
                    class="h-3 w-3 text-primary"
                  />
                  <ArrowDown
                    v-else-if="header.column.getIsSorted() === 'desc'"
                    class="h-3 w-3 text-primary"
                  />
                  <ArrowUpDown v-else class="h-3 w-3 opacity-0 group-hover/header:opacity-30" />
                </template>
              </div>

              <!-- Resizer Handle -->
              <div
                v-if="header.column.getCanResize()"
                class="absolute right-0 top-0 h-full w-1 cursor-col-resize user-select-none touch-none hover:bg-primary/50 transition-colors"
                :class="{ 'bg-primary w-0.5 opacity-100': header.column.getIsResizing() }"
                @mousedown="header.getResizeHandler()($event)"
                @touchstart="header.getResizeHandler()($event)"
              />
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
        <div :style="{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }" style="will-change: transform; contain: content">
          <div
            v-for="vRow in rowVirtualizer.getVirtualItems()"
            :key="vRow.index"
            v-memo="[vRow.index, vRow.start, selectedRowIndex === vRow.index, editingCell?.rowIndex === vRow.index, table.getRowModel().rows[vRow.index]?.id]"
            class="flex cursor-pointer absolute left-0 right-0"
            :style="{ ...rowBaseStyle, transform: `translateY(${vRow.start}px)` }"
            :class="selectedRowIndex === vRow.index ? 'bg-primary/10' : 'hover:bg-muted/30'"
            @click="selectedRowIndex = vRow.index"
          >
            <div
              class="whitespace-nowrap border-b border-r border-border bg-muted/5 px-3 text-[10px] font-bold text-muted-foreground/40 tabular-nums flex items-center justify-center"
            >
              {{ vRow.index + 1 }}
            </div>
            <div
              v-for="cell in table.getRowModel().rows[vRow.index]?.getVisibleCells()"
              :key="cell.id"
              class="select-text whitespace-nowrap border-b border-r border-border px-3 font-mono text-[12px] flex items-center overflow-hidden"
              :class="{
                'text-muted-foreground/40 italic font-sans': cell.getValue() === null || cell.getValue() === undefined,
                'cursor-pointer hover:bg-primary/[0.02]': !editingCell || editingCell.rowIndex !== vRow.index || editingCell.colName !== cell.column.id,
                'text-primary font-bold': selectedRowIndex === vRow.index
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
                <!-- 直接渲染单元格文本，避免 FlexRender 组件实例化开销 -->
                <span v-if="cell.getValue() === null || cell.getValue() === undefined">NULL</span>
                <span v-else>{{ String(cell.getValue()) }}</span>
              </template>
            </div>
            <div
              v-if="editable"
              class="border-b border-r border-border flex items-center justify-center"
            >
              <button
                class="h-5 w-5 flex items-center justify-center rounded-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                :title="t('common.delete')"
                @click.stop="requestDeleteRow(vRow.index)"
              >
                <Trash2 class="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 错误状态：内联紧凑展示 -->
      <div
        v-else-if="result && result.isError"
        class="flex flex-col h-full overflow-auto"
      >
        <!-- 错误头部 -->
        <div class="flex items-center gap-2 px-4 py-3 border-b border-destructive/20 bg-destructive/5">
          <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
            <ShieldAlert v-if="isConnectionError" class="h-4 w-4 text-destructive" />
            <AlertCircle v-else class="h-4 w-4 text-destructive" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold text-destructive">
              {{ isConnectionError ? t('database.queryError') : '执行出错' }}
            </p>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <Button
              v-if="showReconnect"
              size="sm"
              class="h-6 text-[10px] gap-1"
              @click="emit('reconnect')"
            >
              <RotateCcw class="h-3 w-3" />
              {{ t('database.reconnect') }}
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-6 text-[10px]"
              @click="emit('refresh')"
            >
              {{ t('common.retry' as any) || '重试' }}
            </Button>
          </div>
        </div>

        <!-- 错误详情 -->
        <div class="flex-1 px-4 py-3 overflow-auto">
          <pre class="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/80 select-text">{{ result.error }}</pre>

          <!-- 诊断建议 -->
          <div class="mt-4 space-y-1.5">
            <p class="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2">排查建议</p>
            <template v-if="isConnectionError">
              <div class="flex items-start gap-2 text-[11px] text-muted-foreground/70">
                <WifiOff class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span>确保数据库服务地址/端口可达，检查防火墙/白名单</span>
              </div>
              <div class="flex items-start gap-2 text-[11px] text-muted-foreground/70">
                <KeyRound class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span>检查用户名、密码或连接池配置是否正确</span>
              </div>
              <div class="flex items-start gap-2 text-[11px] text-muted-foreground/70">
                <Activity class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span>确认该账号具备从当前 IP 远程连接的权限</span>
              </div>
            </template>
            <template v-else>
              <div class="flex items-start gap-2 text-[11px] text-muted-foreground/70">
                <AlertCircle class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span>检查 SQL 关键字拼写、括号匹配、引号闭合是否正确</span>
              </div>
              <div class="flex items-start gap-2 text-[11px] text-muted-foreground/70">
                <Hash class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span>确认表名、列名、数据库名是否存在且拼写正确</span>
              </div>
              <div class="flex items-start gap-2 text-[11px] text-muted-foreground/70">
                <KeyRound class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span>确认当前用户对目标对象有足够权限，检查是否违反约束</span>
              </div>
            </template>
          </div>
        </div>
      </div>


      <!-- Empty initial state -->
      <div
        v-else-if="!loading && !result"
        class="flex h-full items-center justify-center text-muted-foreground"
      >
        <p class="text-sm font-medium tracking-wide">{{ t('database.noResults') }}</p>
      </div>

      <!-- Success state for non-select queries -->
      <div
        v-else-if="!loading && result && !result.isError && result.columns.length === 0"
        class="flex h-full flex-col items-center justify-center text-muted-foreground gap-4 animate-in zoom-in-95 duration-300"
      >
        <div class="rounded-full bg-green-500/10 p-4 shadow-sm">
          <CheckCircle2 class="h-10 w-10 text-green-500" />
        </div>
        <div class="text-center space-y-1.5">
          <p class="text-lg font-bold text-foreground">执行成功</p>
          <p class="text-xs text-muted-foreground/80">
            <span class="font-medium text-foreground">{{ result.affectedRows }}</span> <span class="opacity-80">{{ t('database.rowsAffected') }}</span>
            <span class="mx-2 opacity-30">|</span>
            <span class="opacity-80">耗时</span> <span class="font-medium text-foreground">{{ result.executionTimeMs }}ms</span>
          </p>
        </div>
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

    <!-- 多格式导出对话框 -->
    <ExportDialog
      v-if="connectionId"
      v-model:open="exportDialogOpen"
      :connection-id="connectionId"
      :source="exportSource"
    />
  </div>
</template>
