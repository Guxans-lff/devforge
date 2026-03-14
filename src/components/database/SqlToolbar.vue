<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Play, Loader2, Square, WrapText, Bookmark, ListTree,
  PlayCircle, CheckCircle2, XCircle, Clock, Database,
  ShieldAlert, ShieldCheck, Timer,
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

const executeDisabledReason = computed(() => {
  if (!props.isConnected) return t('database.notConnected')
  if (props.isExecuting) return t('database.executing')
  return ''
})

const timeoutModel = computed({
  get: () => props.queryTimeout,
  set: (val: number) => emit('update:queryTimeout', val),
})

const databaseModel = computed({
  get: () => props.currentDatabase,
  set: (val: string) => emit('update:currentDatabase', val),
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

    <!-- 数据库选择器 -->
    <div class="w-px h-4 bg-border" />
    <div class="flex items-center gap-1">
      <Database class="h-3 w-3 text-muted-foreground" />
      <select
        v-model="databaseModel"
        class="h-6 rounded border border-border bg-background px-1.5 text-[11px] min-w-[100px] max-w-[200px] cursor-pointer hover:border-primary/50 transition-colors"
        :title="t('database.selectDatabase')"
      >
        <option value="" disabled>{{ t('database.selectDatabase') }}</option>
        <option v-for="db in databases" :key="db" :value="db">{{ db }}</option>
      </select>
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
