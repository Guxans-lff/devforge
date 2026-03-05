<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, onActivated } from 'vue'
import { useI18n } from 'vue-i18n'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
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
} from 'lucide-vue-next'
import * as dbApi from '@/api/database'
import type { DatabaseTreeNode } from '@/types/database'

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
  showCreateSql: [database: string, table: string]
  showObjectDefinition: [database: string, name: string, objectType: string]
  schemaUpdated: []
  openSchemaCompare: []
  backupDatabase: [database: string]
  restoreDatabase: [database: string]
}>()

const { t } = useI18n()
const treeNodes = ref<DatabaseTreeNode[]>([])
const loading = ref(false)
const searchQuery = ref('')
const debouncedQuery = ref('')
const searchCollapsedDbs = ref(new Set<string>())

// Debounce search input for performance with large table lists
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(searchQuery, (val) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    debouncedQuery.value = val
    searchCollapsedDbs.value = new Set()
  }, 200)
})



onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

onActivated(() => {
  // KeepAlive 重新激活时仅重置搜索状态，保留已加载的树数据
  searchQuery.value = ''
  debouncedQuery.value = ''
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
        // 非 folder 节点（兼容旧结构），直接匹配
        const nameMatch = folderNode.label.toLowerCase().includes(q)
        const commentMatch = (folderNode.meta?.comment ?? '').toLowerCase().includes(q)
        return (nameMatch || commentMatch) ? folderNode : null
      }
      // folder 节点：过滤其子项
      const matchedItems = folderNode.children?.filter(item =>
        item.label.toLowerCase().includes(q) ||
        (item.meta?.comment ?? '').toLowerCase().includes(q)
      )
      if (matchedItems && matchedItems.length > 0) {
        // 保留原始 folder 引用的响应式属性，仅覆盖 children 和展开状态
        return Object.assign({}, folderNode, { isExpanded: true, children: matchedItems })
      }
      return null
    }).filter(Boolean) as DatabaseTreeNode[] | undefined

    if (matchedFolders && matchedFolders.length > 0) {
      return Object.assign({}, dbNode, { isExpanded: !isCollapsedByUser, children: matchedFolders })
    }
    // 数据库名匹配但无匹配子节点，显示数据库但不展开
    if (dbMatches) {
      return Object.assign({}, dbNode, { isExpanded: false, children: [] })
    }
    return null
  }).filter(Boolean) as DatabaseTreeNode[]
})

async function loadDatabases() {
  loading.value = true
  try {
    const databases = await dbApi.dbGetDatabases(props.connectionId)
    treeNodes.value = databases.map((db) => ({
      id: `db-${db.name}`,
      label: db.name,
      type: 'database' as const,
      children: [],
      isExpanded: false,
      isLoading: false,
      meta: { database: db.name },
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
    { id: `folder-tables-${database}`, label: t('objectTree.tables'), type: 'folder', folderType: 'tables', children: [], isExpanded: false, isLoading: false, meta: { database } },
    { id: `folder-views-${database}`, label: t('objectTree.views'), type: 'folder', folderType: 'views', children: [], isExpanded: false, isLoading: false, meta: { database } },
    { id: `folder-procedures-${database}`, label: t('objectTree.procedures'), type: 'folder', folderType: 'procedures', children: [], isExpanded: false, isLoading: false, meta: { database } },
    { id: `folder-functions-${database}`, label: t('objectTree.functions'), type: 'folder', folderType: 'functions', children: [], isExpanded: false, isLoading: false, meta: { database } },
    { id: `folder-triggers-${database}`, label: t('objectTree.triggers'), type: 'folder', folderType: 'triggers', children: [], isExpanded: false, isLoading: false, meta: { database } },
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
    switch (node.folderType) {
      case 'tables': {
        const tables = await dbApi.dbGetTables(props.connectionId, database)
        node.children = tables
          .filter(tbl => tbl.tableType !== 'VIEW')
          .map((tbl) => ({
            id: `tbl-${database}-${tbl.name}`,
            label: tbl.name,
            type: 'table' as const,
            children: [],
            isExpanded: false,
            isLoading: false,
            meta: { database, table: tbl.name, comment: tbl.comment ?? undefined },
          }))
        break
      }
      case 'views': {
        const views = await dbApi.dbGetViews(props.connectionId, database)
        node.children = views.map((v) => ({
          id: `view-${database}-${v.name}`,
          label: v.name,
          type: 'view' as const,
          children: [],
          isExpanded: false,
          isLoading: false,
          meta: { database, table: v.name, objectType: 'VIEW' },
        }))
        break
      }
      case 'procedures': {
        const procs = await dbApi.dbGetProcedures(props.connectionId, database)
        node.children = procs.map((p) => ({
          id: `proc-${database}-${p.name}`,
          label: p.name,
          type: 'procedure' as const,
          meta: {
            database,
            objectType: 'PROCEDURE',
            comment: p.comment ?? undefined,
            definer: p.definer ?? undefined,
            created: p.created ?? undefined,
          },
        }))
        break
      }
      case 'functions': {
        const funcs = await dbApi.dbGetFunctions(props.connectionId, database)
        node.children = funcs.map((f) => ({
          id: `func-${database}-${f.name}`,
          label: f.name,
          type: 'function' as const,
          meta: {
            database,
            objectType: 'FUNCTION',
            comment: f.comment ?? undefined,
            definer: f.definer ?? undefined,
            created: f.created ?? undefined,
          },
        }))
        break
      }
      case 'triggers': {
        const triggers = await dbApi.dbGetTriggers(props.connectionId, database)
        node.children = triggers.map((tr) => ({
          id: `trigger-${database}-${tr.name}`,
          label: tr.name,
          type: 'trigger' as const,
          meta: {
            database,
            objectType: 'TRIGGER',
            event: tr.event,
            timing: tr.timing,
            table: tr.tableName,
          },
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
    const columns = await dbApi.dbGetColumns(props.connectionId, database, table)
    node.children = columns.map((col) => ({
      id: `col-${database}-${table}-${col.name}`,
      label: col.name,
      type: 'column' as const,
      meta: {
        database,
        table,
        dataType: col.dataType,
        isPrimaryKey: col.isPrimaryKey,
        nullable: col.nullable,
        comment: col.comment ?? undefined,
      },
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

function handleShowCreateSql(node: DatabaseTreeNode) {
  const database = node.meta?.database
  const table = node.meta?.table
  if (database && table) {
    emit('showCreateSql', database, table)
  }
}

function handleShowDefinition(node: DatabaseTreeNode) {
  const database = node.meta?.database
  const objectType = node.meta?.objectType
  if (database && objectType) {
    emit('showObjectDefinition', database, node.label, objectType)
  }
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
}

defineExpose({ loadDatabases, treeNodes, clearTree })
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
        @click="loadDatabases"
      >
        <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': loading }" />
      </Button>
    </div>

    <!-- Search -->
    <div class="px-2 py-1.5 border-b border-border">
      <div class="relative">
        <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <Input
          v-model="searchQuery"
          class="h-6 pl-6 text-xs"
          :class="searchQuery ? 'pr-6' : 'pr-2'"
          :placeholder="t('database.searchTables')"
          @keydown.escape="searchQuery = ''"
        />
        <button
          v-if="searchQuery"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground transition-colors"
          @click="searchQuery = ''"
        >
          <X class="h-3 w-3" />
        </button>
      </div>
    </div>

    <!-- Tree -->
    <ScrollArea class="min-h-0 flex-1">
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

      <div v-else class="py-1">
        <template v-for="dbNode in filteredNodes" :key="dbNode.id">
          <!-- Database node with context menu -->
          <ContextMenu>
            <ContextMenuTrigger as-child>
              <div
                class="group flex cursor-pointer items-center gap-1 px-2 py-1 text-xs hover:bg-muted/50 transition-colors"
                @click="toggleNode(dbNode)"
                @dblclick="handleDoubleClick(dbNode)"
              >
                <ChevronRight
                  class="h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150"
                  :class="{ 'rotate-90': dbNode.isExpanded }"
                />
                <Loader2 v-if="dbNode.isLoading" class="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                <component :is="getNodeIcon(dbNode)" v-else class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span class="truncate">{{ dbNode.label }}</span>
                <span
                  v-if="dbNode.children && dbNode.children.length > 0"
                  class="ml-auto shrink-0 text-[10px] text-muted-foreground/40 tabular-nums"
                >
                  {{ dbNode.children.length }}
                </span>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent class="w-48">
              <ContextMenuItem class="gap-2 text-xs" @click="handleCreateTable(dbNode)">
                <Plus class="h-3.5 w-3.5" />
                {{ t('tableEditor.createTable') }}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem class="gap-2 text-xs" @click="emit('openSchemaCompare')">
                <GitCompareArrows class="h-3.5 w-3.5" />
                {{ t('schemaCompare.title') }}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem class="gap-2 text-xs" @click="emit('backupDatabase', dbNode.meta!.database!)">
                <HardDrive class="h-3.5 w-3.5" />
                {{ t('backup.title') }}
              </ContextMenuItem>
              <ContextMenuItem class="gap-2 text-xs" @click="emit('restoreDatabase', dbNode.meta!.database!)">
                <Upload class="h-3.5 w-3.5" />
                {{ t('restore.title') }}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>

          <!-- Folder / Table nodes -->
          <template v-if="dbNode.isExpanded && dbNode.children">
            <template v-for="folderNode in dbNode.children" :key="folderNode.id">
              <!-- Folder node (Tables/Views/Procedures/Functions/Triggers) -->
              <div
                class="group flex cursor-pointer items-center gap-1 py-1 pl-6 pr-2 text-xs hover:bg-muted/50 transition-colors"
                @click="toggleNode(folderNode)"
              >
                <ChevronRight
                  class="h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150"
                  :class="{ 'rotate-90': folderNode.isExpanded }"
                />
                <Loader2 v-if="folderNode.isLoading" class="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                <component :is="getNodeIcon(folderNode)" v-else class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span class="truncate">{{ folderNode.label }}</span>
                <span
                  v-if="folderNode.children && folderNode.children.length > 0"
                  class="ml-auto shrink-0 text-[10px] text-muted-foreground/40 tabular-nums"
                >
                  {{ folderNode.children.length }}
                </span>
              </div>

              <!-- Folder children -->
              <template v-if="folderNode.isExpanded && folderNode.children">
                <template v-for="childNode in folderNode.children" :key="childNode.id">
                  <!-- Table/View items (expandable for columns) -->
                  <template v-if="folderNode.folderType === 'tables' || folderNode.folderType === 'views'">
                    <ContextMenu>
                      <ContextMenuTrigger as-child>
                        <div
                          class="group flex cursor-pointer items-center gap-1 py-1 pl-10 pr-2 text-xs hover:bg-muted/50 transition-colors"
                          @click="toggleNode(childNode)"
                          @dblclick="handleDoubleClick(childNode)"
                        >
                          <ChevronRight
                            class="h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150"
                            :class="{ 'rotate-90': childNode.isExpanded }"
                          />
                          <Loader2 v-if="childNode.isLoading" class="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                          <component :is="getNodeIcon(childNode)" v-else class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span class="truncate">{{ childNode.label }}</span>
                          <span
                            v-if="childNode.meta?.comment"
                            class="ml-auto truncate text-[10px] text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            {{ childNode.meta.comment }}
                          </span>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent class="w-48">
                        <template v-if="folderNode.folderType === 'tables'">
                          <ContextMenuItem class="gap-2 text-xs" @click="handleEditTable(childNode)">
                            <Pencil class="h-3.5 w-3.5" />
                            {{ t('tableEditor.alterTable') }}
                          </ContextMenuItem>
                          <ContextMenuItem class="gap-2 text-xs" @click="handleImportData(childNode)">
                            <FileUp class="h-3.5 w-3.5" />
                            {{ t('dataImport.import') }}
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem class="gap-2 text-xs" @click="handleShowCreateSql(childNode)">
                            <Code class="h-3.5 w-3.5" />
                            {{ t('database.showCreateTable') }}
                          </ContextMenuItem>
                        </template>
                        <template v-else>
                          <ContextMenuItem class="gap-2 text-xs" @click="handleShowDefinition(childNode)">
                            <Code class="h-3.5 w-3.5" />
                            {{ t('objectTree.viewDefinition') }}
                          </ContextMenuItem>
                        </template>
                      </ContextMenuContent>
                    </ContextMenu>

                    <!-- Column nodes -->
                    <template v-if="childNode.isExpanded && childNode.children">
                      <div
                        v-for="colNode in childNode.children"
                        :key="colNode.id"
                        class="flex items-center gap-1 py-0.5 pl-14 pr-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
                      >
                        <component :is="getNodeIcon(colNode)" class="h-3 w-3 shrink-0" :class="{ 'text-amber-500': colNode.meta?.isPrimaryKey }" />
                        <span class="truncate">{{ colNode.label }}</span>
                        <span class="ml-auto shrink-0 text-[10px] text-muted-foreground/50">
                          {{ colNode.meta?.dataType }}
                        </span>
                      </div>
                    </template>
                  </template>

                  <!-- Procedure/Function/Trigger items (leaf nodes) -->
                  <template v-else>
                    <ContextMenu>
                      <ContextMenuTrigger as-child>
                        <div
                          class="group flex cursor-pointer items-center gap-1 py-1 pl-10 pr-2 text-xs hover:bg-muted/50 transition-colors"
                          @dblclick="handleShowDefinition(childNode)"
                        >
                          <component :is="getNodeIcon(childNode)" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span class="truncate">{{ childNode.label }}</span>
                          <!-- 触发器：显示 timing + event + 关联表 -->
                          <template v-if="childNode.meta?.objectType === 'TRIGGER'">
                            <span class="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                              {{ childNode.meta.timing }} {{ childNode.meta.event }}
                              <span v-if="childNode.meta.table" class="text-muted-foreground/40">on {{ childNode.meta.table }}</span>
                            </span>
                          </template>
                          <!-- 存储过程/函数：hover 显示 definer -->
                          <template v-else>
                            <span
                              v-if="childNode.meta?.definer"
                              class="ml-auto shrink-0 truncate max-w-[120px] text-[10px] text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity"
                              :title="childNode.meta.definer"
                            >
                              {{ childNode.meta.definer }}
                            </span>
                          </template>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent class="w-48">
                        <ContextMenuItem class="gap-2 text-xs" @click="handleShowDefinition(childNode)">
                          <Code class="h-3.5 w-3.5" />
                          {{ t('objectTree.viewDefinition') }}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  </template>
                </template>
              </template>
            </template>
          </template>
        </template>
      </div>
    </ScrollArea>
  </div>
</template>
