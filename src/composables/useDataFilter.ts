import { ref, computed } from 'vue'

/** 筛选运算符 */
export type FilterOperator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'NOT LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL'

/** 单个筛选条件 */
export interface FilterCondition {
  id: string
  column: string
  operator: FilterOperator
  value: string
  /** 与前一个条件的逻辑关系 */
  logic: 'AND' | 'OR'
}

/** 排序方向 */
export type SortDirection = 'ASC' | 'DESC'

/** 单列排序 */
export interface SortColumn {
  column: string
  direction: SortDirection
}

/**
 * 数据过滤与排序 composable
 * 管理排序和筛选状态，生成 SQL WHERE / ORDER BY 子句
 */
export function useDataFilter(quoteIdentifier: (name: string) => string) {
  /** 筛选条件列表 */
  const filters = ref<FilterCondition[]>([])
  /** 排序列列表（支持多列排序） */
  const sortColumns = ref<SortColumn[]>([])
  /** 筛选面板是否展开 */
  const isFilterPanelOpen = ref(false)

  /** 是否有活跃的筛选条件 */
  const hasActiveFilters = computed(() => filters.value.length > 0)
  /** 是否有排序 */
  const hasSort = computed(() => sortColumns.value.length > 0)

  /** 添加筛选条件 */
  function addFilter(column: string = '', operator: FilterOperator = 'LIKE', value: string = '') {
    filters.value.push({
      id: crypto.randomUUID(),
      column,
      operator,
      value,
      logic: filters.value.length === 0 ? 'AND' : 'AND',
    })
  }

  /** 更新筛选条件 */
  function updateFilter(id: string, updates: Partial<FilterCondition>) {
    const idx = filters.value.findIndex(f => f.id === id)
    if (idx >= 0) {
      filters.value[idx] = { ...filters.value[idx]!, ...updates }
      // 触发响应式
      filters.value = [...filters.value]
    }
  }

  /** 移除筛选条件 */
  function removeFilter(id: string) {
    filters.value = filters.value.filter(f => f.id !== id)
  }

  /** 清空所有筛选条件 */
  function clearFilters() {
    filters.value = []
  }

  /**
   * 点击列标题切换排序
   * 无排序 → 升序 → 降序 → 无排序
   * Shift+点击追加多列排序
   */
  function toggleSort(column: string, append: boolean = false) {
    const existingIdx = sortColumns.value.findIndex(s => s.column === column)

    if (existingIdx >= 0) {
      const current = sortColumns.value[existingIdx]!
      if (current.direction === 'ASC') {
        // 升序 → 降序
        sortColumns.value[existingIdx] = { ...current, direction: 'DESC' }
        sortColumns.value = [...sortColumns.value]
      } else {
        // 降序 → 移除
        sortColumns.value = sortColumns.value.filter((_, i) => i !== existingIdx)
      }
    } else {
      // 无排序 → 升序
      if (append) {
        sortColumns.value = [...sortColumns.value, { column, direction: 'ASC' }]
      } else {
        sortColumns.value = [{ column, direction: 'ASC' }]
      }
    }
  }

  /** 清空排序 */
  function clearSort() {
    sortColumns.value = []
  }

  /** 获取列的当前排序方向 */
  function getSortDirection(column: string): SortDirection | null {
    const sort = sortColumns.value.find(s => s.column === column)
    return sort?.direction ?? null
  }

  /** 获取列的排序序号（多列排序时显示） */
  function getSortIndex(column: string): number {
    return sortColumns.value.findIndex(s => s.column === column)
  }

  /** 转义 SQL 字符串值中的单引号 */
  function escapeValue(val: string): string {
    return val.replace(/'/g, "''")
  }

  /** 构建 WHERE 子句 */
  function buildWhereClause(): string {
    const validFilters = filters.value.filter(f => {
      if (!f.column) return false
      // IS NULL / IS NOT NULL 不需要值
      if (f.operator === 'IS NULL' || f.operator === 'IS NOT NULL') return true
      return f.value.trim() !== ''
    })

    if (validFilters.length === 0) return ''

    const parts: string[] = []
    validFilters.forEach((f, i) => {
      const col = quoteIdentifier(f.column)
      let condition = ''

      switch (f.operator) {
        case 'IS NULL':
          condition = `${col} IS NULL`
          break
        case 'IS NOT NULL':
          condition = `${col} IS NOT NULL`
          break
        case 'LIKE':
          condition = `${col} LIKE '%${escapeValue(f.value)}%'`
          break
        case 'NOT LIKE':
          condition = `${col} NOT LIKE '%${escapeValue(f.value)}%'`
          break
        case 'IN': {
          const items = f.value.split(',').map(v => `'${escapeValue(v.trim())}'`).join(', ')
          condition = `${col} IN (${items})`
          break
        }
        default:
          condition = `${col} ${f.operator} '${escapeValue(f.value)}'`
      }

      if (i === 0) {
        parts.push(condition)
      } else {
        parts.push(`${f.logic} ${condition}`)
      }
    })

    return parts.join(' ')
  }

  /** 构建 ORDER BY 子句 */
  function buildOrderByClause(): string {
    if (sortColumns.value.length === 0) return ''
    return sortColumns.value
      .map(s => `${quoteIdentifier(s.column)} ${s.direction}`)
      .join(', ')
  }

  /** 重置所有状态 */
  function resetAll() {
    filters.value = []
    sortColumns.value = []
    isFilterPanelOpen.value = false
  }

  return {
    filters,
    sortColumns,
    isFilterPanelOpen,
    hasActiveFilters,
    hasSort,
    addFilter,
    updateFilter,
    removeFilter,
    clearFilters,
    toggleSort,
    clearSort,
    getSortDirection,
    getSortIndex,
    buildWhereClause,
    buildOrderByClause,
    resetAll,
  }
}
