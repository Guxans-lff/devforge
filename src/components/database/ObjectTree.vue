<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
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
}>()

const { t } = useI18n()
const treeNodes = ref<DatabaseTreeNode[]>([])
const loading = ref(false)
const searchQuery = ref('')
const debouncedQuery = ref('')
const searchCollapsedDbs = ref(new Set<string>())
const TABLE_RENDER_LIMIT = 100
const visibleTableLimit = ref(new Map<string, number>())

// Debounce search input for performance with large table lists
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(searchQuery, (val) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    debouncedQuery.value = val
    searchCollapsedDbs.value = new Set()
    visibleTableLimit.value = new Map()
  }, 200)
})

function getVisibleLimit(dbId: string): number {
  return visibleTableLimit.value.get(dbId) ?? TABLE_RENDER_LIMIT
}

function showMoreTables(dbId: string) {
  const current = getVisibleLimit(dbId)
  const next = new Map(visibleTableLimit.value)
  next.set(dbId, current + TABLE_RENDER_LIMIT)
  visibleTableLimit.value = next
}

// Infinite scroll: auto-load more tables when sentinel enters viewport
const sentinelObserver = ref<IntersectionObserver | null>(null)
const sentinelRefs = new Map<string, HTMLElement>()

function initObserver() {
  sentinelObserver.value = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const dbId = (entry.target as HTMLElement).dataset.dbId
        if (dbId) showMoreTables(dbId)
      }
    }
  }, { rootMargin: '100px' })
}

function observeSentinel(el: HTMLElement | null, dbId: string) {
  if (!sentinelObserver.value) initObserver()
  const prev = sentinelRefs.get(dbId)
  if (prev) sentinelObserver.value!.unobserve(prev)
  if (el) {
    el.dataset.dbId = dbId
    sentinelObserver.value!.observe(el)
    sentinelRefs.set(dbId, el)
  } else {
    sentinelRefs.delete(dbId)
  }
}

onBeforeUnmount(() => {
  sentinelObserver.value?.disconnect()
})

const filteredNodes = computed(() => {
  const q = debouncedQuery.value.toLowerCase().trim()
  if (!q) return treeNodes.value
  return treeNodes.value.map(dbNode => {
    const dbId = dbNode.id
    const isCollapsedByUser = searchCollapsedDbs.value.has(dbId)
    // Check if database name matches
    if (dbNode.label.toLowerCase().includes(q)) {
      return { ...dbNode, isExpanded: !isCollapsedByUser }
    }
    // Filter children (tables) that match
    const matchedChildren = dbNode.children?.filter(tblNode =>
      tblNode.label.toLowerCase().includes(q) ||
      (tblNode.meta?.comment ?? '').toLowerCase().includes(q)
    )
    if (matchedChildren && matchedChildren.length > 0) {
      return { ...dbNode, isExpanded: !isCollapsedByUser, children: matchedChildren }
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
    loadTables(node)
  } else if (node.type === 'table' && node.children && node.children.length === 0) {
    loadColumns(node)
  }
}

async function loadTables(node: DatabaseTreeNode) {
  const database = node.meta?.database
  if (!database) return

  node.isLoading = true
  try {
    const tables = await dbApi.dbGetTables(props.connectionId, database)
    node.children = tables.map((tbl) => ({
      id: `tbl-${database}-${tbl.name}`,
      label: tbl.name,
      type: (tbl.tableType === 'VIEW' ? 'view' : 'table') as 'table' | 'view',
      children: [],
      isExpanded: false,
      isLoading: false,
      meta: {
        database,
        table: tbl.name,
        comment: tbl.comment ?? undefined,
      },
    }))
  } catch {
    node.children = []
  } finally {
    node.isLoading = false
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
  } catch {
    node.children = []
  } finally {
    node.isLoading = false
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

function getNodeIcon(node: DatabaseTreeNode) {
  switch (node.type) {
    case 'database':
      return Database
    case 'table':
      return Table2
    case 'view':
      return Eye
    case 'column':
      return node.meta?.isPrimaryKey ? KeyRound : Columns3
  }
}

defineExpose({ loadDatabases, treeNodes })
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
          class="h-6 pl-6 pr-2 text-xs"
          :placeholder="t('database.searchTables')"
        />
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
            </ContextMenuContent>
          </ContextMenu>

          <!-- Table nodes (with render limit for performance) -->
          <template v-if="dbNode.isExpanded && dbNode.children">
            <template v-for="tblNode in dbNode.children.slice(0, getVisibleLimit(dbNode.id))" :key="tblNode.id">
              <ContextMenu>
                <ContextMenuTrigger as-child>
                  <div
                    class="group flex cursor-pointer items-center gap-1 py-1 pl-6 pr-2 text-xs hover:bg-muted/50 transition-colors"
                    @click="toggleNode(tblNode)"
                    @dblclick="handleDoubleClick(tblNode)"
                  >
                    <ChevronRight
                      class="h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150"
                      :class="{ 'rotate-90': tblNode.isExpanded }"
                    />
                    <Loader2 v-if="tblNode.isLoading" class="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                    <component :is="getNodeIcon(tblNode)" v-else class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span class="truncate">{{ tblNode.label }}</span>
                    <span
                      v-if="tblNode.meta?.comment"
                      class="ml-auto truncate text-[10px] text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      {{ tblNode.meta.comment }}
                    </span>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent class="w-48">
                  <ContextMenuItem class="gap-2 text-xs" @click="handleEditTable(tblNode)">
                    <Pencil class="h-3.5 w-3.5" />
                    {{ t('tableEditor.alterTable') }}
                  </ContextMenuItem>
                  <ContextMenuItem class="gap-2 text-xs" @click="handleImportData(tblNode)">
                    <FileUp class="h-3.5 w-3.5" />
                    {{ t('dataImport.import') }}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem class="gap-2 text-xs" @click="handleShowCreateSql(tblNode)">
                    <Code class="h-3.5 w-3.5" />
                    {{ t('database.showCreateTable') }}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>

              <!-- Column nodes -->
              <template v-if="tblNode.isExpanded && tblNode.children">
                <div
                  v-for="colNode in tblNode.children"
                  :key="colNode.id"
                  class="flex items-center gap-1 py-0.5 pl-10 pr-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
                >
                  <component :is="getNodeIcon(colNode)" class="h-3 w-3 shrink-0" :class="{ 'text-amber-500': colNode.meta?.isPrimaryKey }" />
                  <span class="truncate">{{ colNode.label }}</span>
                  <span class="ml-auto shrink-0 text-[10px] text-muted-foreground/50">
                    {{ colNode.meta?.dataType }}
                  </span>
                </div>
              </template>
            </template>

            <!-- Infinite scroll sentinel -->
            <div
              v-if="dbNode.children.length > getVisibleLimit(dbNode.id)"
              :ref="(el) => observeSentinel(el as HTMLElement | null, dbNode.id)"
              class="h-px"
            />
          </template>
        </template>
      </div>
    </ScrollArea>
  </div>
</template>
