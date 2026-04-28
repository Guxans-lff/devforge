<script setup lang="ts">
/**
 * AuditLogPanel - 操作审计日志面板
 * 时间线展示所有 DDL/DML 操作记录
 */
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Shield, Search, Trash2, Loader2, AlertCircle, Copy,
  Database as DatabaseIcon, Clock, ChevronDown, RefreshCw,
} from 'lucide-vue-next'
import { queryAuditLogs, getAuditStats, cleanupAuditLogs } from '@/api/database'
import type { AuditLogEntry, AuditStats } from '@/types/database'
import { useMessage } from '@/stores/message-center'
import { createLogger } from '@/utils/logger'

const log = createLogger('audit.log')

const props = defineProps<{
  connectionId?: string
}>()

const message = useMessage()
const logs = ref<AuditLogEntry[]>([])
const stats = ref<AuditStats | null>(null)
const isLoading = ref(false)
const searchQuery = ref('')
const filterType = ref<string>('all')
const hasMore = ref(true)

const PAGE_SIZE = 50

/** 操作类型的颜色和标签 */
const OP_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  INSERT: { color: 'text-df-success', bg: 'bg-df-success/10 border-df-success/20', label: 'INSERT' },
  UPDATE: { color: 'text-df-warning', bg: 'bg-df-warning/10 border-df-warning/20', label: 'UPDATE' },
  DELETE: { color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/20', label: 'DELETE' },
  CREATE: { color: 'text-primary', bg: 'bg-primary/10 border-primary/20', label: 'CREATE' },
  ALTER: { color: 'text-df-info', bg: 'bg-df-info/10 border-df-info/20', label: 'ALTER' },
  DROP: { color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/20', label: 'DROP' },
  TRUNCATE: { color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/20', label: 'TRUNCATE' },
  GRANT: { color: 'text-df-success', bg: 'bg-df-success/10 border-df-success/20', label: 'GRANT' },
  REVOKE: { color: 'text-df-warning', bg: 'bg-df-warning/10 border-df-warning/20', label: 'REVOKE' },
  REPLACE: { color: 'text-primary', bg: 'bg-primary/10 border-primary/20', label: 'REPLACE' },
  CALL: { color: 'text-primary', bg: 'bg-primary/10 border-primary/20', label: 'CALL' },
}
const DEFAULT_STYLE = { color: 'text-muted-foreground', bg: 'bg-muted/20 border-border/30', label: '其他' }

function getOpStyle(type: string) {
  return OP_STYLES[type] ?? DEFAULT_STYLE
}

/** 格式化时间戳为相对时间 */
function formatTime(ts: number): string {
  const now = Date.now()
  const diff = now - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`
  return new Date(ts).toLocaleString('zh-CN')
}

/** 格式化绝对时间 */
function formatAbsTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

/** 日期分组 key */
function dateKey(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return '今天'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

/** 按日期分组 */
const groupedLogs = computed(() => {
  const groups: { key: string; items: AuditLogEntry[] }[] = []
  let currentKey = ''
  for (const log of logs.value) {
    const key = dateKey(log.createdAt)
    if (key !== currentKey) {
      currentKey = key
      groups.push({ key, items: [] })
    }
    groups[groups.length - 1]!.items.push(log)
  }
  return groups
})

async function loadLogs(append = false) {
  isLoading.value = true
  try {
    const result = await queryAuditLogs({
      connectionId: props.connectionId,
      operationType: filterType.value === 'all' ? undefined : filterType.value,
      search: searchQuery.value.trim() || undefined,
      limit: PAGE_SIZE,
      offset: append ? logs.value.length : 0,
    })
    if (append) {
      logs.value = [...logs.value, ...result]
    } else {
      logs.value = result
    }
    hasMore.value = result.length >= PAGE_SIZE
  } catch (e) {
    message.error('加载审计日志失败: ' + e)
  } finally {
    isLoading.value = false
  }
}

async function loadStats() {
  try {
    stats.value = await getAuditStats(props.connectionId)
  } catch (e) { log.warn('load_stats_failed', undefined, e) }
}

async function handleCleanup() {
  try {
    const deleted = await cleanupAuditLogs(30)
    message.success(`已清理 ${deleted} 条过期日志`)
    loadLogs()
    loadStats()
  } catch (e) {
    message.error('清理失败: ' + e)
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
    .then(() => message.success('已复制到剪贴板'))
    .catch(() => message.error('复制失败'))
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(searchQuery, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadLogs(), 300)
})
watch(filterType, () => loadLogs())

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

onMounted(() => {
  loadLogs()
  loadStats()
})
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <!-- 顶部工具栏 -->
    <div class="flex items-center gap-3 border-b border-border/20 px-4 py-2.5">
      <Shield class="h-4 w-4 text-primary/60 shrink-0" />
      <h2 class="text-xs font-black tracking-tight">操作审计日志</h2>

      <div class="flex-1" />

      <!-- 统计摘要 -->
      <div v-if="stats" class="flex items-center gap-3 text-[10px] text-muted-foreground/60 mr-2">
        <span>共 <b class="text-foreground/70">{{ stats.total }}</b> 条</span>
        <span v-if="stats.errorCount > 0" class="text-destructive">
          <AlertCircle class="inline h-3 w-3 -mt-0.5" /> {{ stats.errorCount }} 错误
        </span>
      </div>

      <!-- 搜索 -->
      <div class="relative w-48">
        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40" />
        <Input
          v-model="searchQuery"
          class="h-7 pl-7 text-[10px] bg-muted/20"
          placeholder="搜索 SQL..."
        />
      </div>

      <!-- 类型筛选 -->
      <Select v-model="filterType">
        <SelectTrigger class="h-7 w-28 text-[10px] bg-muted/20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" class="text-xs">全部类型</SelectItem>
          <SelectItem value="INSERT" class="text-xs">INSERT</SelectItem>
          <SelectItem value="UPDATE" class="text-xs">UPDATE</SelectItem>
          <SelectItem value="DELETE" class="text-xs">DELETE</SelectItem>
          <SelectItem value="CREATE" class="text-xs">CREATE</SelectItem>
          <SelectItem value="ALTER" class="text-xs">ALTER</SelectItem>
          <SelectItem value="DROP" class="text-xs">DROP</SelectItem>
          <SelectItem value="GRANT" class="text-xs">GRANT</SelectItem>
          <SelectItem value="REVOKE" class="text-xs">REVOKE</SelectItem>
        </SelectContent>
      </Select>

      <!-- 操作按钮 -->
      <Button variant="ghost" size="icon" class="h-7 w-7" @click="loadLogs(); loadStats()">
        <RefreshCw class="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost" size="icon" class="h-7 w-7 text-destructive/60 hover:text-destructive"
        title="清理 30 天前的日志"
        @click="handleCleanup"
      >
        <Trash2 class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- 日志列表 -->
    <ScrollArea class="flex-1">
      <div v-if="isLoading && logs.length === 0" class="flex items-center justify-center py-20">
        <Loader2 class="h-6 w-6 animate-spin text-primary/30" />
      </div>

      <div v-else-if="logs.length === 0" class="flex flex-col items-center justify-center py-20 text-muted-foreground/40">
        <Shield class="h-10 w-10 mb-3 opacity-30" />
        <p class="text-xs font-medium">暂无审计记录</p>
        <p class="text-[10px] mt-1">执行 DDL/DML 操作后，记录将自动出现在这里</p>
      </div>

      <div v-else class="p-4 space-y-6">
        <div v-for="group in groupedLogs" :key="group.key">
          <!-- 日期分隔线 -->
          <div class="flex items-center gap-3 mb-3">
            <div class="h-px flex-1 bg-border/20" />
            <span class="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">{{ group.key }}</span>
            <div class="h-px flex-1 bg-border/20" />
          </div>

          <!-- 时间线条目 -->
          <div class="relative pl-6 space-y-1">
            <!-- 时间线竖线 -->
            <div class="absolute left-[7px] top-2 bottom-2 w-px bg-border/20" />

            <div
              v-for="log in group.items" :key="log.id"
              class="relative group rounded-lg border border-transparent hover:border-border/30 hover:bg-muted/10 p-2.5 transition-[background-color,border-color]"
            >
              <!-- 时间线圆点 -->
              <div
                class="absolute -left-[17px] top-3.5 h-2.5 w-2.5 rounded-full border-2 border-background"
                :class="log.isError ? 'bg-destructive' : 'bg-primary/60'"
              />

              <div class="flex items-start gap-3">
                <!-- 操作类型标签 -->
                <div
                  class="shrink-0 px-2 py-0.5 rounded-md border text-[10px] font-bold"
                  :class="getOpStyle(log.operationType).bg + ' ' + getOpStyle(log.operationType).color"
                >
                  {{ log.operationType }}
                </div>

                <!-- SQL 内容 -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span v-if="log.databaseName" class="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                      <DatabaseIcon class="h-2.5 w-2.5" />{{ log.databaseName }}
                    </span>
                    <span class="text-[10px] text-muted-foreground/30">|</span>
                    <span class="flex items-center gap-1 text-[10px] text-muted-foreground/40">
                      <Clock class="h-2.5 w-2.5" />{{ formatAbsTime(log.createdAt) }}
                    </span>
                    <span class="text-[10px] text-muted-foreground/30">({{ formatTime(log.createdAt) }})</span>
                    <span v-if="log.executionTimeMs > 0" class="text-[10px] text-muted-foreground/40">
                      {{ log.executionTimeMs }}ms
                    </span>
                    <span v-if="log.affectedRows > 0" class="text-[10px] text-muted-foreground/40">
                      {{ log.affectedRows }} 行
                    </span>
                  </div>

                  <pre class="text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-all leading-relaxed line-clamp-3">{{ log.sqlText }}</pre>

                  <!-- 错误信息 -->
                  <div v-if="log.isError && log.errorMessage" class="mt-1.5 text-[10px] text-destructive bg-destructive/5 rounded px-2 py-1 border border-destructive/10">
                    {{ log.errorMessage }}
                  </div>
                </div>

                <!-- 操作按钮 -->
                <div class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" class="h-6 w-6" @click="copyToClipboard(log.sqlText)">
                    <Copy class="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 加载更多 -->
        <div v-if="hasMore" class="flex justify-center py-4">
          <Button
            variant="outline" size="sm"
            class="h-7 text-[10px] gap-1.5"
            :disabled="isLoading"
            @click="loadLogs(true)"
          >
            <ChevronDown v-if="!isLoading" class="h-3 w-3" />
            <Loader2 v-else class="h-3 w-3 animate-spin" />
            加载更多
          </Button>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
