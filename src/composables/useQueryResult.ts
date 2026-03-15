/**
 * 查询结果面板核心业务逻辑 composable
 * 从 QueryResult.vue 提取，负责数据过滤/排序/编辑/导出、虚拟滚动配置等
 */
import { ref, computed, watch, nextTick, onBeforeUnmount, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  useVueTable, getCoreRowModel, getSortedRowModel, createColumnHelper,
} from '@tanstack/vue-table'
import type { ColumnDef as TanstackColumnDef, SortingState, ColumnResizeMode } from '@tanstack/vue-table'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile, dbExecuteQueryInDatabase } from '@/api/database'
import { formatData, getFilters, type ExportFormat } from '@/utils/exportData'
import { useToast } from '@/composables/useToast'
import { useAdaptiveOverscan } from '@/composables/useAdaptiveOverscan'
import { computeColumnStatsAsync, type ColumnStatsResult } from '@/utils/columnStatistics'
import { fetchPrimaryKeys } from '@/composables/usePrimaryKey'
import type { QueryResult as QueryResultType } from '@/types/database'

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
    state: { get sorting() { return sorting.value } },
    onSortingChange: updater => {
      sorting.value = typeof updater === 'function' ? updater(sorting.value) : updater
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
    }).catch(() => {})
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

  function handleCellClick(value: unknown) {
    // 单击只复制内容到剪贴板
    const text = value === null || value === undefined ? 'NULL' : String(value)
    navigator.clipboard.writeText(text).then(() => {
      toast.success(t('toast.copySuccess'))
    }).catch(err => console.warn('Failed to copy to clipboard:', err))
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

  // ===== 内联编辑 =====

  function startEdit(rowIndex: number, colName: string, currentValue: unknown) {
    if (!editable.value) return
    editingCell.value = { rowIndex, colName }
    editingValue.value = currentValue === null || currentValue === undefined ? '' : String(currentValue)
  }

  function cancelEdit() { editingCell.value = null; editingValue.value = '' }

  /**
   * 根据主键构建精准的 WHERE 子句
   * 超越 Navicat 的关键：只用已验证的主键列，绝不使用时间戳/NULL/二进制等不安全类型
   */
  function buildWhereClause(row: unknown[]): string {
    if (!result.value || primaryKeys.value.length === 0) return '1=0'
    
    const columns = result.value.columns
    const conditions = primaryKeys.value.map(pkName => {
      const colIdx = columns.findIndex(c => c.name === pkName)
      if (colIdx < 0) return null
      const val = row[colIdx]
      if (val === null || val === undefined) return `${quoteId(pkName)} IS NULL`
      return `${quoteId(pkName)} = '${String(val).replace(/'/g, "''")}'`
    }).filter(Boolean)
    
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
    const sql = `UPDATE ${quoteId(tbl)} SET ${quoteId(colName)} = ${newVal} WHERE ${buildWhereClause(row)} LIMIT 1`
    console.log('[saveEdit] 数据库:', db, '表:', tbl, '\nSQL:', sql)
    try {
      const res = await dbExecuteQueryInDatabase(connectionId.value!, db, sql)
      console.log('[saveEdit] 执行结果:', JSON.stringify({ isError: res.isError, error: res.error, affectedRows: res.affectedRows }))
      if (res.isError) {
        toast.error(t('database.queryError'), res.error ?? '')
      } else if (res.affectedRows === 0) {
        toast.error('更新失败', `WHERE 条件未匹配到任何行，数据库: ${db}, 表: ${tbl}`)
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
    } catch (e) {
      console.error('[saveEdit] 异常:', e)
      toast.error(t('database.queryError'), String(e))
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
    const sql = `DELETE FROM ${quoteId(tableName.value!)} WHERE ${buildWhereClause(row)} LIMIT 1`
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
    } catch (e) { toast.error(t('database.queryError'), String(e)) }
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
      const content = formatData(result.value, format, tablePart)
      await writeTextFile(path, content)
      toast.success(t('toast.exportSuccess'))
    } catch (e) { toast.error(t('toast.exportFailed'), String(e)) }
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
    table, sorting, columnResizeMode,
    // 虚拟滚动
    rowVirtualizer, gridStyle, rowBaseStyle,
    // 核心状态
    visibleCount, selectedRowIndex, totalRows, hasMore, tableData,
    // 行详情
    rowDetailOpen, selectedRowData, openRowDetail, handleRowDetailNavigate, copyRowAsJson,
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
    // 错误
    isConnectionError,
    // 操作
    loadMore,
  }
}
