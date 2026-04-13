/**
 * 对象树核心业务逻辑 composable
 * 从 ObjectTree.vue 提取，负责树节点加载/搜索/展开/虚拟滚动等
 */
import { ref, computed, watch, onActivated, markRaw, nextTick, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { useVirtualizer } from '@tanstack/vue-virtual'
import * as dbApi from '@/api/database'
import { fetchWithCache, invalidateByPrefix } from '@/composables/useMetadataCache'
import { useObjectSearch } from '@/composables/useObjectSearch'
import { useAdaptiveOverscan } from '@/composables/useAdaptiveOverscan'
import type { DatabaseTreeNode, DatabaseInfo } from '@/types/database'

export interface UseObjectTreeOptions {
  connectionId: Ref<string>
  connecting: Ref<boolean | undefined>
  parentRef: Ref<HTMLElement | null>
  /** 事件发射器 */
  onSelectTable: (database: string, table: string) => void
  onSelectDatabase: (database: string) => void
  onSchemaUpdated: () => void
}

/**
 * 树节点扁平化封装结构
 * 直接引用原 Node 保证响应式和 toggle 操作生效
 */
export interface FlatNodeWrapper {
  id: string
  node?: DatabaseTreeNode
  level: number
  isSystem?: boolean
  isSystemFolder?: boolean
  systemAction?: 'user' | 'perf'
  isDivider?: boolean
}

export function useObjectTree(options: UseObjectTreeOptions) {
  const {
    connectionId, connecting: _connecting, parentRef,
    onSelectTable, onSelectDatabase, onSchemaUpdated,
  } = options

  const { t } = useI18n()
  const toast = useToast()
  const treeNodes = ref<DatabaseTreeNode[]>([])
  const loading = ref(false)
  const searchQuery = ref('')
  const debouncedQuery = ref('')
  const searchCollapsedDbs = ref(new Set<string>())

  // ===== 全局对象搜索 =====
  const {
    searchQuery: objectSearchQuery,
    isSearching: isObjectSearching,
    searchResults: objectSearchResults,
    highlightedNodeId,
    navigateToNode,
  } = useObjectSearch(treeNodes)

  const showObjectSearchDropdown = ref(false)

  watch(isObjectSearching, (val) => {
    showObjectSearchDropdown.value = val
  })

  /** 获取节点图标组件 */
  function getNodeIcon(node: DatabaseTreeNode) {
    const { Database, FolderOpen, Folder, Table2, Eye, Workflow, FunctionSquare, Zap, KeyRound, Columns3 } = _icons
    switch (node.type) {
      case 'database': return Database
      case 'folder': return node.isExpanded ? FolderOpen : Folder
      case 'table': return Table2
      case 'view': return Eye
      case 'procedure': return Workflow
      case 'function': return FunctionSquare
      case 'trigger': return Zap
      case 'column': return node.meta?.isPrimaryKey ? KeyRound : Columns3
    }
  }

  /** 点击搜索结果项：关闭下拉面板 → 展开路径 → 滚动到目标节点 → 打开表数据 */
  function handleSearchResultClick(item: (typeof objectSearchResults.value)[number]) {
    showObjectSearchDropdown.value = false
    navigateToNode(item)

    // 等待树节点展开、扁平化列表更新后，滚动到目标节点
    nextTick(() => {
      const targetId = item.node.id
      const idx = flattenedNodes.value.findIndex(n => n.id === targetId)
      if (idx >= 0) {
        virtualizer.value.scrollToIndex(idx, { align: 'center' })
      }
    })

    // 点击 table/view 时直接打开表数据
    if (item.node.type === 'table' || item.node.type === 'view') {
      const database = item.node.meta?.database
      const table = item.node.meta?.table
      if (database && table) onSelectTable(database, table)
    } else if (item.node.type === 'database') {
      const database = item.node.meta?.database
      if (database) onSelectDatabase(database)
    }
  }

  // ===== 统一搜索输入 =====
  const combinedSearchQuery = ref('')
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  onActivated(() => {
    combinedSearchQuery.value = ''
  })

  const debounceCombinedSearch = (val: string) => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      debouncedQuery.value = val
      searchCollapsedDbs.value = new Set()
    }, 150)
  }

  watch(combinedSearchQuery, (val) => {
    const trimmed = val.trim()
    searchQuery.value = val
    debounceCombinedSearch(val)
    objectSearchQuery.value = val
    if (!trimmed) {
      showObjectSearchDropdown.value = false
      searchCollapsedDbs.value = new Set()
    }
  })

  // ===== 过滤后节点 =====
  const filteredNodes = computed(() => {
    const q = debouncedQuery.value.toLowerCase().trim()
    if (!q) return treeNodes.value
    return treeNodes.value.map(dbNode => {
      const dbId = dbNode.id
      const isCollapsedByUser = searchCollapsedDbs.value.has(dbId)
      const dbMatches = dbNode.label.toLowerCase().includes(q)
      const matchedFolders = dbNode.children?.map(folderNode => {
        if (folderNode.type !== 'folder') {
          const nameMatch = folderNode.label.toLowerCase().includes(q)
          const commentMatch = (folderNode.meta?.comment ?? '').toLowerCase().includes(q)
          return (nameMatch || commentMatch) ? folderNode : null
        }
        const matchedItems = folderNode.children?.filter(item =>
          item.label.toLowerCase().includes(q)
          || (item.meta?.comment ?? '').toLowerCase().includes(q),
        )
        if (matchedItems && matchedItems.length > 0) {
          return Object.assign({}, folderNode, { isExpanded: true, children: matchedItems })
        }
        return null
      }).filter(Boolean) as DatabaseTreeNode[] | undefined

      if (matchedFolders && matchedFolders.length > 0) {
        return Object.assign({}, dbNode, { isExpanded: !isCollapsedByUser, children: matchedFolders })
      }
      if (dbMatches) {
        return Object.assign({}, dbNode, { isExpanded: false, children: [] })
      }
      return null
    }).filter(Boolean) as DatabaseTreeNode[]
  })

  // ===== 扁平化节点 =====
  const isSystemExpanded = ref(false)

  const flattenedNodes = computed(() => {
    const result: FlatNodeWrapper[] = []
    function recurse(nodes: DatabaseTreeNode[], level: number) {
      nodes.forEach(node => {
        result.push({ id: node.id, node, level })
        if (node.isExpanded && node.children && node.children.length > 0) {
          recurse(node.children, level + 1)
        }
      })
    }
    recurse(filteredNodes.value, 0)
    if (debouncedQuery.value.trim() === '') {
      result.push({ id: 'db-divider', level: 0, isDivider: true })
      result.push({ id: 'sys-folder', level: 0, isSystemFolder: true })
      if (isSystemExpanded.value) {
        result.push({ id: 'sys-users', level: 1, isSystem: true, systemAction: 'user' })
        result.push({ id: 'sys-perf', level: 1, isSystem: true, systemAction: 'perf' })
      }
    }
    return result
  })

  // ===== 虚拟滚动 =====
  const { overscan: treeAdaptiveOverscan, attach: attachTreeOverscan } = useAdaptiveOverscan(
    parentRef,
    { baseOverscan: 20, maxOverscan: 60, rowHeight: 28, velocityThreshold: 15, decayDelay: 300 },
  )

  const virtualizer = useVirtualizer(computed(() => ({
    count: flattenedNodes.value.length,
    getScrollElement: () => parentRef.value,
    estimateSize: () => 28,
    overscan: treeAdaptiveOverscan.value,
  })))

  const virtualRows = computed(() => virtualizer.value.getVirtualItems())
  const totalSize = computed(() => virtualizer.value.getTotalSize())

  watch(parentRef, (el) => {
    if (el) attachTreeOverscan()
  })

  // ===== 数据加载 =====

  async function loadDatabases(preloaded?: DatabaseInfo[]) {
    loading.value = true
    try {
      let databases: DatabaseInfo[]
      if (preloaded) {
        databases = preloaded
      } else {
        const result = await fetchWithCache(
          `${connectionId.value}:databases`,
          () => dbApi.dbGetDatabases(connectionId.value),
        )
        databases = result.data
      }
      treeNodes.value = databases.map((db) => ({
        id: `db-${db.name}`,
        label: db.name,
        type: 'database' as const,
        children: [],
        isExpanded: false,
        isLoading: false,
        meta: markRaw({ database: db.name }),
      }))
      onSchemaUpdated()
    } catch {
      treeNodes.value = []
    } finally {
      loading.value = false
    }
  }

  function createFolderNodes(database: string): DatabaseTreeNode[] {
    return [
      { id: `folder-tables-${database}`, label: t('objectTree.tables'), type: 'folder', folderType: 'tables', children: [], isExpanded: false, isLoading: false, meta: markRaw({ database }) },
      { id: `folder-views-${database}`, label: t('objectTree.views'), type: 'folder', folderType: 'views', children: [], isExpanded: false, isLoading: false, meta: markRaw({ database }) },
      { id: `folder-procedures-${database}`, label: t('objectTree.procedures'), type: 'folder', folderType: 'procedures', children: [], isExpanded: false, isLoading: false, meta: markRaw({ database }) },
      { id: `folder-functions-${database}`, label: t('objectTree.functions'), type: 'folder', folderType: 'functions', children: [], isExpanded: false, isLoading: false, meta: markRaw({ database }) },
      { id: `folder-triggers-${database}`, label: t('objectTree.triggers'), type: 'folder', folderType: 'triggers', children: [], isExpanded: false, isLoading: false, meta: markRaw({ database }) },
    ]
  }

  async function loadDatabaseFolders(node: DatabaseTreeNode) {
    const database = node.meta?.database
    if (!database) return
    node.isLoading = true
    node.children = createFolderNodes(database)
    node.isLoading = false
  }

  async function loadFolderChildren(node: DatabaseTreeNode) {
    const database = node.meta?.database
    if (!database) return
    node.isLoading = true
    try {
      const cacheKey = `${connectionId.value}:${database}:${node.folderType}`
      switch (node.folderType) {
        case 'tables': {
          const { data: tables } = await fetchWithCache(cacheKey, () => dbApi.dbGetTables(connectionId.value, database))
          node.children = tables
            .filter(tbl => tbl.tableType !== 'VIEW')
            .map((tbl) => ({
              id: `tbl-${database}-${tbl.name}`,
              label: tbl.name,
              type: 'table' as const,
              children: [],
              isExpanded: false,
              isLoading: false,
              meta: markRaw({ database, table: tbl.name, comment: tbl.comment ?? undefined }),
            }))
          break
        }
        case 'views': {
          const { data: views } = await fetchWithCache(cacheKey, () => dbApi.dbGetViews(connectionId.value, database))
          node.children = views.map((v) => ({
            id: `view-${database}-${v.name}`,
            label: v.name,
            type: 'view' as const,
            children: [],
            isExpanded: false,
            isLoading: false,
            meta: markRaw({ database, table: v.name, objectType: 'VIEW' }),
          }))
          break
        }
        case 'procedures': {
          const { data: procs } = await fetchWithCache(cacheKey, () => dbApi.dbGetProcedures(connectionId.value, database))
          node.children = procs.map((p) => ({
            id: `proc-${database}-${p.name}`,
            label: p.name,
            type: 'procedure' as const,
            meta: markRaw({ database, objectType: 'PROCEDURE', comment: p.comment ?? undefined, definer: p.definer ?? undefined, created: p.created ?? undefined }),
          }))
          break
        }
        case 'functions': {
          const { data: funcs } = await fetchWithCache(cacheKey, () => dbApi.dbGetFunctions(connectionId.value, database))
          node.children = funcs.map((f) => ({
            id: `func-${database}-${f.name}`,
            label: f.name,
            type: 'function' as const,
            meta: markRaw({ database, objectType: 'FUNCTION', comment: f.comment ?? undefined, definer: f.definer ?? undefined, created: f.created ?? undefined }),
          }))
          break
        }
        case 'triggers': {
          const { data: triggers } = await fetchWithCache(cacheKey, () => dbApi.dbGetTriggers(connectionId.value, database))
          node.children = triggers.map((tr) => ({
            id: `trigger-${database}-${tr.name}`,
            label: tr.name,
            type: 'trigger' as const,
            meta: markRaw({ database, objectType: 'TRIGGER', event: tr.event, timing: tr.timing, table: tr.tableName }),
          }))
          break
        }
      }
    } catch (e) {
      node.children = []
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(t('objectTree.loadFailed'), msg)
      console.error(`[ObjectTree] 加载 ${node.folderType} 失败:`, e)
    } finally {
      node.isLoading = false
      onSchemaUpdated()
    }
  }

  async function loadColumns(node: DatabaseTreeNode) {
    const database = node.meta?.database
    const table = node.meta?.table
    if (!database || !table) return
    node.isLoading = true
    try {
      const cacheKey = `${connectionId.value}:${database}:${table}:columns`
      const { data: columns } = await fetchWithCache(cacheKey, () => dbApi.dbGetColumns(connectionId.value, database, table))
      node.children = columns.map((col) => ({
        id: `col-${database}-${table}-${col.name}`,
        label: col.name,
        type: 'column' as const,
        meta: markRaw({ database, table, dataType: col.dataType, isPrimaryKey: col.isPrimaryKey, nullable: col.nullable, comment: col.comment ?? undefined }),
      }))
    } catch (e) {
      node.children = []
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(t('objectTree.loadFailed'), msg)
      console.error(`[ObjectTree] 加载列信息失败:`, e)
    } finally {
      node.isLoading = false
      onSchemaUpdated()
    }
  }

  // ===== 节点交互 =====

  function toggleNode(node: DatabaseTreeNode) {
    if (node.type === 'column') return
    const isSearching = debouncedQuery.value.trim().length > 0
    if (isSearching && node.type === 'database') {
      const dbId = node.id
      const next = new Set(searchCollapsedDbs.value)
      if (next.has(dbId)) next.delete(dbId)
      else next.add(dbId)
      searchCollapsedDbs.value = next
      return
    }
    node.isExpanded = !node.isExpanded
    if (!node.isExpanded) return
    if (node.type === 'database' && node.meta?.database) {
      onSelectDatabase(node.meta.database)
    }
    if (node.type === 'database' && node.children && node.children.length === 0) {
      loadDatabaseFolders(node)
    } else if (node.type === 'folder' && node.children && node.children.length === 0) {
      loadFolderChildren(node)
    } else if ((node.type === 'table' || node.type === 'view') && node.children && node.children.length === 0) {
      loadColumns(node)
    }
  }

  function handleDoubleClick(node: DatabaseTreeNode) {
    if (node.type === 'table' || node.type === 'view') {
      const database = node.meta?.database
      const table = node.meta?.table
      if (database && table) onSelectTable(database, table)
    } else if (node.type === 'database') {
      const database = node.meta?.database
      if (database) onSelectDatabase(database)
    }
  }

  function handleRefreshDatabase(node: DatabaseTreeNode) {
    node.children = []
    node.isExpanded = false
    toggleNode(node)
  }

  function handleRefreshFolder(node: DatabaseTreeNode) {
    node.children = []
    node.isExpanded = false
    toggleNode(node)
  }

  function clearTree() {
    treeNodes.value = []
    searchQuery.value = ''
    debouncedQuery.value = ''
    invalidateByPrefix(connectionId.value)
  }

  async function forceRefresh() {
    invalidateByPrefix(connectionId.value)
    await loadDatabases()
  }

  async function silentRefresh() {
    const expandedKeys = new Set<string>()
    const collectExpanded = (nodes: DatabaseTreeNode[]) => {
      for (const node of nodes) {
        if (node.isExpanded) expandedKeys.add(node.id)
        if (node.children) collectExpanded(node.children)
      }
    }
    collectExpanded(treeNodes.value)
    invalidateByPrefix(connectionId.value)
    await loadDatabases()
    const restoreExpanded = async (nodes: DatabaseTreeNode[]) => {
      await Promise.all(nodes.map(async (node) => {
        if (expandedKeys.has(node.id)) {
          node.isExpanded = true
          if (node.type === 'database') {
            await loadDatabaseFolders(node)
            await restoreExpanded(node.children || [])
          } else if (node.type === 'folder') {
            await loadFolderChildren(node)
            await restoreExpanded(node.children || [])
          } else if (node.type === 'table' || node.type === 'view') {
            await loadColumns(node)
          }
        }
      }))
    }
    if (expandedKeys.size > 0) {
      await restoreExpanded(treeNodes.value)
    }
  }

  // ===== 节点元数据提取辅助函数 =====

  function getNodeDatabase(node: DatabaseTreeNode): string | undefined {
    return node.meta?.database
  }

  function getNodeTable(node: DatabaseTreeNode): string | undefined {
    return node.meta?.table
  }

  function getNodeColumns(node: DatabaseTreeNode): string[] {
    return node.children?.filter(c => c.type === 'column').map(c => c.label) ?? []
  }

  return {
    // 核心状态
    treeNodes, loading, filteredNodes, flattenedNodes,
    isSystemExpanded, debouncedQuery,
    // 搜索
    combinedSearchQuery, showObjectSearchDropdown,
    isObjectSearching, objectSearchResults, highlightedNodeId,
    handleSearchResultClick,
    // 虚拟滚动
    virtualRows, totalSize,
    // 节点交互
    toggleNode, handleDoubleClick,
    handleRefreshDatabase, handleRefreshFolder,
    getNodeIcon,
    // 数据加载
    loadDatabases, clearTree, forceRefresh, silentRefresh,
    // 辅助函数
    getNodeDatabase, getNodeTable, getNodeColumns,
  }
}

/**
 * 图标组件引用 — 避免在 composable 中直接 import 组件
 * 由 ObjectTree.vue 在初始化时注入
 */
import {
  Database, Table2, Columns3, Eye, KeyRound,
  FolderOpen, Folder, Workflow, Zap, FunctionSquare,
} from 'lucide-vue-next'

const _icons = {
  Database, Table2, Columns3, Eye, KeyRound,
  FolderOpen, Folder, Workflow, Zap, FunctionSquare,
}
