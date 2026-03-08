<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, onActivated, markRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Database,
  Table2,
  Columns3,
  Eye,
  KeyRound,
  ChevronRight,
  Loader2,
  RefreshCw,
  Pencil,
  FileUp,
  Code,
  Plus,
  Search,
  X,
  FolderOpen,
  Folder,
  Workflow,
  Zap,
  FunctionSquare,
  GitCompareArrows,
  HardDrive,
  Upload,
  Users,
  Activity,
  FileCode,
  FileDown,
  Trash2,
} from 'lucide-vue-next'
import * as dbApi from '@/api/database'
import { fetchWithCache, invalidateByPrefix } from '@/composables/useMetadataCache'
import type { DatabaseTreeNode, DatabaseInfo } from '@/types/database'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useObjectSearch } from '@/composables/useObjectSearch'
import { useAdaptiveOverscan } from '@/composables/useAdaptiveOverscan'

const props = defineProps<{
  connectionId: string
  connecting?: boolean
}>()

const emit = defineEmits<{
  selectTable: [database: string, table: string]
  selectDatabase: [database: string]
  editTable: [database: string, table: string]
  importData: [database: string, table: string, columns: string[]]
  createTable: [database: string]
  deleteTable: [database: string, table: string]
  showCreateSql: [database: string, table: string]
  showObjectDefinition: [database: string, name: string, objectType: string]
  schemaUpdated: []
  openSchemaCompare: []
  backupDatabase: [database: string]
  restoreDatabase: [database: string]
  openUserManagement: []
  openPerformance: []
  generateScript: [database: string, table: string, scriptType: string]
  exportDatabaseDdl: [database: string]
}>()

const { t } = useI18n()
const treeNodes = ref<DatabaseTreeNode[]>([])
const loading = ref(false)
const searchQuery = ref('')
const debouncedQuery = ref('')
const searchCollapsedDbs = ref(new Set<string>())

// 全局对象搜索
const {
  searchQuery: objectSearchQuery,
  isSearching: isObjectSearching,
  searchResults: objectSearchResults,
  highlightedNodeId,
  navigateToNode,
  clearSearch: clearObjectSearch,
} = useObjectSearch(treeNodes)

/** 对象搜索下拉面板是否显示 */
const showObjectSearchDropdown = ref(false)

/** 监听对象搜索状态，控制下拉面板显示 */
watch(isObjectSearching, (val) => {
  showObjectSearchDropdown.value = val
})

/** 获取搜索结果节点的图标组件 */
function getSearchResultIcon(node: DatabaseTreeNode) {
  return getNodeIcon(node)
}

/** 点击搜索结果项 */
function handleSearchResultClick(item: (typeof objectSearchResults.value)[number]) {
  showObjectSearchDropdown.value = false
  navigateToNode(item)
}

// 统一搜索输入
const combinedSearchQuery = ref('')

let searchTimer: ReturnType<typeof setTimeout> | null = null

onActivated(() => {
  // KeepAlive 重新激活时重置搜索状态
  combinedSearchQuery.value = ''
})

// 搜索响应式加速：不再直接强制同步，而是给予主线程极短的喘息时间
const debounceCombinedSearch = (val: string) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    debouncedQuery.value = val
    searchCollapsedDbs.value = new Set()
  }, 150) // 150ms 是打字顺滑度与搜索即时性的黄金平衡点
}

// 监听统一搜索输入，同步到两个子搜索逻辑
watch(combinedSearchQuery, (val) => {
  const trimmed = val.trim()
  // 1. 本地过滤逻辑（走微防抖）
  searchQuery.value = val
  debounceCombinedSearch(val)
  
  // 2. 同步到全局对象搜索逻辑（原逻辑已内置处理）
  objectSearchQuery.value = val
  
  // 如果输入为空，确保下拉面板关闭
  if (!trimmed) {
    showObjectSearchDropdown.value = false
    searchCollapsedDbs.value = new Set()
  }
})

const filteredNodes = computed(() => {
  const q = debouncedQuery.value.toLowerCase().trim()
  if (!q) return treeNodes.value
  return treeNodes.value.map(dbNode => {
    const dbId = dbNode.id
    const isCollapsedByUser = searchCollapsedDbs.value.has(dbId)
    const dbMatches = dbNode.label.toLowerCase().includes(q)

    // 深度搜索：遍历 folder 子节点内部的表/视图/存储过程等
    const matchedFolders = dbNode.children?.map(folderNode => {
      if (folderNode.type !== 'folder') {
        const nameMatch = folderNode.label.toLowerCase().includes(q)
        const commentMatch = (folderNode.meta?.comment ?? '').toLowerCase().includes(q)
        return (nameMatch || commentMatch) ? folderNode : null
      }
      const matchedItems = folderNode.children?.filter(item =>
        item.label.toLowerCase().includes(q) ||
        (item.meta?.comment ?? '').toLowerCase().includes(q)
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

/** 
 * 树节点扁平化封装结构
 * 直接引用原 Node 保证响应式和 toggle 操作生效
 */
interface FlatNodeWrapper {
  id: string
  node?: DatabaseTreeNode
  level: number
  isSystem?: boolean
  isSystemFolder?: boolean
  systemAction?: 'user' | 'perf'
  isDivider?: boolean
}

const isSystemExpanded = ref(false)

const flattenedNodes = computed(() => {
  const result: FlatNodeWrapper[] = []
  
  // 1. 递归主树 (数据库列表)
  function recurse(nodes: DatabaseTreeNode[], level: number) {
    nodes.forEach(node => {
      result.push({ id: node.id, node, level })
      if (node.isExpanded && node.children && node.children.length > 0) {
        recurse(node.children, level + 1)
      }
    })
  }
  
  recurse(filteredNodes.value, 0)

  // 2. 底部系统管理入口 (仅在未搜索时显示，降低视觉干扰)
  if (debouncedQuery.value.trim() === '') {
    // 分割线
    result.push({ id: 'db-divider', level: 0, isDivider: true })
    
    // 系统管理聚合文件夹
    result.push({ id: 'sys-folder', level: 0, isSystemFolder: true })
    
    // 展开后的子项
    if (isSystemExpanded.value) {
      result.push({ id: 'sys-users', level: 1, isSystem: true, systemAction: 'user' })
      result.push({ id: 'sys-perf', level: 1, isSystem: true, systemAction: 'perf' })
    }
  }
  
  return result
})

// 虚拟列表容器引用
const parentRef = ref<HTMLElement | null>(null)

// 自适应 overscan：根据滚动速度动态调整预渲染行数
const { overscan: treeAdaptiveOverscan, attach: attachTreeOverscan } = useAdaptiveOverscan(
  parentRef,
  { baseOverscan: 20, maxOverscan: 60, rowHeight: 28, velocityThreshold: 15, decayDelay: 300 },
)

// 初始化虚拟滚动器 - 使用 computed 包裹 options 是 Vue 3 环境下最通用的方案
const virtualizer = useVirtualizer(computed(() => ({
  count: flattenedNodes.value.length,
  getScrollElement: () => parentRef.value,
  estimateSize: () => 28,
  overscan: treeAdaptiveOverscan.value, // 动态 overscan，随滚动速度自适应
})))

const virtualRows = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

// parentRef 挂载后绑定自适应 overscan 的滚动监听
watch(parentRef, (el) => {
  if (el) attachTreeOverscan()
})

/** 加载数据库列表，支持接受预加载数据（跳过 IPC 请求） */
async function loadDatabases(preloaded?: DatabaseInfo[]) {
  loading.value = true
  try {
    let databases: DatabaseInfo[]
    if (preloaded) {
      databases = preloaded
    } else {
      const result = await fetchWithCache(
        `${props.connectionId}:databases`,
        () => dbApi.dbGetDatabases(props.connectionId),
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
    emit('schemaUpdated')
  } catch (e) {
    treeNodes.value = []
  } finally {
    loading.value = false
  }
}

function toggleNode(node: DatabaseTreeNode) {
  if (node.type === 'column') return

  const isSearching = debouncedQuery.value.trim().length > 0

  // During search, track collapsed databases separately
  if (isSearching && node.type === 'database') {
    const dbId = node.id
    if (searchCollapsedDbs.value.has(dbId)) {
      const next = new Set(searchCollapsedDbs.value)
      next.delete(dbId)
      searchCollapsedDbs.value = next
    } else {
      const next = new Set(searchCollapsedDbs.value)
      next.add(dbId)
      searchCollapsedDbs.value = next
    }
    return
  }

  node.isExpanded = !node.isExpanded
  if (!node.isExpanded) return

  // 展开数据库节点时，自动通知父组件切换当前数据库上下文
  // 这样用户展开 data_sync 后执行 SQL 就不会报 "No database selected"
  if (node.type === 'database' && node.meta?.database) {
    emit('selectDatabase', node.meta.database)
  }

  // Fire-and-forget: expand immediately, load data in background
  if (node.type === 'database' && node.children && node.children.length === 0) {
    loadDatabaseFolders(node)
  } else if (node.type === 'folder' && node.children && node.children.length === 0) {
    loadFolderChildren(node)
  } else if ((node.type === 'table' || node.type === 'view') && node.children && node.children.length === 0) {
    loadColumns(node)
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
    const cacheKey = `${props.connectionId}:${database}:${node.folderType}`
    switch (node.folderType) {
      case 'tables': {
        const { data: tables } = await fetchWithCache(
          cacheKey,
          () => dbApi.dbGetTables(props.connectionId, database),
        )
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
        const { data: views } = await fetchWithCache(
          cacheKey,
          () => dbApi.dbGetViews(props.connectionId, database),
        )
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
        const { data: procs } = await fetchWithCache(
          cacheKey,
          () => dbApi.dbGetProcedures(props.connectionId, database),
        )
        node.children = procs.map((p) => ({
          id: `proc-${database}-${p.name}`,
          label: p.name,
          type: 'procedure' as const,
          meta: markRaw({
            database,
            objectType: 'PROCEDURE',
            comment: p.comment ?? undefined,
            definer: p.definer ?? undefined,
            created: p.created ?? undefined,
          }),
        }))
        break
      }
      case 'functions': {
        const { data: funcs } = await fetchWithCache(
          cacheKey,
          () => dbApi.dbGetFunctions(props.connectionId, database),
        )
        node.children = funcs.map((f) => ({
          id: `func-${database}-${f.name}`,
          label: f.name,
          type: 'function' as const,
          meta: markRaw({
            database,
            objectType: 'FUNCTION',
            comment: f.comment ?? undefined,
            definer: f.definer ?? undefined,
            created: f.created ?? undefined,
          }),
        }))
        break
      }
      case 'triggers': {
        const { data: triggers } = await fetchWithCache(
          cacheKey,
          () => dbApi.dbGetTriggers(props.connectionId, database),
        )
        node.children = triggers.map((tr) => ({
          id: `trigger-${database}-${tr.name}`,
          label: tr.name,
          type: 'trigger' as const,
          meta: markRaw({
            database,
            objectType: 'TRIGGER',
            event: tr.event,
            timing: tr.timing,
            table: tr.tableName,
          }),
        }))
        break
      }
    }
  } catch (e) {
    node.children = []
    console.error(`[ObjectTree] 加载 ${node.folderType} 失败:`, e)
  } finally {
    node.isLoading = false
    emit('schemaUpdated')
  }
}

async function loadColumns(node: DatabaseTreeNode) {
  const database = node.meta?.database
  const table = node.meta?.table
  if (!database || !table) return

  node.isLoading = true
  try {
    const cacheKey = `${props.connectionId}:${database}:${table}:columns`
    const { data: columns } = await fetchWithCache(
      cacheKey,
      () => dbApi.dbGetColumns(props.connectionId, database, table),
    )
    node.children = columns.map((col) => ({
      id: `col-${database}-${table}-${col.name}`,
      label: col.name,
      type: 'column' as const,
      meta: markRaw({
        database,
        table,
        dataType: col.dataType,
        isPrimaryKey: col.isPrimaryKey,
        nullable: col.nullable,
        comment: col.comment ?? undefined,
      }),
    }))
  } catch (e) {
    node.children = []
    console.error(`[ObjectTree] 加载列信息失败:`, e)
  } finally {
    node.isLoading = false
    emit('schemaUpdated')
  }
}

function handleDoubleClick(node: DatabaseTreeNode) {
  if (node.type === 'table' || node.type === 'view') {
    const database = node.meta?.database
    const table = node.meta?.table
    if (database && table) {
      emit('selectTable', database, table)
    }
  } else if (node.type === 'database') {
    const database = node.meta?.database
    if (database) {
      emit('selectDatabase', database)
    }
  }
}

function handleEditTable(node: DatabaseTreeNode) {
  const database = node.meta?.database
  const table = node.meta?.table
  if (database && table) {
    emit('editTable', database, table)
  }
}

function handleImportData(node: DatabaseTreeNode) {
  const database = node.meta?.database
  const table = node.meta?.table
  if (database && table) {
    const columns = node.children?.filter(c => c.type === 'column').map(c => c.label) ?? []
    emit('importData', database, table, columns)
  }
}

function handleCreateTable(node: DatabaseTreeNode) {
  const database = node.meta?.database
  if (database) {
    emit('createTable', database)
  }
}

function handleDeleteTable(node: DatabaseTreeNode) {
  const database = node.meta?.database
  const table = node.meta?.table
  if (database && table) {
    emit('deleteTable', database, table)
  }
}

function handleShowCreateSql(node: DatabaseTreeNode) {
  const database = node.meta?.database
  const table = node.meta?.table
  if (database && table) {
    emit('showCreateSql', database, table)
  }
}

/** 生成表对象的 DDL 脚本 */
function handleGenerateScript(node: DatabaseTreeNode, scriptType: string) {
  const database = node.meta?.database
  const table = node.meta?.table
  if (database && table) {
    emit('generateScript', database, table, scriptType)
  }
}

/** 导出数据库结构 */
function handleExportDatabaseDdl(node: DatabaseTreeNode) {
  const database = node.meta?.database
  if (database) {
    emit('exportDatabaseDdl', database)
  }
}

function handleShowDefinition(node: DatabaseTreeNode) {
  const database = node.meta?.database
  const objectType = node.meta?.objectType
  if (database && objectType) {
    emit('showObjectDefinition', database, node.label, objectType)
  }
}

function handleBackupDatabase(node: DatabaseTreeNode) {
  const database = node.meta?.database
  if (database) emit('backupDatabase', database)
}

function handleRestoreDatabase(node: DatabaseTreeNode) {
  const database = node.meta?.database
  if (database) emit('restoreDatabase', database)
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

function getNodeIcon(node: DatabaseTreeNode) {
  switch (node.type) {
    case 'database':
      return Database
    case 'folder':
      return node.isExpanded ? FolderOpen : Folder
    case 'table':
      return Table2
    case 'view':
      return Eye
    case 'procedure':
      return Workflow
    case 'function':
      return FunctionSquare
    case 'trigger':
      return Zap
    case 'column':
      return node.meta?.isPrimaryKey ? KeyRound : Columns3
  }
}

function clearTree() {
  treeNodes.value = []
  searchQuery.value = ''
  debouncedQuery.value = ''
  // 清理该连接的所有元数据缓存
  invalidateByPrefix(props.connectionId)
}

/** 强制刷新：清除缓存后重新加载 */
async function forceRefresh() {
  invalidateByPrefix(props.connectionId)
  await loadDatabases()
}

/** 保持展开状态的无感刷新 (应对 DDL 执行后树的重新渲染而不丢失层级) */
async function silentRefresh() {
  const expandedKeys = new Set<string>()
  const collectExpanded = (nodes: DatabaseTreeNode[]) => {
    for (const node of nodes) {
      if (node.isExpanded) expandedKeys.add(node.id)
      if (node.children) collectExpanded(node.children)
    }
  }
  collectExpanded(treeNodes.value)

  invalidateByPrefix(props.connectionId)
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

defineExpose({ loadDatabases, treeNodes, clearTree, forceRefresh, silentRefresh })
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden border-r border-border bg-muted/30">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-2 py-1.5">
      <span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {{ t('database.objects') }}
      </span>
      <Button
        variant="ghost"
        size="icon"
        class="h-5 w-5 text-muted-foreground hover:text-foreground"
        :disabled="loading"
        @click="forceRefresh"
      >
        <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': loading }" />
      </Button>
    </div>

    <!-- 统一智能搜索框 -->
    <div class="px-2 pt-2 border-b border-border/10 pb-2 relative">
      <div class="relative group">
        <Search class="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50 transition-colors group-focus-within:text-primary" />
        <Input
          v-model="combinedSearchQuery"
          class="h-8 pl-8 pr-8 text-xs bg-muted/20 border-border/20 focus-visible:ring-1 focus-visible:ring-primary/30 transition-all rounded-md"
          :placeholder="t('objectTree.searchPlaceholder')"
          @keydown.escape="combinedSearchQuery = ''; showObjectSearchDropdown = false"
          @focus="isObjectSearching && (showObjectSearchDropdown = true)"
        />
        <button
          v-if="combinedSearchQuery"
          class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-all"
          @click="combinedSearchQuery = ''; showObjectSearchDropdown = false"
        >
          <X class="h-3 w-3" />
        </button>
      </div>

      <!-- 搜索结果下拉面板 (整合版) -->
      <div
        v-if="showObjectSearchDropdown && isObjectSearching"
        class="absolute left-2 right-2 top-full z-50 mt-1 max-h-[300px] overflow-hidden rounded-lg border border-border bg-popover shadow-xl animate-in fade-in slide-in-from-top-1 duration-200"
      >
        <div class="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border/10">
          <span class="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">全局对象匹配</span>
          <span class="text-[9px] px-1 bg-primary/10 text-primary rounded">{{ objectSearchResults.length }}</span>
        </div>
        
        <div class="max-h-[260px] overflow-y-auto">
          <div v-if="objectSearchResults.length === 0" class="px-3 py-8 text-center">
            <Search class="mx-auto mb-2 h-5 w-5 text-muted-foreground/20" />
            <p class="text-[11px] text-muted-foreground/60">未找到相关数据库对象</p>
          </div>
          <div v-else class="py-1">
            <div
              v-for="(item, idx) in objectSearchResults"
              :key="item.node.id + '-' + idx"
              class="group/item flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs hover:bg-primary/5 transition-colors border-l-2 border-transparent hover:border-primary"
              @click="handleSearchResultClick(item)"
            >
              <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted/40 text-muted-foreground">
                <component
                  :is="getSearchResultIcon(item.node)"
                  class="h-3.5 w-3.5"
                />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <p class="truncate font-medium text-foreground tracking-tight">{{ item.node.label }}</p>
                  <span
                    v-if="item.node.meta?.comment && (item.node.type === 'table' || item.node.type === 'view')"
                    class="shrink-0 max-w-[140px] truncate text-[9px] text-muted-foreground/40 italic"
                  >{{ item.node.meta.comment }}</span>
                </div>
                <div class="flex items-center gap-1.5 text-[9px] text-muted-foreground/50">
                   <span class="uppercase tracking-widest font-bold">{{ item.node.type }}</span>
                   <span v-if="item.node.type !== 'database'" class="opacity-40">•</span>
                   <span v-if="item.node.type !== 'database'" class="truncate italic">{{ item.database }}</span>
                </div>
              </div>
              <ChevronRight class="h-3 w-3 text-muted-foreground/30 opacity-0 group-hover/item:opacity-100 transition-opacity" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 虚拟滚动树 (性能怪兽版) -->
    <!-- contain: strict 限制重排范围，will-change: transform 提示 GPU 合成层 -->
    <div ref="parentRef" class="min-h-0 flex-1 overflow-y-auto no-scrollbar py-1" style="will-change: transform; contain: strict">
      <div v-if="(loading || connecting) && treeNodes.length === 0" class="flex items-center justify-center py-8">
        <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
      </div>

      <div v-else-if="filteredNodes.length === 0 && debouncedQuery.trim()" class="px-3 py-6 text-center">
        <Search class="mx-auto mb-2 h-5 w-5 text-muted-foreground/40" />
        <p class="text-xs text-muted-foreground">{{ t('database.noSearchResults') }}</p>
      </div>

      <div v-else-if="!loading && !connecting && treeNodes.length === 0" class="px-3 py-6 text-center">
        <Database class="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
        <p class="text-xs text-muted-foreground">{{ t('database.noDatabases') }}</p>
      </div>

      <div v-else class="relative w-full" :style="{ height: `${totalSize}px` }" style="will-change: transform">
        <div
          v-for="virtualRow in virtualRows"
          :key="virtualRow.key"
          class="absolute left-0 top-0 w-full"
          :style="{ height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }"
        >
          <template v-for="item in [flattenedNodes[virtualRow.index]]" :key="item?.id || virtualRow.key">
            <div 
              v-if="item" 
              v-memo="[
                item.id, 
                item.node?.isExpanded, 
                item.node?.isLoading,
                highlightedNodeId === item.id,
                isSystemExpanded
              ]"
              class="flex items-center h-full w-full"
            >
              <!-- 系统文件夹节点 -->
              <div
                v-if="item.isSystemFolder"
                class="group flex h-full grow cursor-pointer items-center gap-1 px-2 text-xs hover:bg-muted/50"
                @click="isSystemExpanded = !isSystemExpanded"
              >
                <div class="w-4 shrink-0 flex items-center justify-center">
                  <ChevronRight
                    class="h-3 w-3 text-muted-foreground transition-transform duration-150"
                    :class="{ 'rotate-90': isSystemExpanded }"
                  />
                </div>
                <FolderOpen v-if="isSystemExpanded" class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                <Folder v-else class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                <span class="truncate font-medium text-muted-foreground/80">系统管理</span>
              </div>

              <!-- 系统子入口节点 -->
              <div
                v-else-if="item.isSystem"
                class="group flex h-full grow cursor-pointer items-center gap-1 text-xs hover:bg-muted/50"
                :style="{ paddingLeft: `${item.level * 12 + 12}px` }"
                @click="item.systemAction === 'user' ? emit('openUserManagement') : emit('openPerformance')"
              >
                 <component :is="item.systemAction === 'user' ? Users : Activity" class="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                 <span class="truncate text-muted-foreground/70">{{ item.systemAction === 'user' ? '用户管理' : '性能监控' }}</span>
              </div>

              <!-- 分割线系统特供 -->
              <div v-else-if="item.isDivider" class="px-2 h-full grow flex items-center">
                 <div class="w-full border-b border-border/20" />
              </div>

              <!-- 普通对象节点 (虚拟化渲染) -->
              <ContextMenu v-else-if="item.node">
                <ContextMenuTrigger as-child>
                  <div
                    class="group flex h-full grow cursor-pointer items-center gap-1 pr-2 text-xs hover:bg-muted/50"
                    :class="[
                      { 'bg-primary/10 ring-1 ring-primary/30 rounded-sm': highlightedNodeId === item.node.id },
                    ]"
                    :style="{ paddingLeft: `${item.level * 12 + 8}px` }"
                    @click="toggleNode(item.node)"
                    @dblclick="handleDoubleClick(item.node)"
                  >
                    <!-- 展开/收起图标 (仅非叶子节点显示) -->
                    <div class="w-4 shrink-0 flex items-center justify-center">
                      <ChevronRight
                        v-if="item.node.type !== 'column' && item.node.type !== 'procedure' && item.node.type !== 'function' && item.node.type !== 'trigger'"
                        class="h-3 w-3 text-muted-foreground transition-transform duration-150"
                        :class="{ 'rotate-90': item.node.isExpanded }"
                      />
                    </div>

                    <Loader2 v-if="item.node.isLoading" class="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                    <component :is="getNodeIcon(item.node)" v-else class="h-3.5 w-3.5 shrink-0 text-muted-foreground" :class="{ 'text-amber-500': item.node.type === 'column' && item.node.meta?.isPrimaryKey }" />
                    
                    <span class="truncate" :class="{ 'text-muted-foreground': item.node.type === 'column' }">{{ item.node.label }}</span>

                    <!-- 表注释/元数据展示 -->
                    <span
                      v-if="item.node.meta?.comment && (item.node.type === 'table' || item.node.type === 'view')"
                      class="ml-auto truncate text-[10px] text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      {{ item.node.meta.comment }}
                    </span>

                    <!-- 触发器特供 -->
                    <span v-if="item.node.meta?.objectType === 'TRIGGER'" class="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                      {{ item.node.meta.timing }} {{ item.node.meta.event }}
                    </span>

                    <!-- 列类型显示 -->
                    <span v-if="item.node.type === 'column'" class="ml-auto shrink-0 text-[10px] text-muted-foreground/40 tabular-nums">
                      {{ item.node.meta?.dataType }}
                    </span>

                    <!-- 节点计数 (Folder) -->
                    <span
                      v-if="item.node.type === 'folder' && item.node.children && item.node.children.length > 0"
                      class="ml-auto shrink-0 text-[10px] text-muted-foreground/30 tabular-nums"
                    >
                      {{ item.node.children.length }}
                    </span>
                  </div>
                </ContextMenuTrigger>
                
                <!-- 右键菜单逻辑 (适配各种类型) -->
                <ContextMenuContent class="w-48">
                  <template v-if="item.node.type === 'database'">
                    <ContextMenuItem class="gap-2 text-xs" @click="handleBackupDatabase(item.node)">
                      <HardDrive class="h-3.5 w-3.5" />
                      {{ t('backup.title') }}
                    </ContextMenuItem>
                    <ContextMenuItem class="gap-2 text-xs" @click="handleRestoreDatabase(item.node)">
                      <Upload class="h-3.5 w-3.5" />
                      {{ t('restore.title') }}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem class="gap-2 text-xs" @click="emit('openSchemaCompare')">
                      <GitCompareArrows class="h-3.5 w-3.5" />
                      {{ t('schemaCompare.title') }}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem class="gap-2 text-xs" @click="handleExportDatabaseDdl(item.node)">
                      <FileDown class="h-3.5 w-3.5" />
                      导出数据库结构
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem class="gap-2 text-xs" @click="handleRefreshDatabase(item.node)">
                      <RefreshCw class="h-3.5 w-3.5" />
                      {{ t('common.refresh') }}
                    </ContextMenuItem>
                  </template>

                  <template v-if="item.node.type === 'folder'">
                    <ContextMenuItem v-if="item.node.folderType === 'tables'" class="gap-2 text-xs" @click="handleCreateTable(item.node)">
                      <Plus class="h-3.5 w-3.5" />
                      {{ t('tableEditor.createTable') }}
                    </ContextMenuItem>
                    <ContextMenuItem class="gap-2 text-xs" @click="handleRefreshFolder(item.node)">
                      <RefreshCw class="h-3.5 w-3.5" />
                      {{ t('common.refresh') }}
                    </ContextMenuItem>
                  </template>

                  <template v-if="item.node.type === 'table'">
                    <ContextMenuItem class="gap-2 text-xs" @click="handleEditTable(item.node)">
                      <Pencil class="h-3.5 w-3.5" />
                      {{ t('tableEditor.alterTable') }}
                    </ContextMenuItem>
                    <ContextMenuItem class="gap-2 text-xs" @click="handleImportData(item.node)">
                      <FileUp class="h-3.5 w-3.5" />
                      {{ t('dataImport.import') }}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem class="gap-2 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive" @click="handleDeleteTable(item.node)">
                      <Trash2 class="h-3.5 w-3.5" />
                      删除表
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem class="gap-2 text-xs" @click="handleShowCreateSql(item.node)">
                      <Code class="h-3.5 w-3.5" />
                      {{ t('database.showCreateTable') }}
                    </ContextMenuItem>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger class="gap-2 text-xs">
                        <FileCode class="h-3.5 w-3.5" />
                        生成脚本
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent class="w-44">
                        <ContextMenuItem class="text-xs" @click="handleGenerateScript(item.node, 'create')">CREATE TABLE</ContextMenuItem>
                        <ContextMenuItem class="text-xs" @click="handleGenerateScript(item.node, 'drop')">DROP TABLE</ContextMenuItem>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                  </template>

                  <template v-if="item.node.type === 'view' || item.node.type === 'procedure' || item.node.type === 'function'">
                     <ContextMenuItem class="gap-2 text-xs" @click="handleShowDefinition(item.node)">
                      <Code class="h-3.5 w-3.5" />
                      {{ t('objectTree.viewDefinition') }}
                    </ContextMenuItem>
                  </template>
                </ContextMenuContent>
              </ContextMenu>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
