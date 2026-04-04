<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MemoryStick, RefreshCw, Loader2, AlertTriangle } from 'lucide-vue-next'
import { redisMemoryStats, redisMemoryDoctor, redisTopKeysByMemory } from '@/api/redis'
import { useToast } from '@/composables/useToast'
import type { RedisMemoryStats, RedisKeyMemory } from '@/types/redis'

const props = defineProps<{
  connectionId: string
}>()

const { t } = useI18n()
const toast = useToast()

// 内存统计
const stats = ref<RedisMemoryStats | null>(null)
const loadingStats = ref(false)

// Doctor 建议
const doctorAdvice = ref('')
const showDoctor = ref(false)
const loadingDoctor = ref(false)

// Top-N 键
const topKeys = ref<RedisKeyMemory[]>([])
const loadingTopKeys = ref(false)
const topCount = ref(20)

/** 加载内存统计 */
async function loadStats() {
  loadingStats.value = true
  try {
    stats.value = await redisMemoryStats(props.connectionId)
  } catch (e) {
    toast.error(t('redis.memory.loadFailed'), (e as any)?.message ?? String(e))
  } finally {
    loadingStats.value = false
  }
}

/** 加载 MEMORY DOCTOR */
async function loadDoctor() {
  loadingDoctor.value = true
  try {
    doctorAdvice.value = await redisMemoryDoctor(props.connectionId)
    showDoctor.value = true
  } catch (e) {
    toast.error(t('redis.memory.loadFailed'), (e as any)?.message ?? String(e))
  } finally {
    loadingDoctor.value = false
  }
}

/** 计算 Top-N 键 */
async function loadTopKeys() {
  loadingTopKeys.value = true
  try {
    topKeys.value = await redisTopKeysByMemory({
      connectionId: props.connectionId,
      count: topCount.value,
    })
  } catch (e) {
    toast.error(t('redis.memory.loadFailed'), (e as any)?.message ?? String(e))
  } finally {
    loadingTopKeys.value = false
  }
}

/** 格式化字节 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// 初始加载
loadStats()
</script>

<template>
  <div class="flex h-full flex-col border-l border-border/40 bg-zinc-950/50">
    <!-- 头部 -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 shrink-0">
      <MemoryStick class="h-3.5 w-3.5 text-muted-foreground/50" />
      <span class="text-xs font-bold text-muted-foreground/50 uppercase tracking-wider">{{ t('redis.memory.title') }}</span>
      <div class="flex-1" />
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="loadStats" :disabled="loadingStats">
        <RefreshCw class="h-3.5 w-3.5" :class="loadingStats && 'animate-spin'" />
      </Button>
    </div>

    <div class="flex-1 overflow-auto p-3 space-y-4">
      <!-- 统计卡片 -->
      <div v-if="stats" class="grid grid-cols-2 gap-2">
        <div class="rounded-lg border border-border/20 bg-muted/10 p-2.5">
          <div class="text-[10px] text-muted-foreground/50 uppercase">{{ t('redis.memory.usedMemory') }}</div>
          <div class="text-sm font-bold text-foreground mt-0.5">{{ stats.usedMemoryHuman }}</div>
        </div>
        <div class="rounded-lg border border-border/20 bg-muted/10 p-2.5">
          <div class="text-[10px] text-muted-foreground/50 uppercase">{{ t('redis.memory.peakMemory') }}</div>
          <div class="text-sm font-bold text-foreground mt-0.5">{{ stats.usedMemoryPeakHuman }}</div>
        </div>
        <div class="rounded-lg border border-border/20 bg-muted/10 p-2.5">
          <div class="text-[10px] text-muted-foreground/50 uppercase">{{ t('redis.memory.fragmentation') }}</div>
          <div class="text-sm font-bold mt-0.5" :class="stats.memFragmentationRatio > 1.5 ? 'text-amber-400' : 'text-foreground'">
            {{ stats.memFragmentationRatio.toFixed(2) }}
          </div>
        </div>
        <div class="rounded-lg border border-border/20 bg-muted/10 p-2.5">
          <div class="text-[10px] text-muted-foreground/50 uppercase">{{ t('redis.memory.evicted') }}</div>
          <div class="text-sm font-bold text-foreground mt-0.5">{{ stats.evictedKeys }}</div>
        </div>
      </div>

      <!-- MEMORY DOCTOR -->
      <div>
        <Button variant="outline" size="sm" class="h-7 text-xs w-full" @click="loadDoctor" :disabled="loadingDoctor">
          <Loader2 v-if="loadingDoctor" class="h-3.5 w-3.5 mr-1 animate-spin" />
          {{ t('redis.memory.doctor') }}
        </Button>
        <div v-if="showDoctor" class="mt-2 p-2.5 rounded-lg border border-border/20 bg-muted/10 text-xs text-foreground/80 font-mono whitespace-pre-wrap break-words">
          {{ doctorAdvice }}
        </div>
      </div>

      <!-- Top-N 键 -->
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold text-muted-foreground/50 uppercase">{{ t('redis.memory.topKeys') }}</span>
          <div class="flex-1" />
          <Input
            type="number"
            v-model.number="topCount"
            class="h-7 w-16 text-xs text-center"
            min="1"
            max="100"
          />
          <Button variant="outline" size="sm" class="h-7 text-xs px-2" @click="loadTopKeys" :disabled="loadingTopKeys">
            <Loader2 v-if="loadingTopKeys" class="h-3.5 w-3.5 mr-1 animate-spin" />
            {{ t('redis.memory.calculate') }}
          </Button>
        </div>
        <div class="flex items-center gap-1.5 text-[10px] text-amber-500/60 px-1">
          <AlertTriangle class="h-3.5 w-3.5 shrink-0" />
          <span>{{ t('redis.memory.warning') }}</span>
        </div>
        <div v-if="topKeys.length > 0" class="space-y-0.5">
          <div
            v-for="(item, i) in topKeys"
            :key="item.key"
            class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/10 text-xs"
          >
            <span class="text-muted-foreground/30 w-5 text-right shrink-0 tabular-nums">#{{ i + 1 }}</span>
            <span class="font-mono text-foreground/80 truncate flex-1" :title="item.key">{{ item.key }}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary/70 shrink-0">{{ item.keyType }}</span>
            <span class="text-muted-foreground/60 shrink-0 tabular-nums">{{ formatBytes(item.memoryBytes) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
