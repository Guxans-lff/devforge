<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import { Button } from '@/components/ui/button'
import { Play, Loader2, Plus, FileUp, Table2 } from 'lucide-vue-next'
import ObjectTree from '@/components/database/ObjectTree.vue'
import SqlEditor from '@/components/database/SqlEditor.vue'
import QueryResultComponent from '@/components/database/QueryResult.vue'
import TableEditorDialog from '@/components/database/TableEditorDialog.vue'
import ImportDialog from '@/components/database/ImportDialog.vue'
import { useConnectionStore } from '@/stores/connections'
import * as dbApi from '@/api/database'
import type { QueryResult, SchemaCache, DatabaseSchema, TableSchema, DatabaseTreeNode } from '@/types/database'

const props = defineProps<{
  connectionId: string
  connectionName: string
}>()

const connectionStore = useConnectionStore()

const driver = computed(() => {
  const state = connectionStore.connections.get(props.connectionId)
  if (!state) return 'mysql'
  try {
    const config = JSON.parse(state.record.configJson)
    return (config.driver as string) ?? 'mysql'
  } catch {
    return 'mysql'
  }
})

const { t } = useI18n()
const objectTreeRef = ref<InstanceType<typeof ObjectTree>>()
const editorRef = ref<InstanceType<typeof SqlEditor>>()

const sqlContent = ref('')
const queryResult = ref<QueryResult | null>(null)
const isExecuting = ref(false)
const isConnected = ref(false)
const isConnecting = ref(false)
const schemaCache = ref<SchemaCache | null>(null)

// Table Editor dialog state
const showTableEditor = ref(false)
const tableEditorDatabase = ref('')
const tableEditorTable = ref<string | undefined>(undefined)

// Import dialog state
const showImportDialog = ref(false)
const importDatabase = ref('')
const importTable = ref<string | undefined>(undefined)
const importColumns = ref<string[]>([])

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

// Watch ObjectTree data changes to update schema cache (debounced)
let schemaCacheTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => objectTreeRef.value?.treeNodes,
  (nodes) => {
    if (schemaCacheTimer) clearTimeout(schemaCacheTimer)
    schemaCacheTimer = setTimeout(() => {
      if (nodes) {
        schemaCache.value = buildSchemaCache(nodes)
      }
    }, 300)
  },
  { deep: true },
)

onMounted(async () => {
  await connectAndLoad()
})

onBeforeUnmount(async () => {
  if (isConnected.value) {
    await dbApi.dbDisconnect(props.connectionId).catch(() => {})
  }
})

async function connectAndLoad() {
  isConnecting.value = true
  try {
    await dbApi.dbConnect(props.connectionId)
    isConnected.value = true
    await objectTreeRef.value?.loadDatabases()
  } catch (e) {
    isConnected.value = false
    queryResult.value = {
      columns: [],
      rows: [],
      affectedRows: 0,
      executionTimeMs: 0,
      isError: true,
      error: String(e),
    }
  } finally {
    isConnecting.value = false
  }
}

async function handleExecute(sql: string) {
  if (!sql.trim() || isExecuting.value) return
  isExecuting.value = true
  try {
    queryResult.value = await dbApi.dbExecuteQuery(props.connectionId, sql)
  } catch (e) {
    queryResult.value = {
      columns: [],
      rows: [],
      affectedRows: 0,
      executionTimeMs: 0,
      isError: true,
      error: String(e),
    }
  } finally {
    isExecuting.value = false
  }
}

function quoteIdentifier(name: string): string {
  return driver.value === 'postgresql' ? `"${name}"` : `\`${name}\``
}

function handleSelectTable(database: string, table: string) {
  const q = quoteIdentifier
  const sql = `SELECT * FROM ${q(database)}.${q(table)} LIMIT 100;`
  sqlContent.value = sql
  handleExecute(sql)
}

function handleSelectDatabase(database: string) {
  const q = quoteIdentifier
  const sql = driver.value === 'postgresql'
    ? `SET search_path TO ${q(database)};`
    : `USE ${q(database)};`
  sqlContent.value = sql
}

function executeCurrentSql() {
  const selected = editorRef.value?.getSelectedText()
  if (selected && selected.trim()) {
    handleExecute(selected)
  } else {
    handleExecute(sqlContent.value)
  }
}

// Context menu handlers from ObjectTree
function handleEditTable(database: string, table: string) {
  tableEditorDatabase.value = database
  tableEditorTable.value = table
  showTableEditor.value = true
}

function handleCreateTable(database: string) {
  tableEditorDatabase.value = database
  tableEditorTable.value = undefined
  showTableEditor.value = true
}

function handleImportData(database: string, table: string, columns: string[]) {
  importDatabase.value = database
  importTable.value = table
  importColumns.value = columns
  showImportDialog.value = true
}

async function handleShowCreateSql(database: string, table: string) {
  try {
    const sql = await dbApi.dbGetCreateTable(props.connectionId, database, table)
    sqlContent.value = sql
  } catch (e) {
    sqlContent.value = `-- Error: ${e}`
  }
}

function handleTableEditorSuccess() {
  showTableEditor.value = false
  objectTreeRef.value?.loadDatabases()
}

function handleImportSuccess() {
  showImportDialog.value = false
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 border-b border-border px-3 py-1.5">
      <Button
        variant="default"
        size="sm"
        class="h-7 gap-1.5 text-xs"
        :disabled="!isConnected || isExecuting"
        @click="executeCurrentSql"
      >
        <Loader2 v-if="isExecuting" class="h-3.5 w-3.5 animate-spin" />
        <Play v-else class="h-3.5 w-3.5" />
        {{ t('database.execute') }}
      </Button>
      <span class="text-xs text-muted-foreground">
        Ctrl+Enter
      </span>

      <div class="mx-1 h-4 w-px bg-border" />

      <Button
        variant="ghost"
        size="sm"
        class="h-7 gap-1.5 text-xs"
        :disabled="!isConnected"
        @click="tableEditorDatabase = ''; tableEditorTable = undefined; showTableEditor = true"
      >
        <Plus class="h-3.5 w-3.5" />
        {{ t('tableEditor.createTable') }}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        class="h-7 gap-1.5 text-xs"
        :disabled="!isConnected"
        @click="importDatabase = ''; importTable = undefined; importColumns = []; showImportDialog = true"
      >
        <FileUp class="h-3.5 w-3.5" />
        {{ t('dataImport.import') }}
      </Button>

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

    <!-- Main content with splitpanes -->
    <Splitpanes class="flex-1" horizontal>
      <Pane :size="60">
        <Splitpanes>
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
            />
          </Pane>

          <!-- SQL Editor -->
          <Pane :size="75">
            <SqlEditor
              ref="editorRef"
              v-model="sqlContent"
              :schema="schemaCache"
              @execute="handleExecute"
              @execute-selected="handleExecute"
            />
          </Pane>
        </Splitpanes>
      </Pane>

      <!-- Query Result -->
      <Pane :size="40" :min-size="15">
        <QueryResultComponent
          :result="queryResult"
          :loading="isExecuting"
          :show-reconnect="!isConnected && !isConnecting"
          @reconnect="connectAndLoad"
        />
      </Pane>
    </Splitpanes>

    <!-- Table Editor Dialog -->
    <TableEditorDialog
      v-model:open="showTableEditor"
      :connection-id="connectionId"
      :database="tableEditorDatabase"
      :driver="driver"
      :table="tableEditorTable"
      @success="handleTableEditorSuccess"
    />

    <!-- Import Dialog -->
    <ImportDialog
      v-model:open="showImportDialog"
      :connection-id="connectionId"
      :database="importDatabase"
      :target-table="importTable"
      :table-columns="importColumns"
      @success="handleImportSuccess"
    />
  </div>
</template>

<style>
/* Override splitpanes default styles to match our theme */
.splitpanes--vertical > .splitpanes__splitter,
.splitpanes--horizontal > .splitpanes__splitter {
  background-color: hsl(var(--border));
  position: relative;
  cursor: col-resize;
}

.splitpanes--horizontal > .splitpanes__splitter {
  cursor: row-resize;
}

.splitpanes--vertical > .splitpanes__splitter {
  width: 3px;
  min-width: 3px;
}

.splitpanes--horizontal > .splitpanes__splitter {
  height: 3px;
  min-height: 3px;
}

.splitpanes--vertical > .splitpanes__splitter:hover,
.splitpanes--horizontal > .splitpanes__splitter:hover {
  background-color: hsl(var(--primary));
}

/* Ensure panes don't overflow */
.splitpanes__pane {
  overflow: hidden;
}
</style>
