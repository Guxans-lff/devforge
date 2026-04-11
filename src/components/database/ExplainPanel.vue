<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  X, AlertTriangle, CheckCircle, AlertCircle, ChevronDown, ChevronRight,
  Zap, Table2, Search, Clock, Info, Save,
} from 'lucide-vue-next'
import { setAppStateJson } from '@/api/app-state'
import { useMessage } from '@/stores/message-center'
import { isMysqlExplain, isExplainError, isExplainRaw, isPgExplain } from '@/types/explain'
import type { MysqlQueryBlock, PgPlanNode } from '@/types/explain'

const props = defineProps<{
  result: Record<string, unknown> | null
  tableRows: Record<string, unknown>[] | null
  loading: boolean
  /** 关联的 SQL（用于保存计划时标识） */
  sql?: string
  connectionId?: string
  database?: string
}>()

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const message = useMessage()

interface ExplainNode {
  id: string
  type: string
  table: string | null
  rows: number | null
  filteredPct: number | null
  cost: number | null
  key: string | null
  possibleKeys: string[] | null
  keyLen: string | null
  extra: string | null
  ref: string | null
  selectType: string | null
  children: ExplainNode[]
  level: 'good' | 'warn' | 'bad'
  warnings: string[]
}

let nodeCounter = 0

// ---- MySQL 解析 ----
function parseMysqlExplain(data: Record<string, unknown>): ExplainNode[] {
  nodeCounter = 0
  if (!isMysqlExplain(data)) return []
  return [parseMysqlNode(data.query_block)]
}

function parseMysqlNode(block: MysqlQueryBlock): ExplainNode {
  const id = `node-${nodeCounter++}`
  const tbl = block?.table ?? {}
  const table = tbl?.table_name ?? block?.table_name ?? null
  const accessType = tbl?.access_type ?? block?.access_type ?? ''
  const rows = tbl?.rows_examined_per_scan ?? block?.rows_examined_per_scan ?? null
  const filteredPct = tbl?.filtered != null ? parseFloat(String(tbl.filtered)) : null
  const costStr = tbl?.cost_info?.read_cost ?? tbl?.cost_info?.eval_cost ?? block?.cost_info?.query_cost
  const cost = costStr ? parseFloat(String(costStr)) : null
  const key = tbl?.key ?? block?.key ?? null
  const possibleKeysRaw = tbl?.possible_keys ?? block?.possible_keys ?? null
  const possibleKeys = possibleKeysRaw ? (Array.isArray(possibleKeysRaw) ? possibleKeysRaw : [possibleKeysRaw]) : null
  const keyLen = tbl?.key_length != null ? String(tbl.key_length) : null
  const extra = block?.message ?? null
  const refVal = tbl?.ref != null ? (Array.isArray(tbl.ref) ? tbl.ref.join(',') : tbl.ref) : null
  const selectType = block?.select_type ?? null

  // 判断性能等级
  let level: 'good' | 'warn' | 'bad' = 'good'
  if (accessType === 'ALL' || accessType === 'index') level = 'bad'
  else if (accessType === 'range' || accessType === 'index_merge') level = 'warn'

  // 生成警告
  const warnings: string[] = []
  if (accessType === 'ALL') warnings.push(t('explain.warnFullScan'))
  if (accessType === 'index') warnings.push(t('explain.warnIndexScan'))
  if (rows != null && rows > 10000) warnings.push(t('explain.warnHighRows', { rows: rows.toLocaleString() }))
  if (filteredPct != null && filteredPct < 20) warnings.push(t('explain.warnLowFiltered', { pct: filteredPct }))
  if (possibleKeys && possibleKeys.length > 0 && !key) warnings.push(t('explain.warnNoKeyUsed'))

  const children: ExplainNode[] = []
  if (block?.nested_loop) {
    for (const item of block.nested_loop) {
      children.push(parseMysqlNode(item))
    }
  }
  if (block?.ordering_operation) {
    children.push(parseMysqlNode(block.ordering_operation))
  }
  if (block?.grouping_operation) {
    children.push(parseMysqlNode(block.grouping_operation))
  }
  if (block?.duplicates_removal) {
    children.push(parseMysqlNode(block.duplicates_removal))
  }
  if (block?.subqueries) {
    for (const sub of block.subqueries) {
      children.push(parseMysqlNode(sub))
    }
  }

  return {
    id, type: accessType || (block?.ordering_operation ? 'ORDER' : block?.grouping_operation ? 'GROUP' : 'QUERY'),
    table, rows, filteredPct, cost, key, possibleKeys, keyLen, extra, ref: refVal, selectType,
    children, level, warnings,
  }
}

// ---- PostgreSQL 解析 ----
function parsePgNode(plan: PgPlanNode, idx: number): ExplainNode {
  const id = `pg-${nodeCounter++}-${idx}`
  const nodeType = plan?.['Node Type'] ?? 'Unknown'
  const table = plan?.['Relation Name'] ?? null
  const rows = plan?.['Actual Rows'] ?? plan?.['Plan Rows'] ?? null
  const cost = plan?.['Total Cost'] ?? null
  const key = plan?.['Index Name'] ?? null
  const filteredPct = plan?.['Rows Removed by Filter'] != null && rows
    ? Math.round((rows / (rows + plan['Rows Removed by Filter'])) * 100)
    : null

  let level: 'good' | 'warn' | 'bad' = 'good'
  if (nodeType.includes('Seq Scan')) level = 'bad'
  else if (nodeType.includes('Index Scan') || nodeType.includes('Index Only Scan')) level = 'good'
  else if (nodeType.includes('Bitmap')) level = 'warn'

  const warnings: string[] = []
  if (nodeType.includes('Seq Scan')) warnings.push(t('explain.warnFullScan'))
  if (rows != null && rows > 10000) warnings.push(t('explain.warnHighRows', { rows: rows.toLocaleString() }))

  const children = (plan?.Plans ?? []).map((p: PgPlanNode, i: number) => parsePgNode(p, i))

  return {
    id, type: nodeType, table, rows, filteredPct, cost, key,
    possibleKeys: null, keyLen: null, extra: null, ref: null, selectType: null,
    children, level, warnings,
  }
}

// ---- 计算属性 ----
const nodes = computed<ExplainNode[]>(() => {
  if (!props.result) return []
  if (isExplainError(props.result)) return []
  if (isExplainRaw(props.result)) return []

  if (isMysqlExplain(props.result)) {
    return parseMysqlExplain(props.result)
  }
  if (isPgExplain(props.result)) {
    nodeCounter = 0
    return props.result.map((plan, i: number) => {
      const pgPlan = plan.Plan ?? (plan as unknown as PgPlanNode)
      return parsePgNode(pgPlan, i)
    })
  }
  return []
})

const fallbackJson = computed(() => {
  if (!props.result) return null
  if (isExplainError(props.result)) return null
  if (isExplainRaw(props.result)) return null
  if (nodes.value.length > 0) return null
  try {
    return JSON.stringify(props.result, null, 2)
  } catch {
    return null
  }
})

const errorMessage = computed(() => {
  if (!props.result) return null
  return isExplainError(props.result) ? props.result.error : null
})

const rawText = computed(() => {
  if (!props.result) return null
  return isExplainRaw(props.result) ? props.result.raw : null
})

// ---- 汇总统计 ----
interface ExplainSummary {
  totalCost: number | null
  totalRows: number
  tableCount: number
  fullScanCount: number
  indexUsedCount: number
  warnings: string[]
}

function collectStats(nodeList: ExplainNode[]): ExplainSummary {
  let totalRows = 0
  let tableCount = 0
  let fullScanCount = 0
  let indexUsedCount = 0
  const allWarnings: string[] = []

  function walk(n: ExplainNode) {
    if (n.table) {
      tableCount++
      if (n.rows != null) totalRows += n.rows
      if (n.type === 'ALL' || n.type === 'index') fullScanCount++
      if (n.key) indexUsedCount++
    }
    allWarnings.push(...n.warnings)
    n.children.forEach(walk)
  }
  nodeList.forEach(walk)

  // 总成本取根节点
  const rootCost = isMysqlExplain(props.result) && props.result.query_block.cost_info?.query_cost
    ? parseFloat(props.result.query_block.cost_info.query_cost)
    : nodeList[0]?.cost ?? null

  return { totalCost: rootCost, totalRows, tableCount, fullScanCount, indexUsedCount, warnings: allWarnings }
}

const summary = computed<ExplainSummary | null>(() => {
  if (nodes.value.length === 0) return null
  return collectStats(nodes.value)
})

// 展开/折叠节点详情
const expandedNodes = ref<Set<string>>(new Set())
function toggleNode(id: string) {
  if (expandedNodes.value.has(id)) {
    expandedNodes.value.delete(id)
  } else {
    expandedNodes.value.add(id)
  }
}

// 视图切换
const viewMode = ref<'tree' | 'table' | 'json'>('tree')
const formattedJson = computed(() => {
  if (!props.result) return ''
  try {
    return JSON.stringify(props.result, null, 2)
  } catch {
    return ''
  }
})

// ---- 表格视图相关 ----
/** EXPLAIN 表格视图的标准列名 */
const tableColumns = ['id', 'select_type', 'table', 'type', 'possible_keys', 'key', 'key_len', 'ref', 'rows', 'filtered', 'Extra']

/** 根据行数据返回单元格的警告样式类 */
function getCellWarningClass(row: Record<string, unknown>, colName: string): string {
  // type=ALL 全表扫描 → 红色
  if (colName === 'type' && String(row['type'] ?? '').toUpperCase() === 'ALL') {
    return 'bg-destructive/10 text-destructive'
  }
  // Extra 中包含 Using filesort 或 Using temporary → 黄色
  if (colName === 'Extra') {
    const extra = String(row['Extra'] ?? row['extra'] ?? '')
    if (extra.includes('Using filesort') || extra.includes('Using temporary')) {
      return 'bg-df-warning/10 text-df-warning'
    }
  }
  return ''
}

/** 获取行数据中某列的值（兼容大小写） */
function getRowValue(row: Record<string, unknown>, colName: string): string {
  const val = row[colName] ?? row[colName.toLowerCase()] ?? null
  return val === null || val === undefined ? 'NULL' : String(val)
}

/** 保存当前执行计划到 KV 存储 */
const savingPlan = ref(false)
async function saveExplainPlan() {
  if (!props.result || savingPlan.value) return
  savingPlan.value = true
  try {
    const id = `explain_plan:${Date.now()}`
    const plan = {
      id,
      sql: props.sql ?? '(unknown)',
      connectionId: props.connectionId ?? '',
      database: props.database ?? '',
      result: props.result,
      tableRows: props.tableRows,
      summary: summary.value,
      savedAt: new Date().toISOString(),
    }
    await setAppStateJson(id, plan)
    message.success('执行计划已保存，可在"计划对比"中使用')
  } catch (e) {
    message.error('保存失败: ' + e)
  } finally {
    savingPlan.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <!-- 标题栏 -->
    <div class="flex items-center justify-between border-b border-border px-3 py-1.5">
      <div class="flex items-center gap-2">
        <Zap class="h-3.5 w-3.5 text-df-warning" />
        <span class="text-xs font-medium">{{ t('explain.title') }}</span>
        <!-- 视图切换 -->
        <div v-if="nodes.length > 0 || (tableRows && tableRows.length > 0)" class="flex items-center gap-0.5 ml-2 rounded-md border border-border p-0.5">
          <button
            class="px-1.5 py-0.5 text-[10px] rounded transition-colors"
            :class="viewMode === 'tree' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="viewMode = 'tree'"
          >
            {{ t('explain.viewTree') }}
          </button>
          <button
            class="px-1.5 py-0.5 text-[10px] rounded transition-colors"
            :class="viewMode === 'table' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="viewMode = 'table'"
          >
            {{ t('explain.viewTable', '表格') }}
          </button>
          <button
            class="px-1.5 py-0.5 text-[10px] rounded transition-colors"
            :class="viewMode === 'json' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="viewMode = 'json'"
          >
            JSON
          </button>
        </div>
      </div>
      <div class="flex items-center gap-1">
        <Button
          v-if="nodes.length > 0 || (tableRows && tableRows.length > 0)"
          variant="ghost"
          size="sm"
          class="h-5 gap-1 text-[10px] px-1.5"
          :disabled="savingPlan"
          @click="saveExplainPlan"
        >
          <Save class="h-3 w-3" />
          保存计划
        </Button>
        <Button variant="ghost" size="icon" class="h-5 w-5" @click="$emit('close')">
          <X class="h-3 w-3" />
        </Button>
      </div>
    </div>

    <ScrollArea class="flex-1 min-h-0">
      <!-- 加载中 -->
      <div v-if="loading" class="flex items-center justify-center py-12">
        <span class="text-xs text-muted-foreground">{{ t('explain.analyzing') }}</span>
      </div>

      <!-- 错误 -->
      <div v-else-if="errorMessage" class="p-4">
        <div class="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
          <AlertCircle class="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <pre class="text-xs text-destructive whitespace-pre-wrap break-all">{{ errorMessage }}</pre>
        </div>
      </div>

      <!-- 原始文本 -->
      <div v-else-if="rawText" class="p-4">
        <pre class="text-xs font-mono whitespace-pre-wrap break-all">{{ rawText }}</pre>
      </div>

      <!-- 执行计划 -->
      <div v-else-if="nodes.length > 0 || (tableRows && tableRows.length > 0)" class="p-3 space-y-3">
        <!-- 汇总统计卡片（仅 tree 视图显示） -->
        <div v-if="summary && viewMode === 'tree'" class="grid grid-cols-4 gap-2">
          <div class="rounded-md border border-border bg-muted/30 px-2.5 py-2">
            <div class="flex items-center gap-1.5 text-muted-foreground mb-1">
              <Clock class="h-3 w-3" />
              <span class="text-[10px]">{{ t('explain.totalCost') }}</span>
            </div>
            <span class="text-sm font-semibold tabular-nums">
              {{ summary.totalCost != null ? summary.totalCost.toFixed(2) : '-' }}
            </span>
          </div>
          <div class="rounded-md border border-border bg-muted/30 px-2.5 py-2">
            <div class="flex items-center gap-1.5 text-muted-foreground mb-1">
              <Search class="h-3 w-3" />
              <span class="text-[10px]">{{ t('explain.scanRows') }}</span>
            </div>
            <span class="text-sm font-semibold tabular-nums">{{ summary.totalRows.toLocaleString() }}</span>
          </div>
          <div class="rounded-md border border-border bg-muted/30 px-2.5 py-2">
            <div class="flex items-center gap-1.5 text-muted-foreground mb-1">
              <Table2 class="h-3 w-3" />
              <span class="text-[10px]">{{ t('explain.tableCount') }}</span>
            </div>
            <span class="text-sm font-semibold tabular-nums">{{ summary.tableCount }}</span>
          </div>
          <div class="rounded-md border border-border px-2.5 py-2"
            :class="summary.fullScanCount > 0 ? 'bg-destructive/5 border-destructive/20' : 'bg-df-success/5 border-df-success/20'"
          >
            <div class="flex items-center gap-1.5 mb-1"
              :class="summary.fullScanCount > 0 ? 'text-destructive' : 'text-df-success'"
            >
              <Zap class="h-3 w-3" />
              <span class="text-[10px]">{{ t('explain.indexUsage') }}</span>
            </div>
            <span class="text-sm font-semibold tabular-nums"
              :class="summary.fullScanCount > 0 ? 'text-destructive' : 'text-df-success'"
            >
              {{ summary.indexUsedCount }}/{{ summary.tableCount }}
            </span>
          </div>
        </div>

        <!-- 优化建议（仅 tree 视图显示） -->
        <div v-if="summary && summary.warnings.length > 0 && viewMode === 'tree'" class="rounded-md border border-df-warning/30 bg-df-warning/5 px-3 py-2">
          <div class="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle class="h-3.5 w-3.5 text-df-warning" />
            <span class="text-xs font-medium text-df-warning">{{ t('explain.suggestions') }}</span>
          </div>
          <ul class="space-y-0.5">
            <li v-for="(w, i) in summary.warnings" :key="i" class="text-[11px] text-df-warning pl-5">
              • {{ w }}
            </li>
          </ul>
        </div>

        <!-- 树形视图 -->
        <div v-if="viewMode === 'tree'" class="space-y-1">
          <template v-for="node in nodes" :key="node.id">
            <ExplainNodeItem :node="node" :depth="0" :expanded-nodes="expandedNodes" @toggle="toggleNode" />
          </template>
        </div>

        <!-- 表格视图 -->
        <div v-else-if="viewMode === 'table'">
          <div v-if="tableRows && tableRows.length > 0" class="overflow-x-auto">
            <table class="w-full text-xs font-mono border-collapse">
              <thead>
                <tr>
                  <th
                    v-for="col in tableColumns"
                    :key="col"
                    class="px-2 py-1.5 text-left font-semibold text-muted-foreground border border-border bg-muted/30 whitespace-nowrap"
                  >
                    {{ col }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in tableRows" :key="idx" class="hover:bg-muted/20">
                  <td
                    v-for="col in tableColumns"
                    :key="col"
                    class="px-2 py-1 border border-border whitespace-nowrap"
                    :class="getCellWarningClass(row, col)"
                  >
                    {{ getRowValue(row, col) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <!-- 表格数据为空时的提示 -->
          <div v-else class="flex items-center justify-center py-8">
            <span class="text-xs text-muted-foreground">{{ t('explain.noData') }}</span>
          </div>
        </div>

        <!-- JSON 视图 -->
        <div v-else>
          <pre class="text-xs font-mono whitespace-pre-wrap break-all text-foreground bg-muted/30 rounded-md p-3 border border-border">{{ formattedJson }}</pre>
        </div>
      </div>

      <!-- 回退 JSON -->
      <div v-else-if="fallbackJson" class="p-4">
        <pre class="text-xs font-mono whitespace-pre-wrap break-all text-foreground">{{ fallbackJson }}</pre>
      </div>

      <!-- 无数据 -->
      <div v-else class="flex items-center justify-center py-12">
        <span class="text-xs text-muted-foreground">{{ t('explain.noData') }}</span>
      </div>
    </ScrollArea>
  </div>
</template>

<script lang="ts">
import { defineComponent, h, type PropType, type VNode } from 'vue'

interface ExplainNodeType {
  id: string
  type: string
  table: string | null
  rows: number | null
  filteredPct: number | null
  cost: number | null
  key: string | null
  possibleKeys: string[] | null
  keyLen: string | null
  extra: string | null
  ref: string | null
  selectType: string | null
  children: ExplainNodeType[]
  level: 'good' | 'warn' | 'bad'
  warnings: string[]
}

const ExplainNodeItem = defineComponent({
  name: 'ExplainNodeItem',
  props: {
    node: { type: Object as PropType<ExplainNodeType>, required: true },
    depth: { type: Number, default: 0 },
    expandedNodes: { type: Object as PropType<Set<string>>, required: true },
  },
  emits: ['toggle'],
  setup(props, { emit }) {
    return () => {
      const n = props.node as ExplainNodeType
      const indent = `${props.depth * 16 + 4}px`
      const isExpanded = props.expandedNodes.has(n.id)
      const hasDetails = !!(n.possibleKeys?.length || n.keyLen || n.ref || n.filteredPct != null || n.extra || n.warnings.length)

      const levelColors: Record<string, string> = {
        good: 'text-df-success',
        warn: 'text-df-warning',
        bad: 'text-destructive',
      }
      const levelBg: Record<string, string> = {
        good: 'bg-df-success/10 border-df-success/20',
        warn: 'bg-df-warning/10 border-df-warning/20',
        bad: 'bg-destructive/10 border-destructive/20',
      }
      const icon = n.level === 'bad' ? AlertTriangle : n.level === 'warn' ? AlertCircle : CheckCircle

      const elements: VNode[] = []

      // 主行
      const mainRowChildren: VNode[] = [
        h(icon, { class: `h-3.5 w-3.5 shrink-0 ${levelColors[n.level]}` }),
        // 访问类型 badge
        h('span', {
          class: `px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${levelBg[n.level]} border`,
        }, n.type || 'QUERY'),
      ]

      if (n.table) {
        mainRowChildren.push(h('span', { class: 'font-medium text-foreground' }, n.table))
      }
      if (n.key) {
        mainRowChildren.push(
          h('span', { class: 'flex items-center gap-0.5 text-primary' }, [
            h('span', { class: 'text-[10px]' }, 'KEY:'),
            h('span', {}, n.key),
          ])
        )
      } else if (n.table && n.type === 'ALL') {
        mainRowChildren.push(
          h('span', { class: 'text-destructive text-[10px]' }, 'NO INDEX')
        )
      }

      // 右侧数据
      const rightItems: VNode[] = []
      if (n.rows != null) {
        rightItems.push(h('span', { class: 'tabular-nums' }, `${n.rows.toLocaleString()} rows`))
      }
      if (n.filteredPct != null) {
        const fClass = n.filteredPct < 20 ? 'text-destructive' : n.filteredPct < 50 ? 'text-df-warning' : 'text-muted-foreground'
        rightItems.push(h('span', { class: `tabular-nums ${fClass}` }, `${n.filteredPct}%`))
      }
      if (n.cost != null) {
        rightItems.push(h('span', { class: 'tabular-nums' }, `cost ${n.cost.toFixed(2)}`))
      }
      if (rightItems.length > 0) {
        mainRowChildren.push(
          h('span', { class: 'ml-auto flex items-center gap-2 text-muted-foreground' }, rightItems)
        )
      }

      // 展开按钮
      if (hasDetails) {
        mainRowChildren.push(
          h('button', {
            class: 'ml-1 p-0.5 rounded hover:bg-muted/50 text-muted-foreground',
            onClick: (e: Event) => { e.stopPropagation(); emit('toggle', n.id) },
          }, [
            h(isExpanded ? ChevronDown : ChevronRight, { class: 'h-3 w-3' }),
          ])
        )
      }

      elements.push(
        h('div', {
          class: `flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs cursor-pointer hover:bg-muted/30 transition-colors ${levelBg[n.level]}`,
          style: { marginLeft: indent },
          onClick: () => { if (hasDetails) emit('toggle', n.id) },
        }, mainRowChildren)
      )

      // 展开的详情区域
      if (isExpanded && hasDetails) {
        const detailItems: VNode[] = []

        if (n.possibleKeys?.length) {
          detailItems.push(
            h('div', { class: 'flex items-start gap-2' }, [
              h('span', { class: 'text-muted-foreground shrink-0 w-24' }, 'Possible Keys:'),
              h('span', { class: 'text-foreground' }, n.possibleKeys.join(', ')),
            ])
          )
        }
        if (n.key && n.keyLen) {
          detailItems.push(
            h('div', { class: 'flex items-start gap-2' }, [
              h('span', { class: 'text-muted-foreground shrink-0 w-24' }, 'Key Length:'),
              h('span', { class: 'text-foreground' }, n.keyLen),
            ])
          )
        }
        if (n.ref) {
          detailItems.push(
            h('div', { class: 'flex items-start gap-2' }, [
              h('span', { class: 'text-muted-foreground shrink-0 w-24' }, 'Ref:'),
              h('span', { class: 'text-foreground' }, Array.isArray(n.ref) ? n.ref.join(', ') : n.ref),
            ])
          )
        }
        if (n.filteredPct != null) {
          detailItems.push(
            h('div', { class: 'flex items-start gap-2' }, [
              h('span', { class: 'text-muted-foreground shrink-0 w-24' }, 'Filtered:'),
              h('span', {
                class: n.filteredPct < 20 ? 'text-destructive' : n.filteredPct < 50 ? 'text-df-warning' : 'text-foreground',
              }, `${n.filteredPct}% of rows match filter`),
            ])
          )
        }
        if (n.extra) {
          detailItems.push(
            h('div', { class: 'flex items-start gap-2' }, [
              h('span', { class: 'text-muted-foreground shrink-0 w-24' }, 'Extra:'),
              h('span', { class: 'text-foreground' }, n.extra),
            ])
          )
        }
        if (n.warnings.length > 0) {
          detailItems.push(
            h('div', { class: 'flex items-start gap-2 mt-1 pt-1 border-t border-df-warning/20' }, [
              h(Info, { class: 'h-3 w-3 text-df-warning shrink-0 mt-0.5' }),
              h('div', { class: 'space-y-0.5' },
                n.warnings.map((w, i) => h('div', { key: i, class: 'text-df-warning' }, w))
              ),
            ])
          )
        }

        elements.push(
          h('div', {
            class: 'rounded-md border border-border bg-muted/20 px-3 py-2 text-[11px] space-y-1.5',
            style: { marginLeft: `${props.depth * 16 + 20}px` },
          }, detailItems)
        )
      }

      // 子节点
      if (n.children?.length) {
        for (const child of n.children) {
          elements.push(h(ExplainNodeItem, {
            node: child,
            depth: props.depth + 1,
            expandedNodes: props.expandedNodes,
            onToggle: (id: string) => emit('toggle', id),
          }))
        }
      }

      return h('div', { class: 'space-y-1' }, elements)
    }
  },
})
</script>
