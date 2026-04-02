<script setup lang="ts">
/**
 * SlowQueryPanel - 慢查询 Top N 分析面板
 * 基于 performance_schema.events_statements_summary_by_digest
 */
import { ref, onMounted } from 'vue'
import { dbGetSlowQueryDigest } from '@/api/database'
import type { SlowQueryDigest } from '@/types/database'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { useMessage } from '@/stores/message-center'
import { RefreshCw, Clock, AlertTriangle, Copy } from 'lucide-vue-next'

const props = defineProps<{
  connectionId: string
  isConnected: boolean
}>()

const message = useMessage()
const isLoading = ref(false)
const digests = ref<SlowQueryDigest[]>([])
const limit = ref(20)
const errorMsg = ref<string | null>(null)

/** 加载慢查询摘要 */
async function fetchDigests() {
  if (!props.isConnected) return
  isLoading.value = true
  errorMsg.value = null
  try {
    digests.value = await dbGetSlowQueryDigest(props.connectionId, limit.value)
  } catch (e) {
    errorMsg.value = String(e)
  } finally {
    isLoading.value = false
  }
}

/** 格式化毫秒为可读时间 */
function formatMs(ms: number): string {
  if (ms >= 1000) return (ms / 1000).toFixed(2) + 's'
  return ms.toFixed(2) + 'ms'
}

/** 格式化行数 */
function formatRows(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

/** 复制 SQL 到剪贴板 */
async function copySql(sql: string) {
  try {
    await navigator.clipboard.writeText(sql)
    message.success('已复制到剪贴板')
  } catch {
    message.error('复制失败')
  }
}

onMounted(() => { fetchDigests() })
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden px-6 pt-4">
    <!-- 标题栏 -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="p-2 rounded-xl bg-destructive/10 text-destructive shadow-sm">
          <Clock class="h-5 w-5" />
        </div>
        <div>
          <h3 class="text-sm font-black tracking-tight uppercase">慢查询分析 (Slow Query Digest)</h3>
          <p class="text-[10px] text-muted-foreground/40 font-medium">基于 performance_schema 统计的 Top {{ limit }} 高耗时 SQL</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold px-3 py-1 rounded-full bg-muted border border-border/10 text-muted-foreground">
          {{ digests.length }} 条记录
        </span>
        <Button size="icon" variant="ghost" class="h-8 w-8 rounded-full" @click="fetchDigests">
          <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': isLoading }" />
        </Button>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="errorMsg" class="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-center gap-2">
      <AlertTriangle class="h-4 w-4 shrink-0" />
      {{ errorMsg }}
    </div>

    <!-- 慢查询列表 -->
    <div class="flex-1 border border-border/10 rounded-2xl overflow-hidden bg-muted/5">
      <ScrollArea class="h-full">
        <table class="w-full text-left border-collapse">
          <thead class="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/20">
            <tr class="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest h-12">
              <th class="px-4 w-12">#</th>
              <th class="px-4">SQL 摘要</th>
              <th class="px-4 w-20 text-right">执行次数</th>
              <th class="px-4 w-24 text-right">平均耗时</th>
              <th class="px-4 w-24 text-right">最大耗时</th>
              <th class="px-4 w-24 text-right">总耗时</th>
              <th class="px-4 w-24 text-right">扫描行数</th>
              <th class="px-4 w-24 text-right">返回行数</th>
              <th class="px-4 w-12"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border/5">
            <tr v-for="(d, i) in digests" :key="i" class="text-xs hover:bg-primary/[0.03] transition-colors group">
              <td class="px-4 py-3 font-mono font-bold text-muted-foreground/40">{{ i + 1 }}</td>
              <td class="px-4 py-3 max-w-md">
                <div class="font-mono text-[11px] leading-relaxed text-foreground/80 line-clamp-2 group-hover:line-clamp-none">
                  {{ d.digestText }}
                </div>
                <div v-if="d.lastSeen" class="text-[10px] text-muted-foreground/30 mt-1">
                  最后执行: {{ d.lastSeen }}
                </div>
              </td>
              <td class="px-4 py-3 text-right font-mono font-bold text-df-warning">{{ formatRows(d.execCount) }}</td>
              <td class="px-4 py-3 text-right font-mono font-bold" :class="d.avgTimeMs > 1000 ? 'text-destructive' : 'text-foreground/70'">
                {{ formatMs(d.avgTimeMs) }}
              </td>
              <td class="px-4 py-3 text-right font-mono font-bold" :class="d.maxTimeMs > 5000 ? 'text-destructive' : 'text-foreground/70'">
                {{ formatMs(d.maxTimeMs) }}
              </td>
              <td class="px-4 py-3 text-right font-mono font-bold text-primary">{{ formatMs(d.totalTimeMs) }}</td>
              <td class="px-4 py-3 text-right font-mono text-muted-foreground/60">{{ formatRows(d.rowsExamined) }}</td>
              <td class="px-4 py-3 text-right font-mono text-muted-foreground/60">{{ formatRows(d.rowsSent) }}</td>
              <td class="px-4 py-3">
                <Button variant="ghost" size="icon" class="h-7 w-7 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" @click="copySql(d.digestText)">
                  <Copy class="h-3 w-3" />
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="digests.length === 0 && !isLoading && !errorMsg" class="flex flex-col items-center justify-center h-64 opacity-20">
          <Clock class="h-12 w-12 mb-3" />
          <p class="text-xs font-black uppercase tracking-widest">No Slow Queries Found</p>
          <p class="text-[10px] mt-1">performance_schema 可能未启用或没有慢查询记录</p>
        </div>
      </ScrollArea>
    </div>
  </div>
</template>
