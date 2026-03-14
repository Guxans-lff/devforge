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
  Hash, Download, Trash2, Filter, ShieldAlert, WifiOff, KeyRound,
  Activity, RotateCcw, BarChart3, Loader2,
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
import CellPreviewPanel from '@/components/database/CellPreviewPanel.vue'
import ColumnStatsBar from '@/components/database/ColumnStatsBar.vue'
import { useQueryResult } from '@/composables/useQueryResult'

/** 懒加载图表面板 */
const ChartPanel = defineAsyncComponent(() => import('@/components/database/chart/ChartPanel.vue'))

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
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <!-- Status bar -->
    <div
      class="flex h-8 items-center gap-6 border-b border-border bg-muted/20 px-4 text-[11px] text-muted-foreground transition-colors shrink-0"
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
            <Button
              variant="ghost" size="sm"
              class="h-6 gap-1.5 text-[10px] px-2 hover:bg-muted/50 rounded-md transition-all active:scale-95"
              :class="{ 'text-primary bg-primary/10': qr.showChart.value }"
              @click="qr.showChart.value = !qr.showChart.value"
            >
              <BarChart3 class="h-3 w-3" />
              图表
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

    <!-- Table -->
    <div ref="tableScrollRef" class="qr-scroll-area relative min-h-0 flex-1 overflow-auto bg-background/30 border-t border-border/50" style="contain: strict">
      <div
        v-if="result && !result.isError && result.columns.length > 0"
        class="text-sm min-w-full inline-block align-top"
        :style="{ width: 'max-content' }"
      >
        <!-- Header -->
        <div class="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
          <div class="w-full" :style="qr.gridStyle.value">
            <div class="whitespace-nowrap border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
              #
            </div>
            <div
              v-for="header in qr.table.getFlatHeaders()"
              :key="header.id"
              class="group/header relative select-none whitespace-nowrap border-b border-r border-border px-3 py-1.5 text-left text-xs font-bold text-muted-foreground/80 hover:bg-muted/50 transition-colors"
              :class="{ 'bg-primary/5 text-primary': qr.selectedStatsColumn.value === header.column.id }"
              @contextmenu.prevent="qr.triggerColumnStats(header.column.id)"
            >
              <div
                class="flex items-center gap-1 cursor-pointer"
                @click="isTableBrowse ? qr.handleHeaderClick(header.column.id) : header.column.getToggleSortingHandler()?.($event)"
              >
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
              <!-- Resizer Handle -->
              <div
                v-if="header.column.getCanResize()"
                class="absolute right-0 top-0 h-full w-1 cursor-col-resize user-select-none touch-none hover:bg-primary/50 transition-colors"
                :class="{ 'bg-primary w-0.5 opacity-100': header.column.getIsResizing() }"
                @mousedown="header.getResizeHandler()($event)"
                @touchstart="header.getResizeHandler()($event)"
              />
            </div>
            <div
              v-if="qr.editable.value"
              class="whitespace-nowrap border-b border-r border-border px-1 py-1.5 text-center text-xs font-medium text-muted-foreground"
            />
          </div>
          <!-- Filter row -->
          <div v-if="qr.showFilters.value" class="flex" :style="qr.gridStyle.value">
            <div class="border-b border-r border-border px-1 py-0.5" />
            <div
              v-for="header in qr.table.getFlatHeaders()"
              :key="'filter-' + header.id"
              class="border-b border-r border-border px-1 py-0.5"
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

        <!-- Body (virtual rows) -->
        <div :style="{ height: `${qr.rowVirtualizer.value.getTotalSize()}px`, position: 'relative' }" style="will-change: transform; contain: content">
          <ContextMenu v-for="vRow in qr.rowVirtualizer.value.getVirtualItems()" :key="vRow.index">
            <ContextMenuTrigger as-child>
              <div
                v-memo="[vRow.index, vRow.start, qr.selectedRowIndex.value === vRow.index, qr.editingCell.value?.rowIndex === vRow.index, qr.table.getRowModel().rows[vRow.index]?.id, qr.table.getState().columnSizing]"
                class="cursor-pointer absolute left-0 right-0"
                :style="{ ...qr.rowBaseStyle.value, transform: `translateY(${vRow.start}px)` }"
                :class="qr.selectedRowIndex.value === vRow.index ? 'bg-primary/10' : 'hover:bg-muted/30'"
                @click="qr.selectedRowIndex.value = vRow.index"
              >
                <div class="whitespace-nowrap border-b border-r border-border bg-muted/5 px-3 text-[10px] font-bold text-muted-foreground/40 tabular-nums flex items-center justify-center">
                  {{ vRow.index + 1 }}
                </div>
                <div
                  v-for="cell in qr.table.getRowModel().rows[vRow.index]?.getVisibleCells()"
                  :key="cell.id"
                  class="select-text whitespace-nowrap border-b border-r border-border px-3 font-mono text-[12px] flex items-center overflow-hidden"
                  :class="{
                    'text-muted-foreground/40 italic font-sans': cell.getValue() === null || cell.getValue() === undefined,
                    'cursor-pointer hover:bg-primary/[0.02]': !qr.editingCell.value || qr.editingCell.value.rowIndex !== vRow.index || qr.editingCell.value.colName !== cell.column.id,
                    'text-primary font-bold': qr.selectedRowIndex.value === vRow.index
                  }"
                  @click.stop="qr.handleCellClick(cell.getValue(), cell.column.id, result?.columns.find(c => c.name === cell.column.id)?.dataType)"
                  @dblclick="qr.editable.value ? qr.startEdit(vRow.index, cell.column.id, cell.getValue()) : undefined"
                >
                  <template v-if="qr.editingCell.value && qr.editingCell.value.rowIndex === vRow.index && qr.editingCell.value.colName === cell.column.id">
                    <input
                      :value="qr.editingValue.value"
                      class="h-full w-full bg-background px-1 text-xs font-mono outline-none border border-primary rounded-sm"
                      autofocus
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
            </ContextMenuTrigger>
            <ContextMenuContent class="w-48">
              <ContextMenuItem class="gap-2 text-xs" @click="qr.openRowDetail(vRow.index)">
                查看行详情
                <span class="ml-auto text-[10px] text-muted-foreground">Ctrl+D</span>
              </ContextMenuItem>
              <ContextMenuItem class="gap-2 text-xs" @click="qr.copyRowAsJson(vRow.index)">
                复制为 JSON
              </ContextMenuItem>
              <template v-if="qr.editable.value">
                <ContextMenuSeparator />
                <ContextMenuItem class="gap-2 text-xs text-destructive" @click="qr.requestDeleteRow(vRow.index)">
                  删除行
                </ContextMenuItem>
              </template>
            </ContextMenuContent>
          </ContextMenu>
        </div>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="result && result.isError" class="flex flex-col h-full overflow-auto">
        <div class="flex items-center gap-2 px-4 py-3 border-b border-destructive/20 bg-destructive/5">
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
          <pre class="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/80 select-text">{{ result.error }}</pre>
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

      <!-- Empty initial state -->
      <div v-else-if="!loading && !result" class="flex h-full items-center justify-center text-muted-foreground">
        <p class="text-sm font-medium tracking-wide">{{ t('database.noResults') }}</p>
      </div>

      <!-- Success state for non-select queries -->
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

    <!-- 单元格预览面板 -->
    <CellPreviewPanel
      v-if="qr.showPreview.value && qr.previewCell.value"
      :value="qr.previewCell.value.value"
      :column-name="qr.previewCell.value.columnName"
      :column-type="qr.previewCell.value.columnType"
      @close="qr.showPreview.value = false"
    />

    <!-- 列统计栏 -->
    <ColumnStatsBar
      v-if="qr.columnStats.value && qr.selectedStatsColumn.value"
      :stats="qr.columnStats.value"
      :column-name="qr.selectedStatsColumn.value"
    />

    <!-- 图表面板 -->
    <div v-if="qr.showChart.value && result && !result.isError && result.columns.length > 0" class="h-[300px] shrink-0">
      <ChartPanel :rows="result.rows" :columns="result.columns" />
    </div>

    <!-- Status footer -->
    <div
      v-if="result && !result.isError && result.columns.length > 0"
      class="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground shrink-0"
    >
      <span>
        {{ t('database.showing') }} {{ Math.min(qr.visibleCount.value, qr.totalRows.value) }} / {{ result.totalCount ?? qr.totalRows.value }} {{ t('database.rows') }}
        <template v-if="loadingMore"> ({{ t('database.loadingMore') }}...)</template>
      </span>
      <span v-if="qr.hasMore.value" class="text-primary/70">{{ t('database.scrollForMore') }}</span>
    </div>

    <!-- 删除确认对话框 -->
    <ConfirmDialog
      v-model:open="qr.deleteConfirmOpen.value"
      :title="t('database.confirmDeleteRow')"
      :description="t('database.confirmDeleteRowDesc')"
      :confirm-label="t('common.delete')"
      :cancel-label="t('common.cancel')"
      variant="destructive"
      @confirm="qr.confirmDeleteRow()"
    />

    <!-- 多格式导出对话框 -->
    <ExportDialog
      v-if="connectionId"
      v-model:open="qr.exportDialogOpen.value"
      :connection-id="connectionId"
      :source="qr.exportSource.value"
    />

    <!-- 行详情面板 -->
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
</template>
