import { ref, computed } from 'vue'

/** 搜索匹配项 */
export interface SearchMatch {
  rowIndex: number
  colIndex: number
}

/**
 * 数据网格搜索 composable
 * 提供 Ctrl+F 搜索功能：文本匹配、高亮、上/下导航
 */
export function useGridSearch() {
  /** 搜索关键词 */
  const searchText = ref('')
  /** 搜索栏是否可见 */
  const isSearchVisible = ref(false)
  /** 当前高亮的匹配项索引 */
  const currentMatchIndex = ref(-1)
  /** 所有匹配项 */
  const matches = ref<SearchMatch[]>([])

  /** 匹配项总数 */
  const matchCount = computed(() => matches.value.length)

  /** 当前匹配项（用于滚动定位） */
  const currentMatch = computed(() => {
    if (currentMatchIndex.value < 0 || currentMatchIndex.value >= matches.value.length) return null
    return matches.value[currentMatchIndex.value] ?? null
  })

  /** 打开搜索栏 */
  function openSearch() {
    isSearchVisible.value = true
  }

  /** 关闭搜索栏并清空 */
  function closeSearch() {
    isSearchVisible.value = false
    searchText.value = ''
    matches.value = []
    currentMatchIndex.value = -1
  }

  /**
   * 执行搜索
   * @param rows 数据行（二维数组）
   * @param columns 列定义（用于获取列名）
   */
  function performSearch(rows: unknown[][], _columns: { name: string }[]) {
    const keyword = searchText.value.trim().toLowerCase()
    if (!keyword) {
      matches.value = []
      currentMatchIndex.value = -1
      return
    }

    const found: SearchMatch[] = []
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      if (!row) continue
      for (let c = 0; c < row.length; c++) {
        const val = row[c]
        const str = val === null || val === undefined ? 'NULL' : String(val)
        if (str.toLowerCase().includes(keyword)) {
          found.push({ rowIndex: r, colIndex: c })
        }
      }
    }

    matches.value = found
    currentMatchIndex.value = found.length > 0 ? 0 : -1
  }

  /** 跳转到下一个匹配项 */
  function nextMatch() {
    if (matches.value.length === 0) return
    currentMatchIndex.value = (currentMatchIndex.value + 1) % matches.value.length
  }

  /** 跳转到上一个匹配项 */
  function prevMatch() {
    if (matches.value.length === 0) return
    currentMatchIndex.value = (currentMatchIndex.value - 1 + matches.value.length) % matches.value.length
  }

  /** 判断单元格是否匹配搜索 */
  function isCellMatch(rowIndex: number, colIndex: number): boolean {
    if (!searchText.value.trim()) return false
    return matches.value.some(m => m.rowIndex === rowIndex && m.colIndex === colIndex)
  }

  /** 判断单元格是否为当前高亮的匹配项 */
  function isCellCurrentMatch(rowIndex: number, colIndex: number): boolean {
    const current = currentMatch.value
    if (!current) return false
    return current.rowIndex === rowIndex && current.colIndex === colIndex
  }

  return {
    searchText,
    isSearchVisible,
    currentMatchIndex,
    matches,
    matchCount,
    currentMatch,
    openSearch,
    closeSearch,
    performSearch,
    nextMatch,
    prevMatch,
    isCellMatch,
    isCellCurrentMatch,
  }
}
