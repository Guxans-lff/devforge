<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, onActivated, onDeactivated, nextTick, onErrorCaptured } from 'vue'
import { useI18n } from 'vue-i18n'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import ObjectTree from '@/components/database/ObjectTree.vue'
import InnerTabBar from '@/components/database/InnerTabBar.vue'
import QueryPanel from '@/components/database/QueryPanel.vue'
import TableEditorPanel from '@/components/database/TableEditorPanel.vue'
import ImportPanel from '@/components/database/ImportPanel.vue'
import TableDataPanel from '@/components/database/TableDataPanel.vue'
import SchemaComparePanel from '@/components/database/SchemaComparePanel.vue'
import BackupDialog from '@/components/database/BackupDialog.vue'
import RestoreDialog from '@/components/database/RestoreDialog.vue'
import { useConnectionStore } from '@/stores/connections'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import * as dbApi from '@/api/database'
import type { SchemaCache, DatabaseSchema, TableSchema, DatabaseTreeNode } from '@/types/database'
import type { TableEditorTabContext, ImportTabContext } from '@/types/database-workspace'

const props = defineProps<{
  connectionId: string
  connectionName: string
}>()

const connectionStore = useConnectionStore()
const dbWorkspaceStore = useDatabaseWorkspaceStore()

// 缓存 configJson 解析结果，避免 driver computed 每次求值都重复 JSON.parse
const parsedConfig = computed(() => {
  const state = connectionStore.connections.get(props.connectionId)
  if (!state) return null
  try {
    return JSON.parse(state.record.configJson) as Record<string, unknown>
  } catch {
    return null
  }
})

const driver = computed(() => {
  const config = parsedConfig.value
  return (config?.driver as string) ?? 'mysql'
})

const { t } = useI18n()
const objectTreeRef = ref<InstanceType<typeof ObjectTree>>()

const isConnected = ref(false)
const isConnecting = ref(false)
const schemaCache = ref<SchemaCache | null>(null)

// 错误边界
const panelError = ref<string | null>(null)
onErrorCaptured((err) => {
  panelError.value = String(err)
  return false
})

// 当前活动的内部 Tab（使用 getOrCreate 确保 workspace 始终存在，避免 computed 在 onMounted 前求值时返回 undefined）
const workspace = computed(() => {
  return dbWorkspaceStore.getOrCreate(props.connectionId)
})
const activeTab = computed(() => {
  const ws = workspace.value
  return ws.tabs.find((t) => t.id === ws.activeTabId)
})

// 类型安全的 tab context 访问
const tableEditorContext = computed(() => {
  const tab = activeTab.value
  if (tab?.type === 'table-editor') return tab.context as TableEditorTabContext
  return null
})

const importContext = computed(() => {
  const tab = activeTab.value
  if (tab?.type === 'import') return tab.context as ImportTabContext
  return null
})

// QueryPanel refs（用于外部触发执行）
const queryPanelRef = ref<InstanceType<typeof QueryPanel>>()
// Build schema cache from ObjectTree data for SQL completion
function buildSchemaCache(nodes: DatabaseTreeNode[]): SchemaCache {
  const databases = new Map<string, DatabaseSchema>()

  for (const dbNode of nodes) {
    if (dbNode.type !== 'database' || !dbNode.meta?.database) continue

    const tables = new Map<string, TableSchema>()

    if (dbNode.children) {
      for (const tblNode of dbNode.children) {
        if (!tblNode.meta?.table) continue

        const columns = tblNode.children?.filter(c => c.type === 'column').map(c => ({
          name: c.label,
          dataType: c.meta?.dataType ?? '',
          nullable: c.meta?.nullable ?? true,
          defaultValue: null,
          isPrimaryKey: c.meta?.isPrimaryKey ?? false,
          comment: c.meta?.comment ?? null,
        })) ?? []

        tables.set(tblNode.meta.table, {
          columns,
          tableType: tblNode.type === 'view' ? 'VIEW' : 'TABLE',
        })
      }
    }

    databases.set(dbNode.meta.database, { tables })
  }

  return { databases }
}

// Watch ObjectTree data changes to update schema cache (event-driven)
let schemaCacheTimer: ReturnType<typeof setTimeout> | null = null

function handleSchemaUpdated() {
  if (schemaCacheTimer) clearTimeout(schemaCacheTimer)
  schemaCacheTimer = setTimeout(() => {
    const nodes = objectTreeRef.value?.treeNodes
    if (nodes) {
      schemaCache.value = buildSchemaCache(nodes)
    }
  }, 300)
}

onMounted(async () => {
  // 确保该连接的 workspace 已初始化（副作用仅在此处执行一次）
  dbWorkspaceStore.getOrCreate(props.connectionId)
  await connectAndLoad()
})

// KeepAlive 重新激活时：检查连接状态，断开则重连并刷新
// 注意：closeTab 通过 store 更新状态为 disconnected，但本地 isConnected ref 不会被重置
// 因此必须同时检查 store 中的实际连接状态
onActivated(async () => {
  const storeState = connectionStore.connections.get(props.connectionId)
  const storeDisconnected = !storeState || storeState.status !== 'connected'

  if (storeDisconnected) {
    // 同步本地状态，并立即清除旧缓存数据，避免用户看到上次的内容
    isConnected.value = false
    schemaCache.value = null
    objectTreeRef.value?.clearTree()

    // 清除所有 query tab 的旧结果
    const ws = workspace.value
    for (const tab of ws.tabs) {
      if (tab.type === 'query') {
        dbWorkspaceStore.updateTabContext(props.connectionId, tab.id, {
          result: null,
          tableBrowse: undefined,
        })
      }
    }
  }

  if (!isConnected.value) {
    await connectAndLoad()
  }
})

onBeforeUnmount(async () => {
  if (schemaCacheTimer) {
    clearTimeout(schemaCacheTimer)
    schemaCacheTimer = null
  }
  if (isConnected.value) {
    await dbApi.dbDisconnect(props.connectionId).catch(() => {})
    connectionStore.updateConnectionStatus(props.connectionId, 'disconnected')
  }
})

async function connectAndLoad() {
  isConnecting.value = true
  try {
    await dbApi.dbConnect(props.connectionId)
    isConnected.value = true
    connectionStore.updateConnectionStatus(props.connectionId, 'connected')

    // 连接成功后，如果当前活跃 tab 是报错状态，则清除错误结果
    const ws = workspace.value
    const activeQueryTab = ws.tabs.find((t) => t.id === ws.activeTabId)
    if (activeQueryTab?.type === 'query' && (activeQueryTab.context as { result?: { isError?: boolean } }).result?.isError) {
      dbWorkspaceStore.updateTabContext(props.connectionId, activeQueryTab.id, {
        result: null,
      })
    }
    await objectTreeRef.value?.loadDatabases()
  } catch (e) {
    isConnected.value = false
    connectionStore.updateConnectionStatus(props.connectionId, 'error', String(e))
    // 将错误显示在当前活动的 query tab 中
    const ws = workspace.value
    const activeQueryTab = ws.tabs.find((t) => t.id === ws.activeTabId)
    if (activeQueryTab?.type === 'query') {
      dbWorkspaceStore.updateTabContext(props.connectionId, activeQueryTab.id, {
        result: {
          columns: [],
          rows: [],
          affectedRows: 0,
          executionTimeMs: 0,
          isError: true,
          error: String(e),
          totalCount: null,
          truncated: false,
        },
      })
    }
  } finally {
    isConnecting.value = false
  }
}

function quoteIdentifier(name: string): string {
  return driver.value === 'postgresql' ? `"${name}"` : `\`${name}\``
}

function handleSelectTable(database: string, table: string) {
  const ws = workspace.value
  const q = quoteIdentifier
  const sql = `SELECT * FROM ${q(database)}.${q(table)};`

  // 优先使用当前激活的 query tab，否则找第一个 query tab，都没有则创建新的
  let queryTab = ws.tabs.find((t) => t.id === ws.activeTabId && t.type === 'query')
  if (!queryTab) {
    queryTab = ws.tabs.find((t) => t.type === 'query')
  }
  if (!queryTab) {
    queryTab = dbWorkspaceStore.addQueryTab(props.connectionId)
  }

  // 切换到该 tab 并更新内容
  dbWorkspaceStore.setActiveInnerTab(props.connectionId, queryTab.id)
  dbWorkspaceStore.updateTabContext(props.connectionId, queryTab.id, {
    sql,
    tableBrowse: { database, table, currentPage: 1, pageSize: 200 },
  })
  nextTick(() => {
    queryPanelRef.value?.browseTable(database, table)
  })
}

function handleSelectDatabase(database: string) {
  const ws = workspace.value
  const activeQueryTab = ws.tabs.find((t) => t.id === ws.activeTabId && t.type === 'query')
  const q = quoteIdentifier
  const sql = driver.value === 'postgresql'
    ? `SET search_path TO ${q(database)};`
    : `USE ${q(database)};`

  if (activeQueryTab) {
    dbWorkspaceStore.updateTabContext(props.connectionId, activeQueryTab.id, { sql })
  }
}

function handleEditTable(database: string, table: string) {
  dbWorkspaceStore.openTableEditor(props.connectionId, database, table)
}

function handleCreateTable(database: string) {
  dbWorkspaceStore.openTableEditor(props.connectionId, database)
}

function handleImportData(database: string, table: string, columns: string[]) {
  dbWorkspaceStore.openImport(props.connectionId, database, table, columns)
}

async function handleShowCreateSql(database: string, table: string) {
  try {
    const sql = await dbApi.dbGetCreateTable(props.connectionId, database, table)
    const ws = workspace.value
    const activeQueryTab = ws.tabs.find((t) => t.id === ws.activeTabId && t.type === 'query')
    if (activeQueryTab) {
      dbWorkspaceStore.updateTabContext(props.connectionId, activeQueryTab.id, { sql })
    }
  } catch (e) {
    console.error('Failed to get CREATE SQL:', e)
  }
}

async function handleShowObjectDefinition(database: string, name: string, objectType: string) {
  try {
    const sql = await dbApi.dbGetObjectDefinition(props.connectionId, database, name, objectType)
    const ws = workspace.value
    const activeQueryTab = ws.tabs.find((t) => t.id === ws.activeTabId && t.type === 'query')
    if (activeQueryTab) {
      dbWorkspaceStore.updateTabContext(props.connectionId, activeQueryTab.id, { sql })
    }
  } catch (e) {
    console.error('Failed to get object definition:', e)
  }
}

function handleTableEditorSuccess() {
  objectTreeRef.value?.loadDatabases()
}

function handleImportSuccess() {
  objectTreeRef.value?.loadDatabases()
}

function handleOpenSchemaCompare() {
  dbWorkspaceStore.openSchemaCompare(props.connectionId)
}

// 备份/恢复
const backupDialogOpen = ref(false)
const backupDatabase = ref('')
const restoreDialogOpen = ref(false)
const restoreDatabase = ref('')

function handleBackupDatabase(database: string) {
  backupDatabase.value = database
  backupDialogOpen.value = true
}

function handleRestoreDatabase(database: string) {
  restoreDatabase.value = database
  restoreDialogOpen.value = true
}

function handleRestoreSuccess() {
  objectTreeRef.value?.loadDatabases()
}
</script>

<template>
  <div class="flex h-full flex-col bg-transparent">
    <!-- Connection status bar -->
    <div class="flex items-center gap-2 border-b border-border/30 bg-background/50 backdrop-blur-md px-3 py-1.5">
      <div class="flex-1" />
      <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <div
          class="h-2 w-2 rounded-full"
          :class="{
            'bg-[var(--df-success)]': isConnected,
            'bg-[var(--df-warning)] animate-pulse': isConnecting,
            'bg-destructive': !isConnected && !isConnecting,
          }"
        />
        <span>{{ connectionName }}</span>
      </div>
    </div>

    <!-- Main content -->
    <Splitpanes class="flex-1">
      <!-- Object Tree -->
      <Pane :size="25" :min-size="15" :max-size="50">
        <ObjectTree
          ref="objectTreeRef"
          :connection-id="connectionId"
          :connecting="isConnecting"
          @select-table="handleSelectTable"
          @select-database="handleSelectDatabase"
          @edit-table="handleEditTable"
          @create-table="handleCreateTable"
          @import-data="handleImportData"
          @show-create-sql="handleShowCreateSql"
          @show-object-definition="handleShowObjectDefinition"
          @schema-updated="handleSchemaUpdated"
          @open-schema-compare="handleOpenSchemaCompare"
          @backup-database="handleBackupDatabase"
          @restore-database="handleRestoreDatabase"
        />
      </Pane>

      <!-- Inner Tab Area -->
      <Pane :size="75">
        <div class="flex h-full flex-col">
          <InnerTabBar :connection-id="connectionId" />

          <!-- Active Panel -->
          <div class="relative flex-1 min-h-0">
            <!-- 错误边界 -->
            <div v-if="panelError" class="flex h-full flex-col items-center justify-center gap-3 text-sm text-destructive">
              <p>{{ panelError }}</p>
              <button class="text-xs text-primary underline" @click="panelError = null">{{ t('common.close') }}</button>
            </div>
            <KeepAlive v-else :max="8">
              <QueryPanel
                v-if="activeTab?.type === 'query'"
                ref="queryPanelRef"
                :key="activeTab.id"
                :connection-id="connectionId"
                :tab-id="activeTab.id"
                :is-connected="isConnected"
                :schema-cache="schemaCache"
                :driver="driver"
                @reconnect="connectAndLoad"
              />
              <TableEditorPanel
                v-else-if="activeTab?.type === 'table-editor' && tableEditorContext"
                :key="activeTab.id"
                :connection-id="connectionId"
                :database="tableEditorContext.database"
                :driver="driver"
                :table="tableEditorContext.table"
                @success="handleTableEditorSuccess"
              />
              <ImportPanel
                v-else-if="activeTab?.type === 'import' && importContext"
                :key="activeTab.id"
                :connection-id="connectionId"
                :database="importContext.database"
                :target-table="importContext.table"
                :table-columns="importContext.columns"
                @success="handleImportSuccess"
              />
              <TableDataPanel
                v-else-if="activeTab?.type === 'table-data'"
                :key="activeTab.id"
                :connection-id="connectionId"
                :tab-id="activeTab.id"
                :is-connected="isConnected"
                :driver="driver"
              />
              <SchemaComparePanel
                v-else-if="activeTab?.type === 'schema-compare'"
                :key="activeTab.id"
                :connection-id="connectionId"
                :is-connected="isConnected"
              />
            </KeepAlive>
          </div>
        </div>
      </Pane>
    </Splitpanes>

    <!-- 备份/恢复对话框 -->
    <BackupDialog
      v-model:open="backupDialogOpen"
      :connection-id="connectionId"
      :database="backupDatabase"
    />
    <RestoreDialog
      v-model:open="restoreDialogOpen"
      :connection-id="connectionId"
      :database="restoreDatabase"
      @success="handleRestoreSuccess"
    />
  </div>
</template>

<style>
/* Override splitpanes default styles to match our theme */
.splitpanes--vertical > .splitpanes__splitter,
.splitpanes--horizontal > .splitpanes__splitter {
  background-color: transparent;
  position: relative;
  z-index: 10;
}

.splitpanes--vertical > .splitpanes__splitter::before,
.splitpanes--horizontal > .splitpanes__splitter::before {
  content: '';
  position: absolute;
  background-color: rgba(var(--color-border), 0.3);
  transition: all 0.2s ease;
}

.splitpanes--vertical > .splitpanes__splitter::before {
  top: 0; bottom: 0; left: 50%; transform: translateX(-50%); width: 1px;
}
.splitpanes--horizontal > .splitpanes__splitter::before {
  left: 0; right: 0; top: 50%; transform: translateY(-50%); height: 1px;
}

.splitpanes--vertical > .splitpanes__splitter:hover::before {
  width: 2px;
  background-color: rgba(var(--color-primary), 0.8);
  box-shadow: 0 0 8px rgba(var(--color-primary), 0.5);
}
.splitpanes--horizontal > .splitpanes__splitter:hover::before {
  height: 2px;
  background-color: rgba(var(--color-primary), 0.8);
  box-shadow: 0 0 8px rgba(var(--color-primary), 0.5);
}

.splitpanes--horizontal > .splitpanes__splitter {
  height: 9px;
  min-height: 9px;
  margin-top: -4px;
  margin-bottom: -4px;
  cursor: row-resize;
}

.splitpanes--vertical > .splitpanes__splitter {
  width: 9px;
  min-width: 9px;
  margin-left: -4px;
  margin-right: -4px;
  cursor: col-resize;
}

/* Ensure panes don't overflow */
.splitpanes__pane {
  overflow: hidden;
}
</style>
