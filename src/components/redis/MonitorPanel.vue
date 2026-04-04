<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Eye, Pause, Play, Trash2, Filter } from 'lucide-vue-next'
import { redisMonitorStart, redisMonitorStop } from '@/api/redis'
import { useConnectionStore } from '@/stores/connections'
import { getCredential } from '@/api/connection'
import { useToast } from '@/composables/useToast'
import { useAdaptiveOverscan } from '@/composables/useAdaptiveOverscan'
import type { RedisMonitorMessage } from '@/types/redis'

const props = defineProps<{
  connectionId: string
}>()

const { t } = useI18n()
const toast = useToast()
const connectionStore = useConnectionStore()

// 状态
const monitoring = ref(false)
const starting = ref(false)
const paused = ref(false)
const filterText = ref('')
const showFilter = ref(false)
const messages = ref<RedisMonitorMessage[]>([])
const messageCount = ref(0)
const MAX_MESSAGES = 10000
const ROW_HEIGHT = 24

// 虚拟滚动
const parentRef = ref<HTMLElement | null>(null)
let unlisten: UnlistenFn | null = null

const { overscan, attach: attachOverscan, detach: detachOverscan } = useAdaptiveOverscan(parentRef, {
  baseOverscan: 20,
  maxOverscan: 60,
  rowHeight: ROW_HEIGHT,
})

// 过滤
const filteredMessages = computed(() => {
  if (!filterText.value) return messages.value
  const keyword = filterText.value.toLowerCase()
  return messages.value.filter(m =>
    m.command.toLowerCase().includes(keyword) ||
    m.clientAddr.toLowerCase().includes(keyword)
  )
})

// 虚拟化实例
const virtualizer = useVirtualizer(computed(() => ({
  count: filteredMessages.value.length,
  getScrollElement: () => parentRef.value,
  estimateSize: () => ROW_HEIGHT,
  overscan: overscan.value,
})))

const virtualRows = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

// 自动滚动到底部标记
const autoScroll = ref(true)

/** 获取连接参数 */
function getConnectionParams() {
  const conn = connectionStore.connections.get(props.connectionId)
  if (!conn) throw new Error(t('redis.connectionNotFound'))
  const record = conn.record
  const config = JSON.parse(record.configJson || '{}')
  return { record, config }
}

/** 开始监控 */
async function handleStart() {
  starting.value = true
  try {
    const { record, config } = getConnectionParams()
    let password: string | null = null
    try {
      password = await getCredential(record.id) || null
    } catch { /* 无密码 */ }

    await redisMonitorStart({
      connectionId: props.connectionId,
      host: record.host,
      port: record.port,
      password,
      useTls: config.useTls ?? false,
      timeoutSecs: config.timeoutSecs ?? 10,
    })
    monitoring.value = true
  } catch (e) {
    toast.error(t('redis.monitor.startFailed'), (e as any)?.message ?? String(e))
  } finally {
    starting.value = false
  }
}

/** 停止监控 */
async function handleStop() {
  try {
    await redisMonitorStop(props.connectionId)
  } catch { /* ignore */ }
  monitoring.value = false
}

/** 清空消息 */
function clearMessages() {
  messages.value = []
  messageCount.value = 0
}

/** 格式化时间戳 */
function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString('zh-CN', { hour12: false }) +
    '.' + String(d.getMilliseconds()).padStart(3, '0')
}

/** 命令颜色映射 */
function commandColor(cmd: string): string {
  const verb = cmd.split(/\s+/)[0]?.toUpperCase() ?? ''
  // 写操作
  if (['SET', 'MSET', 'DEL', 'EXPIRE', 'HSET', 'HMSET', 'LPUSH', 'RPUSH', 'SADD', 'ZADD', 'XADD'].includes(verb))
    return 'text-amber-400/80'
  // 读操作
  if (['GET', 'MGET', 'HGET', 'HGETALL', 'LRANGE', 'SMEMBERS', 'ZRANGE', 'XRANGE', 'SCAN', 'KEYS', 'TYPE', 'TTL'].includes(verb))
    return 'text-sky-400/80'
  // 订阅
  if (['SUBSCRIBE', 'PSUBSCRIBE', 'PUBLISH', 'UNSUBSCRIBE'].includes(verb))
    return 'text-violet-400/80'
  // 系统
  if (['PING', 'INFO', 'CONFIG', 'CLIENT', 'MONITOR', 'SLOWLOG', 'MEMORY', 'DEBUG'].includes(verb))
    return 'text-emerald-400/60'
  return 'text-foreground/80'
}

/** 滚动到底部 */
function scrollToEnd() {
  if (filteredMessages.value.length > 0) {
    virtualizer.value.scrollToIndex(filteredMessages.value.length - 1, { align: 'end' })
  }
}

/** 检测用户是否在底部附近（用于自动滚动） */
function handleScroll() {
  const el = parentRef.value
  if (!el) return
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < ROW_HEIGHT * 3
  autoScroll.value = atBottom
}

// 事件监听
async function setupListener() {
  const eventName = `redis://monitor/${props.connectionId}`
  unlisten = await listen<RedisMonitorMessage>(eventName, (event) => {
    messageCount.value++
    if (paused.value) return

    messages.value.push(event.payload)
    if (messages.value.length > MAX_MESSAGES) {
      messages.value = messages.value.slice(-MAX_MESSAGES)
    }
    if (autoScroll.value) {
      nextTick(scrollToEnd)
    }
  })
}

onMounted(() => {
  setupListener()
  if (parentRef.value) {
    attachOverscan()
  }
})

// 等 parentRef 挂载后绑定 overscan 监听
watch(parentRef, (el) => {
  if (el) attachOverscan()
})

onBeforeUnmount(async () => {
  detachOverscan()
  if (unlisten) {
    unlisten()
    unlisten = null
  }
  if (monitoring.value) {
    redisMonitorStop(props.connectionId).catch(() => {})
  }
})
</script>

<template>
  <div class="flex h-full flex-col border-l border-border/40 bg-zinc-950/50">
    <!-- 头部 -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 shrink-0">
      <Eye class="h-3.5 w-3.5 text-muted-foreground/50" />
      <span class="text-xs font-bold text-muted-foreground/50 uppercase tracking-wider">MONITOR</span>
      <span v-if="messageCount > 0" class="text-[10px] font-mono text-primary/50">{{ messageCount }}</span>
      <div class="flex-1" />
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="showFilter = !showFilter">
        <Filter class="h-3.5 w-3.5" :class="showFilter ? 'text-primary' : ''" />
      </Button>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="paused = !paused">
        <Pause v-if="!paused" class="h-3.5 w-3.5" />
        <Play v-else class="h-3.5 w-3.5 text-df-success" />
      </Button>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="clearMessages">
        <Trash2 class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- 过滤器 -->
    <div v-if="showFilter" class="flex items-center gap-2 px-3 py-1.5 border-b border-border/10 shrink-0">
      <Input
        v-model="filterText"
        :placeholder="t('redis.monitor.filterPlaceholder')"
        class="h-7 flex-1 text-xs font-mono"
      />
    </div>

    <!-- 控制栏 -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 shrink-0">
      <Button
        v-if="!monitoring"
        size="sm"
        class="h-7 text-xs px-3"
        :disabled="starting"
        @click="handleStart"
      >
        {{ starting ? t('redis.connecting') : t('redis.monitor.start') }}
      </Button>
      <Button
        v-else
        variant="destructive"
        size="sm"
        class="h-7 text-xs px-3"
        @click="handleStop"
      >
        {{ t('redis.monitor.stop') }}
      </Button>
      <span v-if="monitoring" class="text-[10px] text-df-success/60 flex items-center gap-1">
        <span class="h-1.5 w-1.5 rounded-full bg-df-success animate-pulse" />
        {{ t('redis.monitor.running') }}
      </span>
      <span class="text-[10px] text-muted-foreground/30 ml-auto">{{ t('redis.monitor.hint') }}</span>
    </div>

    <!-- 虚拟滚动命令流 -->
    <div
      ref="parentRef"
      class="flex-1 overflow-auto font-mono text-xs"
      @scroll="handleScroll"
    >
      <template v-if="filteredMessages.length > 0">
        <div :style="{ height: `${totalSize}px`, width: '100%', position: 'relative' }">
          <div
            v-for="row in virtualRows"
            :key="row.index"
            class="flex items-center gap-2 py-0.5 hover:bg-muted/10 px-3 absolute left-0 w-full"
            :style="{ height: `${row.size}px`, transform: `translateY(${row.start}px)` }"
          >
            <span class="text-[10px] text-muted-foreground/30 shrink-0 tabular-nums w-[80px]">
              {{ formatTime(filteredMessages[row.index]!.timestamp) }}
            </span>
            <span class="text-[10px] text-primary/40 shrink-0 w-[40px] truncate" :title="filteredMessages[row.index]!.database">
              [{{ filteredMessages[row.index]!.database }}]
            </span>
            <span class="text-[10px] text-muted-foreground/40 shrink-0 w-[120px] truncate" :title="filteredMessages[row.index]!.clientAddr">
              {{ filteredMessages[row.index]!.clientAddr }}
            </span>
            <span class="truncate leading-relaxed" :class="commandColor(filteredMessages[row.index]!.command)">
              {{ filteredMessages[row.index]!.command }}
            </span>
          </div>
        </div>
      </template>
      <div v-else class="text-muted-foreground/20 text-center py-8">
        <template v-if="!monitoring">
          {{ t('redis.monitor.notStarted') }}
        </template>
        <template v-else-if="messageCount === 0">
          {{ t('redis.monitor.waiting') }}
        </template>
        <template v-else>
          {{ t('redis.monitor.noMatch') }}
        </template>
      </div>
    </div>
  </div>
</template>
