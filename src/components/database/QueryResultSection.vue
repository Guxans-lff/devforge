<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  CheckCircle2, XCircle, ListTree, Pin, Table2, X as XIcon,
} from 'lucide-vue-next'
import QueryResultComponent from '@/components/database/QueryResult.vue'
import ExplainPanel from '@/components/database/ExplainPanel.vue'
import { useGridSearch } from '@/composables/useGridSearch'
import type { QueryResult } from '@/types/database'
import type { ResultTab, SubStatementResult } from '@/types/database-workspace'

const props = defineProps<{
  /** 当前显示的结果 */
  displayResult: QueryResult | null
  /** 结果标签页列表 */
  resultTabs: ResultTab[]
  /** 当前激活的标签页 ID */
  activeResultTabId: string | null
  /** 是否正在执行 */
  isExecuting: boolean
  /** 是否正在加载更多 */
  isLoadingMore: boolean
  /** 是否还有更多服务端数据 */
  hasMoreServerRows: boolean
  /** 是否已连接 */
  isConnected: boolean
  /** 连接 ID */
  connectionId: string
  /** 当前浏览的数据库名 */
  currentBrowseDb?: string
  /** 当前浏览的表名 */
  currentBrowseTable?: string
  /** 驱动类型 */
  driver: string
  /** 是否表浏览模式 */
  isTableBrowse: boolean
  /** 当前 SQL 编辑器选中的数据库（用于 SQL 查询模式下的编辑回写） */
  currentDatabase?: string
  /** 多语句子结果列表 */
  subResults: SubStatementResult[]
  /** 是否为多语句结果 */
  isMultiResultTab: boolean
  /** 当前选中的子结果索引 */
  activeSubResultIndex: number
  /** EXPLAIN 相关 */
  showExplain: boolean
  explainResult: Record<string, unknown> | null
  explainTableRows: Record<string, unknown>[] | null
  isExplaining: boolean
  /** 右键菜单状态 */
  contextMenu: { x: number; y: number; tabId: string } | null
}>()

const emit = defineEmits<{
  reconnect: []
  loadMore: []
  refresh: []
  serverFilter: [whereClause: string]
  serverSort: [orderBy: string]
  setActiveResultTab: [tabId: string]
  closeResultTab: [tabId: string]
  closeOtherResultTabs: [tabId: string]
  closeAllResultTabs: []
  togglePinResultTab: [tabId: string]
  showContextMenu: [e: MouseEvent, tabId: string]
  closeContextMenu: []
  setActiveSubResult: [index: number]
  closeExplain: []
}>()

const { t: _t } = useI18n()

// 数据网格搜索
const gridSearch = useGridSearch()

/** 跳转到指定行对话框 */
const showGoToLineDialog = ref(false)
const goToLineInput = ref('')

/** 快捷键处理 */
function handleKeydown(e: KeyboardEvent) {
  const isCtrl = e.ctrlKey || e.metaKey

  if (isCtrl && e.key === 'f') {
    e.preventDefault()
    gridSearch.openSearch()
    const result = props.displayResult
    if (result && result.columns.length > 0) {
      gridSearch.performSearch(result.rows, result.columns)
    }
  } else if (isCtrl && e.key === 'g') {
    e.preventDefault()
    showGoToLineDialog.value = true
    goToLineInput.value = ''
  }
}

/** 跳转到指定行 */
function handleGoToLine() {
  const lineNum = parseInt(goToLineInput.value, 10)
  if (isNaN(lineNum) || lineNum < 1) return
  const result = props.displayResult
  if (!result) return
  const targetRow = Math.min(lineNum - 1, result.rows.length - 1)
  if (targetRow >= 0) {
    gridSearch.matches.value = [{ rowIndex: targetRow, colIndex: 0 }]
    gridSearch.currentMatchIndex.value = 0
  }
  showGoToLineDialog.value = false
  goToLineInput.value = ''
}

defineExpose({ gridSearch })
</script>

<template>
  <div ref="resultPanelRef" class="flex flex-col h-full" tabindex="0" @keydown="handleKeydown">
    <!-- 执行进度条 -->
    <div
      v-if="isExecuting"
      class="h-0.5 w-full overflow-hidden bg-primary/10 shrink-0"
    >
      <div class="h-full w-1/3 bg-primary rounded-full animate-[indeterminate_1.5s_ease-in-out_infinite]" />
    </div>

    <!-- 搜索栏（Ctrl+F） -->
    <div v-if="gridSearch.isSearchVisible.value" class="flex items-center gap-2 border-b border-border px-2 py-1 bg-muted/30">
      <input
        v-model="gridSearch.searchText.value"
        type="text"
        class="flex-1 h-6 rounded border border-border bg-background px-2 text-xs"
        placeholder="搜索..."
        autofocus
        @input="gridSearch.performSearch(displayResult?.rows ?? [], displayResult?.columns ?? [])"
        @keydown.enter.prevent="gridSearch.nextMatch()"
        @keydown.escape.prevent="gridSearch.closeSearch()"
      />
      <span class="text-[10px] text-muted-foreground tabular-nums">
        {{ gridSearch.matchCount.value > 0 ? `${gridSearch.currentMatchIndex.value + 1}/${gridSearch.matchCount.value}` : '无匹配' }}
      </span>
      <Button variant="ghost" size="sm" class="h-5 w-5 p-0" @click="gridSearch.prevMatch()">↑</Button>
      <Button variant="ghost" size="sm" class="h-5 w-5 p-0" @click="gridSearch.nextMatch()">↓</Button>
      <Button variant="ghost" size="sm" class="h-5 w-5 p-0" @click="gridSearch.closeSearch()">
        <XIcon class="h-3 w-3" />
      </Button>
    </div>

    <!-- 跳转到指定行（Ctrl+G） -->
    <div v-if="showGoToLineDialog" class="flex items-center gap-2 border-b border-border px-2 py-1 bg-muted/30">
      <span class="text-xs text-muted-foreground">跳转到行:</span>
      <input
        v-model="goToLineInput"
        type="number"
        min="1"
        class="w-24 h-6 rounded border border-border bg-background px-2 text-xs"
        placeholder="行号"
        autofocus
        @keydown.enter.prevent="handleGoToLine()"
        @keydown.escape.prevent="showGoToLineDialog = false"
      />
      <Button variant="ghost" size="sm" class="h-5 text-[10px]" @click="handleGoToLine()">确定</Button>
      <Button variant="ghost" size="sm" class="h-5 w-5 p-0" @click="showGoToLineDialog = false">
        <XIcon class="h-3 w-3" />
      </Button>
    </div>

    <!-- 结果标签栏 -->
    <div v-if="resultTabs.length > 0" class="flex items-center border-b border-border bg-muted/20 overflow-x-auto no-scrollbar" role="tablist" :aria-label="'查询结果标签'" @click.self="emit('closeContextMenu')">
      <TooltipProvider :delay-duration="300">
        <div class="flex">
          <Tooltip v-for="tab in resultTabs" :key="tab.id">
            <TooltipTrigger as-child>
              <button
                role="tab"
                :aria-selected="tab.id === activeResultTabId"
                class="group relative flex items-center gap-2 px-4 py-2 text-[11px] border-r border-border transition-colors duration-200 shrink-0"
                :class="tab.id === activeResultTabId ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'"
                @click="emit('setActiveResultTab', tab.id)"
                @contextmenu="emit('showContextMenu', $event, tab.id)"
              >
                <!-- 活动状态蓝色底边指示器 -->
                <div v-if="tab.id === activeResultTabId" class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary shadow-[0_0_8px_rgba(59,130,246,0.5)] animate-in fade-in slide-in-from-bottom-1 duration-300" />

                <div class="flex items-center gap-1.5 min-w-[60px]">
                  <Table2 class="h-3 w-3 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity" :class="tab.id === activeResultTabId ? 'text-primary' : ''" />
                  <span class="truncate font-medium">{{ tab.title }}</span>
                  <Pin v-if="tab.isPinned" class="h-2.5 w-2.5 text-df-info animate-in zoom-in-50" />
                </div>

                <button
                  v-if="!tab.isPinned"
                  class="ml-1 opacity-0 group-hover:opacity-100 rounded-full hover:bg-muted/80 p-0.5 transition-[opacity,background-color,color] text-muted-foreground hover:text-foreground"
                  @click.stop="emit('closeResultTab', tab.id)"
                >
                  <XIcon class="h-2.5 w-2.5" />
                </button>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" class="max-w-md p-3 bg-popover border border-border shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div class="space-y-2">
                <div class="flex items-center justify-between border-b border-border/30 pb-1">
                  <p class="text-[10px] font-bold text-primary uppercase tracking-widest">执行 SQL</p>
                  <p class="text-[9px] text-muted-foreground/60 italic">{{ new Date(tab.createdAt).toLocaleTimeString() }}</p>
                </div>
                <div class="relative group/code">
                  <code class="text-[11px] block bg-muted/80 p-2.5 rounded border border-border/20 font-mono text-foreground break-all leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto thin-scrollbar select-all">
                    {{ tab.sql }}
                  </code>
                </div>
                <p class="text-[9px] text-muted-foreground/40 text-right">消耗时间: {{ tab.result.executionTimeMs }}ms</p>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="fixed z-50 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-md"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click="emit('closeContextMenu')"
      >
        <button class="w-full rounded-sm px-2 py-1 text-left text-xs hover:bg-accent" @click="emit('togglePinResultTab', contextMenu!.tabId)">
          {{ resultTabs.find(t => t.id === contextMenu!.tabId)?.isPinned ? '取消固定' : '固定' }}
        </button>
        <button class="w-full rounded-sm px-2 py-1 text-left text-xs hover:bg-accent" @click="emit('closeResultTab', contextMenu!.tabId)">
          关闭
        </button>
        <button class="w-full rounded-sm px-2 py-1 text-left text-xs hover:bg-accent" @click="emit('closeOtherResultTabs', contextMenu!.tabId)">
          关闭其他
        </button>
        <button class="w-full rounded-sm px-2 py-1 text-left text-xs hover:bg-accent" @click="emit('closeAllResultTabs')">
          关闭所有
        </button>
      </div>
    </Teleport>

    <!-- 多语句子结果切换条 -->
    <div v-if="isMultiResultTab && !showExplain" class="flex items-center border-b border-border bg-muted/10 overflow-x-auto no-scrollbar shrink-0">
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 text-[11px] border-r border-border shrink-0 transition-colors"
        :class="activeSubResultIndex === -1 ? 'bg-background text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'"
        @click="emit('setActiveSubResult', -1)"
      >
        <ListTree class="h-3 w-3" />
        汇总
        <span class="text-[9px] opacity-60">({{ subResults.length }})</span>
      </button>
      <button
        v-for="(sub, idx) in subResults"
        :key="sub.index"
        class="flex items-center gap-1.5 px-3 py-1.5 text-[11px] border-r border-border shrink-0 transition-colors"
        :class="activeSubResultIndex === idx ? 'bg-background text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'"
        :title="sub.sql"
        @click="emit('setActiveSubResult', idx)"
      >
        <CheckCircle2 v-if="!sub.result.isError" class="h-3 w-3 text-df-success" />
        <XCircle v-else class="h-3 w-3 text-destructive" />
        <span class="max-w-[120px] truncate">{{ sub.statementType }}</span>
        <span class="text-[9px] opacity-50">{{ sub.result.executionTimeMs }}ms</span>
      </button>
    </div>

    <!-- 主结果面板 -->
    <ExplainPanel
      v-if="showExplain"
      :result="explainResult"
      :table-rows="explainTableRows"
      :loading="isExplaining"
      :connection-id="connectionId"
      :database="currentBrowseDb || currentDatabase"
      class="flex-1 min-h-0"
      @close="emit('closeExplain')"
    />
    <QueryResultComponent
      v-else
      :key="`qr-${currentBrowseDb}-${currentBrowseTable}-${activeResultTabId}`"
      :result="displayResult"
      :loading="isExecuting"
      :loading-more="isLoadingMore"
      :has-more-server-rows="hasMoreServerRows"
      :show-reconnect="!isConnected"
      :connection-id="connectionId"
      :database="currentBrowseDb || currentDatabase"
      :table-name="currentBrowseTable || displayResult?.tableName"
      :driver="driver"
      :is-table-browse="isTableBrowse"
      class="flex-1 min-h-0"
      @reconnect="emit('reconnect')"
      @load-more="emit('loadMore')"
      @refresh="emit('refresh')"
      @server-filter="emit('serverFilter', $event)"
      @server-sort="emit('serverSort', $event)"
    />
  </div>
</template>
