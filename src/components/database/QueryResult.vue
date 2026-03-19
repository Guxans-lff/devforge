<script setup lang="ts">
/**
 * 查询结果面板 — 薄编排层
 * 业务逻辑全部委托给 useQueryResult composable
 */
import { ref, toRef, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { FlexRender } from '@tanstack/vue-table'
import {
  ArrowUpDown, ArrowUp, ArrowDown, Clock, AlertCircle, CheckCircle2,
  Hash, Download, Trash2, Filter, ShieldAlert, WifiOff, KeyRound, Eye,
  Loader2, RotateCcw, Activity,
  Table as TableIcon,
  BarChart3,
  Settings2,
  Pin, PinOff,
} from 'lucide-vue-next'
import type { QueryResult as QueryResultType } from '@/types/database'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu'
import ExportDialog from '@/components/database/ExportDialog.vue'
import RowDetailSheet from '@/components/database/RowDetailSheet.vue'
import ColumnStatsBar from '@/components/database/ColumnStatsBar.vue'
import { useQueryResult } from '@/composables/useQueryResult'

/** 懒加载图表面板 */
const ChartPanel = defineAsyncComponent(() => import('@/components/database/chart/ChartPanel.vue'))

/** 自动聚焦并全选指令：解决虚拟列表中 autofocus 被浏览器拦截的问题，同时全选文本以支持直接粘贴覆盖 */
const vFocus = {
  mounted: (el: HTMLElement) => {
    el.focus()
    if (el instanceof HTMLInputElement) {
      el.select()
    }
  }
}

const props = defineProps<{
  result: QueryResultType | null
  loading?: boolean
  loadingMore?: boolean
  hasMoreServerRows?: boolean
  showReconnect?: boolean
  connectionId?: string
  database?: string
  tableName?: string
  driver?: string
  isTableBrowse?: boolean
}>()

const emit = defineEmits<{
  reconnect: []
  loadMore: []
  refresh: []
  serverFilter: [whereClause: string]
  serverSort: [orderBy: string]
}>()

const { t } = useI18n()
const tableScrollRef = ref<HTMLDivElement | null>(null)

// ── 共享右键菜单状态（避免每行创建 ContextMenu 实例）──
const ctxRowIndex = ref<number | null>(null)
const ctxMenuOpen = ref(false)
const ctxMenuStyle = ref({ left: '0px', top: '0px' })

function handleRowContextMenu(e: MouseEvent, rowIndex: number) {
  e.preventDefault()
  ctxRowIndex.value = rowIndex
  ctxMenuStyle.value = { left: `${e.clientX}px`, top: `${e.clientY}px` }
  ctxMenuOpen.value = true
}

function closeCtxMenu() {
  ctxMenuOpen.value = false
}

const qr = useQueryResult({
  result: toRef(props, 'result'),
  loading: toRef(props, 'loading') as any,
  loadingMore: toRef(props, 'loadingMore') as any,
  hasMoreServerRows: toRef(props, 'hasMoreServerRows') as any,
  showReconnect: toRef(props, 'showReconnect') as any,
  connectionId: toRef(props, 'connectionId'),
  database: toRef(props, 'database'),
  tableName: toRef(props, 'tableName'),
  driver: toRef(props, 'driver'),
  isTableBrowse: toRef(props, 'isTableBrowse') as any,
  tableScrollRef,
  onReconnect: () => emit('reconnect'),
  onLoadMore: () => emit('loadMore'),
  onRefresh: () => emit('refresh'),
  onServerFilter: (where: string) => emit('serverFilter', where),
  onServerSort: (orderBy: string) => emit('serverSort', orderBy),
})

/** 控制图表侧边配置面板开关 */
const chartConfigOpen = ref(false)
</script>

<template>
  <!-- 架构级 Grid 布局：严格隔离各功能板块 -->
  <div class="flex h-full flex-col overflow-hidden bg-background">
    
    <!-- 状态栏 (Flex 子项) -->
    <div
      class="flex h-[32px] items-center gap-6 border-b border-border bg-muted/20 px-4 text-[11px] text-muted-foreground shrink-0"
    >
      <template v-if="loading">
        <div class="flex items-center gap-2 text-primary animate-pulse">
          <Loader2 class="h-3.5 w-3.5 animate-spin" />
          <span class="font-medium tracking-tight">{{ t('database.executing') }}</span>
        </div>
      </template>
      <template v-else-if="result">
        <template v-if="result.isError" />
        <template v-else>
          <div class="flex items-center gap-1.5 hover:text-foreground transition-colors">
            <CheckCircle2 class="h-3.5 w-3.5 text-green-500" />
            <span v-if="result.columns.length > 0" class="font-medium tracking-tight tabular-nums">
              {{ result.rows.length }} <span class="opacity-60">{{ t('database.rows') }}</span>
            </span>
            <span v-else-if="result.multiStatementSummary" class="font-medium tracking-tight">
              {{ result.multiStatementSummary.success }}/{{ result.multiStatementSummary.total }} <span class="opacity-60">条成功</span>
            </span>
            <span v-else-if="result.affectedRows > 0" class="font-medium tracking-tight">
              {{ result.affectedRows }} <span class="opacity-60">{{ t('database.rowsAffected') }}</span>
            </span>
            <span v-else class="font-medium tracking-tight">
              {{ t('database.executeSuccess') }}
            </span>
          </div>
          <div class="flex items-center gap-1.5 hover:text-foreground transition-colors">
            <Clock class="h-3.5 w-3.5 opacity-60" />
            <span class="font-medium tracking-tight tabular-nums">{{ result.executionTimeMs }}<span class="text-[10px] opacity-60">ms</span></span>
          </div>
          <div v-if="result.columns.length > 0" class="flex items-center gap-1.5 hover:text-foreground transition-colors">
            <Hash class="h-3.5 w-3.5 opacity-60" />
            <span class="font-medium tracking-tight tabular-nums">{{ result.columns.length }} <span class="opacity-60">{{ t('database.columns') }}</span></span>
          </div>
          <div class="flex-1" />
          <div class="flex items-center gap-1">
            <div class="flex items-center bg-muted/40 rounded-lg p-0.5 border border-border/50">
              <button
                class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-all"
                :class="!qr.showChart.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
                @click="qr.showChart.value = false"
              >
                <TableIcon class="h-3 w-3" />
                表格数据
              </button>
              <button
                class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-all"
                :class="qr.showChart.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
                @click="qr.showChart.value = true"
              >
                <BarChart3 class="h-3 w-3" />
                可视化分析
              </button>
            </div>
            
            <Button
              v-if="qr.showChart.value"
              variant="ghost" size="sm"
              class="h-6 gap-1.5 text-[10px] px-2 hover:bg-muted/50 rounded-md transition-all active:scale-95 ml-1"
              @click="chartConfigOpen = true"
            >
              <Settings2 class="h-3 w-3" />
              配置图表
            </Button>
            <div class="w-px h-3 bg-border/50 mx-1" />
            <Button
              variant="ghost" size="sm"
              class="h-6 gap-1.5 text-[10px] px-2 hover:bg-muted/50 rounded-md transition-all active:scale-95"
              :class="{ 'text-primary bg-primary/10': qr.showFilters.value }"
              @click="qr.toggleFilters()"
            >
              <Filter class="h-3 w-3" />
              {{ t('database.filter') }}
            </Button>
            <div class="w-px h-3 bg-border/50 mx-1" />
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="sm" class="h-6 gap-1.5 text-[10px] px-2 hover:bg-muted/50 rounded-md transition-all active:scale-95">
                  <Download class="h-3 w-3" />
                  {{ t('database.export') }}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="min-w-[140px]">
                <DropdownMenuItem @click="qr.handleExport('csv')">CSV</DropdownMenuItem>
                <DropdownMenuItem @click="qr.handleExport('json')">JSON</DropdownMenuItem>
                <DropdownMenuItem @click="qr.handleExport('sql')">SQL脚本</DropdownMenuItem>
                <DropdownMenuItem @click="qr.handleExport('markdown')">Markdown</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem v-if="connectionId" @click="qr.exportDialogOpen.value = true" class="font-medium text-primary">多格式高级导出...</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </template>
      </template>
      <template v-else>
        <span class="opacity-50 italic">{{ t('database.ready') }}</span>
      </template>
    </div>

    <!-- 主体内容 (自适应高度) -->
    <div class="relative flex-1 min-h-0 flex flex-col overflow-hidden bg-background/30">
      <!-- 视图 1: 经典表格 -->
      <div v-show="!qr.showChart.value" ref="tableScrollRef" class="qr-scroll-area relative flex-1 min-h-0 overflow-auto">
      <div
        v-if="result && !result.isError && result.columns.length > 0"
        class="text-sm min-w-full inline-block align-top"
        :style="{ width: 'max-content' }"
      >
        <!-- Header -->
        <div class="sticky top-0 z-10 bg-muted">
          <div class="w-full" :style="qr.gridStyle.value">
            <div class="whitespace-nowrap border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-muted-foreground sticky left-0 z-20 bg-muted">
              #
            </div>
            <ContextMenu v-for="header in qr.table.getFlatHeaders()" :key="'hctx-' + header.id">
              <ContextMenuTrigger as-child>
                <div
                  class="group/header relative select-none whitespace-nowrap border-b border-r border-border px-3 py-1.5 text-left text-xs font-bold text-muted-foreground/80 hover:bg-muted/50 transition-colors"
                  :class="{
                    'bg-primary/5 text-primary': qr.selectedStatsColumn.value === header.column.id,
                    'sticky z-20 bg-muted': qr.isColumnPinned(header.column.id),
                  }"
                  :style="qr.isColumnPinned(header.column.id) ? { left: qr.pinnedColumnOffsets.value[header.column.id] + 'px' } : undefined"
                >
                  <div
                    class="flex items-center gap-1 cursor-pointer"
                    @click="isTableBrowse ? qr.handleHeaderClick(header.column.id) : header.column.getToggleSortingHandler()?.($event)"
                  >
                    <Pin v-if="qr.isColumnPinned(header.column.id)" class="h-2.5 w-2.5 text-primary/50 shrink-0" />
                    <FlexRender :render="header.column.columnDef.header" :props="header.getContext()" />
                    <template v-if="isTableBrowse">
                      <ArrowUp v-if="qr.serverSortCol.value === header.column.id && qr.serverSortDir.value === 'ASC'" class="h-3 w-3 text-primary" />
                      <ArrowDown v-else-if="qr.serverSortCol.value === header.column.id && qr.serverSortDir.value === 'DESC'" class="h-3 w-3 text-primary" />
                      <ArrowUpDown v-else class="h-3 w-3 opacity-0 group-hover/header:opacity-30" />
                    </template>
                    <template v-else>
                      <ArrowUp v-if="header.column.getIsSorted() === 'asc'" class="h-3 w-3 text-primary" />
                      <ArrowDown v-else-if="header.column.getIsSorted() === 'desc'" class="h-3 w-3 text-primary" />
                      <ArrowUpDown v-else class="h-3 w-3 opacity-0 group-hover/header:opacity-30" />
                    </template>
                  </div>
                  <div
                    v-if="header.column.getCanResize()"
                    class="absolute right-0 top-0 h-full w-1 cursor-col-resize user-select-none touch-none hover:bg-primary/50 transition-colors"
                    :class="{ 'bg-primary w-0.5 opacity-100': header.column.getIsResizing() }"
                    @mousedown="header.getResizeHandler()($event)"
                    @touchstart="header.getResizeHandler()($event)"
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent class="w-44">
                <ContextMenuItem class="gap-2 text-xs" @click="qr.triggerColumnStats(header.column.id)">
                  <Activity class="h-3.5 w-3.5" />
                  列统计
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem v-if="!qr.isColumnPinned(header.column.id)" class="gap-2 text-xs" @click="qr.pinColumnLeft(header.column.id)">
                  <Pin class="h-3.5 w-3.5" />
                  固定到左侧
                </ContextMenuItem>
                <ContextMenuItem v-else class="gap-2 text-xs" @click="qr.unpinColumn(header.column.id)">
                  <PinOff class="h-3.5 w-3.5" />
                  取消固定
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            <div
              v-if="qr.editable.value"
              class="whitespace-nowrap border-b border-r border-border px-1 py-1.5 text-center text-xs font-medium text-muted-foreground"
            />
          </div>
          <div v-if="qr.showFilters.value" class="flex" :style="qr.gridStyle.value">
            <div class="border-b border-r border-border px-1 py-0.5 sticky left-0 z-20 bg-muted/80" />
            <div
              v-for="header in qr.table.getFlatHeaders()"
              :key="'filter-' + header.id"
              class="border-b border-r border-border px-1 py-0.5"
              :class="{
                'sticky z-20 bg-muted/80': qr.isColumnPinned(header.column.id),
              }"
              :style="qr.isColumnPinned(header.column.id) ? { left: qr.pinnedColumnOffsets.value[header.column.id] + 'px' } : undefined"
            >
              <div v-if="isTableBrowse" class="flex gap-0.5">
                <select
                  :value="qr.filterOperators.value[header.column.id] || 'LIKE'"
                  class="h-5 w-14 shrink-0 rounded-sm border border-border bg-background text-[9px] outline-none focus:border-primary"
                  @change="qr.handleOperatorChange(header.column.id, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="LIKE">LIKE</option>
                  <option value="=">=</option>
                  <option value="!=">!=</option>
                  <option value=">">&gt;</option>
                  <option value="<">&lt;</option>
                  <option value=">=">>=</option>
                  <option value="<="><=</option>
                  <option value="IN">IN</option>
                  <option value="IS NULL">NULL</option>
                  <option value="IS NOT NULL">!NULL</option>
                </select>
                <input
                  :value="qr.columnFilters.value[header.column.id] ?? ''"
                  :placeholder="t('database.filterPlaceholder')"
                  :disabled="(qr.filterOperators.value[header.column.id] === 'IS NULL' || qr.filterOperators.value[header.column.id] === 'IS NOT NULL')"
                  class="h-5 min-w-0 flex-1 rounded-sm border border-border bg-background px-1 text-[10px] outline-none focus:border-primary disabled:opacity-40"
                  @input="qr.handleFilterChange(header.column.id, ($event.target as HTMLInputElement).value)"
                />
              </div>
              <input
                v-else
                :value="qr.columnFilters.value[header.column.id] ?? ''"
                :placeholder="t('database.filterPlaceholder')"
                class="h-5 w-full rounded-sm border border-border bg-background px-1.5 text-[10px] outline-none focus:border-primary"
                @input="qr.columnFilters.value = { ...qr.columnFilters.value, [header.column.id]: ($event.target as HTMLInputElement).value }"
              />
            </div>
            <div v-if="qr.editable.value" class="border-b border-r border-border px-1 py-0.5" />
          </div>
        </div>

        <!-- Virtual Body -->
        <div :style="{ height: `${qr.rowVirtualizer.value.getTotalSize()}px`, position: 'relative' }" style="will-change: transform; contain: content">
          <div
            v-for="vRow in qr.rowVirtualizer.value.getVirtualItems()"
            :key="vRow.index"
            v-memo="[vRow.index, vRow.start, qr.selectedRowIndex.value === vRow.index, qr.editingCell.value?.rowIndex === vRow.index, qr.table.getRowModel().rows[vRow.index]?.id, qr.columnSizingKey.value]"
          >
            <div
              v-if="vRow && qr.table.getRowModel().rows[vRow.index]"
              class="cursor-pointer absolute left-0 right-0 group/row"
              :style="{ ...qr.rowBaseStyle.value, transform: `translateY(${vRow.start}px)` }"
              :class="qr.selectedRowIndex.value === vRow.index ? 'selected-row bg-primary/10' : ''"
              @click="qr.selectedRowIndex.value = vRow.index"
              @contextmenu="handleRowContextMenu($event, vRow.index)"
            >
              <div
                class="whitespace-nowrap border-b border-r border-border px-3 text-[10px] font-bold text-muted-foreground/40 tabular-nums flex items-center justify-center sticky left-0 z-[5]"
                :class="qr.selectedRowIndex.value === vRow.index ? 'bg-primary/10' : 'bg-muted/5 group-hover/row:bg-muted-foreground/10'"
              >
                {{ vRow.index + 1 }}
              </div>
              <div
                v-for="cell in qr.table.getRowModel().rows[vRow.index]?.getVisibleCells()"
                :key="cell.id"
                class="select-text whitespace-nowrap border-b border-r border-border px-3 font-mono text-[12px] flex items-center overflow-hidden"
                :class="{
                  'text-muted-foreground/40 italic font-sans': cell.getValue() === null || cell.getValue() === undefined,
                  'cursor-pointer': !qr.editingCell.value || qr.editingCell.value.rowIndex !== vRow.index || qr.editingCell.value.colName !== cell.column.id,
                  'text-primary font-bold bg-primary/10': qr.selectedRowIndex.value === vRow.index,
                  'group-hover/row:bg-muted-foreground/10': qr.selectedRowIndex.value !== vRow.index,
                  'sticky z-[5]': qr.isColumnPinned(cell.column.id),
                  '!bg-primary/10': qr.isColumnPinned(cell.column.id) && qr.selectedRowIndex.value === vRow.index,
                  'bg-background group-hover/row:!bg-muted-foreground/10': qr.isColumnPinned(cell.column.id) && qr.selectedRowIndex.value !== vRow.index,
                }"
                :style="qr.isColumnPinned(cell.column.id) ? { left: qr.pinnedColumnOffsets.value[cell.column.id] + 'px' } : undefined"
                @click.stop="qr.handleCellClick(cell.getValue())"
                @dblclick="qr.editable.value ? qr.startEdit(vRow.index, cell.column.id, cell.getValue()) : undefined"
              >
                <template v-if="qr.editingCell.value && qr.editingCell.value.rowIndex === vRow.index && qr.editingCell.value.colName === cell.column.id">
                  <input
                    :value="qr.editingValue.value"
                    v-focus
                    class="h-full w-full bg-background px-1 text-xs font-mono outline-none border border-primary rounded-sm"
                    @input="qr.editingValue.value = ($event.target as HTMLInputElement).value"
                    @keydown.enter="qr.saveEdit()"
                    @keydown.escape="qr.cancelEdit()"
                    @blur="qr.saveEdit()"
                  />
                </template>
                <template v-else>
                  <span v-if="cell.getValue() === null || cell.getValue() === undefined">NULL</span>
                  <span v-else>{{ String(cell.getValue()) }}</span>
                </template>
              </div>
              <div
                v-if="qr.editable.value"
                class="border-b border-r border-border flex items-center justify-center"
              >
                <button
                  class="h-5 w-5 flex items-center justify-center rounded-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  :title="t('common.delete')"
                  @click.stop="qr.requestDeleteRow(vRow.index)"
                >
                  <Trash2 class="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Error State (Unified Scroll Container) -->
      <div v-else-if="result && result.isError" class="flex h-full flex-col">
        <div class="flex items-center gap-2 px-4 py-3 border-b border-destructive/20 bg-destructive/5 shrink-0">
          <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
            <ShieldAlert v-if="qr.isConnectionError.value" class="h-4 w-4 text-destructive" />
            <AlertCircle v-else class="h-4 w-4 text-destructive" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold text-destructive">
              {{ qr.isConnectionError.value ? t('database.queryError') : '执行出错' }}
            </p>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <Button v-if="showReconnect" size="sm" class="h-6 text-[10px] gap-1" @click="emit('reconnect')">
              <RotateCcw class="h-3 w-3" />
              {{ t('database.reconnect') }}
            </Button>
            <Button variant="outline" size="sm" class="h-6 text-[10px]" @click="emit('refresh')">
              {{ t('common.retry' as any) || '重试' }}
            </Button>
          </div>
        </div>
        <div class="flex-1 px-4 py-3 overflow-auto">
          <pre class="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/80 select-text">{{ typeof result.error === 'string' ? result.error : (result.error?.message || result.error?.msg || JSON.stringify(result.error, null, 2)) }}</pre>
          <div class="mt-4 space-y-1.5">
            <p class="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2">排查建议</p>
            <template v-if="qr.isConnectionError.value">
              <div class="flex items-start gap-2 text-[11px] text-muted-foreground/70">
                <WifiOff class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span>确保数据库服务地址/端口可达，检查防火墙/白名单</span>
              </div>
              <div class="flex items-start gap-2 text-[11px] text-muted-foreground/70">
                <KeyRound class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span>检查用户名、密码或连接池配置是否正确</span>
              </div>
              <div class="flex items-start gap-2 text-[11px] text-muted-foreground/70">
                <Activity class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span>确认该账号具备从当前 IP 远程连接的权限</span>
              </div>
            </template>
            <template v-else>
              <div class="flex items-start gap-2 text-[11px] text-muted-foreground/70">
                <AlertCircle class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span>检查 SQL 关键字拼写、括号匹配、引号闭合是否正确</span>
              </div>
              <div class="flex items-start gap-2 text-[11px] text-muted-foreground/70">
                <Hash class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span>确认表名、列名、数据库名是否存在且拼写正确</span>
              </div>
              <div class="flex items-start gap-2 text-[11px] text-muted-foreground/70">
                <KeyRound class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span>确认当前用户对目标对象有足够权限，检查是否违反约束</span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else-if="!loading && !result" class="flex h-full items-center justify-center text-muted-foreground">
        <p class="text-sm font-medium tracking-wide">{{ t('database.noResults') }}</p>
      </div>

      <!-- Success state -->
      <div
        v-else-if="!loading && result && !result.isError && result.columns.length === 0"
        class="flex h-full flex-col items-center justify-center text-muted-foreground gap-4 animate-in zoom-in-95 duration-300"
      >
        <div class="rounded-full bg-green-500/10 p-4 shadow-sm">
          <CheckCircle2 class="h-10 w-10 text-green-500" />
        </div>
        <div class="text-center space-y-1.5">
          <p class="text-lg font-bold text-foreground">执行成功</p>
          <p class="text-xs text-muted-foreground/80">
            <template v-if="result.multiStatementSummary">
              <span class="font-medium text-foreground">{{ result.multiStatementSummary.total }}</span> <span class="opacity-80">条语句</span>
              <span class="mx-1 opacity-30">·</span>
              <span class="font-medium text-green-500">{{ result.multiStatementSummary.success }} 成功</span>
              <template v-if="result.multiStatementSummary.fail > 0">
                <span class="mx-1 opacity-30">·</span>
                <span class="font-medium text-red-500">{{ result.multiStatementSummary.fail }} 失败</span>
              </template>
              <span class="mx-2 opacity-30">|</span>
            </template>
            <template v-else-if="result.affectedRows > 0">
              <span class="font-medium text-foreground">{{ result.affectedRows }}</span> <span class="opacity-80">{{ t('database.rowsAffected') }}</span>
              <span class="mx-2 opacity-30">|</span>
            </template>
            <span class="opacity-80">耗时</span> <span class="font-medium text-foreground">{{ result.executionTimeMs }}ms</span>
          </p>
        </div>
      </div>
    </div>

    <!-- 视图 2: 旗舰级图表看板 -->
      <div v-if="qr.showChart.value && result && !result.isError && result.columns.length > 0" class="flex-1 min-h-0 overflow-hidden">
        <ChartPanel :rows="result.rows" :columns="result.columns" v-model:configOpen="chartConfigOpen" />
      </div>
    </div>

    <!-- 底部状态栏 -->
    <div
      v-if="result && !result.isError && result.columns.length > 0"
      class="flex h-[26px] items-center justify-between border-t border-border bg-muted/30 px-3 text-[10px] text-muted-foreground shrink-0"
    >
      <span>
        {{ t('database.showing') }} {{ Math.min(qr.visibleCount.value, qr.totalRows.value) }} / {{ result.totalCount ?? qr.totalRows.value }} {{ t('database.rows') }}
        <template v-if="loadingMore"> ({{ t('database.loadingMore') }}...)</template>
      </span>
      <!-- 主键 / 编辑状态展示 -->
      <span class="flex items-center gap-2">
        <!-- 可编辑：显示主键列名 -->
        <template v-if="qr.editableReason.value === 'ok'">
          <span class="flex items-center gap-1 text-emerald-500/80 font-medium">
            <KeyRound class="h-3 w-3" />
            PK: {{ qr.primaryKeys.value.join(', ') }}
          </span>
          <span class="text-muted-foreground/40">·</span>
          <span class="text-muted-foreground/60">双击单元格可编辑</span>
        </template>
        <!-- 无主键：只读提示 -->
        <template v-else-if="qr.editableReason.value === 'no-pk'">
          <span class="flex items-center gap-1 text-amber-500/80">
            <ShieldAlert class="h-3 w-3" />
            无主键，只读模式
          </span>
        </template>
        <!-- 无法确定表：复杂查询只读 -->
        <template v-else-if="qr.editableReason.value === 'no-table'">
          <span class="flex items-center gap-1 text-muted-foreground/50">
            <Eye class="h-3 w-3" />
            复杂查询，只读模式
          </span>
        </template>
      </span>
      <span v-if="qr.hasMore.value" class="text-primary/70">{{ t('database.scrollForMore') }}</span>
    </div>

    <!-- Overlays -->
    <ColumnStatsBar
      v-if="qr.columnStats.value && qr.selectedStatsColumn.value"
      :stats="qr.columnStats.value"
      :column-name="qr.selectedStatsColumn.value"
    />
    <ConfirmDialog
      v-model:open="qr.deleteConfirmOpen.value"
      :title="t('database.confirmDeleteRow')"
      :description="t('database.confirmDeleteRowDesc')"
      :confirm-label="t('common.delete')"
      :cancel-label="t('common.cancel')"
      variant="destructive"
      @confirm="qr.confirmDeleteRow()"
    />
    <ExportDialog
      v-if="connectionId"
      v-model:open="qr.exportDialogOpen.value"
      :connection-id="connectionId"
      :source="qr.exportSource.value"
      :preview-columns="result?.columns?.map(c => c.name) ?? []"
      :preview-rows="(result?.rows ?? []).slice(0, 10)"
    />
    <RowDetailSheet
      v-model:open="qr.rowDetailOpen.value"
      :columns="result?.columns ?? []"
      :row="qr.selectedRowData.value"
      :row-index="qr.selectedRowIndex.value ?? 0"
      :total-rows="qr.totalRows.value"
      :driver="driver"
      @navigate="qr.handleRowDetailNavigate"
    />
  </div>

  <!-- 共享行右键菜单（单例，避免每行创建 ContextMenu 实例） -->
  <Teleport to="body">
    <template v-if="ctxMenuOpen">
      <div class="fixed inset-0 z-50" @click="closeCtxMenu()" @contextmenu.prevent="closeCtxMenu()" />
      <div
        class="fixed z-50 min-w-[192px] rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
        :style="ctxMenuStyle"
      >
        <button
          class="flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-accent hover:text-accent-foreground"
          @click="qr.openRowDetail(ctxRowIndex!); closeCtxMenu()"
        >
          查看行详情
          <span class="ml-auto text-[10px] text-muted-foreground">Ctrl+D</span>
        </button>
        <button
          class="flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-accent hover:text-accent-foreground"
          @click="qr.copyRowAsJson(ctxRowIndex!); closeCtxMenu()"
        >
          复制为 JSON
        </button>
        <button
          class="flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-accent hover:text-accent-foreground"
          @click="qr.copyRowAsSql(ctxRowIndex!); closeCtxMenu()"
        >
          复制为 SQL
        </button>
        <template v-if="qr.editable.value">
          <div class="my-1 h-px bg-border" />
          <button
            class="flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-destructive outline-none hover:bg-accent hover:text-destructive"
            @click="qr.requestDeleteRow(ctxRowIndex!); closeCtxMenu()"
          >
            删除行
          </button>
        </template>
      </div>
    </template>
  </Teleport>
</template>
