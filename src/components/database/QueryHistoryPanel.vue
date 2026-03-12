<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Search,
  Trash2,
  Copy,
  Play,
  Clock,
  AlertCircle,
  CheckCircle2,
  X,
  Calendar,
  ChevronRight,
  Zap,
} from 'lucide-vue-next'
import * as historyApi from '@/api/query-history'
import type { QueryHistoryRecord } from '@/api/query-history'

const emit = defineEmits<{
  execute: [sql: string, connectionId: string]
  copy: [sql: string]
}>()

const { t } = useI18n()

const records = ref<QueryHistoryRecord[]>([])
const searchText = ref('')
const isLoading = ref(false)
const hasMore = ref(true)
const PAGE_SIZE = 50

async function loadHistory(reset = false) {
  if (isLoading.value) return
  isLoading.value = true

  try {
    const offset = reset ? 0 : records.value.length
    const result = await historyApi.listQueryHistory({
      searchText: searchText.value || null,
      limit: PAGE_SIZE,
      offset,
    })

    if (reset) {
      records.value = result
    } else {
      records.value = [...records.value, ...result]
    }
    hasMore.value = result.length === PAGE_SIZE
  } catch {
    // 静默处理
  } finally {
    isLoading.value = false
  }
}

async function handleDelete(id: string) {
  try {
    await historyApi.deleteQueryHistory(id)
    records.value = records.value.filter((r) => r.id !== id)
  } catch {
    // 静默处理
  }
}

async function handleClearAll() {
  try {
    await historyApi.clearQueryHistory()
    records.value = []
  } catch {
    // 静默处理
  }
}

function handleCopy(sql: string) {
  navigator.clipboard.writeText(sql)
  emit('copy', sql)
}

function handleExecute(record: QueryHistoryRecord) {
  emit('execute', record.sqlText, record.connectionId)
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return t('messageCenter.justNow')
  if (diffMin < 60) return `${diffMin} ${t('messageCenter.minutesAgo')}`
  if (diffHour < 24) return `${diffHour} ${t('messageCenter.hoursAgo')}`
  if (diffDay < 7) return `${diffDay} ${t('messageCenter.daysAgo')}`
  return d.toLocaleDateString()
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function truncateSql(sql: string, maxLen = 200): string {
  const oneLine = sql.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= maxLen) return oneLine
  return oneLine.slice(0, maxLen) + '...'
}

const groupedRecords = computed(() => {
  const groups: { title: string; records: QueryHistoryRecord[] }[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const groupMap = new Map<string, QueryHistoryRecord[]>()

  records.value.forEach(record => {
    const date = new Date(record.executedAt)
    date.setHours(0, 0, 0, 0)
    
    let key = ''
    if (date.getTime() === today.getTime()) key = 'today'
    else if (date.getTime() === yesterday.getTime()) key = 'yesterday'
    else key = 'older'

    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(record)
  })

  if (groupMap.has('today')) groups.push({ title: t('messageCenter.today' as any) || '今天', records: groupMap.get('today')! })
  if (groupMap.has('yesterday')) groups.push({ title: '昨天', records: groupMap.get('yesterday')! })
  if (groupMap.has('older')) groups.push({ title: '更早', records: groupMap.get('older')! })

  return groups
})

function highlightSql(sql: string) {
  const keywords = ['SELECT', 'FROM', 'WHERE', 'UPDATE', 'DELETE', 'INSERT', 'INTO', 'VALUES', 'SET', 'ORDER', 'BY', 'GROUP', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT', 'AS']
  let escaped = sql.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  
  keywords.forEach(kw => {
    const regex = new RegExp(`\\b${kw}\\b`, 'gi')
    escaped = escaped.replace(regex, `<span class="text-primary/70 font-bold">${kw}</span>`)
  })
  
  return escaped
}

function handleRowClick(sql: string) {
  handleCopy(sql)
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(searchText, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadHistory(true), 300)
})

onMounted(() => loadHistory(true))
</script>

<template>
  <TooltipProvider :delay-duration="100">
    <div class="flex h-full flex-col">
    <!-- Header (Masterpiece Refined) -->
    <div class="flex items-center gap-2 border-b border-border/10 px-4 py-2 bg-muted/5">
      <div class="relative flex-1 group">
        <Search class="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
        <Input
          v-model="searchText"
          :placeholder="t('queryHistory.searchPlaceholder')"
          class="h-7 pl-8 rounded-lg border-border/40 bg-background/50 text-[11px] font-bold transition-all focus:border-primary focus:ring-4 focus:ring-primary/5"
        />
      </div>
      <Button
        v-if="records.length > 0"
        variant="ghost"
        size="sm"
        class="h-7 gap-1.5 px-3 rounded-lg text-[10px] font-black text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all uppercase tracking-tight"
        @click="handleClearAll"
      >
        <Trash2 class="h-3 w-3" />
        {{ t('queryHistory.clearAll') }}
      </Button>
    </div>

    <!-- List -->
    <ScrollArea class="flex-1 h-full min-h-0">
      <div v-if="records.length === 0 && !isLoading" class="flex flex-col items-center justify-center p-8 text-center text-xs text-muted-foreground opacity-50">
        <Clock class="mb-2 h-8 w-8 stroke-[1.5]" />
        {{ t('queryHistory.noHistory') }}
      </div>
      
      <div v-else class="p-2 space-y-3">
        <div v-for="group in groupedRecords" :key="group.title" class="space-y-1">
          <!-- Group Header -->
          <div class="flex items-center gap-2 px-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/30">
            <Calendar class="h-2.5 w-2.5 opacity-50" />
            {{ group.title }}
            <div class="h-[1px] flex-1 bg-border/5"></div>
          </div>

          <!-- Items -->
          <div class="divide-y divide-border/5">
            <div
              v-for="record in group.records"
              :key="record.id"
              class="group relative flex cursor-pointer items-center gap-2.5 rounded-md border border-transparent py-1.5 px-2 transition-all duration-150 hover:bg-muted/40 active:bg-muted/60"
              @click="handleRowClick(record.sqlText)"
              @dblclick="handleExecute(record)"
            >
              <!-- Status indicator (Left bar) -->
              <div class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full transition-all duration-300 group-hover:opacity-100 opacity-0" 
                   :class="record.isError ? 'bg-destructive' : 'bg-primary'"></div>

              <!-- Status icon (Smaller) -->
              <div class="shrink-0 flex items-center justify-center h-3.5 w-3.5 rounded-full">
                <AlertCircle v-if="record.isError" class="h-3 w-3 text-destructive" />
                <CheckCircle2 v-else class="h-3 w-3 text-primary opacity-60" />
              </div>

              <!-- Content -->
              <div class="min-w-0 flex-1 flex items-center gap-3">
                <div class="min-w-0 flex-1">
                  <p class="truncate font-mono text-[11px] leading-tight text-foreground/70 group-hover:text-foreground transition-colors" 
                     v-html="highlightSql(truncateSql(record.sqlText, 250))">
                  </p>
                </div>
                
                <!-- Metadata & Actions -->
                <div class="shrink-0 flex items-center gap-3 text-[10px] font-medium text-muted-foreground/40 tabular-nums">
                  <div class="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    <Zap class="h-2.5 w-2.5" />
                    <span>{{ formatDuration(record.executionTimeMs) }}</span>
                  </div>
                  
                  <div v-if="record.connectionName" class="hidden md:block truncate bg-muted/30 px-1 py-0.5 rounded text-[9px] font-semibold opacity-60">
                    {{ record.connectionName }}
                  </div>

                  <span class="w-16 text-right font-mono tracking-tighter opacity-100">{{ formatTime(record.executedAt) }}</span>

                  <!-- Quick Actions (Reveal on hover) -->
                  <div class="flex items-center gap-0.5 w-0 overflow-hidden group-hover:w-[48px] transition-all duration-200">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Button variant="ghost" size="icon" class="h-5 w-5 rounded-md hover:bg-primary/10 hover:text-primary" @click.stop="handleExecute(record)">
                          <Play class="h-2.5 w-2.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" class="text-[10px]">{{ t('database.execute') }}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Button variant="ghost" size="icon" class="h-5 w-5 rounded-md hover:bg-primary/10 hover:text-primary" @click.stop="handleCopy(record.sqlText)">
                          <Copy class="h-2.5 w-2.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" class="text-[10px]">{{ t('common.copy') }}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Load more -->
      <div v-if="hasMore && records.length > 0" class="p-2 text-center">
        <Button
          variant="ghost"
          size="sm"
          class="h-6 text-xs"
          :disabled="isLoading"
          @click="loadHistory(false)"
        >
          {{ isLoading ? t('database.loadingMore') : t('queryHistory.loadMore') }}
        </Button>
      </div>
    </ScrollArea>
    </div>
  </TooltipProvider>
</template>
