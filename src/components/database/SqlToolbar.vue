<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Popover, PopoverTrigger, PopoverContent,
} from '@/components/ui/popover'
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from '@/components/ui/command'
import {
  Play, Loader2, Square, WrapText, Bookmark, ListTree,
  PlayCircle, CheckCircle2, XCircle, Clock, Database,
  ShieldAlert, ShieldCheck, Timer, ChevronDown, Check,
} from 'lucide-vue-next'
import type { ErrorStrategy } from '@/types/database'

const props = defineProps<{
  isConnected: boolean
  isExecuting: boolean
  isExplaining: boolean
  isInTransaction: boolean
  showExplain: boolean
  snippetPanelOpen: boolean
  errorStrategy: ErrorStrategy
  queryTimeout: number
  databases: string[]
  currentDatabase: string
  /** 执行计时器是否运行中 */
  timerRunning: boolean
  /** 格式化的耗时文本 */
  timerElapsed: string
}>()

const emit = defineEmits<{
  execute: []
  cancel: []
  format: []
  explain: []
  toggleSnippet: []
  toggleErrorStrategy: []
  beginTransaction: []
  commit: []
  rollback: []
  'update:queryTimeout': [value: number]
  'update:currentDatabase': [value: string]
}>()

const { t } = useI18n()

const dbSelectorOpen = ref(false)

function handleDbSelect(db: string) {
  emit('update:currentDatabase', db)
  dbSelectorOpen.value = false
}

const executeDisabledReason = computed(() => {
  if (!props.isConnected) return t('database.notConnected')
  if (props.isExecuting) return t('database.executing')
  return ''
})

const timeoutModel = computed({
  get: () => props.queryTimeout,
  set: (val: number) => emit('update:queryTimeout', val),
})

</script>

<template>
  <div
    class="flex items-center gap-1 border-b border-border px-2 py-1"
    role="toolbar"
    :aria-label="t('database.sqlToolbar')"
  >
    <!-- ═══ 第一组：主操作 ═══ -->
    <TooltipProvider :delay-duration="300">
      <!-- 执行按钮（主色突出） -->
      <Tooltip>
        <TooltipTrigger as-child>
          <div>
            <Button
              v-if="!isExecuting"
              size="sm"
              :aria-label="t('database.execute') + ' (Ctrl+Enter)'"
              class="h-7 gap-1.5 px-3 text-[11px] font-bold"
              :disabled="!isConnected"
              @click="emit('execute')"
            >
              <Play class="h-3 w-3" />
              {{ t('database.execute') }}
            </Button>
            <!-- 执行中：切换为红色 Stop -->
            <Button
              v-else
              variant="destructive"
              size="sm"
              :aria-label="t('common.cancel')"
              class="h-7 gap-1.5 px-3 text-[11px] font-bold animate-pulse"
              @click="emit('cancel')"
            >
              <Square class="h-3 w-3" />
              {{ t('common.cancel') }}
            </Button>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" class="text-xs">
          <template v-if="executeDisabledReason">{{ executeDisabledReason }}</template>
          <template v-else-if="isExecuting">{{ t('common.cancel') }} (Ctrl+C)</template>
          <template v-else>{{ t('database.execute') }} (Ctrl+Enter)</template>
        </TooltipContent>
      </Tooltip>

      <!-- 执行计时器 -->
      <span
        v-if="timerRunning"
        class="flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground animate-in fade-in duration-300 ml-1"
        aria-live="polite"
      >
        <Timer class="h-3 w-3 animate-pulse text-primary" />
        {{ timerElapsed }}
      </span>

      <!-- ═══ 分隔符 ═══ -->
      <div class="w-px h-4 bg-border mx-1" aria-hidden="true" />

      <!-- ═══ 第二组：SQL 工具 ═══ -->

      <!-- 格式化 -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            :aria-label="t('database.format') + ' (Shift+Alt+F)'"
            class="h-6 gap-1 text-[11px]"
            @click="emit('format')"
          >
            <WrapText class="h-3 w-3" />
            {{ t('database.format') }}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" class="text-xs">Shift+Alt+F</TooltipContent>
      </Tooltip>

      <!-- EXPLAIN -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            :aria-label="'EXPLAIN'"
            class="h-6 gap-1 text-[11px]"
            :disabled="!isConnected || isExplaining"
            :class="{ 'bg-muted': showExplain }"
            @click="emit('explain')"
          >
            <Loader2 v-if="isExplaining" class="h-3 w-3 animate-spin" />
            <ListTree v-else class="h-3 w-3" />
            EXPLAIN
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" class="text-xs">{{ t('database.explainTooltip') }}</TooltipContent>
      </Tooltip>

      <!-- 数据库选择器 -->
      <Popover v-model:open="dbSelectorOpen">
        <PopoverTrigger as-child>
          <Button
            variant="outline"
            role="combobox"
            :aria-label="t('database.selectDatabase')"
            class="h-6 min-w-[100px] max-w-[200px] justify-between px-2 text-[11px] font-normal hover:border-primary/50 transition-[border-color] bg-background border-border/50"
          >
            <div class="flex items-center gap-1.5 min-w-0">
              <Database class="h-3 w-3 shrink-0 text-primary/70" />
              <span class="truncate font-medium">{{ currentDatabase || t('database.selectDatabase') }}</span>
            </div>
            <ChevronDown class="ml-2 h-3 w-3 shrink-0 opacity-40" />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-[220px] p-0 shadow-2xl border-primary/10 overflow-hidden" align="start">
          <Command>
            <CommandInput
              :placeholder="t('database.searchDatabase')"
              class="border-none ring-0 focus:ring-0"
            />
            <CommandEmpty class="py-4 text-[10px] text-center text-muted-foreground">{{ t('common.noResults') }}</CommandEmpty>
            <CommandList class="max-h-[300px] overflow-y-auto p-1 custom-scrollbar">
              <CommandGroup>
                <CommandItem
                  v-for="db in databases"
                  :key="db"
                  :value="db"
                  class="flex items-center gap-2 px-2 py-1.5 text-[11px] rounded-sm transition-colors cursor-pointer group/db"
                  @select="handleDbSelect(db)"
                >
                  <div class="flex h-4 w-4 items-center justify-center rounded bg-primary/5 text-primary/40 group-hover/db:bg-primary/20 group-hover/db:text-primary transition-colors">
                    <Database class="h-2.5 w-2.5" />
                  </div>
                  <span class="flex-1 truncate font-medium">{{ db }}</span>
                  <Check
                    v-if="currentDatabase === db"
                    class="ml-auto h-3 w-3 text-primary animate-in zoom-in-50 duration-200"
                  />
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <!-- 错误策略 -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            :aria-label="t('database.multiStatement.errorStrategyTooltip', { strategy: errorStrategy === 'stopOnError' ? t('database.multiStatement.stopOnError') : t('database.multiStatement.continueOnError') })"
            class="h-6 w-6 p-0"
            @click="emit('toggleErrorStrategy')"
          >
            <ShieldAlert v-if="errorStrategy === 'stopOnError'" class="h-3 w-3 text-df-warning" />
            <ShieldCheck v-else class="h-3 w-3 text-df-success" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" class="text-xs max-w-[260px]">
          {{ t('database.multiStatement.errorStrategyTooltip', { strategy: errorStrategy === 'stopOnError' ? t('database.multiStatement.stopOnError') : t('database.multiStatement.continueOnError') }) }}
        </TooltipContent>
      </Tooltip>

      <!-- ═══ 分隔符 ═══ -->
      <div class="w-px h-4 bg-border mx-1" aria-hidden="true" />

      <!-- ═══ 第三组：高级操作 ═══ -->

      <!-- 事务管理 -->
      <Button
        v-if="!isInTransaction"
        variant="ghost"
        size="sm"
        :aria-label="t('database.beginTransaction')"
        class="h-6 gap-1 text-[11px]"
        :disabled="!isConnected"
        @click="emit('beginTransaction')"
      >
        <PlayCircle class="h-3 w-3" />
        {{ t('database.beginTransaction') }}
      </Button>
      <Button
        v-if="isInTransaction"
        variant="ghost"
        size="sm"
        :aria-label="t('database.commit')"
        class="h-6 gap-1 text-[11px] text-df-success hover:text-df-success"
        @click="emit('commit')"
      >
        <CheckCircle2 class="h-3 w-3" />
        {{ t('database.commit') }}
      </Button>
      <Button
        v-if="isInTransaction"
        variant="ghost"
        size="sm"
        :aria-label="t('database.rollback')"
        class="h-6 gap-1 text-[11px] text-destructive hover:text-destructive"
        @click="emit('rollback')"
      >
        <XCircle class="h-3 w-3" />
        {{ t('database.rollback') }}
      </Button>

      <!-- 事务进行中标识 -->
      <span
        v-if="isInTransaction"
        class="inline-flex items-center rounded-md bg-df-warning/10 px-2 py-0.5 text-[10px] font-medium text-df-warning"
        role="status"
      >
        {{ t('database.transactionActive') }}
      </span>

      <!-- 代码片段 -->
      <div class="w-px h-3.5 bg-border/40 mx-1" aria-hidden="true" />
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            :aria-label="t('sqlSnippet.title')"
            :aria-pressed="snippetPanelOpen"
            class="h-6 px-2 gap-1.5 text-[11px] font-medium transition-colors"
            :class="snippetPanelOpen ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
            @click="emit('toggleSnippet')"
          >
            <Bookmark class="h-3.5 w-3.5" />
            {{ t('sqlSnippet.title') }}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" class="text-xs">{{ t('sqlSnippet.title') }}</TooltipContent>
      </Tooltip>
    </TooltipProvider>

    <!-- 查询超时（推至右侧） -->
    <div class="flex items-center gap-2 ml-auto pr-1">
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <div class="flex items-center gap-1 bg-muted/30 hover:bg-muted/50 border border-border/30 rounded-md px-2 py-0.5 transition-colors group">
              <Clock class="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground/70" />
              <input
                v-model.number="timeoutModel"
                type="number"
                min="0"
                max="3600"
                :aria-label="t('database.queryTimeout')"
                class="w-8 bg-transparent border-none focus:ring-0 text-[11px] text-center tabular-nums p-0 text-foreground font-medium appearance-none"
                placeholder="30"
              />
              <span class="text-[10px] text-muted-foreground/30 font-semibold tracking-tighter">SEC</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="text-xs">{{ t('database.queryTimeoutTooltip') }}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </div>
</template>
