import { ref, computed } from 'vue'
import type { QueryResult } from '@/types/database'

/** 变更类型 */
export type ChangeType = 'update' | 'insert' | 'delete'

/** 单元格变更记录 */
export interface CellChange {
  rowIndex: number
  column: string
  oldValue: unknown
  newValue: unknown
}

/** 行变更记录（用于构建提交数据） */
export interface RowChangeRecord {
  type: ChangeType
  rowIndex: number
  /** 主键列名-值对（用于定位行） */
  primaryKeys: { column: string; value: unknown }[]
  /** 变更的列值 */
  changes: { column: string; value: unknown }[]
}

/**
 * 行内编辑 composable
 * 管理变更缓冲区、编辑状态和数据类型校验
 */
export function useInlineEdit() {
  /** 单元格变更缓冲区：key = `${rowIndex}:${column}` */
  const cellChanges = ref<Map<string, CellChange>>(new Map())
  /** 标记为删除的行索引集合 */
  const deletedRows = ref<Set<number>>(new Set())
  /** 新增行数据列表 */
  const insertedRows = ref<{ values: Record<string, unknown> }[]>([])
  /** 当前编辑的单元格 */
  const editingCell = ref<{ rowIndex: number; column: string } | null>(null)
  /** 编辑中的值 */
  const editingValue = ref<string>('')

  /** 是否有未提交的变更 */
  const hasChanges = computed(() =>
    cellChanges.value.size > 0 || deletedRows.value.size > 0 || insertedRows.value.length > 0
  )

  /** 变更计数 */
  const changeCount = computed(() =>
    cellChanges.value.size + deletedRows.value.size + insertedRows.value.length
  )

  /** 记录单元格变更 */
  function setCellChange(rowIndex: number, column: string, oldValue: unknown, newValue: unknown) {
    const key = `${rowIndex}:${column}`
    // 如果新值等于原始值，移除变更记录
    if (String(newValue) === String(oldValue)) {
      cellChanges.value.delete(key)
    } else {
      cellChanges.value.set(key, { rowIndex, column, oldValue, newValue })
    }
    // 触发响应式更新
    cellChanges.value = new Map(cellChanges.value)
  }

  /** 获取单元格的变更状态 */
  function getCellChangeType(rowIndex: number, column: string): ChangeType | null {
    if (deletedRows.value.has(rowIndex)) return 'delete'
    const key = `${rowIndex}:${column}`
    if (cellChanges.value.has(key)) return 'update'
    return null
  }

  /** 获取单元格的显示值（优先显示变更后的值） */
  function getDisplayValue(rowIndex: number, column: string, originalValue: unknown): unknown {
    const key = `${rowIndex}:${column}`
    const change = cellChanges.value.get(key)
    return change ? change.newValue : originalValue
  }

  /** 标记行为删除 */
  function markRowDeleted(rowIndex: number) {
    deletedRows.value.add(rowIndex)
    deletedRows.value = new Set(deletedRows.value)
    // 同时移除该行的单元格变更
    const keysToRemove: string[] = []
    for (const key of cellChanges.value.keys()) {
      if (key.startsWith(`${rowIndex}:`)) keysToRemove.push(key)
    }
    keysToRemove.forEach(k => cellChanges.value.delete(k))
    cellChanges.value = new Map(cellChanges.value)
  }

  /** 取消行删除标记 */
  function unmarkRowDeleted(rowIndex: number) {
    deletedRows.value.delete(rowIndex)
    deletedRows.value = new Set(deletedRows.value)
  }

  /** 判断行是否标记为删除 */
  function isRowDeleted(rowIndex: number): boolean {
    return deletedRows.value.has(rowIndex)
  }

  /** 开始编辑单元格 */
  function startEdit(rowIndex: number, column: string, currentValue: unknown) {
    editingCell.value = { rowIndex, column }
    editingValue.value = currentValue === null || currentValue === undefined ? '' : String(currentValue)
  }

  /** 取消编辑 */
  function cancelEdit() {
    editingCell.value = null
    editingValue.value = ''
  }

  /** 确认编辑（将值写入缓冲区） */
  function confirmEdit(originalValue: unknown) {
    if (!editingCell.value) return
    const { rowIndex, column } = editingCell.value
    const newValue = editingValue.value === '' ? null : editingValue.value
    setCellChange(rowIndex, column, originalValue, newValue)
    cancelEdit()
  }

  /** 构建提交用的行变更列表 */
  function buildRowChanges(
    result: QueryResult,
    primaryKeyColumns: string[],
  ): RowChangeRecord[] {
    const records: RowChangeRecord[] = []

    // 处理更新：按行索引聚合单元格变更
    const updatedRows = new Map<number, { column: string; value: unknown }[]>()
    for (const change of cellChanges.value.values()) {
      if (!updatedRows.has(change.rowIndex)) {
        updatedRows.set(change.rowIndex, [])
      }
      updatedRows.get(change.rowIndex)!.push({
        column: change.column,
        value: change.newValue,
      })
    }

    for (const [rowIndex, changes] of updatedRows) {
      const row = result.rows[rowIndex]
      if (!row) continue
      const pks = primaryKeyColumns.map(col => {
        const colIdx = result.columns.findIndex(c => c.name === col)
        return { column: col, value: colIdx >= 0 ? row[colIdx] : null }
      })
      records.push({ type: 'update', rowIndex, primaryKeys: pks, changes })
    }

    // 处理删除
    for (const rowIndex of deletedRows.value) {
      const row = result.rows[rowIndex]
      if (!row) continue
      const pks = primaryKeyColumns.map(col => {
        const colIdx = result.columns.findIndex(c => c.name === col)
        return { column: col, value: colIdx >= 0 ? row[colIdx] : null }
      })
      records.push({ type: 'delete', rowIndex, primaryKeys: pks, changes: [] })
    }

    return records
  }

  /** 清空所有变更 */
  function discardAll() {
    cellChanges.value = new Map()
    deletedRows.value = new Set()
    insertedRows.value = []
    editingCell.value = null
    editingValue.value = ''
  }

  return {
    cellChanges,
    deletedRows,
    insertedRows,
    editingCell,
    editingValue,
    hasChanges,
    changeCount,
    setCellChange,
    getCellChangeType,
    getDisplayValue,
    markRowDeleted,
    unmarkRowDeleted,
    isRowDeleted,
    startEdit,
    cancelEdit,
    confirmEdit,
    buildRowChanges,
    discardAll,
  }
}
