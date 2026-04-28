/**
 * 查询结果面板核心业务逻辑 composable
 * 从 QueryResult.vue 提取，负责数据过滤/排序/编辑/导出、虚拟滚动配置等
 */
import { ref, computed, watch, nextTick, onBeforeUnmount, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  useVueTable, getCoreRowModel, getSortedRowModel, createColumnHelper,
} from '@tanstack/vue-table'
import type { ColumnDef as TanstackColumnDef, SortingState, ColumnResizeMode, ColumnPinningState } from '@tanstack/vue-table'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile, dbExecuteQueryInDatabase, dbGenerateScript, dbGetTableData } from '@/api/database'
import { formatData, getFilters, type ExportFormat } from '@/utils/exportData'
import { useToast } from '@/composables/useToast'
import { useAdaptiveOverscan } from '@/composables/useAdaptiveOverscan'
import { computeColumnStatsAsync, type ColumnStatsResult } from '@/utils/columnStatistics'
import { fetchPrimaryKeys } from '@/composables/usePrimaryKey'
import { extractNumericCursorValue, isIntegerResultColumn } from '@/composables/useTableSeek'
import type { QueryResult as QueryResultType } from '@/types/database'
import { createLogger } from '@/utils/logger'
import { parseBackendError } from '@/types/error'

export type RowData = Record<string, unknown> & { __originalIndex: number }

export interface UseQueryResultOptions {
  result: Ref<QueryResultType | null>
  loading: Ref<boolean>
  loadingMore: Ref<boolean>
  hasMoreServerRows: Ref<boolean>
  showReconnect: Ref<boolean>
  connectionId: Ref<string | undefined>
  database: Ref<string | undefined>
  tableName: Ref<string | undefined>
  driver: Ref<string | undefined>
  isTableBrowse: Ref<boolean>
  tableScrollRef: Ref<HTMLDivElement | null>
  /** 事件发射器 */
  onReconnect: () => void
  onLoadMore: () => void
  onRefresh: () => void
  onServerFilter: (where: string) => void
  onServerSort: (orderBy: string) => void
}

const CHUNK_SIZE = 200
const ROW_HEIGHT = 28

export function useQueryResult(options: UseQueryResultOptions) {
  const log = createLogger('query-result')
  const {
    result, loading: _loading, loadingMore, hasMoreServerRows, showReconnect: _showReconnect,
    connectionId, database, tableName, driver, isTableBrowse,
    tableScrollRef,
    onReconnect: _onReconnect, onLoadMore, onRefresh, onServerFilter, onServerSort,
  } = options

  const { t } = useI18n()
  const toast = useToast()

  // ===== 核心状态 =====
  const sorting = ref<SortingState>([])
  const columnPinning = ref<ColumnPinningState>({ left: [], right: [] })
  const visibleCount = ref(CHUNK_SIZE)
  const selectedRowIndex = ref<number | null>(null)
  const columnResizeMode = ref<ColumnResizeMode>('onChange')

  // ===== 行详情 =====
  const rowDetailOpen = ref(false)

  // ===== 列统计 =====
  const selectedStatsColumn = ref<string | null>(null)
  const columnStats = ref<ColumnStatsResult | null>(null)
  const computingStats = ref(false)

  // ===== 图表 =====
  const showChart = ref(false)

  // ===== 主键状态 =====
  /** 当前表的主键列名列表（复合主键时有多个元素） */
  const primaryKeys = ref<string[]>([])
  /** 是否正在查询主键信息 */
  const pkLoading = ref(false)

  // 当 connectionId/database/tableName 变化时，自动拉取主键元数据
  watch(
    [connectionId, database, tableName],
    async ([connId, db, tbl]) => {
      if (!connId || !db || !tbl) {
        primaryKeys.value = []
        return
      }
      pkLoading.value = true
      try {
        primaryKeys.value = await fetchPrimaryKeys(connId, db, tbl)
      } finally {
        pkLoading.value = false
      }
    },
    { immediate: true },
  )

  // ===== 编辑状态 =====
  /**
   * 说明当前结果集是否支持内联编辑及原因：
   * - 'ok'        — 有主键，可以编辑
   * - 'no-pk'     — 表无主键（唯一不可信），只读
   * - 'no-table'  — 无法确定表名（如复杂关联查询），只读
   * - 'no-conn'   — 未连接
   */
  const editableReason = computed<'ok' | 'no-pk' | 'no-table' | 'no-conn'>(() => {
    if (!connectionId.value || !database.value) return 'no-conn'
    if (!tableName.value) return 'no-table'
    if (pkLoading.value) return 'no-pk' // 加载中暂时禁用
    if (primaryKeys.value.length === 0) return 'no-pk'
    return 'ok'
  })

  /** 是否可内联编辑 */
  const editable = computed(() => editableReason.value === 'ok')
  const editingCell = ref<{ rowIndex: number; colName: string } | null>(null)
  const editingValue = ref('')

  // ===== 删除确认 =====
  const deleteConfirmOpen = ref(false)
  const pendingDeleteIndex = ref<number | null>(null)

  // ===== 导出 =====
  const exportDialogOpen = ref(false)
  const exportSource = computed(() => ({
    type: 'table' as const,
    database: database.value ?? '',
    table: tableName.value ?? 'exported_table',
  }))

  // ===== 过滤 =====
  const showFilters = ref(false)
  const columnFilters = ref<Record<string, string>>({})
  const filterOperators = ref<Record<string, string>>({})
  let filterDebounceTimer: ReturnType<typeof setTimeout> | null = null

  // ===== 服务端排序 =====
  const serverSortCol = ref<string | null>(null)
  const serverSortDir = ref<'ASC' | 'DESC' | null>(null)

  // 当表/数据库切换时，重置所有 UI 交互状态
  watch(
    [database, tableName],
    () => {
      // 清除过滤防抖定时器，防止旧表的过滤请求污染新表
      if (filterDebounceTimer) {
        clearTimeout(filterDebounceTimer)
        filterDebounceTimer = null
      }
      // 重置排序
      sorting.value = []
      columnPinning.value = { left: [], right: [] }
      // 重置过滤
      columnFilters.value = {}
      filterOperators.value = {}
      showFilters.value = false
      serverSortCol.value = null
      serverSortDir.value = null
      // 重置编辑
      editingCell.value = null
      editingValue.value = ''
      // 重置选中
      selectedRowIndex.value = null
      rowDetailOpen.value = false
      deleteConfirmOpen.value = false
      pendingDeleteIndex.value = null
      // 重置统计
      selectedStatsColumn.value = null
      columnStats.value = null
      // 重置图表
      showChart.value = false
      // 重置可见行数
      visibleCount.value = CHUNK_SIZE
      // 重置滚动位置
      if (tableScrollRef.value) {
        tableScrollRef.value.scrollTop = 0
        tableScrollRef.value.scrollLeft = 0
      }
    },
  )

  // ===== 连接错误判断 =====
  const isConnectionError = computed(() => {
    const err = result.value?.error?.toLowerCase() ?? ''
    const keywords = [
      'connection refused', 'connection reset', 'connection timed out',
      'can\'t connect', 'cannot connect', 'unable to connect',
      'broken pipe', 'network', 'timeout', 'timed out',
      'access denied', 'authentication', 'login failed',
      'host is not allowed', 'too many connections',
      'gone away', 'lost connection', 'server has gone away',
      'ssl', 'handshake',
    ]
    return keywords.some(kw => err.includes(kw))
  })

  // ===== 数据处理 =====
  const allTableData = computed<RowData[]>(() => {
    if (!result.value || result.value.isError || result.value.columns.length === 0) return []
    let indexed = result.value.rows.map((row, originalIdx) => ({ row, originalIdx }))
    const activeFilters = Object.entries(columnFilters.value).filter(([, v]) => v.trim() !== '')
    if (activeFilters.length > 0) {
      indexed = indexed.filter(({ row }) =>
        activeFilters.every(([colName, filterVal]) => {
          const colIdx = result.value!.columns.findIndex(c => c.name === colName)
          if (colIdx < 0) return true
          const cellVal = row[colIdx]
          const cellStr = cellVal === null || cellVal === undefined ? 'NULL' : String(cellVal)
          return cellStr.toLowerCase().includes(filterVal.trim().toLowerCase())
        }),
      )
    }
    return indexed.map(({ row, originalIdx }) => {
      const obj: RowData = { __originalIndex: originalIdx }
      result.value!.columns.forEach((col, i) => { obj[col.name] = row[i] })
      return obj
    })
  })

  const totalRows = computed(() => allTableData.value.length)
  const hasMore = computed(() => visibleCount.value < totalRows.value || !!hasMoreServerRows.value)
  const tableData = computed(() => allTableData.value.slice(0, visibleCount.value))

  // ===== TanStack Table =====
  const columns = computed<TanstackColumnDef<RowData, unknown>[]>(() => {
    if (!result.value || result.value.columns.length === 0) return []
    const helper = createColumnHelper<RowData>()
    return result.value.columns.map(col =>
      helper.accessor(col.name, {
        header: col.name,
        cell: info => {
          const val = info.getValue()
          if (val === null || val === undefined) return 'NULL'
          return String(val)
        },
      }),
    )
  })

  const table = useVueTable({
    get data() { return tableData.value },
    get columns() { return columns.value },
    state: {
      get sorting() { return sorting.value },
      get columnPinning() { return columnPinning.value },
    },
    onSortingChange: updater => {
      sorting.value = typeof updater === 'function' ? updater(sorting.value) : updater
    },
    onColumnPinningChange: updater => {
      columnPinning.value = typeof updater === 'function' ? updater(columnPinning.value) : updater
    },
    columnResizeMode: columnResizeMode.value,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  // ===== 虚拟滚动 =====
  const gridStyle = computed(() => {
    void table.getState().columnSizing
    const headers = table.getFlatHeaders()
    if (headers.length === 0) return {}
    const columnWidths = headers.map(h => `${h.getSize()}px`).join(' ')
    const actionCol = editable.value ? ' 40px' : ''
    return { display: 'grid', gridTemplateColumns: `60px ${columnWidths}${actionCol}` }
  })

  const rowBaseStyle = computed(() => ({ ...gridStyle.value, height: `${ROW_HEIGHT}px` }))

  /** 列宽指纹：序列化为字符串，避免 v-memo 因对象引用变化而失效 */
  const columnSizingKey = computed(() => {
    const sizing = table.getState().columnSizing
    return Object.keys(sizing).length === 0 ? '' : JSON.stringify(sizing)
  })

  const { overscan: adaptiveOverscan, attach: attachOverscan, detach: detachOverscan } = useAdaptiveOverscan(
    tableScrollRef,
    { baseOverscan: 20, maxOverscan: 80, rowHeight: ROW_HEIGHT, velocityThreshold: 15, decayDelay: 600 },
  )

  const rowVirtualizer = useVirtualizer({
    get count() { return table.getRowModel().rows.length },
    getScrollElement: () => tableScrollRef.value,
    estimateSize: () => ROW_HEIGHT,
    get overscan() { return adaptiveOverscan.value },
  })

  // ===== 方法 =====

  function quoteId(name: string): string {
    return driver.value === 'postgresql' ? `"${name}"` : `\`${name}\``
  }

  function openRowDetail(displayIndex: number) {
    selectedRowIndex.value = displayIndex
    rowDetailOpen.value = true
  }

  function handleRowDetailNavigate(direction: 'prev' | 'next') {
    if (selectedRowIndex.value === null) return
    selectedRowIndex.value = direction === 'prev'
      ? Math.max(0, selectedRowIndex.value - 1)
      : Math.min(totalRows.value - 1, selectedRowIndex.value + 1)
  }

  const selectedRowData = computed(() => {
    if (selectedRowIndex.value === null || !result.value) return null
    const tableRow = table.getRowModel().rows[selectedRowIndex.value]
    if (!tableRow) return null
    return result.value.rows[tableRow.original.__originalIndex] ?? null
  })

  function copyRowAsJson(displayIndex: number) {
    if (!result.value) return
    const tableRow = table.getRowModel().rows[displayIndex]
    if (!tableRow) return
    const row = result.value.rows[tableRow.original.__originalIndex]
    if (!row) return
    const obj: Record<string, unknown> = {}
    result.value.columns.forEach((col, i) => { obj[col.name] = row[i] })
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2)).then(() => {
      toast.success(t('toast.copySuccess'))
    }).catch((e: unknown) => log.warn('copy_json_failed', undefined, e))
  }

  /** 复制行数据为 INSERT SQL 语句 */
  function copyRowAsSql(displayIndex: number) {
    if (!result.value) return
    const tableRow = table.getRowModel().rows[displayIndex]
    if (!tableRow) return
    const row = result.value.rows[tableRow.original.__originalIndex]
    if (!row) return
    const tbl = tableName.value || 'table_name'
    const cols = result.value.columns.map(c => quoteId(c.name)).join(', ')
    const vals = result.value.columns.map((_, i) => {
      const v = row[i]
      if (v === null || v === undefined) return 'NULL'
      if (typeof v === 'number') return String(v)
      return `'${String(v).replace(/'/g, "''")}'`
    }).join(', ')
    const sql = `INSERT INTO ${quoteId(tbl)} (${cols}) VALUES (${vals});`
    navigator.clipboard.writeText(sql).then(() => {
      toast.success(t('toast.copySuccess'))
    }).catch((e: unknown) => log.warn('copy_sql_failed', undefined, e))
  }

  async function triggerColumnStats(columnName: string) {
    if (!result.value || result.value.isError) return
    if (selectedStatsColumn.value === columnName) {
      selectedStatsColumn.value = null
      columnStats.value = null
      return
    }
    selectedStatsColumn.value = columnName
    computingStats.value = true
    try {
      const colIndex = result.value.columns.findIndex(c => c.name === columnName)
      if (colIndex < 0) return
      const colType = result.value.columns[colIndex]?.dataType
      columnStats.value = await computeColumnStatsAsync(result.value.rows, colIndex, colType)
    } finally {
      computingStats.value = false
    }
  }

  let cellClickTimer: ReturnType<typeof setTimeout> | null = null
  function handleCellClick(value: unknown) {
    // 编辑中不触发复制
    if (editingCell.value) return
    // 防双击：延迟执行，双击时取消单击的复制
    if (cellClickTimer) clearTimeout(cellClickTimer)
    cellClickTimer = setTimeout(() => {
      cellClickTimer = null
      const text = value === null || value === undefined ? 'NULL' : String(value)
      navigator.clipboard.writeText(text).then(() => {
        toast.success(t('toast.copySuccess'))
      }).catch(err => log.warn('copy_clipboard_failed', undefined, err))
    }, 250)
  }

  // ===== 过滤 =====

  function toggleFilters() {
    showFilters.value = !showFilters.value
    if (!showFilters.value) {
      columnFilters.value = {}
      filterOperators.value = {}
      if (isTableBrowse.value) onServerFilter('')
    }
  }

  function buildServerWhereClause(): string {
    const parts: string[] = []
    for (const [colName, filterVal] of Object.entries(columnFilters.value)) {
      const val = filterVal.trim()
      if (!val) continue
      const op = filterOperators.value[colName] || 'LIKE'
      const quoted = quoteId(colName)
      if (op === 'IS NULL') parts.push(`${quoted} IS NULL`)
      else if (op === 'IS NOT NULL') parts.push(`${quoted} IS NOT NULL`)
      else if (op === 'LIKE') parts.push(`${quoted} LIKE '%${val.replace(/'/g, "''")}%'`)
      else if (op === 'IN') {
        const items = val.split(',').map(v => `'${v.trim().replace(/'/g, "''")}'`).join(', ')
        parts.push(`${quoted} IN (${items})`)
      } else parts.push(`${quoted} ${op} '${val.replace(/'/g, "''")}'`)
    }
    return parts.join(' AND ')
  }

  function handleFilterChange(colName: string, value: string) {
    columnFilters.value = { ...columnFilters.value, [colName]: value }
    if (isTableBrowse.value) {
      if (filterDebounceTimer) clearTimeout(filterDebounceTimer)
      filterDebounceTimer = setTimeout(() => onServerFilter(buildServerWhereClause()), 500)
    }
  }

  function handleOperatorChange(colName: string, op: string) {
    filterOperators.value = { ...filterOperators.value, [colName]: op }
    if (isTableBrowse.value && (op === 'IS NULL' || op === 'IS NOT NULL')) {
      onServerFilter(buildServerWhereClause())
    }
  }

  // ===== 服务端排序 =====

  function handleHeaderClick(columnId: string) {
    if (!isTableBrowse.value) return
    if (serverSortCol.value === columnId) {
      if (serverSortDir.value === 'ASC') serverSortDir.value = 'DESC'
      else { serverSortCol.value = null; serverSortDir.value = null }
    } else {
      serverSortCol.value = columnId; serverSortDir.value = 'ASC'
    }
    const orderBy = serverSortCol.value && serverSortDir.value
      ? `${quoteId(serverSortCol.value)} ${serverSortDir.value}` : ''
    onServerSort(orderBy)
  }

  // ===== 列冻结/固定 =====

  /** 固定列到左侧 */
  function pinColumnLeft(columnId: string) {
    const left = [...(columnPinning.value.left ?? [])]
    if (!left.includes(columnId)) left.push(columnId)
    columnPinning.value = { ...columnPinning.value, left }
  }

  /** 取消列固定 */
  function unpinColumn(columnId: string) {
    const left = (columnPinning.value.left ?? []).filter(id => id !== columnId)
    const right = (columnPinning.value.right ?? []).filter(id => id !== columnId)
    columnPinning.value = { left, right }
  }

  /** 判断列是否已固定 */
  function isColumnPinned(columnId: string): boolean {
    return (columnPinning.value.left ?? []).includes(columnId)
      || (columnPinning.value.right ?? []).includes(columnId)
  }

  /**
   * 计算固定列的 sticky left 偏移值
   * 行号列宽度 60px + 前面各固定列的宽度累加
   */
  const pinnedColumnOffsets = computed<Record<string, number>>(() => {
    const offsets: Record<string, number> = {}
    const pinnedIds = columnPinning.value.left ?? []
    if (pinnedIds.length === 0) return offsets
    const headers = table.getFlatHeaders()
    let offset = 60 // 行号列宽度
    for (const id of pinnedIds) {
      const header = headers.find(h => h.column.id === id)
      offsets[id] = offset
      offset += header ? header.getSize() : 150
    }
    return offsets
  })

  // ===== 内联编辑 =====

  function startEdit(rowIndex: number, colName: string, currentValue: unknown) {
    if (!editable.value) return
    // 取消双击前的单击复制
    if (cellClickTimer) { clearTimeout(cellClickTimer); cellClickTimer = null }
    editingCell.value = { rowIndex, colName }
    editingValue.value = currentValue === null || currentValue === undefined ? '' : String(currentValue)
  }

  function cancelEdit() { editingCell.value = null; editingValue.value = '' }

  /**
   * 根据列类型生成类型感知的 SQL 比较条件
   * 解决前端值序列化格式与数据库存储格式不一致的问题：
   * - 数字类型：无引号直接比较，避免隐式转换
   * - 日期时间：使用 CAST 消除格式差异（ISO vs MySQL 格式）
   * - 字符串类型：标准引号包裹
   * - 跳过不安全类型：BLOB/BINARY/JSON/空间类型等
   */
  function buildTypedCondition(colName: string, dataType: string, val: unknown): string | null {
    if (val === null || val === undefined) {
      return `${quoteId(colName)} IS NULL`
    }

    const strVal = String(val)
    if (strVal.length > 500) return null // 超长值跳过

    const t = dataType.toLowerCase()

    // 跳过不可靠的比较类型
    const SKIP = ['blob', 'binary', 'varbinary', 'longblob', 'mediumblob', 'tinyblob',
      'geometry', 'point', 'linestring', 'polygon', 'multipoint', 'multilinestring',
      'multipolygon', 'geometrycollection', 'json', 'longtext', 'mediumtext']
    if (SKIP.some(s => t.includes(s))) return null

    // 整数类型：无引号比较
    if (['int', 'integer', 'bigint', 'smallint', 'tinyint', 'mediumint'].some(s => t.includes(s))) {
      // tinyint(1) 可能是 bool，js 端可能为 true/false/0/1
      const numVal = Number(val)
      if (Number.isFinite(numVal)) {
        return `${quoteId(colName)} = ${numVal}`
      }
      return `${quoteId(colName)} = '${strVal.replace(/'/g, "''")}'`
    }

    // 浮点/定点类型：无引号比较，处理精度
    if (['float', 'double', 'decimal', 'numeric', 'real'].some(s => t.includes(s))) {
      const numVal = Number(val)
      if (Number.isFinite(numVal)) {
        return `${quoteId(colName)} = ${numVal}`
      }
      return null // 非数字值跳过
    }

    // 日期时间类型：CAST 消除 ISO8601 vs MySQL 格式差异
    if (['datetime', 'timestamp'].some(s => t.includes(s))) {
      // 前端可能拿到 "2024-01-01T00:00:00" 或 "2024-01-01 00:00:00"
      // 统一用 CAST 让 MySQL 自己解析
      const cleaned = strVal.replace('T', ' ').replace(/\.\d{3}Z?$/, '').replace(/Z$/, '')
      return `${quoteId(colName)} = CAST('${cleaned.replace(/'/g, "''")}' AS DATETIME)`
    }

    if (t === 'date') {
      // 取日期部分
      const datePart = strVal.substring(0, 10)
      return `${quoteId(colName)} = CAST('${datePart}' AS DATE)`
    }

    if (t === 'time') {
      return `${quoteId(colName)} = CAST('${strVal.replace(/'/g, "''")}' AS TIME)`
    }

    if (t === 'year') {
      const numVal = Number(val)
      if (Number.isFinite(numVal)) {
        return `${quoteId(colName)} = ${numVal}`
      }
      return null
    }

    // bit 类型
    if (t.includes('bit')) {
      const numVal = Number(val)
      if (Number.isFinite(numVal)) {
        return `${quoteId(colName)} = ${numVal}`
      }
      return null
    }

    // 枚举/Set/普通字符串类型：标准字符串比较
    return `${quoteId(colName)} = '${strVal.replace(/'/g, "''")}'`
  }

  /**
   * 构建带乐观锁的 WHERE 子句：主键定位 + 原始值校验
   * 确保 UPDATE/DELETE 操作时，目标行未被其他客户端修改
   * 如果任意列的当前值与本地快照不一致，affected_rows=0 → 前端提示冲突
   */
  function buildOptimisticWhereClause(row: unknown[]): string {
    if (!result.value || primaryKeys.value.length === 0) return '1=0'

    const columns = result.value.columns
    const conditions: string[] = []
    const debugInfo: string[] = [] // 调试：记录每个列的条件生成过程

    // 1. 主键条件（必须）
    for (const pkName of primaryKeys.value) {
      const colIdx = columns.findIndex(c => c.name === pkName)
      if (colIdx < 0) continue
      const cond = buildTypedCondition(pkName, columns[colIdx]!.dataType, row[colIdx])
      if (cond) {
        conditions.push(cond)
        debugInfo.push(`[PK] ${pkName}(${columns[colIdx]!.dataType}): val=${JSON.stringify(row[colIdx])} → ${cond}`)
      }
    }

    // 2. 非主键列的原始值校验（乐观锁核心）
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]!
      if (primaryKeys.value.includes(col.name)) continue
      const cond = buildTypedCondition(col.name, col.dataType, row[i])
      if (cond) {
        conditions.push(cond)
        debugInfo.push(`[COL] ${col.name}(${col.dataType}): val=${JSON.stringify(row[i])} → ${cond}`)
      } else {
        debugInfo.push(`[SKIP] ${col.name}(${col.dataType}): val=${JSON.stringify(row[i])?.substring(0, 50)} → skipped`)
      }
    }

    return conditions.length > 0 ? conditions.join(' AND ') : '1=0'
  }

  function getOriginalRow(displayIndex: number): unknown[] | null {
    const tableRow = table.getRowModel().rows[displayIndex]
    if (!tableRow || !result.value) return null
    return result.value.rows[tableRow.original.__originalIndex] ?? null
  }

  async function saveEdit() {
    if (!editingCell.value || !result.value || !editable.value) return
    const { rowIndex, colName } = editingCell.value
    const row = getOriginalRow(rowIndex)
    if (!row) { cancelEdit(); return }

    // 值未变化则跳过更新
    const colIndex = result.value.columns.findIndex(c => c.name === colName)
    const originalValue = colIndex >= 0 ? row[colIndex] : undefined
    const originalStr = originalValue === null || originalValue === undefined ? '' : String(originalValue)
    if (editingValue.value === originalStr) { cancelEdit(); return }

    // 获取数据库名，优先使用 options 传入的 database
    const db = database.value
    if (!db) {
      toast.error(t('database.queryError'), '无法确定目标数据库，请先选择数据库')
      cancelEdit()
      return
    }
    
    const scrollTop = tableScrollRef.value?.scrollTop ?? 0
    const scrollLeft = tableScrollRef.value?.scrollLeft ?? 0
    const newVal = editingValue.value === '' ? 'NULL' : `'${editingValue.value.replace(/'/g, "''")}'`
    // 直接使用表名，数据库上下文由 API 层处理
    const tbl = tableName.value!
    const sql = `UPDATE ${quoteId(tbl)} SET ${quoteId(colName)} = ${newVal} WHERE ${buildOptimisticWhereClause(row)} LIMIT 1`
    try {
      const res = await dbExecuteQueryInDatabase(connectionId.value!, db, sql)
      if (res.isError) {
        toast.error(t('database.queryError'), res.error ?? '')
      } else if (res.affectedRows === 0) {
        toast.error('更新冲突', `该行数据可能已被其他客户端修改或删除，请刷新后重试`)
      } else {
        toast.success(t('database.updateSuccess'))
        // 本地更新单元格数据，避免全量刷新导致滚动位置等状态丢失
        const colIndex = result.value.columns.findIndex(c => c.name === colName)
        if (colIndex >= 0) {
          const tableRow = table.getRowModel().rows[rowIndex]
          if (tableRow) {
            const originalIdx = tableRow.original.__originalIndex
            const updatedValue = editingValue.value === '' ? null : editingValue.value
            result.value.rows[originalIdx]![colIndex] = updatedValue
          }
        }
        nextTick(() => {
          if (tableScrollRef.value) {
            tableScrollRef.value.scrollTop = scrollTop
            tableScrollRef.value.scrollLeft = scrollLeft
          }
        })
      }
    } catch (e: unknown) {
      const errorMsg = parseBackendError(e).message
      toast.error(t('database.queryError'), errorMsg)
    }
    cancelEdit()
  }

  // ===== 行删除 =====

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
    if (!result.value || !editable.value) return
    const row = getOriginalRow(displayIndex)
    if (!row) return

    const db = database.value
    if (!db) {
      toast.error(t('database.queryError'), '无法确定目标数据库，请先选择数据库')
      return
    }

    const scrollTop = tableScrollRef.value?.scrollTop ?? 0
    const scrollLeft = tableScrollRef.value?.scrollLeft ?? 0
    const sql = `DELETE FROM ${quoteId(tableName.value!)} WHERE ${buildOptimisticWhereClause(row)} LIMIT 1`
    try {
      const res = await dbExecuteQueryInDatabase(connectionId.value!, db, sql)
      if (res.isError) toast.error(t('database.queryError'), res.error ?? '')
      else {
        toast.success(t('database.deleteSuccess'))
        onRefresh()
        nextTick(() => {
          if (tableScrollRef.value) {
            tableScrollRef.value.scrollTop = scrollTop
            tableScrollRef.value.scrollLeft = scrollLeft
          }
        })
      }
    } catch (e: unknown) {
      const errorMsg = parseBackendError(e).message
      toast.error(t('database.queryError'), errorMsg)
    }
  }

  // ===== 导出 =====

  async function handleExport(format: ExportFormat) {
    if (!result.value || result.value.isError) return
    
    // 生成专业文件名：[数据库名_]表名_时间戳.格式
    const dbName = database.value || ''
    const tablePart = tableName.value || result.value?.tableName || 'query_result'
    const fullSourcePath = dbName ? `${dbName}_${tablePart}` : tablePart
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16).replace('T', '_')
    const defaultName = `${fullSourcePath}_${timestamp}.${format}`

    const path = await save({ 
      defaultPath: defaultName, 
      filters: getFilters(format) 
    })
    
    if (!path) return
    try {
      // SQL 格式导出时，尝试获取表结构 DDL
      let ddl: string | undefined
      const effectiveDb = database.value || dbName
      const effectiveTable = tableName.value || result.value?.tableName || tablePart
      if (format === 'sql' && connectionId.value && effectiveDb && effectiveTable && effectiveTable !== 'query_result') {
        try {
          ddl = await dbGenerateScript(connectionId.value, effectiveDb, effectiveTable, 'create', { includeIfNotExists: false, includeIfExists: false })
        } catch {
          // 获取 DDL 失败时静默跳过，不影响数据导出
        }
      }
      // 表浏览模式下若服务端还有更多行，从头重新全量分页拉取再导出
      let exportResult = result.value
      if (isTableBrowse.value && hasMoreServerRows.value && connectionId.value && database.value && (tableName.value || result.value.tableName)) {
        const tbl = tableName.value || result.value.tableName!
        const batchSize = 1000
        const whereClause = buildServerWhereClause()
        const orderBy = serverSortCol.value && serverSortDir.value
          ? `${serverSortCol.value} ${serverSortDir.value}` : null
        const seekColumn = !orderBy && primaryKeys.value.length === 1 && isIntegerResultColumn(primaryKeys.value[0], result.value)
          ? primaryKeys.value[0]
          : undefined
        const seekOrderBy = seekColumn ? `${seekColumn} ASC` : orderBy
        const allRows: unknown[][] = []
        let page = 1
        let seekValue: number | undefined
        while (true) {
          const more = await dbGetTableData(
            connectionId.value,
            database.value,
            tbl,
            page,
            batchSize,
            whereClause || null,
            seekOrderBy,
            seekColumn,
            seekValue,
          )
          allRows.push(...more.rows)
          if (more.rows.length < batchSize) break
          const nextSeekValue = extractNumericCursorValue(more.rows, more.columns, seekColumn)
          if (seekColumn && nextSeekValue === undefined) break
          seekValue = nextSeekValue
          if (!seekColumn && more.totalCount !== null && allRows.length >= more.totalCount) break
          page++
        }
        exportResult = { ...result.value, rows: allRows }
      }
      const content = formatData(exportResult, format, tablePart, ddl)
      await writeTextFile(path, content)
      toast.success(t('toast.exportSuccess'))
    } catch (e: unknown) {
      const errorMsg = parseBackendError(e).message
      toast.error(t('toast.exportFailed'), errorMsg)
    }
  }

  // ===== 分页加载 =====

  function loadMore() {
    if (!hasMore.value) return
    visibleCount.value = Math.min(visibleCount.value + CHUNK_SIZE, totalRows.value)
  }

  const prevRowCount = ref(0)
  watch(result, (newResult) => {
    const newCount = newResult?.rows?.length ?? 0
    if (newCount > prevRowCount.value && prevRowCount.value > 0) {
      visibleCount.value = newCount
    } else {
      visibleCount.value = CHUNK_SIZE
      selectedRowIndex.value = null
    }
    prevRowCount.value = newCount
  })

  // ===== 滚动加载 =====

  function handleScroll() {
    const el = tableScrollRef.value
    if (!el || !hasMore.value) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 500) {
      if (visibleCount.value < totalRows.value) loadMore()
      else if (hasMoreServerRows.value && !loadingMore.value) onLoadMore()
    }
  }

  watch(tableScrollRef, (el, oldEl) => {
    oldEl?.removeEventListener('scroll', handleScroll)
    el?.addEventListener('scroll', handleScroll, { passive: true })
    if (el) attachOverscan(); else detachOverscan()
  })

  // ===== 键盘快捷键 =====

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault()
      if (selectedRowIndex.value !== null) openRowDetail(selectedRowIndex.value)
    }
  }

  document.addEventListener('keydown', handleGlobalKeydown)

  onBeforeUnmount(() => {
    tableScrollRef.value?.removeEventListener('scroll', handleScroll)
    document.removeEventListener('keydown', handleGlobalKeydown)
  })

  return {
    // 常量
    ROW_HEIGHT,
    // TanStack Table
    table, sorting, columnResizeMode, columnPinning,
    // 虚拟滚动
    rowVirtualizer, gridStyle, rowBaseStyle, columnSizingKey,
    // 核心状态
    visibleCount, selectedRowIndex, totalRows, hasMore, tableData,
    // 行详情
    rowDetailOpen, selectedRowData, openRowDetail, handleRowDetailNavigate, copyRowAsJson, copyRowAsSql,
    // 单元格交互
    handleCellClick,
    // 列统计
    selectedStatsColumn, columnStats, computingStats, triggerColumnStats,
    // 图表
    showChart,
    // 编辑
    editable, editableReason, primaryKeys, pkLoading,
    editingCell, editingValue, startEdit, cancelEdit, saveEdit,
    // 删除
    deleteConfirmOpen, pendingDeleteIndex, requestDeleteRow, confirmDeleteRow,
    // 导出
    exportDialogOpen, exportSource, handleExport,
    // 过滤
    showFilters, columnFilters, filterOperators,
    toggleFilters, handleFilterChange, handleOperatorChange,
    // 排序
    serverSortCol, serverSortDir, handleHeaderClick,
    // 列冻结
    pinColumnLeft, unpinColumn, isColumnPinned, pinnedColumnOffsets,
    // 错误
    isConnectionError,
    // 操作
    loadMore,
  }
}
