<script setup lang="ts">
/**
 * 对象树面板 — 薄编排层
 * 业务逻辑委托给 useObjectTree composable
 */
import { ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { onClickOutside } from '@vueuse/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent,
  ContextMenuSubTrigger, ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Database, ChevronRight, Loader2, RefreshCw, Pencil,
  FileUp, Code, Plus, Search, X, FolderOpen, Folder,
  HardDrive, Upload, Users, Activity, FileCode, FileDown,
  Trash2, Eraser, Network, GitCompareArrows, Play,
  ArrowLeftRight, CalendarClock, Workflow,
} from 'lucide-vue-next'
import { useObjectTree } from '@/composables/useObjectTree'
import type { DatabaseTreeNode } from '@/types/database'

const props = defineProps<{
  connectionId: string
  connecting?: boolean
  exportingDb?: string
}>()

const emit = defineEmits<{
  selectTable: [database: string, table: string]
  selectDatabase: [database: string]
  editTable: [database: string, table: string]
  importData: [database: string, table: string, columns: string[]]
  createTable: [database: string]
  deleteTable: [database: string, table: string]
  truncateTable: [database: string, table: string]
  showCreateSql: [database: string, table: string]
  showObjectDefinition: [database: string, name: string, objectType: string]
  schemaUpdated: []
  openSchemaCompare: []
  backupDatabase: [database: string]
  restoreDatabase: [database: string]
  openUserManagement: []
  openPerformance: []
  openDataSync: []
  openScheduler: []
  openErDiagram: [database: string]
  openSqlBuilder: [database: string]
  generateScript: [database: string, table: string, scriptType: string]
  exportDatabaseDdl: [database: string]
  runSqlFile: [database: string]
  createDatabase: []
  editDatabase: [database: string]
  executeRoutine: [database: string, name: string, routineType: string]
  /** 对象编辑：新建 */
  createObject: [database: string, objectType: string, tableName?: string]
  /** 对象编辑：编辑现有对象 */
  editObject: [database: string, objectName: string, objectType: string]
  /** 对象删除 */
  dropObject: [database: string, objectName: string, objectType: string]
}>()

/** 可拖拽的节点类型 */
const DRAGGABLE_TYPES = new Set(['table', 'view', 'column', 'procedure', 'function'])

/** MySQL 系统数据库（灰显处理） */
const SYSTEM_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys'])

/** 判断节点是否可拖拽到 SQL 编辑器 */
function isDraggableNode(node: DatabaseTreeNode): boolean {
  return DRAGGABLE_TYPES.has(node.type)
}

/** 拖拽开始时设置传输数据 */
function handleDragStart(event: DragEvent, node: DatabaseTreeNode) {
  if (!event.dataTransfer) return
  const dragData = {
    type: node.type,
    database: node.meta?.database,
    table: node.meta?.table,
    name: node.label,
    objectType: node.meta?.objectType,
  }
  event.dataTransfer.setData('application/devforge-node', JSON.stringify(dragData))
  event.dataTransfer.setData('text/plain', node.label)
  event.dataTransfer.effectAllowed = 'copy'
}

const { t } = useI18n()
const parentRef = ref<HTMLElement | null>(null)

const tree = useObjectTree({
  connectionId: toRef(props, 'connectionId'),
  connecting: toRef(props, 'connecting'),
  parentRef,
  onSelectTable: (db, tbl) => emit('selectTable', db, tbl),
  onSelectDatabase: (db) => emit('selectDatabase', db),
  onSchemaUpdated: () => emit('schemaUpdated'),
})

// ===== 搜索下拉面板：点击外部关闭 =====
const searchAreaRef = ref<HTMLElement | null>(null)
onClickOutside(searchAreaRef, () => {
  tree.showObjectSearchDropdown.value = false
})

// ===== 事件处理（从 node 提取 meta 后转发 emit） =====

function emitEditTable(node: DatabaseTreeNode) {
  const db = tree.getNodeDatabase(node)
  const tbl = tree.getNodeTable(node)
  if (db && tbl) emit('editTable', db, tbl)
}

function emitImportData(node: DatabaseTreeNode) {
  const db = tree.getNodeDatabase(node)
  const tbl = tree.getNodeTable(node)
  if (db && tbl) emit('importData', db, tbl, tree.getNodeColumns(node))
}

function emitCreateTable(node: DatabaseTreeNode) {
  const db = tree.getNodeDatabase(node)
  if (db) emit('createTable', db)
}

function emitDeleteTable(node: DatabaseTreeNode) {
  const db = tree.getNodeDatabase(node)
  const tbl = tree.getNodeTable(node)
  if (db && tbl) emit('deleteTable', db, tbl)
}

function emitTruncateTable(node: DatabaseTreeNode) {
  const db = tree.getNodeDatabase(node)
  const tbl = tree.getNodeTable(node)
  if (db && tbl) emit('truncateTable', db, tbl)
}

function emitShowCreateSql(node: DatabaseTreeNode) {
  const db = tree.getNodeDatabase(node)
  const tbl = tree.getNodeTable(node)
  if (db && tbl) emit('showCreateSql', db, tbl)
}

function emitGenerateScript(node: DatabaseTreeNode, scriptType: string) {
  const db = tree.getNodeDatabase(node)
  const tbl = tree.getNodeTable(node)
  if (db && tbl) emit('generateScript', db, tbl, scriptType)
}

function emitExportDatabaseDdl(node: DatabaseTreeNode) {
  const db = tree.getNodeDatabase(node)
  if (db) emit('exportDatabaseDdl', db)
}

function emitShowDefinition(node: DatabaseTreeNode) {
  const db = tree.getNodeDatabase(node)
  const objectType = node.meta?.objectType
  if (db && objectType) emit('showObjectDefinition', db, node.label, objectType)
}

function emitExecuteRoutine(node: DatabaseTreeNode) {
  const db = tree.getNodeDatabase(node)
  const routineType = node.meta?.objectType // PROCEDURE 或 FUNCTION
  if (db && routineType) emit('executeRoutine', db, node.label, routineType)
}

/** 新建对象（从文件夹节点触发） */
function emitCreateObject(node: DatabaseTreeNode, objectType: string) {
  const db = tree.getNodeDatabase(node)
  if (db) emit('createObject', db, objectType)
}

/** 编辑对象（从对象节点触发） */
function emitEditObject(node: DatabaseTreeNode) {
  const db = tree.getNodeDatabase(node)
  const objectType = node.meta?.objectType
  if (db && objectType) emit('editObject', db, node.label, objectType)
}

/** 删除对象 */
function emitDropObject(node: DatabaseTreeNode) {
  const db = tree.getNodeDatabase(node)
  const objectType = node.meta?.objectType
  if (db && objectType) emit('dropObject', db, node.label, objectType)
}

function emitBackupDatabase(node: DatabaseTreeNode) {
  const db = tree.getNodeDatabase(node)
  if (db) emit('backupDatabase', db)
}

function emitRestoreDatabase(node: DatabaseTreeNode) {
  const db = tree.getNodeDatabase(node)
  if (db) emit('restoreDatabase', db)
}

defineExpose({
  loadDatabases: tree.loadDatabases,
  treeNodes: tree.treeNodes,
  clearTree: tree.clearTree,
  forceRefresh: tree.forceRefresh,
  silentRefresh: tree.silentRefresh,
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden border-r border-border bg-muted/30">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-2 py-1.5">
      <span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {{ t('database.objects') }}
      </span>
      <div class="flex items-center gap-1">
        <Button
          variant="ghost" size="icon"
          class="h-5 w-5 text-muted-foreground hover:text-foreground"
          title="新建数据库"
          @click="emit('createDatabase')"
        >
          <Plus class="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost" size="icon"
          class="h-5 w-5 text-muted-foreground hover:text-foreground"
          :disabled="tree.loading.value"
          @click="tree.forceRefresh()"
        >
          <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': tree.loading.value }" />
        </Button>
      </div>
    </div>

    <!-- 统一智能搜索框 (Neu/Glass Pill Design) -->
    <div ref="searchAreaRef" class="px-3 pt-2 pb-2 relative border-b border-border/5">
      <div class="relative group flex items-center h-8">
        <!-- Pill Background Container (拟物底座) -->
        <div class="absolute inset-0 rounded-full bg-muted/50 dark:bg-black/20 shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.04),inset_0_0_0_1px_rgba(0,0,0,0.03),0_0.5px_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3),inset_0_0_0_1px_rgba(255,255,255,0.04),0_0.5px_0_rgba(255,255,255,0.02)] transform-gpu transition-[background-color,box-shadow] duration-300 group-focus-within:bg-white dark:group-focus-within:bg-[#1C1C1E] group-focus-within:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05),0_4px_10px_rgba(0,0,0,0.03),0_0_0_1.5px_rgba(var(--primary-rgb),0.15)] dark:group-focus-within:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1),0_4px_12px_rgba(0,0,0,0.4),0_0_0_1.5px_rgba(var(--primary-rgb),0.2)]" />
        
        <Search class="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary z-10" />
        <Input
          v-model="tree.combinedSearchQuery.value"
          class="h-full w-full border-none bg-transparent pl-9 pr-8 text-[11px] font-medium text-foreground placeholder:text-muted-foreground shadow-none focus-visible:ring-0 z-10"
          :placeholder="t('objectTree.searchPlaceholder')"
          @keydown.escape="tree.combinedSearchQuery.value = ''; tree.showObjectSearchDropdown.value = false"
          @focus="tree.isObjectSearching.value && (tree.showObjectSearchDropdown.value = true)"
        />
        <button
          v-if="tree.combinedSearchQuery.value"
          class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/5 transition-colors z-20"
          @click="tree.combinedSearchQuery.value = ''; tree.showObjectSearchDropdown.value = false"
        >
          <X class="h-2.5 w-2.5" />
        </button>
      </div>

      <!-- 搜索结果下拉面板 -->
      <div
        v-if="tree.showObjectSearchDropdown.value && tree.isObjectSearching.value"
        class="absolute left-2 right-2 top-full z-50 mt-1 max-h-[300px] overflow-hidden rounded-lg border border-border bg-popover shadow-xl animate-in fade-in slide-in-from-top-1 duration-200"
      >
        <div class="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border/10">
          <span class="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">全局对象匹配</span>
          <span class="text-[9px] px-1 bg-primary/10 text-primary rounded">{{ tree.objectSearchResults.value.length }}</span>
        </div>
        <div class="max-h-[260px] overflow-y-auto">
          <div v-if="tree.objectSearchResults.value.length === 0" class="px-3 py-8 text-center">
            <Search class="mx-auto mb-2 h-5 w-5 text-muted-foreground/20" />
            <p class="text-[11px] text-muted-foreground/60">未找到相关数据库对象</p>
          </div>
          <div v-else class="py-1">
            <div
              v-for="(item, idx) in tree.objectSearchResults.value"
              :key="item.node.id + '-' + idx"
              class="group/item flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs transition-[background-color,border-color] duration-200 hover:bg-accent/50 border-l-2 border-transparent hover:border-primary"
              @click="tree.handleSearchResultClick(item)"
            >
              <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted/40 text-muted-foreground">
                <component :is="tree.getNodeIcon(item.node)" class="h-3.5 w-3.5" />
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

    <!-- 虚拟滚动树 -->
    <div ref="parentRef" class="min-h-0 flex-1 overflow-y-auto no-scrollbar py-1" role="tree" :aria-label="t('database.objects')" style="will-change: transform; contain: strict">
      <div v-if="(tree.loading.value || connecting) && tree.treeNodes.value.length === 0" class="flex items-center justify-center py-8">
        <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
      </div>

      <div v-else-if="tree.filteredNodes.value.length === 0 && tree.debouncedQuery.value.trim()" class="px-3 py-6 text-center">
        <Search class="mx-auto mb-2 h-5 w-5 text-muted-foreground/40" />
        <p class="text-xs text-muted-foreground">{{ t('database.noSearchResults') }}</p>
      </div>

      <div v-else-if="!tree.loading.value && !connecting && tree.treeNodes.value.length === 0" class="px-3 py-6 text-center">
        <Database class="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
        <p class="text-xs text-muted-foreground">{{ t('database.noDatabases') }}</p>
      </div>

      <div v-else class="relative w-full" :style="{ height: `${tree.totalSize.value}px` }" style="will-change: transform">
        <div
          v-for="virtualRow in tree.virtualRows.value"
          :key="virtualRow.key as number"
          class="absolute left-0 top-0 w-full"
          :style="{ height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }"
        >
          <template v-for="item in [tree.flattenedNodes.value[virtualRow.index]]" :key="item?.id || virtualRow.key">
            <div
              v-if="item"
              v-memo="[item.id, item.node?.isExpanded, item.node?.isLoading, tree.highlightedNodeId.value === item.id, tree.isSystemExpanded.value]"
              class="flex items-center h-full w-full"
            >
              <!-- 系统文件夹节点 -->
              <div
                v-if="item.isSystemFolder"
                class="group flex h-full grow cursor-pointer items-center gap-1 px-2 mx-1.5 rounded-[6px] text-xs transition-colors duration-300 hover:bg-accent/50"
                role="treeitem"
                :aria-expanded="tree.isSystemExpanded.value"
                :aria-label="'系统管理'"
                @click="tree.isSystemExpanded.value = !tree.isSystemExpanded.value"
              >
                <div class="w-4 shrink-0 flex items-center justify-center">
                  <ChevronRight
                    class="h-3 w-3 text-muted-foreground transition-transform duration-150"
                    :class="{ 'rotate-90': tree.isSystemExpanded.value }"
                  />
                </div>
                <FolderOpen v-if="tree.isSystemExpanded.value" class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                <Folder v-else class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                <span class="truncate font-medium text-muted-foreground/80">系统管理</span>
              </div>

              <!-- 系统子入口节点 -->
              <div
                v-else-if="item.isSystem"
                class="group flex h-full grow cursor-pointer items-center gap-1 mx-1.5 rounded-[6px] text-xs transition-colors duration-300 hover:bg-accent/50"
                :style="{ paddingLeft: `${item.level * 12 + 12}px` }"
                @click="item.systemAction === 'user' ? emit('openUserManagement') : emit('openPerformance')"
              >
                <component :is="item.systemAction === 'user' ? Users : Activity" class="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <span class="truncate text-muted-foreground/70">{{ item.systemAction === 'user' ? '用户管理' : '性能监控' }}</span>
              </div>

              <!-- 分割线 -->
              <div v-else-if="item.isDivider" class="px-2 h-full grow flex items-center">
                <div class="w-full border-b border-border/20" />
              </div>

              <!-- 普通对象节点 -->
              <ContextMenu v-else-if="item.node">
                <ContextMenuTrigger as-child>
                  <div
                    class="group relative flex h-full grow cursor-pointer items-center gap-1 pr-2 mx-1.5 rounded-[6px] text-xs transition-[background-color,box-shadow] duration-300 transform-gpu hover:bg-accent/50"
                    :class="[
                      tree.highlightedNodeId.value === item.node.id
                        ? 'bg-primary/10 dark:bg-primary/20 shadow-[inset_0_0_0_1px_rgba(var(--primary-rgb),0.2)]'
                        : item.node.type === 'database' && item.node.isExpanded
                          ? 'bg-muted/30'
                          : 'border-transparent',
                      item.node.type === 'database' && SYSTEM_DATABASES.has(item.node.label.toLowerCase()) && 'opacity-50',
                    ]"
                    :style="{ paddingLeft: `${item.level * 12 + 8}px` }"
                    :draggable="isDraggableNode(item.node)"
                    role="treeitem"
                    :aria-expanded="item.node.type !== 'column' && item.node.type !== 'procedure' && item.node.type !== 'function' && item.node.type !== 'trigger' ? item.node.isExpanded : undefined"
                    :aria-level="item.level + 1"
                    :aria-label="item.node.label"
                    @click="tree.toggleNode(item.node)"
                    @dblclick="tree.handleDoubleClick(item.node)"
                    @dragstart="handleDragStart($event, item.node)"
                  >
                    <!-- 左侧激活指示条 (Apple Style Indicator) -->
                    <div 
                      class="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-full bg-primary transition-[scale,opacity] duration-500 transform-gpu origin-center"
                      :class="tree.highlightedNodeId.value === item.node.id ? 'scale-y-100 opacity-100' : 'scale-y-0 opacity-0'"
                    />

                    <div class="w-4 shrink-0 flex items-center justify-center">
                      <ChevronRight
                        v-if="item.node.type !== 'column' && item.node.type !== 'procedure' && item.node.type !== 'function' && item.node.type !== 'trigger'"
                        class="h-3 w-3 text-muted-foreground transition-transform duration-150"
                        :class="{ 'rotate-90': item.node.isExpanded }"
                      />
                    </div>
                    <Loader2 v-if="item.node.isLoading" class="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                    <component :is="tree.getNodeIcon(item.node)" v-else class="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors duration-300 group-hover:text-primary/80" :class="{ 'text-df-warning': item.node.type === 'column' && item.node.meta?.isPrimaryKey }" />
                    <span class="truncate transition-colors duration-300 group-hover:text-primary font-medium" :class="{ 'text-muted-foreground': item.node.type === 'column' }">{{ item.node.label }}</span>

                    <span
                      v-if="item.node.meta?.comment && (item.node.type === 'table' || item.node.type === 'view')"
                      class="ml-auto truncate text-[10px] text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity"
                    >{{ item.node.meta.comment }}</span>
                    <span v-if="item.node.meta?.objectType === 'TRIGGER'" class="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                      {{ item.node.meta.timing }} {{ item.node.meta.event }}
                    </span>
                    <span v-if="item.node.type === 'column'" class="ml-auto shrink-0 text-[10px] text-muted-foreground/40 tabular-nums">
                      {{ item.node.meta?.dataType }}
                    </span>
                    <span
                      v-if="item.node.type === 'folder' && item.node.children && item.node.children.length > 0"
                      class="ml-auto shrink-0 text-[10px] text-muted-foreground/30 tabular-nums"
                    >{{ item.node.children.length }}</span>
                  </div>
                </ContextMenuTrigger>

                <!-- 右键菜单 -->
                <ContextMenuContent class="w-48">
                  <template v-if="item.node.type === 'database'">
                    <ContextMenuItem class="gap-2 text-xs" @click="emit('editDatabase', item.node.meta?.database ?? item.node.label)">
                      <Pencil class="h-3.5 w-3.5" /> 编辑数据库
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem class="gap-2 text-xs" @click="emitBackupDatabase(item.node)">
                      <HardDrive class="h-3.5 w-3.5" /> {{ t('backup.title') }}
                    </ContextMenuItem>
                    <ContextMenuItem class="gap-2 text-xs" @click="emitRestoreDatabase(item.node)">
                      <Upload class="h-3.5 w-3.5" /> {{ t('restore.title') }}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem class="gap-2 text-xs" @click="emit('openSchemaCompare')">
                      <GitCompareArrows class="h-3.5 w-3.5" /> {{ t('schemaCompare.title') }}
                    </ContextMenuItem>
                    <ContextMenuItem class="gap-2 text-xs" @click="emit('openErDiagram', item.node.meta?.database ?? item.node.label)">
                      <Network class="h-3.5 w-3.5" /> ER 关系图
                    </ContextMenuItem>
                    <ContextMenuItem class="gap-2 text-xs" @click="emit('openSqlBuilder', item.node.meta?.database ?? item.node.label)">
                      <Workflow class="h-3.5 w-3.5" /> SQL Builder
                    </ContextMenuItem>
                    <ContextMenuItem class="gap-2 text-xs" @click="emit('openDataSync')">
                      <ArrowLeftRight class="h-3.5 w-3.5" /> {{ t('dataSync.title') }}
                    </ContextMenuItem>
                    <ContextMenuItem class="gap-2 text-xs" @click="emit('openScheduler')">
                      <CalendarClock class="h-3.5 w-3.5" /> {{ t('scheduler.title') }}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      class="gap-2 text-xs"
                      :disabled="props.exportingDb === (item.node.meta?.database ?? item.node.label)"
                      @click="emitExportDatabaseDdl(item.node)"
                    >
                      <Loader2
                        v-if="props.exportingDb === (item.node.meta?.database ?? item.node.label)"
                        class="h-3.5 w-3.5 animate-spin"
                      />
                      <FileDown v-else class="h-3.5 w-3.5" />
                      导出数据库结构
                    </ContextMenuItem>
                    <ContextMenuItem class="gap-2 text-xs" @click="emit('runSqlFile', item.node.meta?.database ?? item.node.label)">
                      <Code class="h-3.5 w-3.5" /> 运行 SQL 文件
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem class="gap-2 text-xs" @click="tree.handleRefreshDatabase(item.node)">
                      <RefreshCw class="h-3.5 w-3.5" /> 刷新
                    </ContextMenuItem>
                  </template>

                  <template v-if="item.node.type === 'folder'">
                    <ContextMenuItem v-if="item.node.folderType === 'tables'" class="gap-2 text-xs" @click="emitCreateTable(item.node)">
                      <Plus class="h-3.5 w-3.5" /> {{ t('tableEditor.createTable') }}
                    </ContextMenuItem>
                    <ContextMenuItem v-if="item.node.folderType === 'views'" class="gap-2 text-xs" @click="emitCreateObject(item.node, 'VIEW')">
                      <Plus class="h-3.5 w-3.5" /> 新建视图
                    </ContextMenuItem>
                    <ContextMenuItem v-if="item.node.folderType === 'procedures'" class="gap-2 text-xs" @click="emitCreateObject(item.node, 'PROCEDURE')">
                      <Plus class="h-3.5 w-3.5" /> 新建存储过程
                    </ContextMenuItem>
                    <ContextMenuItem v-if="item.node.folderType === 'functions'" class="gap-2 text-xs" @click="emitCreateObject(item.node, 'FUNCTION')">
                      <Plus class="h-3.5 w-3.5" /> 新建函数
                    </ContextMenuItem>
                    <ContextMenuItem v-if="item.node.folderType === 'triggers'" class="gap-2 text-xs" @click="emitCreateObject(item.node, 'TRIGGER')">
                      <Plus class="h-3.5 w-3.5" /> 新建触发器
                    </ContextMenuItem>
                    <ContextMenuItem class="gap-2 text-xs" @click="tree.handleRefreshFolder(item.node)">
                      <RefreshCw class="h-3.5 w-3.5" /> 刷新
                    </ContextMenuItem>
                  </template>

                  <template v-if="item.node.type === 'table'">
                    <ContextMenuItem class="gap-2 text-xs" @click="emitEditTable(item.node)">
                      <Pencil class="h-3.5 w-3.5" /> {{ t('tableEditor.alterTable') }}
                    </ContextMenuItem>
                    <ContextMenuItem class="gap-2 text-xs" @click="emitImportData(item.node)">
                      <FileUp class="h-3.5 w-3.5" /> {{ t('dataImport.import') }}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem class="gap-2 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive" @click="emitTruncateTable(item.node)">
                      <Eraser class="h-3.5 w-3.5" /> 清空表
                    </ContextMenuItem>
                    <ContextMenuItem class="gap-2 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive" @click="emitDeleteTable(item.node)">
                      <Trash2 class="h-3.5 w-3.5" /> 删除表
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem class="gap-2 text-xs" @click="emitShowCreateSql(item.node)">
                      <Code class="h-3.5 w-3.5" /> {{ t('database.showCreateTable') }}
                    </ContextMenuItem>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger class="gap-2 text-xs">
                        <FileCode class="h-3.5 w-3.5" /> 生成脚本
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent class="w-44">
                        <ContextMenuItem class="text-xs" @click="emitGenerateScript(item.node, 'select-template')">SELECT</ContextMenuItem>
                        <ContextMenuItem class="text-xs" @click="emitGenerateScript(item.node, 'insert-template')">INSERT</ContextMenuItem>
                        <ContextMenuItem class="text-xs" @click="emitGenerateScript(item.node, 'update-template')">UPDATE</ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem class="text-xs" @click="emitGenerateScript(item.node, 'create')">CREATE TABLE</ContextMenuItem>
                        <ContextMenuItem class="text-xs" @click="emitGenerateScript(item.node, 'drop')">DROP TABLE</ContextMenuItem>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                  </template>

                  <template v-if="item.node.type === 'view' || item.node.type === 'procedure' || item.node.type === 'function' || item.node.type === 'trigger'">
                    <ContextMenuItem v-if="item.node.type === 'procedure' || item.node.type === 'function'" class="gap-2 text-xs" @click="emitExecuteRoutine(item.node)">
                      <Play class="h-3.5 w-3.5" /> 执行
                    </ContextMenuItem>
                    <ContextMenuItem class="gap-2 text-xs" @click="emitShowDefinition(item.node)">
                      <Code class="h-3.5 w-3.5" /> {{ t('objectTree.viewDefinition') }}
                    </ContextMenuItem>
                    <ContextMenuItem class="gap-2 text-xs" @click="emitEditObject(item.node)">
                      <Pencil class="h-3.5 w-3.5" /> 编辑
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem class="gap-2 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive" @click="emitDropObject(item.node)">
                      <Trash2 class="h-3.5 w-3.5" /> 删除
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
