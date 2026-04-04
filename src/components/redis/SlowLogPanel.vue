<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RefreshCw, Settings, Trash2, ChevronDown, Activity } from 'lucide-vue-next'
import {
  redisSlowlogGet,
  redisSlowlogConfig,
  redisSlowlogReset,
  redisSetSlowlogThreshold,
  redisSetSlowlogMaxLen,
} from '@/api/redis'
import { useToast } from '@/composables/useToast'
import type { RedisSlowLogEntry, RedisSlowLogConfig } from '@/types/redis'

const props = defineProps<{
  connectionId: string
}>()

const { t } = useI18n()
const toast = useToast()

// 状态
const entries = ref<RedisSlowLogEntry[]>([])
const config = ref<RedisSlowLogConfig | null>(null)
const loading = ref(false)
const expandedEntries = ref<Set<number>>(new Set())

// 配置对话框
const showConfig = ref(false)
const newThreshold = ref(10000)
const newMaxLen = ref(128)

// 重置确认
const showResetConfirm = ref(false)

// 排序后的条目（按时间倒序）
const sortedEntries = computed(() => {
  return [...entries.value].sort((a, b) => b.timestamp - a.timestamp)
})

/** 耗时颜色 */
function getDurationClass(durationUs: number): string {
  const ms = durationUs / 1000
  if (ms < 1) return 'text-emerald-400'
  if (ms < 10) return 'text-amber-400'
  return 'text-red-400'
}

/** 格式化耗时 */
function formatDuration(durationUs: number): string {
  const ms = durationUs / 1000
  if (ms < 1) return `${durationUs}μs`
  if (ms < 1000) return `${ms.toFixed(2)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** 格式化时间 */
function formatTime(timestamp: number): string {
  const d = new Date(timestamp * 1000)
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

/** 展开/折叠条目 */
function toggleExpand(id: number) {
  if (expandedEntries.value.has(id)) {
    expandedEntries.value.delete(id)
  } else {
    expandedEntries.value.add(id)
  }
}

/** 加载数据 */
async function loadData() {
  loading.value = true
  try {
    const [e, c] = await Promise.all([
      redisSlowlogGet(props.connectionId, 128),
      redisSlowlogConfig(props.connectionId),
    ])
    entries.value = e
    config.value = c
    newThreshold.value = c.thresholdUs
    newMaxLen.value = c.maxLen
  } catch (e) {
    toast.error(t('redis.slowlog.loadFailed'), (e as any)?.message ?? String(e))
  } finally {
    loading.value = false
  }
}

/** 重置慢查询日志 */
async function handleReset() {
  try {
    await redisSlowlogReset(props.connectionId)
    toast.success(t('redis.slowlog.resetSuccess'))
    showResetConfirm.value = false
    await loadData()
  } catch (e) {
    toast.error(t('redis.slowlog.resetFailed'), (e as any)?.message ?? String(e))
  }
}

/** 保存配置 */
async function handleConfigSave() {
  try {
    if (newThreshold.value !== config.value?.thresholdUs) {
      await redisSetSlowlogThreshold(props.connectionId, newThreshold.value)
    }
    if (newMaxLen.value !== config.value?.maxLen) {
      await redisSetSlowlogMaxLen(props.connectionId, newMaxLen.value)
    }
    toast.success(t('redis.slowlog.configUpdated'))
    showConfig.value = false
    await loadData()
  } catch (e) {
    toast.error(t('redis.slowlog.configFailed'), (e as any)?.message ?? String(e))
  }
}

onMounted(() => { loadData() })
</script>

<template>
  <div class="flex h-full flex-col border-l border-border/40 bg-zinc-950/30">
    <!-- 头部 -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 shrink-0">
      <Activity class="h-3.5 w-3.5 text-muted-foreground/50" />
      <span class="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider">
        {{ t('redis.slowlog.title') }}
      </span>
      <span v-if="config" class="text-[9px] font-mono text-primary/50">
        {{ config.currentLen }}
      </span>
      <div class="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        class="h-6 w-6 p-0"
        :disabled="loading"
        @click="loadData"
      >
        <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': loading }" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 w-6 p-0"
        @click="showConfig = true"
      >
        <Settings class="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 w-6 p-0"
        @click="showResetConfirm = true"
      >
        <Trash2 class="h-3 w-3" />
      </Button>
    </div>

    <!-- 配置摘要 -->
    <div v-if="config" class="flex items-center gap-3 px-3 py-1 border-b border-border/10 text-[9px] text-muted-foreground/40 shrink-0">
      <span>{{ t('redis.slowlog.threshold') }}: {{ config.thresholdUs }}μs</span>
      <span>{{ t('redis.slowlog.maxEntries') }}: {{ config.maxLen }}</span>
    </div>

    <!-- 内容区 -->
    <div class="flex-1 overflow-auto">
      <!-- 空状态 -->
      <div v-if="sortedEntries.length === 0" class="text-muted-foreground/20 text-center py-8 text-[11px]">
        {{ t('redis.slowlog.noEntries') }}
      </div>

      <!-- 列表 -->
      <div v-else class="font-mono text-[11px]">
        <!-- 表头 -->
        <div class="flex items-center gap-1.5 px-3 py-1 text-[9px] font-bold text-muted-foreground/40 border-b border-border/10 sticky top-0 bg-zinc-950/80 backdrop-blur-sm">
          <span class="w-8 shrink-0">ID</span>
          <span class="w-24 shrink-0">{{ t('redis.slowlog.time') }}</span>
          <span class="w-14 shrink-0 text-right">{{ t('redis.slowlog.duration') }}</span>
          <span class="flex-1 min-w-0">{{ t('redis.slowlog.command') }}</span>
        </div>

        <!-- 行 -->
        <div v-for="entry in sortedEntries" :key="entry.id" class="border-b border-border/5">
          <button
            class="w-full flex items-center gap-1.5 px-3 py-1.5 hover:bg-muted/10 transition-colors text-left"
            @click="toggleExpand(entry.id)"
          >
            <span class="w-8 shrink-0 text-muted-foreground/30">#{{ entry.id }}</span>
            <span class="w-24 shrink-0 text-muted-foreground/50 text-[10px]">
              {{ formatTime(entry.timestamp) }}
            </span>
            <span
              class="w-14 shrink-0 text-right font-bold"
              :class="getDurationClass(entry.durationUs)"
            >
              {{ formatDuration(entry.durationUs) }}
            </span>
            <span class="flex-1 min-w-0 text-foreground/70 truncate">
              {{ entry.command.toUpperCase() }}
              <span v-if="entry.commandArgs.length > 1" class="text-muted-foreground/30">
                {{ entry.commandArgs.slice(1).join(' ').substring(0, 40) }}
              </span>
            </span>
            <ChevronDown
              class="h-3 w-3 shrink-0 text-muted-foreground/20 transition-transform"
              :class="{ 'rotate-180': expandedEntries.has(entry.id) }"
            />
          </button>

          <!-- 展开详情 -->
          <div
            v-if="expandedEntries.has(entry.id)"
            class="bg-muted/5 px-3 py-2 border-t border-border/5 space-y-1.5"
          >
            <div class="text-[10px] text-muted-foreground/50">
              <span class="font-bold">{{ t('redis.slowlog.fullCommand') }}:</span>
            </div>
            <div class="bg-zinc-900/60 rounded px-2 py-1.5 text-[10px] text-foreground/60 overflow-x-auto max-h-20 whitespace-pre-wrap break-all">
              {{ entry.commandArgs.join(' ') }}
            </div>
            <div class="flex gap-4 text-[9px] text-muted-foreground/30">
              <span>{{ entry.durationUs }}μs</span>
              <span>{{ t('redis.slowlog.client') }}: {{ entry.clientAddr }}</span>
              <span v-if="entry.clientName">{{ t('redis.slowlog.clientName') }}: {{ entry.clientName }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 配置对话框 -->
    <Dialog :open="showConfig" @update:open="showConfig = $event">
      <DialogContent class="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>{{ t('redis.slowlog.configure') }}</DialogTitle>
          <DialogDescription>{{ t('redis.slowlog.thresholdHint') }}</DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">{{ t('redis.slowlog.threshold') }}</label>
            <Input v-model.number="newThreshold" type="number" class="text-[11px]" />
            <p class="text-[10px] text-muted-foreground/50">
              {{ t('redis.slowlog.currentValue') }}: {{ config?.thresholdUs ?? 0 }}μs
            </p>
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">{{ t('redis.slowlog.maxEntries') }}</label>
            <Input v-model.number="newMaxLen" type="number" class="text-[11px]" />
            <p class="text-[10px] text-muted-foreground/50">
              {{ t('redis.slowlog.currentValue') }}: {{ config?.maxLen ?? 0 }}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" @click="showConfig = false">
            {{ t('common.cancel') }}
          </Button>
          <Button size="sm" @click="handleConfigSave">
            {{ t('common.save') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 重置确认对话框 -->
    <Dialog :open="showResetConfirm" @update:open="showResetConfirm = $event">
      <DialogContent class="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>{{ t('redis.slowlog.reset') }}</DialogTitle>
          <DialogDescription>{{ t('redis.slowlog.resetConfirm') }}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" @click="showResetConfirm = false">
            {{ t('common.cancel') }}
          </Button>
          <Button variant="destructive" size="sm" @click="handleReset">
            {{ t('redis.slowlog.reset') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
