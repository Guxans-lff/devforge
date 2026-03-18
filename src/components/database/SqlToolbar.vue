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
  <div class="flex items-center gap-2 border-b border-border px-2 py-1">
    <!-- 执行按钮 -->
    <TooltipProvider :delay-duration="300">
      <Tooltip>
        <TooltipTrigger as-child>
          <div>
            <Button
              variant="default"
              size="sm"
              class="h-6 gap-1 text-[11px]"
              :disabled="!isConnected || isExecuting"
              @click="emit('execute')"
            >
              <Loader2 v-if="isExecuting" class="h-3 w-3 animate-spin" />
              <Play v-else class="h-3 w-3" />
              {{ t('database.execute') }}
            </Button>
          </div>
        </TooltipTrigger>
        <TooltipContent v-if="executeDisabledReason" side="bottom" class="text-xs">
          {{ executeDisabledReason }}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>

    <!-- 取消按钮 -->
    <Button
      v-if="isExecuting"
      variant="destructive"
      size="sm"
      class="h-6 gap-1 text-[11px]"
      @click="emit('cancel')"
    >
      <Square class="h-3 w-3" />
      {{ t('common.cancel') }}
    </Button>

    <!-- 执行计时器 -->
    <span
      v-if="timerRunning"
      class="flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground animate-in fade-in duration-300"
    >
      <Timer class="h-3 w-3 animate-pulse text-primary" />
      {{ timerElapsed }}
    </span>

    <!-- 格式化 -->
    <TooltipProvider :delay-duration="300">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 gap-1 text-[11px]"
            @click="emit('format')"
          >
            <WrapText class="h-3 w-3" />
            {{ t('database.format') }}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" class="text-xs">
          Shift+Alt+F
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>

    <!-- EXPLAIN -->
    <Button
      variant="ghost"
      size="sm"
      class="h-6 gap-1 text-[11px]"
      :disabled="!isConnected || isExplaining"
      :class="{ 'bg-muted': showExplain }"
      @click="emit('explain')"
    >
      <Loader2 v-if="isExplaining" class="h-3 w-3 animate-spin" />
      <ListTree v-else class="h-3 w-3" />
      EXPLAIN
    </Button>

    <div class="flex items-center gap-1">
      <Popover v-model:open="dbSelectorOpen">
        <PopoverTrigger as-child>
          <Button
            variant="outline"
            role="combobox"
            class="h-6 min-w-[100px] max-w-[200px] justify-between px-2 text-[11px] font-normal hover:border-primary/50 transition-all bg-background border-border/50"
          >
            <div class="flex items-center gap-1.5 min-w-0">
              <Database class="h-3 w-3 shrink-0 text-primary/70" />
              <span class="truncate font-medium">{{ currentDatabase || t('database.selectDatabase') }}</span>
            </div>
            <ChevronDown class="ml-2 h-3 w-3 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity" />
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
    </div>

    <!-- 错误策略 -->
    <TooltipProvider :delay-duration="300">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 w-6 p-0"
            @click="emit('toggleErrorStrategy')"
          >
            <ShieldAlert v-if="errorStrategy === 'stopOnError'" class="h-3 w-3 text-amber-500" />
            <ShieldCheck v-else class="h-3 w-3 text-green-500" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" class="text-xs">
          {{ t('database.multiStatement.errorStrategyTooltip', { strategy: errorStrategy === 'stopOnError' ? t('database.multiStatement.stopOnError') : t('database.multiStatement.continueOnError') }) }}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>

    <!-- 事务管理 -->
    <div class="w-px h-4 bg-border" />
    <Button
      v-if="!isInTransaction"
      variant="ghost"
      size="sm"
      class="h-6 gap-1 text-[11px]"
      :disabled="!isConnected"
      @click="emit('beginTransaction')"
    >
      <PlayCircle class="h-3 w-3" />
      开始事务
    </Button>
    <Button
      v-if="isInTransaction"
      variant="ghost"
      size="sm"
      class="h-6 gap-1 text-[11px] text-green-600 hover:text-green-700"
      @click="emit('commit')"
    >
      <CheckCircle2 class="h-3 w-3" />
      提交
    </Button>
    <Button
      v-if="isInTransaction"
      variant="ghost"
      size="sm"
      class="h-6 gap-1 text-[11px] text-red-600 hover:text-red-700"
      @click="emit('rollback')"
    >
      <XCircle class="h-3 w-3" />
      回滚
    </Button>

    <!-- 代码片段 -->
    <div class="w-px h-4 bg-border" />
    <Button
      variant="ghost"
      size="sm"
      class="h-6 gap-1 text-[11px]"
      :class="{ 'bg-muted': snippetPanelOpen }"
      @click="emit('toggleSnippet')"
    >
      <Bookmark class="h-3 w-3" />
      {{ t('sqlSnippet.title') }}
    </Button>
    <span class="text-[10px] text-muted-foreground">Ctrl+Enter</span>

    <!-- 查询超时 -->
    <div class="flex items-center gap-1 ml-auto">
      <Clock class="h-3 w-3 text-muted-foreground" />
      <input
        v-model.number="timeoutModel"
        type="number"
        min="0"
        max="3600"
        class="w-14 h-5 rounded border border-border bg-background px-1 text-[10px] text-center tabular-nums"
        placeholder="30"
        title="查询超时（秒），0 表示不限制"
      />
      <span class="text-[10px] text-muted-foreground">秒</span>
    </div>

    <!-- 事务进行中标识 -->
    <span
      v-if="isInTransaction"
      class="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
    >
      事务进行中
    </span>
  </div>
</template>
