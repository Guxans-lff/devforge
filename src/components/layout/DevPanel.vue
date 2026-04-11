<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLogStore, type LogEntry } from '@/stores/log'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Search,
  Trash2,
  ArrowLeft,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
} from 'lucide-vue-next'

const { t } = useI18n()
const logStore = useLogStore()

const searchText = ref('')
const expandedIds = ref<Set<string>>(new Set())
const filterLevel = ref<'ALL' | 'ERROR'>('ALL')

/** 仅展示 API 相关日志 */
const apiLogs = computed(() => {
  return logStore.logs.filter(log => {
    const details = log.details as Record<string, unknown> | undefined
    if (!details || typeof details !== 'object') return false
    const logType = details.type as string | undefined
    if (!logType) return false
    if (!['api-request', 'api-response', 'api-error'].includes(logType)) return false

    // 级别过滤
    if (filterLevel.value === 'ERROR' && log.level !== 'ERROR') return false

    // 关键词搜索
    if (searchText.value) {
      const keyword = searchText.value.toLowerCase()
      const command = (details.command as string) || ''
      return command.toLowerCase().includes(keyword) || log.message.toLowerCase().includes(keyword)
    }
    return true
  }).reverse() // 最新的在上面
})

/** 请求/响应配对显示：只显示响应/错误行（内含请求信息） */
const pairedLogs = computed(() => {
  return apiLogs.value.filter(log => {
    const details = log.details as Record<string, unknown>
    return details.type === 'api-response' || details.type === 'api-error'
  })
})

function toggleExpand(id: string) {
  const newSet = new Set(expandedIds.value)
  if (newSet.has(id)) {
    newSet.delete(id)
  } else {
    newSet.add(id)
  }
  expandedIds.value = newSet
}

function getStatusClass(log: LogEntry): string {
  const details = log.details as Record<string, unknown>
  if (details.type === 'api-error') return 'text-destructive'
  return 'text-df-success'
}

function getStatusLabel(log: LogEntry): string {
  const details = log.details as Record<string, unknown>
  if (details.type === 'api-error') return 'FAIL'
  return 'OK'
}

function getCommand(log: LogEntry): string {
  const details = log.details as Record<string, unknown>
  return (details.command as string) || '?'
}

function getDuration(log: LogEntry): string {
  const details = log.details as Record<string, unknown>
  const ms = details.duration as number
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function getDurationClass(log: LogEntry): string {
  const details = log.details as Record<string, unknown>
  const ms = details.duration as number
  if (!ms) return 'text-muted-foreground'
  if (ms > 3000) return 'text-destructive'
  if (ms > 1000) return 'text-df-warning'
  return 'text-muted-foreground'
}

function getDetailsJson(log: LogEntry): string {
  try {
    return JSON.stringify(log.details, null, 2)
  } catch {
    return String(log.details)
  }
}

function handleCopyDetails(log: LogEntry) {
  navigator.clipboard.writeText(getDetailsJson(log))
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

const errorCount = computed(() => {
  return apiLogs.value.filter(l => l.level === 'ERROR').length
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 头部工具栏 -->
    <div class="flex items-center gap-2 border-b border-border/10 px-4 py-2 bg-muted/5">
      <div class="relative flex-1 group">
        <Search class="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
        <Input
          v-model="searchText"
          :placeholder="t('devPanel.searchPlaceholder')"
          class="h-7 pl-8 rounded-lg border-border/40 bg-background/50 text-[11px] font-bold transition-[border-color,box-shadow] focus:border-primary focus:ring-4 focus:ring-primary/5"
        />
      </div>

      <!-- 级别过滤 -->
      <div class="flex h-6 items-center rounded-full bg-muted/20 p-0.5 border border-muted/30">
        <button
          class="h-full px-2.5 rounded-full text-[9px] font-black uppercase tracking-tight transition-[background-color,color,box-shadow]"
          :class="filterLevel === 'ALL' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/50 hover:text-foreground/80'"
          @click="filterLevel = 'ALL'"
        >
          {{ t('devPanel.all') }}
        </button>
        <button
          class="h-full px-2.5 rounded-full text-[9px] font-black uppercase tracking-tight transition-[background-color,color,box-shadow]"
          :class="filterLevel === 'ERROR' ? 'bg-destructive/20 text-destructive shadow-sm' : 'text-muted-foreground/50 hover:text-foreground/80'"
          @click="filterLevel = 'ERROR'"
        >
          {{ t('devPanel.errorsOnly') }}
          <span v-if="errorCount > 0" class="ml-1 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-destructive/20 px-1 text-[8px] font-black text-destructive border border-destructive/20">
            {{ errorCount }}
          </span>
        </button>
      </div>

      <Button
        v-if="apiLogs.length > 0"
        variant="ghost"
        size="sm"
        class="h-7 gap-1.5 px-3 rounded-lg text-[10px] font-black text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors uppercase tracking-tight"
        @click="logStore.clearLogs()"
      >
        <Trash2 class="h-3 w-3" />
        {{ t('devPanel.clear') }}
      </Button>
    </div>

    <!-- 请求列表 -->
    <ScrollArea class="flex-1 h-full min-h-0">
      <div v-if="pairedLogs.length === 0" class="flex flex-col items-center justify-center p-8 text-center text-xs text-muted-foreground opacity-50">
        <AlertTriangle class="mb-2 h-8 w-8 stroke-[1.5]" />
        {{ t('devPanel.noRequests') }}
      </div>

      <div v-else class="divide-y divide-border/5">
        <div
          v-for="log in pairedLogs"
          :key="log.id"
          class="group"
        >
          <!-- 请求摘要行 -->
          <div
            class="flex items-center gap-2 px-4 py-1.5 cursor-pointer transition-colors hover:bg-muted/30 active:bg-muted/50"
            @click="toggleExpand(log.id)"
          >
            <!-- 展开箭头 -->
            <ChevronDown v-if="expandedIds.has(log.id)" class="h-3 w-3 text-muted-foreground/50 shrink-0" />
            <ChevronRight v-else class="h-3 w-3 text-muted-foreground/50 shrink-0" />

            <!-- 方向图标 -->
            <ArrowLeft v-if="(log.details as Record<string, unknown>).type === 'api-response'" class="h-3 w-3 text-df-success/60 shrink-0" />
            <ArrowLeft v-else class="h-3 w-3 text-destructive/60 shrink-0" />

            <!-- 状态 -->
            <span class="w-8 text-[9px] font-black uppercase shrink-0" :class="getStatusClass(log)">
              {{ getStatusLabel(log) }}
            </span>

            <!-- 命令名 -->
            <span class="flex-1 min-w-0 truncate font-mono text-[11px] font-bold text-foreground/80">
              {{ getCommand(log) }}
            </span>

            <!-- 来源 -->
            <span class="shrink-0 text-[9px] font-bold text-muted-foreground/30 uppercase tracking-wider bg-muted/30 px-1.5 py-0.5 rounded">
              {{ log.source }}
            </span>

            <!-- 耗时 -->
            <span class="shrink-0 w-16 text-right font-mono text-[10px] tabular-nums" :class="getDurationClass(log)">
              {{ getDuration(log) }}
            </span>

            <!-- 时间戳 -->
            <span class="shrink-0 w-20 text-right font-mono text-[9px] text-muted-foreground/30 tabular-nums">
              {{ formatTimestamp(log.timestamp) }}
            </span>
          </div>

          <!-- 展开详情 -->
          <div v-if="expandedIds.has(log.id)" class="px-4 py-2 bg-muted/10 border-t border-border/5">
            <div class="flex items-center justify-between mb-1">
              <span class="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">{{ t('devPanel.details') }}</span>
              <Button variant="ghost" size="sm" class="h-5 gap-1 px-2 text-[9px]" @click.stop="handleCopyDetails(log)">
                <Copy class="h-2.5 w-2.5" />
                {{ t('common.copy') }}
              </Button>
            </div>
            <pre class="text-[10px] font-mono leading-relaxed text-foreground/70 bg-background/50 p-2 rounded border border-border/10 overflow-x-auto max-h-48 thin-scrollbar select-all whitespace-pre-wrap break-all">{{ getDetailsJson(log) }}</pre>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
