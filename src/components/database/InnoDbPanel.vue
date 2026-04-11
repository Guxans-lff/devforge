<script setup lang="ts">
/**
 * InnoDbPanel - InnoDB 引擎状态面板
 * 展示 Buffer Pool、锁、行操作、Redo Log 等核心指标
 */
import { ref, computed, onMounted } from 'vue'
import { dbGetInnoDbStatus } from '@/api/database'
import type { InnoDbStatus } from '@/types/database'
import { Button } from '@/components/ui/button'
import { RefreshCw, Database, Lock, FileText, AlertTriangle, HardDrive } from 'lucide-vue-next'

const props = defineProps<{
  connectionId: string
  isConnected: boolean
}>()

const isLoading = ref(false)
const status = ref<InnoDbStatus | null>(null)
const errorMsg = ref<string | null>(null)

async function fetchStatus() {
  if (!props.isConnected) return
  isLoading.value = true
  errorMsg.value = null
  try {
    status.value = await dbGetInnoDbStatus(props.connectionId)
  } catch (e) {
    errorMsg.value = String(e)
  } finally {
    isLoading.value = false
  }
}

/** 格式化字节 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB'
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return bytes + ' B'
}

/** 格式化大数字 */
function formatNum(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

/** 指标分组 */
const metricGroups = computed(() => {
  const s = status.value
  if (!s) return []

  const usedPages = s.bufferPoolPagesTotal - s.bufferPoolPagesFree
  const usagePercent = s.bufferPoolPagesTotal > 0
    ? ((usedPages / s.bufferPoolPagesTotal) * 100).toFixed(1)
    : '0'

  return [
    {
      title: 'Buffer Pool',
      icon: Database,
      color: 'text-primary',
      bg: 'bg-primary/10',
      items: [
        { label: '总页数', value: formatNum(s.bufferPoolPagesTotal) },
        { label: '空闲页', value: formatNum(s.bufferPoolPagesFree) },
        { label: '脏页', value: formatNum(s.bufferPoolPagesDirty), warn: s.bufferPoolPagesDirty > s.bufferPoolPagesTotal * 0.3 },
        { label: '利用率', value: usagePercent + '%' },
        { label: '命中率', value: (s.bufferPoolHitRate * 100).toFixed(2) + '%', warn: s.bufferPoolHitRate < 0.99 },
      ],
    },
    {
      title: '行锁状态',
      icon: Lock,
      color: 'text-df-warning',
      bg: 'bg-df-warning/10',
      items: [
        { label: '当前等待锁数', value: String(s.rowLockCurrentWaits), warn: s.rowLockCurrentWaits > 0 },
        { label: '平均锁等待 (ms)', value: s.rowLockTimeAvgMs.toFixed(2), warn: s.rowLockTimeAvgMs > 100 },
        { label: '死锁次数', value: String(s.deadlocks), warn: s.deadlocks > 0 },
      ],
    },
    {
      title: '行操作统计',
      icon: FileText,
      color: 'text-df-success',
      bg: 'bg-df-success/10',
      items: [
        { label: '读取 (Read)', value: formatNum(s.rowsRead) },
        { label: '插入 (Insert)', value: formatNum(s.rowsInserted) },
        { label: '更新 (Update)', value: formatNum(s.rowsUpdated) },
        { label: '删除 (Delete)', value: formatNum(s.rowsDeleted) },
      ],
    },
    {
      title: 'Redo Log',
      icon: HardDrive,
      color: 'text-df-info',
      bg: 'bg-df-info/10',
      items: [
        { label: '已写入日志', value: formatBytes(s.logBytesWritten) },
        { label: '挂起 fsync', value: String(s.logPendingFsyncs), warn: s.logPendingFsyncs > 5 },
      ],
    },
  ]
})

onMounted(() => { fetchStatus() })
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden px-6 pt-4">
    <!-- 标题栏 -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="p-2 rounded-xl bg-primary/10 text-primary shadow-sm">
          <Database class="h-5 w-5" />
        </div>
        <div>
          <h3 class="text-sm font-black tracking-tight uppercase">InnoDB 引擎状态 (Engine Status)</h3>
          <p class="text-[10px] text-muted-foreground/40 font-medium">Buffer Pool、行锁、行操作、Redo Log 核心指标</p>
        </div>
      </div>
      <Button size="icon" variant="ghost" class="h-8 w-8 rounded-full" @click="fetchStatus">
        <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': isLoading }" />
      </Button>
    </div>

    <!-- 错误提示 -->
    <div v-if="errorMsg" class="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-center gap-2">
      <AlertTriangle class="h-4 w-4 shrink-0" />
      {{ errorMsg }}
    </div>

    <!-- 加载中 -->
    <div v-if="!status && !errorMsg" class="flex-1 flex items-center justify-center">
      <div class="text-center text-muted-foreground">
        <RefreshCw class="mx-auto h-8 w-8 animate-spin mb-2 opacity-50" />
        <p class="text-sm">正在获取 InnoDB 状态...</p>
      </div>
    </div>

    <!-- 指标卡片网格 -->
    <div v-if="status" class="flex-1 overflow-auto">
      <div class="grid grid-cols-2 gap-4">
        <div
          v-for="group in metricGroups"
          :key="group.title"
          class="rounded-2xl border border-border/20 bg-card/30 backdrop-blur-sm p-5"
        >
          <div class="flex items-center gap-2 mb-4">
            <div class="p-1.5 rounded-lg" :class="group.bg">
              <component :is="group.icon" class="h-4 w-4" :class="group.color" />
            </div>
            <h4 class="text-xs font-black uppercase tracking-wider" :class="group.color">{{ group.title }}</h4>
          </div>
          <div class="space-y-3">
            <div
              v-for="item in group.items"
              :key="item.label"
              class="flex items-center justify-between"
            >
              <span class="text-xs text-muted-foreground/70">{{ item.label }}</span>
              <span
                class="text-sm font-mono font-bold"
                :class="item.warn ? 'text-destructive' : 'text-foreground/80'"
              >
                {{ item.value }}
                <AlertTriangle v-if="item.warn" class="inline h-3 w-3 ml-1 text-destructive" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
