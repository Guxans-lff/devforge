import { ref, computed, watch, onBeforeUnmount } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import type { DatabaseTreeNode } from '@/types/database'

/** 搜索结果项，包含节点信息和父级路径 */
export interface SearchResultItem {
  /** 匹配到的节点 */
  node: DatabaseTreeNode
  /** 从根到该节点的父级路径（不含自身） */
  parentPath: DatabaseTreeNode[]
  /** 所属数据库名 */
  database: string
}

/** 可搜索的节点类型集合 */
const SEARCHABLE_TYPES = new Set<DatabaseTreeNode['type']>([
  'database', 'table', 'view', 'procedure', 'function', 'trigger',
])

/**
 * 数据库对象搜索 composable
 * 提供 200ms 防抖搜索、递归遍历树节点、模糊匹配（不区分大小写）
 * @param treeData - 对象树的响应式数据源
 */
export function useObjectSearch(treeData: Ref<DatabaseTreeNode[]>) {
  /** 搜索关键字 */
  const searchQuery = ref('')
  /** 防抖后的搜索关键字 */
  const debouncedQuery = ref('')
  /** 当前选中/高亮的节点 ID */
  const highlightedNodeId = ref<string | null>(null)

  // 防抖定时器
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  /** 200ms 防抖搜索 */
  watch(searchQuery, (val) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debouncedQuery.value = val
    }, 200)
  })

  onBeforeUnmount(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
  })

  /** 是否正在搜索（搜索框有内容） */
  const isSearching: ComputedRef<boolean> = computed(() => {
    return debouncedQuery.value.trim().length > 0
  })

  /**
   * 判断节点是否匹配搜索关键字
   * 仅匹配可搜索类型的节点，不区分大小写
   */
  function matchNode(node: DatabaseTreeNode, query: string): boolean {
    if (!SEARCHABLE_TYPES.has(node.type)) return false
    return node.label.toLowerCase().includes(query)
  }

  /**
   * 递归遍历树节点，收集所有匹配的搜索结果
   * @param nodes - 当前层级的节点列表
   * @param query - 小写化后的搜索关键字
   * @param parentPath - 当前节点的父级路径
   * @param database - 当前所属数据库名
   */
  function collectMatches(
    nodes: DatabaseTreeNode[],
    query: string,
    parentPath: DatabaseTreeNode[] = [],
    database = '',
  ): SearchResultItem[] {
    const results: SearchResultItem[] = []

    for (const node of nodes) {
      // 确定当前数据库名
      const currentDb = node.type === 'database'
        ? (node.meta?.database ?? node.label)
        : database

      // 检查当前节点是否匹配
      if (matchNode(node, query)) {
        results.push({
          node,
          parentPath: [...parentPath],
          database: currentDb,
        })
      }

      // 递归搜索子节点
      if (node.children && node.children.length > 0) {
        const childResults = collectMatches(
          node.children,
          query,
          [...parentPath, node],
          currentDb,
        )
        results.push(...childResults)
      }
    }

    return results
  }

  /** 搜索结果列表 */
  const searchResults: ComputedRef<SearchResultItem[]> = computed(() => {
    const q = debouncedQuery.value.toLowerCase().trim()
    if (!q) return []
    return collectMatches(treeData.value, q)
  })

  /**
   * 点击搜索结果时，展开父级路径并高亮选中节点
   * @param item - 搜索结果项
   */
  function navigateToNode(item: SearchResultItem): void {
    // 清空搜索，恢复完整树结构
    searchQuery.value = ''
    debouncedQuery.value = ''

    // 展开父级路径中的所有节点
    for (const parent of item.parentPath) {
      parent.isExpanded = true
    }

    // 高亮选中目标节点
    highlightedNodeId.value = item.node.id

    // 3 秒后自动取消高亮
    setTimeout(() => {
      if (highlightedNodeId.value === item.node.id) {
        highlightedNodeId.value = null
      }
    }, 3000)
  }

  /** 清空搜索 */
  function clearSearch(): void {
    searchQuery.value = ''
    debouncedQuery.value = ''
    highlightedNodeId.value = null
  }

  return {
    searchQuery,
    debouncedQuery,
    isSearching,
    searchResults,
    highlightedNodeId,
    matchNode,
    navigateToNode,
    clearSearch,
  }
}
