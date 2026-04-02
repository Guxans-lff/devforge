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
import PerformanceDashboard from '@/components/database/PerformanceDashboard.vue'
import UserManagementPanel from '@/components/database/UserManagementPanel.vue'
import { defineAsyncComponent } from 'vue'

/** 懒加载 ER 图面板（vue-flow + dagre 较大） */
const ErDiagramPanel = defineAsyncComponent(() => import('@/components/database/ErDiagramPanel.vue'))
import BackupDialog from '@/components/database/BackupDialog.vue'
import RestoreDialog from '@/components/database/RestoreDialog.vue'
import CreateDatabaseDialog from '@/components/database/CreateDatabaseDialog.vue'
import EditDatabaseDialog from '@/components/database/EditDatabaseDialog.vue'
import RoutineExecDialog from '@/components/database/RoutineExecDialog.vue'
import ObjectEditorDialog from '@/components/database/ObjectEditorDialog.vue'
import ConfirmDialog from '@/components/ui/confirm-dialog/ConfirmDialog.vue'
import EnvironmentBanner from '@/components/database/EnvironmentBanner.vue'
import BreadcrumbNav from '@/components/database/BreadcrumbNav.vue'
import DataSyncPanel from '@/components/database/DataSyncPanel.vue'
import SchedulerPanel from '@/components/database/SchedulerPanel.vue'
import { useConnectionStore } from '@/stores/connections'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import { useSchemaRegistryStore } from '@/stores/schema-registry'
import * as dbApi from '@/api/database'
import type { ScriptOptions } from '@/api/database'
import type { PoolStatus } from '@/types/connection'
import type { TableEditorTabContext, ImportTabContext, ErDiagramTabContext, QueryTabContext } from '@/types/database-workspace'
import type { ObjectTreeExposed } from '@/types/component-exposed'
import { useToast } from '@/composables/useToast'
import { useSchemaCache } from '@/composables/useSchemaCache'
import { useNotification } from '@/composables/useNotification'
import { parseEnvironment, parseReadOnly, parseConfirmDanger } from '@/api/connection'
import type { EnvironmentType } from '@/types/environment'

const props = defineProps<{
  connectionId: string
  connectionName: string
}>()

const connectionStore = useConnectionStore()
const dbWorkspaceStore = useDatabaseWorkspaceStore()
const schemaRegistry = useSchemaRegistryStore()

// 当前连接状态（用于状态栏展示重连信息）
const connectionState = computed(() => connectionStore.connections.get(props.connectionId))
const isReconnecting = computed(() => (connectionState.value?.status as string) === 'reconnecting')

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

// 环境配置（从 configJson 解析）
const environment = computed<EnvironmentType>(() => {
  const state = connectionStore.connections.get(props.connectionId)
  if (!state) return 'development'
  return parseEnvironment(state.record.configJson)
})

const readOnly = computed(() => {
  const state = connectionStore.connections.get(props.connectionId)
  if (!state) return false
  return parseReadOnly(state.record.configJson)
})

const confirmDanger = computed(() => {
  const state = connectionStore.connections.get(props.connectionId)
  if (!state) return false
  return parseConfirmDanger(state.record.configJson)
})

const connectionHost = computed(() => {
  const state = connectionStore.connections.get(props.connectionId)
  return state?.record.host ?? ''
})

const { t } = useI18n()
const notification = useNotification()
const toast = useToast()
const objectTreeRef = ref<InstanceType<typeof ObjectTree>>()

/** 获取 ObjectTree 的类型安全引用 */
function getObjectTree(): ObjectTreeExposed | undefined {
  return objectTreeRef.value as unknown as ObjectTreeExposed | undefined
}

const isConnected = ref(false)
const isConnecting = ref(false)

// 使用 useSchemaCache composable 管理 Schema 缓存和加载状态
const {
  schemaCache,
  isLoadingSchema,
  refreshSchemaCache,
  handleDatabaseSwitch,
  clearSchemaCache,
  dispose: disposeSchemaCache,
} = useSchemaCache(
  () => objectTreeRef.value?.treeNodes,
  () => props.connectionId,
)

// 注册 Schema 到全局注册表（跨连接搜索用）
schemaRegistry.registerSchema(props.connectionId, props.connectionName, schemaCache)

// 面包屑导航上下文
const breadcrumbDatabase = computed(() => {
  const tab = activeTab.value
  if (!tab) return undefined
  const ctx = tab.context
  if ('currentDatabase' in ctx) return (ctx as QueryTabContext).currentDatabase ?? undefined
  if ('database' in ctx) return (ctx as { database: string }).database
  return undefined
})

const breadcrumbTable = computed(() => {
  const tab = activeTab.value
  if (!tab) return undefined
  const ctx = tab.context
  if ('tableBrowse' in ctx && (ctx as QueryTabContext).tableBrowse) {
    return (ctx as QueryTabContext).tableBrowse?.table ?? undefined
  }
  if ('table' in ctx) return (ctx as { table?: string }).table ?? undefined
  return undefined
})

// 错误边界
const panelError = ref<string | null>(null)
onErrorCaptured((err) => {
  panelError.value = String(err)
  return false
})

// 连接池状态
const poolStatus = ref<PoolStatus | null>(null)
let poolStatusTimer: ReturnType<typeof setInterval> | null = null

/** 获取连接池状态 */
async function fetchPoolStatus() {
  if (!isConnected.value) return
  try {
    poolStatus.value = await dbApi.dbGetPoolStatus(props.connectionId)
  } catch {
    // 静默处理，不影响主流程
  }
}

/** 启动连接池状态轮询 */
function startPoolStatusPolling() {
  stopPoolStatusPolling()
  fetchPoolStatus()
  poolStatusTimer = setInterval(fetchPoolStatus, 10000) // 每 10 秒刷新
}

/** 停止连接池状态轮询 */
function stopPoolStatusPolling() {
  if (poolStatusTimer) {
    clearInterval(poolStatusTimer)
    poolStatusTimer = null
  }
}

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

// Schema 缓存更新事件处理（由 ObjectTree 触发）
function handleSchemaUpdated() {
  refreshSchemaCache()
}

// 从 ObjectTree 的 treeNodes 中提取数据库名称列表
const databaseNames = computed(() => {
  const nodes = objectTreeRef.value?.treeNodes
  if (!nodes || nodes.length === 0) return []
  return nodes.map((n) => n.label)
})

// 捕获 QueryPanel 执行成功事件，若是 DDL 则触发对象树无感刷新
function handleExecuteSuccess(sql: string) {
  const isDDL = /\b(CREATE|DROP|ALTER|RENAME|TRUNCATE)\b/i.test(sql)
  if (isDDL) {
    getObjectTree()?.silentRefresh()
  }
}

/** 处理 QueryPanel 数据库切换事件，同步 ObjectTree 高亮和 Schema 缓存 */
function handleDatabaseChanged(database: string) {
  handleDatabaseSwitch(database)
}

/**
 * 全局快捷键处理（数据库视图级别）
 * - Ctrl+T: 新建查询标签页
 * - Ctrl+W: 关闭当前标签页
 * - Ctrl+Tab: 切换到下一个标签页
 */
function handleGlobalKeydown(e: KeyboardEvent) {
  const isCtrl = e.ctrlKey || e.metaKey

  if (isCtrl && !e.shiftKey && e.key === 't') {
    // Ctrl+T: 新建查询标签页
    e.preventDefault()
    dbWorkspaceStore.addQueryTab(props.connectionId)
  } else if (isCtrl && !e.shiftKey && e.key === 'w') {
    // Ctrl+W: 关闭当前标签页
    e.preventDefault()
    const ws = workspace.value
    if (ws.activeTabId) {
      dbWorkspaceStore.closeInnerTab(props.connectionId, ws.activeTabId)
    }
  } else if (isCtrl && e.key === 'Tab') {
    // Ctrl+Tab: 切换到下一个标签页
    e.preventDefault()
    const ws = workspace.value
    if (ws.tabs.length <= 1) return
    const currentIndex = ws.tabs.findIndex(t => t.id === ws.activeTabId)
    const nextIndex = (currentIndex + 1) % ws.tabs.length
    const nextTab = ws.tabs[nextIndex]
    if (nextTab) {
      dbWorkspaceStore.setActiveInnerTab(props.connectionId, nextTab.id)
    }
  }
}

onMounted(async () => {
  // 从 SQLite 恢复上次的标签页状态（首次调用，幂等）
  await dbWorkspaceStore.restoreState().catch((e: unknown) => console.warn('[DatabaseView]', e))
  // 确保该连接的 workspace 已初始化（副作用仅在此处执行一次）
  dbWorkspaceStore.getOrCreate(props.connectionId)
  // 启用自动保存（标签页变更 → debounce 1s → 写入 SQLite）
  dbWorkspaceStore.enableAutoSave()
  await connectAndLoad()
})

// KeepAlive 重新激活时：检查连接状态，断开则重连并刷新
// 注意：closeTab 通过 store 更新状态为 disconnected，但本地 isConnected ref 不会被重置
// 因此必须同时检查 store 中的实际连接状态
onActivated(async () => {
  // 重新激活时恢复全局快捷键监听
  window.addEventListener('keydown', handleGlobalKeydown)

  const storeState = connectionStore.connections.get(props.connectionId)
  const storeDisconnected = !storeState || storeState.status !== 'connected'

  if (storeDisconnected) {
    // 同步本地状态，并立即清除旧缓存数据，避免用户看到上次的内容
    isConnected.value = false
    clearSchemaCache()
    poolStatus.value = null
    stopPoolStatusPolling()
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

// KeepAlive 停用时暂停连接池状态轮询并移除快捷键监听
onDeactivated(() => {
  stopPoolStatusPolling()
  window.removeEventListener('keydown', handleGlobalKeydown)
})

onBeforeUnmount(async () => {
  disposeSchemaCache()
  schemaRegistry.unregisterSchema(props.connectionId)
  stopPoolStatusPolling()
  window.removeEventListener('keydown', handleGlobalKeydown)
  if (isConnected.value) {
    await dbApi.dbDisconnect(props.connectionId).catch((e: unknown) => console.warn('[DatabaseView]', e))
    connectionStore.updateConnectionStatus(props.connectionId, 'disconnected')
  }
})

async function connectAndLoad() {
  isConnecting.value = true
  try {
    const result = await dbApi.dbConnect(props.connectionId)
    isConnected.value = true
    connectionStore.updateConnectionStatus(props.connectionId, 'connected')

    // 连接成功后启动连接池状态轮询
    startPoolStatusPolling()

    // 连接成功后，如果当前活跃 tab 是报错状态，则清除错误结果
    const ws = workspace.value
    const activeQueryTab = ws.tabs.find((t) => t.id === ws.activeTabId)
    if (activeQueryTab?.type === 'query' && (activeQueryTab.context as { result?: { isError?: boolean } }).result?.isError) {
      dbWorkspaceStore.updateTabContext(props.connectionId, activeQueryTab.id, {
        result: null,
      })
    }
    // 使用预加载的数据库列表（由后端在连接时一并获取，减少一次 IPC 往返）
    const preloaded = result.databases.length > 0 ? result.databases : undefined
    await objectTreeRef.value?.loadDatabases(preloaded)
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

  // 切换到该 tab 并更新内容（同时记录当前数据库上下文）
  dbWorkspaceStore.setActiveInnerTab(props.connectionId, queryTab.id)
  dbWorkspaceStore.updateTabContext(props.connectionId, queryTab.id, {
    sql,
    tableBrowse: { database, table, currentPage: 1, pageSize: 200 },
    currentDatabase: database,
  })
  nextTick(() => {
    queryPanelRef.value?.browseTable(database, table)
  })
}

function handleSelectDatabase(database: string) {
  // 数据库切换时自动刷新 Schema 缓存
  handleDatabaseSwitch(database)

  const ws = workspace.value
  const activeQueryTab = ws.tabs.find((t) => t.id === ws.activeTabId && t.type === 'query')
  const q = quoteIdentifier
  const sql = driver.value === 'postgresql'
    ? `SET search_path TO ${q(database)};`
    : `USE ${q(database)};`

  if (activeQueryTab) {
    // 同时更新 currentDatabase，确保后续 SQL 执行自动带上数据库上下文
    dbWorkspaceStore.updateTabContext(props.connectionId, activeQueryTab.id, { sql, currentDatabase: database })
  }
}

function handleEditTable(database: string, table: string) {
  dbWorkspaceStore.openTableEditor(props.connectionId, database, table)
}

function handleCreateTable(database: string) {
  dbWorkspaceStore.openTableEditor(props.connectionId, database)
}

const deleteTableDialogOpen = ref(false)
const deleteTableData = ref({ database: '', table: '' })

function handleDeleteTable(database: string, table: string) {
  deleteTableData.value = { database, table }
  deleteTableDialogOpen.value = true
}

async function handleConfirmDeleteTable() {
  const { database, table } = deleteTableData.value
  if (!database || !table) return
  try {
    const q = quoteIdentifier
    const sql = `DROP TABLE ${q(database)}.${q(table)};`
    const result = await dbApi.dbExecuteQueryInDatabase(props.connectionId, database, sql)
    if (result.isError) {
      notification.error(t('database.queryFailed'), result.error ?? undefined, true)
    } else {
      notification.success(t('database.querySuccess'), t('database.tableDeleted', { table }), 3000)
      getObjectTree()?.silentRefresh()
    }
  } catch (e: any) {
    notification.error(t('database.deleteTableFailed'), String(e), true)
  }
}

const truncateTableDialogOpen = ref(false)
const truncateTableData = ref({ database: '', table: '' })

function handleTruncateTable(database: string, table: string) {
  truncateTableData.value = { database, table }
  truncateTableDialogOpen.value = true
}

async function handleConfirmTruncateTable() {
  const { database, table } = truncateTableData.value
  if (!database || !table) return
  try {
    const q = quoteIdentifier
    const sql = `TRUNCATE TABLE ${q(database)}.${q(table)};`
    const result = await dbApi.dbExecuteQueryInDatabase(props.connectionId, database, sql)
    if (result.isError) {
      notification.error(t('database.queryFailed'), result.error ?? undefined, true)
    } else {
      notification.success(t('database.querySuccess'), t('database.tableTruncated', { table }), 3000)
    }
  } catch (e: any) {
    notification.error(t('database.truncateTableFailed'), String(e), true)
  }
}

function handleImportData(database: string, table: string, columns: string[]) {
  dbWorkspaceStore.openImport(props.connectionId, database, table, columns)
}

// ===== 对象编辑器（视图/存储过程/函数/触发器） =====
const objectEditorOpen = ref(false)
const objectEditorState = ref({ database: '', objectType: '', objectName: '', tableName: '' })

function handleCreateObject(database: string, objectType: string, tableName?: string) {
  objectEditorState.value = { database, objectType, objectName: '', tableName: tableName ?? '' }
  objectEditorOpen.value = true
}

function handleEditObject(database: string, objectName: string, objectType: string) {
  objectEditorState.value = { database, objectType, objectName, tableName: '' }
  objectEditorOpen.value = true
}

function handleObjectEditorSaved() {
  getObjectTree()?.silentRefresh()
}

// ===== 对象删除确认 =====
const dropObjectDialogOpen = ref(false)
const dropObjectData = ref({ database: '', objectName: '', objectType: '' })

function handleDropObject(database: string, objectName: string, objectType: string) {
  dropObjectData.value = { database, objectName, objectType }
  dropObjectDialogOpen.value = true
}

async function handleConfirmDropObject() {
  const { database, objectName, objectType } = dropObjectData.value
  if (!database || !objectName || !objectType) return
  try {
    const q = quoteIdentifier
    const sql = `DROP ${objectType} IF EXISTS ${q(database)}.${q(objectName)};`
    const result = await dbApi.dbExecuteQueryInDatabase(props.connectionId, database, sql)
    if (result.isError) {
      notification.error(t('database.deleteFailed'), result.error ?? undefined, true)
    } else {
      const typeLabel: Record<string, string> = { VIEW: t('database.objectTypeView'), PROCEDURE: t('database.objectTypeProcedure'), FUNCTION: t('database.objectTypeFunction'), TRIGGER: t('database.objectTypeTrigger') }
      notification.success(t('database.deleteObjectSuccess'), t('database.objectDeleted', { type: typeLabel[objectType] ?? objectType, name: objectName }), 3000)
      getObjectTree()?.silentRefresh()
    }
  } catch (e: any) {
    notification.error(t('database.objectDeleteFailed'), String(e), true)
  }
}

async function handleShowCreateSql(database: string, table: string) {
  try {
    const sql = await dbApi.dbGetCreateTable(props.connectionId, database, table)
    const ws = workspace.value
    const activeQueryTab = ws.tabs.find((t) => t.id === ws.activeTabId && t.type === 'query')
    if (activeQueryTab) {
      dbWorkspaceStore.updateTabContext(props.connectionId, activeQueryTab.id, { sql })
    }
  } catch (e: any) {
    notification.error(t('database.getCreateTableFailed'), String(e), true)
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
  } catch (e: any) {
    notification.error(t('database.getObjectDefFailed'), String(e), true)
  }
}

// ===== 存储过程/函数执行对话框 =====
const routineExecState = ref<{
  open: boolean
  database: string
  routineName: string
  routineType: string
}>({ open: false, database: '', routineName: '', routineType: '' })

function handleExecuteRoutine(database: string, name: string, routineType: string) {
  routineExecState.value = { open: true, database, routineName: name, routineType }
}

/** 存储过程执行对话框生成的 SQL 插入到当前查询标签页 */
function handleRoutineExecSql(sql: string) {
  const ws = workspace.value
  const activeQueryTab = ws.tabs.find((t) => t.id === ws.activeTabId && t.type === 'query')
  if (activeQueryTab) {
    dbWorkspaceStore.updateTabContext(props.connectionId, activeQueryTab.id, { sql })
  }
}

function handleTableEditorSuccess() {
  getObjectTree()?.silentRefresh()
}

function handleImportSuccess() {
  getObjectTree()?.silentRefresh()
}

function handleOpenSchemaCompare() {
  dbWorkspaceStore.openSchemaCompare(props.connectionId)
}

// 备份/恢复
const backupDialogOpen = ref(false)
const backupDatabase = ref('')
const restoreDialogOpen = ref(false)
const restoreDatabase = ref('')

// 导出数据库结构的 loading 状态
const exportingDb = ref('')

function handleBackupDatabase(database: string) {
  backupDatabase.value = database
  backupDialogOpen.value = true
}

function handleRestoreDatabase(database: string) {
  restoreDatabase.value = database
  restoreDialogOpen.value = true
}

function handleRestoreSuccess() {
  getObjectTree()?.silentRefresh()
}

/** 打开用户管理面板 */
function handleOpenUserManagement() {
  dbWorkspaceStore.openUserManagement(props.connectionId)
}

/** 打开性能监控面板 */
function handleOpenPerformance() {
  dbWorkspaceStore.openPerformance(props.connectionId)
}

/** 打开数据同步面板 */
function handleOpenDataSync() {
  dbWorkspaceStore.openDataSync(props.connectionId)
}

/** 打开调度管理面板 */
function handleOpenScheduler() {
  dbWorkspaceStore.openScheduler(props.connectionId)
}

/** 数据同步面板中「保存为定时任务」的处理 */
function handleSaveAsScheduledTask(config: import('@/types/data-sync').SyncConfig) {
  // 打开调度管理面板并预填配置
  dbWorkspaceStore.openScheduler(props.connectionId)
  const tabId = `${props.connectionId}-scheduler`
  dbWorkspaceStore.updateTabContext(props.connectionId, tabId, {
    prefill: {
      taskType: 'data_sync',
      configJson: JSON.stringify(config),
      name: `${config.sourceDatabase} → ${config.targetDatabase}`,
    },
  })
}

function handleOpenErDiagram(database: string) {
  dbWorkspaceStore.openErDiagram(props.connectionId, database)
}

/** 生成表对象的 DDL 脚本并在新查询标签页中打开 */
async function handleGenerateScript(database: string, table: string, scriptType: string) {
  try {
    // 默认选项：CREATE 包含 IF NOT EXISTS，DROP 包含 IF EXISTS
    const options: ScriptOptions = {
      includeIfNotExists: true,
      includeIfExists: true,
    }
    const sql = await dbApi.dbGenerateScript(props.connectionId, database, table, scriptType, options)
    // 创建新的查询标签页并填入生成的脚本
    const tab = dbWorkspaceStore.addQueryTab(props.connectionId)
    dbWorkspaceStore.updateTabContext(props.connectionId, tab.id, { sql })
  } catch (e: any) {
    notification.error(t('database.generateScriptFailed'), String(e), true)
  }
}

/** 导出数据库结构并在新查询标签页中打开 */
async function handleExportDatabaseDdl(database: string) {
  exportingDb.value = database
  try {
    const options: ScriptOptions = {
      includeIfNotExists: true,
      includeIfExists: true,
    }
    const sql = await dbApi.dbExportDatabaseDdl(props.connectionId, database, options)
    const tab = dbWorkspaceStore.addQueryTab(props.connectionId)
    dbWorkspaceStore.updateTabContext(props.connectionId, tab.id, { sql })
    toast.success(t('database.exportStructureSuccess', { db: database }))
  } catch (e) {
    toast.error(t('database.exportStructureFailed'), String(e))
  } finally {
    exportingDb.value = ''
  }
}

import RunSqlFileDialog from '@/components/database/RunSqlFileDialog.vue'

// 执行 SQL 文件相关状态
const runSqlDialogOpen = ref(false)
const runSqlDatabase = ref('')
const runSqlFilePath = ref('')

/** 运行 SQL 文件：直接打开对话框，支持在对话框内选择文件 */
function handleRunSqlFile(database: string) {
  runSqlDatabase.value = database
  runSqlFilePath.value = '' // 不再强制要求先选文件
  runSqlDialogOpen.value = true
}

function handleRunSqlSuccess() {
  getObjectTree()?.silentRefresh()
}

const createDatabaseDialogOpen = ref(false)

function handleCreateDatabase() {
  createDatabaseDialogOpen.value = true
}

function handleCreateDatabaseSuccess(dbName: string) {
  notification.success(t('database.createSuccess'), t('database.databaseCreated', { name: dbName }))
  objectTreeRef.value?.forceRefresh()
}

const editDatabaseDialogOpen = ref(false)
const editDatabaseName = ref('')

function handleEditDatabase(dbName: string) {
  editDatabaseName.value = dbName
  editDatabaseDialogOpen.value = true
}

function handleEditDatabaseSuccess() {
  notification.success(t('database.editSuccess'), t('database.databaseUpdated', { name: editDatabaseName.value }))
  objectTreeRef.value?.forceRefresh()
}
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <!-- 连接状态栏 (移除虚化，提升清晰度) -->
    <div class="flex items-center gap-2 border-b border-border/20 bg-background px-3 py-1.5">
      <div class="flex-1" />
      <!-- 更加精致的连接池状态监控（实心锐利版） -->
      <div v-if="poolStatus && isConnected" class="flex items-center bg-muted/50 rounded-full pl-1 pr-2.5 py-0.5 border border-border text-[10px] mr-3 shadow-sm selection:bg-transparent">
        <div class="flex h-4 items-center gap-1.5 px-2 border-r border-border/40">
          <div class="h-1.5 w-1.5 rounded-full bg-df-success shadow-[0_0_6px_var(--df-success)]"></div>
          <span class="text-muted-foreground/60 font-medium">{{ t('database.poolActive') }}</span>
          <span class="text-foreground font-bold tabular-nums">{{ poolStatus.activeConnections }}</span>
        </div>
        <div class="flex h-4 items-center gap-1.5 px-2 border-r border-border/40">
          <div class="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_var(--color-primary)]"></div>
          <span class="text-muted-foreground/60 font-medium">{{ t('database.poolIdle') }}</span>
          <span class="text-foreground font-bold tabular-nums">{{ poolStatus.idleConnections }}</span>
        </div>
        <div class="flex h-4 items-center gap-2 pl-2">
          <span class="text-muted-foreground/40 tabular-nums">{{ t('database.poolTotal') }} {{ poolStatus.activeConnections + poolStatus.idleConnections }}</span>
          <span class="text-muted-foreground/20 italic">/</span>
          <span class="text-muted-foreground/50 font-medium tabular-nums">{{ poolStatus.maxConnections }}</span>
        </div>
      </div>
      <div class="flex items-center gap-2 border-l border-border/10 ml-2 pl-3 text-[10px] font-black tracking-widest text-muted-foreground/30 uppercase italic">
        <div
          class="h-1.5 w-1.5 rounded-full transition-colors duration-300"
          :class="{
            'bg-df-success shadow-[0_0_4px_var(--df-success)]': isConnected && !isReconnecting,
            'bg-df-warning animate-pulse': isReconnecting || (isConnecting && !isReconnecting),
            'bg-destructive': !isConnected && !isConnecting && !isReconnecting,
          }"
        />
        <!-- 重连状态提示 -->
        <span v-if="isReconnecting" class="text-df-warning">
          {{ t('database.reconnecting', { attempt: connectionState?.reconnectAttempt ?? 1 }) }}
        </span>
        <span v-else>{{ connectionName }}</span>
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
          :exporting-db="exportingDb"
          @select-table="handleSelectTable"
          @select-database="handleSelectDatabase"
          @edit-table="handleEditTable"
          @create-table="handleCreateTable"
          @delete-table="handleDeleteTable"
          @truncate-table="handleTruncateTable"
          @import-data="handleImportData"
          @show-create-sql="handleShowCreateSql"
          @show-object-definition="handleShowObjectDefinition"
          @schema-updated="handleSchemaUpdated"
          @open-schema-compare="handleOpenSchemaCompare"
          @backup-database="handleBackupDatabase"
          @restore-database="handleRestoreDatabase"
          @open-user-management="handleOpenUserManagement"
          @open-performance="handleOpenPerformance"
          @open-data-sync="handleOpenDataSync"
          @open-scheduler="handleOpenScheduler"
          @open-er-diagram="handleOpenErDiagram"
          @generate-script="handleGenerateScript"
          @export-database-ddl="handleExportDatabaseDdl"
          @run-sql-file="handleRunSqlFile"
          @create-database="handleCreateDatabase"
          @edit-database="handleEditDatabase"
          @execute-routine="handleExecuteRoutine"
          @create-object="handleCreateObject"
          @edit-object="handleEditObject"
          @drop-object="handleDropObject"
        />
      </Pane>

      <!-- Inner Tab Area -->
      <Pane :size="75">
        <div class="flex h-full flex-col">
          <EnvironmentBanner
            v-if="activeTab?.type !== 'data-sync' && activeTab?.type !== 'scheduler'"
            :environment="environment"
            :connection-name="connectionName"
            :host="connectionHost"
            :read-only="readOnly"
          />
          <InnerTabBar :connection-id="connectionId" :environment="environment" />
          <BreadcrumbNav
            v-if="activeTab?.type !== 'data-sync' && activeTab?.type !== 'scheduler'"
            :connection-name="connectionName"
            :database="breadcrumbDatabase"
            :table="breadcrumbTable"
            :operation="activeTab?.type"
            :environment="environment"
          />

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
                :is-loading-schema="isLoadingSchema"
                :driver="driver"
                :databases="databaseNames"
                :environment="environment"
                :read-only="readOnly"
                :confirm-danger="confirmDanger"
                @reconnect="connectAndLoad"
                @execute-success="handleExecuteSuccess"
                @database-changed="handleDatabaseChanged"
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
              <PerformanceDashboard
                v-else-if="activeTab?.type === 'performance'"
                :key="activeTab.id"
                :connection-id="connectionId"
                :tab-id="activeTab.id"
                :is-connected="isConnected"
              />
              <UserManagementPanel
                v-else-if="activeTab?.type === 'user-management'"
                :key="activeTab.id"
                :connection-id="connectionId"
                :is-connected="isConnected"
              />
              <ErDiagramPanel
                v-else-if="activeTab?.type === 'er-diagram'"
                :key="activeTab.id"
                :connection-id="connectionId"
                :database="(activeTab.context as ErDiagramTabContext).database"
                @open-table-editor="(db: string, table: string) => dbWorkspaceStore.openTableEditor(connectionId, db, table)"
              />
              <DataSyncPanel
                v-else-if="activeTab?.type === 'data-sync'"
                :key="activeTab.id"
                :connection-id="connectionId"
                :is-connected="isConnected"
                @save-as-scheduled-task="handleSaveAsScheduledTask"
              />
              <SchedulerPanel
                v-else-if="activeTab?.type === 'scheduler'"
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
    
    <!-- 删除表二次确认对话框 -->
    <ConfirmDialog
      v-model:open="deleteTableDialogOpen"
      :title="t('database.deleteTableTitle', { table: deleteTableData.table })"
      :description="t('database.deleteTableDesc')"
      variant="destructive"
      :confirm-label="t('database.confirmDelete')"
      @confirm="handleConfirmDeleteTable"
    />

    <!-- 清空表二次确认对话框 -->
    <ConfirmDialog
      v-model:open="truncateTableDialogOpen"
      :title="t('database.truncateTableTitle', { table: truncateTableData.table })"
      :description="t('database.truncateTableDesc')"
      variant="destructive"
      :confirm-label="t('database.confirmTruncate')"
      @confirm="handleConfirmTruncateTable"
    />

    <!-- 运行 SQL 文件对话框 -->
    <RunSqlFileDialog
      v-model:open="runSqlDialogOpen"
      :connection-id="connectionId"
      :database="runSqlDatabase"
      :file-path="runSqlFilePath"
      @success="handleRunSqlSuccess"
    />

    <!-- 新建数据库对话框 -->
    <CreateDatabaseDialog
      v-model:open="createDatabaseDialogOpen"
      :connection-id="connectionId"
      @success="handleCreateDatabaseSuccess"
    />

    <!-- 编辑数据库对话框 -->
    <EditDatabaseDialog
      v-model:open="editDatabaseDialogOpen"
      :connection-id="connectionId"
      :database="editDatabaseName"
      @success="handleEditDatabaseSuccess"
    />

    <!-- 存储过程/函数执行对话框 -->
    <RoutineExecDialog
      v-if="routineExecState.open"
      v-model:open="routineExecState.open"
      :connection-id="connectionId"
      :database="routineExecState.database"
      :routine-name="routineExecState.routineName"
      :routine-type="routineExecState.routineType"
      @execute="handleRoutineExecSql"
    />

    <!-- 对象编辑对话框 (视图/存储过程/函数/触发器) -->
    <ObjectEditorDialog
      v-model:open="objectEditorOpen"
      :connection-id="connectionId"
      :database="objectEditorState.database"
      :object-type="objectEditorState.objectType"
      :object-name="objectEditorState.objectName || undefined"
      :table-name="objectEditorState.tableName || undefined"
      @saved="handleObjectEditorSaved"
    />

    <!-- 删除对象二次确认对话框 -->
    <ConfirmDialog
      v-model:open="dropObjectDialogOpen"
      :title="t('database.dropObjectTitle', { name: dropObjectData.objectName })"
      :description="t('database.dropObjectDesc', { type: ({ VIEW: t('database.objectTypeView'), PROCEDURE: t('database.objectTypeProcedure'), FUNCTION: t('database.objectTypeFunction'), TRIGGER: t('database.objectTypeTrigger') } as Record<string, string>)[dropObjectData.objectType] ?? t('database.objectTypeDefault'), name: dropObjectData.objectName })"
      variant="destructive"
      :confirm-label="t('database.confirmDelete')"
      @confirm="handleConfirmDropObject"
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
