<script setup lang="ts">
/**
 * 可视化 SQL Builder 主面板
 * 三栏布局：表列表 | vue-flow 画布 | 属性面板，底部 SQL 预览
 */
import { ref, computed, watch, onMounted, nextTick, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { dbGetTables, dbGetColumns, dbGetForeignKeys } from '@/api/database'
import { useSqlBuilder } from '@/composables/useSqlBuilder'
import { useToast } from '@/composables/useToast'
import type { TableInfo, ColumnInfo, ForeignKeyRelation } from '@/types/database'
import type { JoinType, SqlOperator } from '@/types/sql-builder'
import type { Node, Edge, Connection } from '@vue-flow/core'
import {
  Search, Layout, Maximize2, Trash2, Plus, Copy, Play, X,
  ArrowUpDown, Filter,
} from 'lucide-vue-next'

import SqlBuilderTableNode from './SqlBuilderTableNode.vue'
import SqlBuilderJoinEdge from './SqlBuilderJoinEdge.vue'

const SqlEditorLazy = defineAsyncComponent(() => import('@/components/database/SqlEditorLazy.vue'))

const props = defineProps<{
  connectionId: string
  database: string
}>()

const emit = defineEmits<{
  executeInQuery: [sql: string]
}>()

const { t } = useI18n()
const toast = useToast()

// ── SQL Builder 核心 ─────────────────────────────────────────────
const builder = useSqlBuilder()

// ── vue-flow ─────────────────────────────────────────────────────
const { fitView } = useVueFlow({
  id: `sql-builder-${props.connectionId}-${props.database}`,
  defaultEdgeOptions: { animated: true },
})

const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])

/** 是否需要重新布局（仅添加/删除表时） */
let needsLayout = false

/** 同步 builder state → vue-flow nodes/edges（不重算布局） */
function syncFlowData() {
  const rawNodes = builder.toVueFlowNodes()
  if (needsLayout) {
    nodes.value = builder.autoLayout(rawNodes)
    needsLayout = false
  } else {
    // 保留现有位置，只更新 data
    const posMap = new Map(nodes.value.map(n => [n.id, n.position]))
    nodes.value = rawNodes.map(n => ({
      ...n,
      position: posMap.get(n.id) ?? n.position,
    }))
  }
  edges.value = builder.toVueFlowEdges()
}

watch(() => builder.state.value, syncFlowData, { deep: true })

// ── 表列表 ───────────────────────────────────────────────────────
const tableList = ref<TableInfo[]>([])
const tableSearch = ref('')
const loadingTables = ref(false)
/** 表名 → 列信息缓存 */
const columnsCache = new Map<string, ColumnInfo[]>()
/** 外键数据 */
const foreignKeys = ref<ForeignKeyRelation[]>([])

const filteredTables = computed(() => {
  const q = tableSearch.value.toLowerCase()
  return q
    ? tableList.value.filter(t => t.name.toLowerCase().includes(q))
    : tableList.value
})

async function loadTableList() {
  loadingTables.value = true
  try {
    const [tables, fks] = await Promise.all([
      dbGetTables(props.connectionId, props.database),
      dbGetForeignKeys(props.connectionId, props.database),
    ])
    tableList.value = tables
    foreignKeys.value = fks
  } catch (e) {
    tableList.value = []
    toast.error(t('sqlBuilder.loadingTables'), String(e))
  } finally {
    loadingTables.value = false
  }
}

/** 获取列信息（带缓存） */
async function getColumns(tableName: string): Promise<ColumnInfo[]> {
  if (columnsCache.has(tableName)) return columnsCache.get(tableName)!
  const cols = await dbGetColumns(props.connectionId, props.database, tableName)
  columnsCache.set(tableName, cols)
  return cols
}

/** 双击表名添加到画布 */
async function handleAddTable(tableName: string) {
  if (builder.addedTableNames.value.has(tableName)) return
  const columns = await getColumns(tableName)
  needsLayout = true
  builder.addTable(tableName, columns)
  // 自动检测 JOIN
  builder.autoDetectJoins(foreignKeys.value)
  await nextTick()
  fitView({ padding: 0.2, duration: 300 })
}

// ── vue-flow 节点/边事件 ─────────────────────────────────────────

function onNodeToggleColumn(nodeId: string, column: string) {
  builder.toggleColumn(nodeId, column)
}
function onNodeSelectAll(nodeId: string) {
  builder.selectAllColumns(nodeId)
}
function onNodeDeselectAll(nodeId: string) {
  builder.deselectAllColumns(nodeId)
}
function onNodeRemove(nodeId: string) {
  needsLayout = true
  builder.removeTable(nodeId)
}

function onEdgeUpdateJoinType(joinId: string, joinType: JoinType) {
  builder.updateJoinType(joinId, joinType)
}
function onEdgeRemoveJoin(joinId: string) {
  builder.removeJoin(joinId)
}

/** 拖拽连线创建 JOIN */
async function onConnect(connection: Connection) {
  if (!connection.source || !connection.target || connection.source === connection.target) return

  const sourceTable = builder.state.value.tables.find(t => t.id === connection.source)
  const targetTable = builder.state.value.tables.find(t => t.id === connection.target)
  if (!sourceTable || !targetTable) return

  // 尝试匹配外键
  const fk = foreignKeys.value.find(f =>
    (f.tableName === sourceTable.tableName && f.referencedTableName === targetTable.tableName)
    || (f.tableName === targetTable.tableName && f.referencedTableName === sourceTable.tableName),
  )

  if (fk) {
    const isForward = fk.tableName === sourceTable.tableName
    builder.addJoin(
      connection.source, isForward ? fk.columnName : fk.referencedColumnName,
      connection.target, isForward ? fk.referencedColumnName : fk.columnName,
      'INNER',
    )
  } else {
    // 无外键：默认用第一列（通常是主键）
    const srcCol = sourceTable.columns.find(c => c.isPrimaryKey)?.name ?? sourceTable.columns[0]?.name
    const tgtCol = targetTable.columns.find(c => c.isPrimaryKey)?.name ?? targetTable.columns[0]?.name
    if (srcCol && tgtCol) {
      builder.addJoin(connection.source, srcCol, connection.target, tgtCol, 'INNER')
    }
  }
}

// ── 工具栏操作 ───────────────────────────────────────────────────

function handleAutoLayout() {
  needsLayout = true
  syncFlowData()
  nextTick(() => fitView({ padding: 0.2, duration: 300 }))
}

function handleFitView() {
  fitView({ padding: 0.2, duration: 300 })
}

function handleClear() {
  builder.reset()
  nodes.value = []
  edges.value = []
}

// ── SQL 操作 ─────────────────────────────────────────────────────

function copySql() {
  const sql = builder.generatedSql.value
  if (sql) navigator.clipboard.writeText(sql)
}

function executeInQuery() {
  const sql = builder.generatedSql.value
  if (sql) emit('executeInQuery', sql)
}

// ── 属性面板 ─────────────────────────────────────────────────────

const operators: SqlOperator[] = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN', 'IS NULL', 'IS NOT NULL']

// ── 生命周期 ─────────────────────────────────────────────────────
onMounted(loadTableList)
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 主内容区（三栏） -->
    <Splitpanes class="flex-1 min-h-0">
      <!-- 左栏：表列表 -->
      <Pane :size="18" :min-size="12" :max-size="30">
        <div class="flex flex-col h-full border-r border-border">
          <div class="px-2 py-1.5 border-b border-border bg-muted/30">
            <div class="relative">
              <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                v-model="tableSearch"
                class="w-full pl-7 pr-2 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                :placeholder="t('sqlBuilder.searchTables')"
              />
            </div>
          </div>
          <div class="flex-1 overflow-y-auto">
            <div v-if="loadingTables" class="p-4 text-center text-xs text-muted-foreground">
              {{ t('sqlBuilder.loadingTables') }}
            </div>
            <div v-else-if="filteredTables.length === 0" class="p-4 text-center text-xs text-muted-foreground">
              {{ t('sqlBuilder.noTables') }}
            </div>
            <div
              v-for="table in filteredTables" :key="table.name"
              class="flex items-center px-2 py-1 text-xs cursor-pointer hover:bg-accent/40"
              :class="builder.addedTableNames.value.has(table.name) ? 'opacity-40' : ''"
              @dblclick="handleAddTable(table.name)"
            >
              <span class="truncate">{{ table.name }}</span>
              <span v-if="table.comment" class="ml-auto text-[9px] text-muted-foreground/50 truncate max-w-[60px]">
                {{ table.comment }}
              </span>
            </div>
          </div>
          <div class="px-2 py-1 text-[10px] text-muted-foreground/50 border-t border-border">
            {{ t('sqlBuilder.dragHint') }}
          </div>
        </div>
      </Pane>

      <!-- 中栏：vue-flow 画布 -->
      <Pane :size="55" :min-size="30">
        <div class="flex flex-col h-full">
          <!-- 画布工具栏 -->
          <div class="flex items-center gap-1 px-2 py-1 border-b border-border bg-muted/20">
            <button
              class="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
              :title="t('sqlBuilder.autoLayout')"
              @click="handleAutoLayout"
            >
              <Layout class="h-3.5 w-3.5" />
            </button>
            <button
              class="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
              :title="t('sqlBuilder.fitView')"
              @click="handleFitView"
            >
              <Maximize2 class="h-3.5 w-3.5" />
            </button>
            <button
              class="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-accent/50"
              :title="t('sqlBuilder.clearCanvas')"
              @click="handleClear"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </button>
            <span class="ml-2 text-[10px] text-muted-foreground">
              {{ builder.state.value.tables.length }} {{ t('sqlBuilder.tablesCount') }}
              · {{ builder.state.value.joins.length }} {{ t('sqlBuilder.joinsCount') }}
            </span>
          </div>

          <!-- 画布 -->
          <div class="flex-1 min-h-0">
            <VueFlow
              v-model:nodes="nodes"
              v-model:edges="edges"
              :default-viewport="{ zoom: 1, x: 0, y: 0 }"
              :min-zoom="0.3"
              :max-zoom="2"
              fit-view-on-init
              @connect="onConnect"
            >
              <template #node-sqlBuilderTable="{ data, selected, id }">
                <SqlBuilderTableNode
                  :data="data"
                  :selected="selected"
                  @toggle-column="(col: string) => onNodeToggleColumn(id, col)"
                  @select-all="onNodeSelectAll(id)"
                  @deselect-all="onNodeDeselectAll(id)"
                  @remove-table="onNodeRemove(id)"
                />
              </template>
              <template #edge-sqlBuilderJoin="edgeProps">
                <SqlBuilderJoinEdge
                  v-bind="edgeProps"
                  @update-join-type="(jt: JoinType) => onEdgeUpdateJoinType(edgeProps.id, jt)"
                  @remove-join="onEdgeRemoveJoin(edgeProps.id)"
                />
              </template>
            </VueFlow>
          </div>
        </div>
      </Pane>

      <!-- 右栏：属性面板 -->
      <Pane :size="27" :min-size="18" :max-size="40">
        <div class="flex flex-col h-full border-l border-border overflow-y-auto">
          <!-- WHERE 条件 -->
          <div class="border-b border-border">
            <div class="flex items-center justify-between px-3 py-1.5 bg-muted/30">
              <span class="text-xs font-medium flex items-center gap-1">
                <Filter class="h-3.5 w-3.5" /> WHERE
              </span>
              <button
                class="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
                @click="builder.addCondition()"
              >
                <Plus class="h-3.5 w-3.5" />
              </button>
            </div>
            <div v-if="builder.state.value.conditions.length === 0" class="px-3 py-2 text-[10px] text-muted-foreground/50">
              {{ t('sqlBuilder.noConditions') }}
            </div>
            <div
              v-for="cond in builder.state.value.conditions" :key="cond.id"
              class="flex flex-wrap items-center gap-1 px-2 py-1 text-[11px] border-b border-border/30 last:border-0"
            >
              <!-- 逻辑连接符 -->
              <select
                v-if="builder.state.value.conditions.indexOf(cond) > 0"
                :value="cond.logic"
                class="w-12 px-1 py-0.5 rounded border border-border bg-background text-[10px]"
                @change="builder.updateCondition(cond.id, { logic: ($event.target as HTMLSelectElement).value as 'AND' | 'OR' })"
              >
                <option>AND</option>
                <option>OR</option>
              </select>
              <!-- 表.列 -->
              <select
                :value="`${cond.tableAlias}.${cond.column}`"
                class="flex-1 min-w-[80px] px-1 py-0.5 rounded border border-border bg-background text-[10px] font-mono"
                @change="(e: Event) => {
                  const v = (e.target as HTMLSelectElement).value.split('.')
                  builder.updateCondition(cond.id, { tableAlias: v[0], column: v[1] })
                }"
              >
                <option
                  v-for="col in builder.allColumns.value" :key="`${col.alias}.${col.column}`"
                  :value="`${col.alias}.${col.column}`"
                >
                  {{ col.alias }}.{{ col.column }}
                </option>
              </select>
              <!-- 操作符 -->
              <select
                :value="cond.operator"
                class="w-[72px] px-1 py-0.5 rounded border border-border bg-background text-[10px]"
                @change="builder.updateCondition(cond.id, { operator: ($event.target as HTMLSelectElement).value as SqlOperator })"
              >
                <option v-for="op in operators" :key="op" :value="op">{{ op }}</option>
              </select>
              <!-- 值 -->
              <input
                v-if="cond.operator !== 'IS NULL' && cond.operator !== 'IS NOT NULL'"
                :value="cond.value"
                class="flex-1 min-w-[50px] px-1 py-0.5 rounded border border-border bg-background text-[10px]"
                :placeholder="cond.operator === 'IN' ? `'a','b' 或 1,2,3` : 'value'"
                @input="builder.updateCondition(cond.id, { value: ($event.target as HTMLInputElement).value })"
              />
              <!-- 删除 -->
              <button
                class="p-0.5 text-muted-foreground/50 hover:text-destructive shrink-0"
                @click="builder.removeCondition(cond.id)"
              >
                <X class="h-3 w-3" />
              </button>
            </div>
          </div>

          <!-- ORDER BY -->
          <div class="border-b border-border">
            <div class="flex items-center justify-between px-3 py-1.5 bg-muted/30">
              <span class="text-xs font-medium flex items-center gap-1">
                <ArrowUpDown class="h-3.5 w-3.5" /> ORDER BY
              </span>
              <button
                class="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
                @click="builder.addOrderBy()"
              >
                <Plus class="h-3.5 w-3.5" />
              </button>
            </div>
            <div v-if="builder.state.value.orderBy.length === 0" class="px-3 py-2 text-[10px] text-muted-foreground/50">
              {{ t('sqlBuilder.noOrderBy') }}
            </div>
            <div
              v-for="ob in builder.state.value.orderBy" :key="ob.id"
              class="flex items-center gap-1 px-2 py-1 text-[11px] border-b border-border/30 last:border-0"
            >
              <select
                :value="`${ob.tableAlias}.${ob.column}`"
                class="flex-1 min-w-[80px] px-1 py-0.5 rounded border border-border bg-background text-[10px] font-mono"
                @change="(e: Event) => {
                  const v = (e.target as HTMLSelectElement).value.split('.')
                  builder.updateOrderBy(ob.id, { tableAlias: v[0], column: v[1] })
                }"
              >
                <option
                  v-for="col in builder.allColumns.value" :key="`${col.alias}.${col.column}`"
                  :value="`${col.alias}.${col.column}`"
                >
                  {{ col.alias }}.{{ col.column }}
                </option>
              </select>
              <select
                :value="ob.direction"
                class="w-16 px-1 py-0.5 rounded border border-border bg-background text-[10px]"
                @change="builder.updateOrderBy(ob.id, { direction: ($event.target as HTMLSelectElement).value as 'ASC' | 'DESC' })"
              >
                <option>ASC</option>
                <option>DESC</option>
              </select>
              <button
                class="p-0.5 text-muted-foreground/50 hover:text-destructive shrink-0"
                @click="builder.removeOrderBy(ob.id)"
              >
                <X class="h-3 w-3" />
              </button>
            </div>
          </div>

          <!-- LIMIT / DISTINCT -->
          <div class="px-3 py-2 space-y-2">
            <div class="flex items-center gap-2">
              <label class="text-[10px] text-muted-foreground shrink-0">LIMIT</label>
              <input
                type="number"
                :value="builder.state.value.limit ?? ''"
                class="flex-1 px-1.5 py-0.5 rounded border border-border bg-background text-[10px]"
                placeholder="无限制"
                min="0"
                @input="builder.setLimit(($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null)"
              />
            </div>
            <label class="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                :checked="builder.state.value.distinct"
                class="rounded"
                @change="builder.setDistinct(($event.target as HTMLInputElement).checked)"
              />
              DISTINCT
            </label>
          </div>
        </div>
      </Pane>
    </Splitpanes>

    <!-- 底部：SQL 预览 -->
    <div class="border-t border-border bg-muted/10">
      <div class="flex items-center justify-between px-3 py-1 border-b border-border/50">
        <span class="text-xs font-medium">{{ t('sqlBuilder.generatedSql') }}</span>
        <div class="flex items-center gap-1">
          <button
            class="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/50"
            :disabled="!builder.generatedSql.value"
            @click="copySql"
          >
            <Copy class="h-3 w-3" /> {{ t('sqlBuilder.copySql') }}
          </button>
          <button
            class="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-primary/10 text-primary hover:bg-primary/20"
            :disabled="!builder.generatedSql.value"
            @click="executeInQuery"
          >
            <Play class="h-3 w-3" /> {{ t('sqlBuilder.executeInQuery') }}
          </button>
        </div>
      </div>
      <div class="h-[120px]">
        <SqlEditorLazy
          :model-value="builder.generatedSql.value"
          :read-only="true"
          language="sql"
        />
      </div>
    </div>
  </div>
</template>
