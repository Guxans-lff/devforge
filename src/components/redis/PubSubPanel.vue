<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Radio, Pause, Play, Trash2, X, Send, Filter } from 'lucide-vue-next'
import {
  redisPubsubSubscribe,
  redisPubsubStop,
  redisPublish,
} from '@/api/redis'
import { useConnectionStore } from '@/stores/connections'
import { useToast } from '@/composables/useToast'
import type { PubSubMessage } from '@/types/redis'

const props = defineProps<{
  connectionId: string
}>()

const { t } = useI18n()
const toast = useToast()
const connectionStore = useConnectionStore()

// 订阅状态
const channelInput = ref('')
const subscribedChannels = ref<string[]>([])
const subscribedPatterns = ref<string[]>([])

// 消息流（带本地发送标记）
interface DisplayMessage extends PubSubMessage {
  isSent?: boolean
}
const messages = ref<DisplayMessage[]>([])
const paused = ref(false)
const filterText = ref('')
const showFilter = ref(false)
const messageCount = ref(0)
const MAX_MESSAGES = 1000

// 发布
const publishChannel = ref('')
const publishMessage = ref('')
const publishing = ref(false)

// 用于标记本面板发出的消息（channel+payload → 到期自动清理）
const sentMessages = new Set<string>()

// 事件监听
let unlisten: UnlistenFn | null = null
const outputRef = ref<HTMLElement>()

// 过滤后的消息
const filteredMessages = computed(() => {
  if (!filterText.value) return messages.value
  const keyword = filterText.value.toLowerCase()
  return messages.value.filter(m =>
    m.channel.toLowerCase().includes(keyword) ||
    m.payload.toLowerCase().includes(keyword)
  )
})

// 是否有活跃订阅
const hasSubscriptions = computed(() =>
  subscribedChannels.value.length > 0 || subscribedPatterns.value.length > 0
)

/** 获取带密码的完整 URL */
async function getFullUrl(): Promise<string> {
  const conn = connectionStore.connections.get(props.connectionId)
  if (!conn) throw new Error('连接记录不存在')
  const record = conn.record
  const config = JSON.parse(record.configJson || '{}')
  const scheme = config.useTls ? 'rediss' : 'redis'

  let auth = ''
  try {
    const { getCredential } = await import('@/api/connection')
    const password = await getCredential(record.id)
    if (password) {
      auth = `:${encodeURIComponent(password)}@`
    }
  } catch { /* 无密码 */ }

  return `${scheme}://${auth}${record.host}:${record.port}/${config.database ?? 0}`
}

/** 订阅频道 */
async function handleSubscribe(isPattern: boolean) {
  const input = channelInput.value.trim()
  if (!input) return

  try {
    const url = await getFullUrl()
    const channels = isPattern ? [] : [input]
    const patterns = isPattern ? [input] : []

    if (hasSubscriptions.value) {
      // 已有订阅，合并新频道 — 需要重新创建整个 PubSub 连接
      const allChannels = [...subscribedChannels.value, ...channels]
      const allPatterns = [...subscribedPatterns.value, ...patterns]
      await redisPubsubSubscribe(props.connectionId, url, allChannels, allPatterns)
      subscribedChannels.value = allChannels
      subscribedPatterns.value = allPatterns
    } else {
      await redisPubsubSubscribe(props.connectionId, url, channels, patterns)
      subscribedChannels.value = channels
      subscribedPatterns.value = patterns
    }

    channelInput.value = ''
  } catch (e) {
    toast.error(t('redis.pubsub.subscribeFailed'), (e as any)?.message ?? String(e))
  }
}

/** 取消单个订阅 */
async function handleUnsubscribe(name: string, isPattern: boolean) {
  try {
    const url = await getFullUrl()
    const channels = isPattern ? [] : [name]
    const patterns = isPattern ? [name] : []

    // 移除后重新订阅剩余的
    const remainingChannels = subscribedChannels.value.filter(ch => !channels.includes(ch))
    const remainingPatterns = subscribedPatterns.value.filter(pat => !patterns.includes(pat))

    if (remainingChannels.length === 0 && remainingPatterns.length === 0) {
      await redisPubsubStop(props.connectionId)
    } else {
      await redisPubsubSubscribe(props.connectionId, url, remainingChannels, remainingPatterns)
    }

    subscribedChannels.value = remainingChannels
    subscribedPatterns.value = remainingPatterns
  } catch (e) {
    toast.error(t('redis.pubsub.unsubscribeFailed'), (e as any)?.message ?? String(e))
  }
}

/** 停止所有订阅 */
async function handleStopAll() {
  try {
    await redisPubsubStop(props.connectionId)
    subscribedChannels.value = []
    subscribedPatterns.value = []
  } catch (e) {
    toast.error('停止失败', (e as any)?.message ?? String(e))
  }
}

/** 发布消息 */
async function handlePublish() {
  const ch = publishChannel.value.trim()
  const msg = publishMessage.value.trim()
  if (!ch || !msg) return

  publishing.value = true
  try {
    // 标记为本面板发出的消息（用于去重回显）
    const sentKey = `${ch}\x00${msg}`
    sentMessages.add(sentKey)
    setTimeout(() => sentMessages.delete(sentKey), 3000)

    const receivers = await redisPublish(props.connectionId, ch, msg)

    // 直接插入发送消息到流中（不依赖订阅回显）
    if (!paused.value) {
      messages.value.push({
        channel: ch,
        pattern: null,
        payload: msg,
        timestampMs: Date.now(),
        isSent: true,
      })
      if (messages.value.length > MAX_MESSAGES) {
        messages.value = messages.value.slice(-MAX_MESSAGES)
      }
      nextTick(scrollToBottom)
    }

    toast.success(t('redis.pubsub.published', { count: receivers }))
    publishMessage.value = ''
  } catch (e) {
    toast.error(t('redis.pubsub.publishFailed'), (e as any)?.message ?? String(e))
  } finally {
    publishing.value = false
  }
}

/** 清空消息 */
function clearMessages() {
  messages.value = []
  messageCount.value = 0
}

/** 格式化时间戳 */
function formatTime(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleTimeString('zh-CN', { hour12: false }) +
    '.' + String(d.getMilliseconds()).padStart(3, '0')
}

/** 滚动到底部 */
function scrollToBottom() {
  if (outputRef.value) {
    outputRef.value.scrollTop = outputRef.value.scrollHeight
  }
}

// 设置事件监听
async function setupListener() {
  const eventName = `redis://pubsub/${props.connectionId}`
  unlisten = await listen<PubSubMessage>(eventName, (event) => {
    messageCount.value++
    if (paused.value) return

    const msg = event.payload
    // 检查是否是本面板发出的消息（已在 handlePublish 中直接插入，跳过回显）
    const sentKey = `${msg.channel}\x00${msg.payload}`
    if (sentMessages.has(sentKey)) {
      sentMessages.delete(sentKey)
      return // 已在发布时插入，不重复添加
    }

    messages.value.push({ ...msg, isSent: false })
    // 超过最大数量时丢弃最旧的
    if (messages.value.length > MAX_MESSAGES) {
      messages.value = messages.value.slice(-MAX_MESSAGES)
    }

    nextTick(scrollToBottom)
  })
}

onMounted(() => {
  setupListener()
})

onBeforeUnmount(async () => {
  // 取消事件监听
  if (unlisten) {
    unlisten()
    unlisten = null
  }
  // 停止后端 PubSub
  if (hasSubscriptions.value) {
    redisPubsubStop(props.connectionId).catch(() => {})
  }
})
</script>

<template>
  <div class="flex h-full flex-col border-l border-border/40 bg-zinc-950/50">
    <!-- 头部 -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 shrink-0">
      <Radio class="h-3.5 w-3.5 text-muted-foreground/50" />
      <span class="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider">PUB/SUB</span>
      <span v-if="messageCount > 0" class="text-[9px] font-mono text-primary/50">{{ messageCount }}</span>
      <div class="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        class="h-6 w-6 p-0"
        :title="showFilter ? t('redis.pubsub.hideFilter') : t('redis.pubsub.showFilter')"
        @click="showFilter = !showFilter"
      >
        <Filter class="h-3 w-3" :class="showFilter ? 'text-primary' : ''" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 w-6 p-0"
        :title="paused ? t('redis.pubsub.resume') : t('redis.pubsub.pause')"
        @click="paused = !paused"
      >
        <Pause v-if="!paused" class="h-3 w-3" />
        <Play v-else class="h-3 w-3 text-df-success" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 w-6 p-0"
        :title="t('redis.pubsub.clear')"
        @click="clearMessages"
      >
        <Trash2 class="h-3 w-3" />
      </Button>
    </div>

    <!-- 过滤器 -->
    <div v-if="showFilter" class="flex items-center gap-2 px-3 py-1.5 border-b border-border/10 shrink-0">
      <Input
        v-model="filterText"
        :placeholder="t('redis.pubsub.filterPlaceholder')"
        class="h-6 flex-1 text-[10px] font-mono"
      />
    </div>

    <!-- 订阅输入 -->
    <div class="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/20 shrink-0">
      <Input
        v-model="channelInput"
        :placeholder="t('redis.pubsub.channelPlaceholder')"
        class="h-7 flex-1 text-[11px] font-mono"
        @keydown.enter="handleSubscribe(false)"
      />
      <Button
        size="sm"
        class="h-7 text-[10px] px-2"
        :disabled="!channelInput.trim()"
        @click="handleSubscribe(false)"
      >
        SUB
      </Button>
      <Button
        variant="outline"
        size="sm"
        class="h-7 text-[10px] px-2"
        :disabled="!channelInput.trim()"
        @click="handleSubscribe(true)"
      >
        PSUB
      </Button>
    </div>

    <!-- 已订阅频道 -->
    <div v-if="hasSubscriptions" class="flex items-center gap-1 px-3 py-1 border-b border-border/10 flex-wrap shrink-0">
      <span
        v-for="ch in subscribedChannels"
        :key="'ch-' + ch"
        class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono bg-primary/10 text-primary/70"
      >
        {{ ch }}
        <button class="hover:text-destructive ml-0.5" @click="handleUnsubscribe(ch, false)">
          <X class="h-2.5 w-2.5" />
        </button>
      </span>
      <span
        v-for="pat in subscribedPatterns"
        :key="'pat-' + pat"
        class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono bg-amber-500/10 text-amber-500/70"
      >
        {{ pat }}
        <button class="hover:text-destructive ml-0.5" @click="handleUnsubscribe(pat, true)">
          <X class="h-2.5 w-2.5" />
        </button>
      </span>
      <button
        class="text-[9px] text-muted-foreground/40 hover:text-destructive/60 ml-auto"
        @click="handleStopAll"
      >
        {{ t('redis.pubsub.stopAll') }}
      </button>
    </div>

    <!-- 消息流 -->
    <div ref="outputRef" class="flex-1 overflow-auto p-3 space-y-0.5 font-mono text-[11px]">
      <template v-if="filteredMessages.length > 0">
        <div
          v-for="(msg, i) in filteredMessages"
          :key="i"
          class="flex items-start gap-2 py-1 hover:bg-muted/10 rounded px-1.5 -mx-1"
        >
          <span class="text-[9px] text-muted-foreground/30 shrink-0 tabular-nums w-[80px] pt-0.5">
            {{ formatTime(msg.timestampMs) }}
          </span>
          <!-- 方向标记 -->
          <span
            class="text-[9px] shrink-0 pt-0.5 w-[16px] text-center"
            :class="msg.isSent ? 'text-amber-400' : 'text-emerald-400'"
            :title="msg.isSent ? t('redis.pubsub.sent') : t('redis.pubsub.received')"
          >{{ msg.isSent ? '↑' : '↓' }}</span>
          <span class="inline-flex items-center px-1.5 py-0.5 rounded bg-primary/10 text-primary/70 text-[10px] shrink-0 max-w-[140px] truncate" :title="msg.channel">
            {{ msg.channel }}
          </span>
          <span v-if="msg.pattern" class="inline-flex items-center px-1 py-0.5 rounded bg-amber-500/10 text-amber-500/50 text-[9px] shrink-0">
            {{ msg.pattern }}
          </span>
          <span class="text-foreground/80 break-all leading-relaxed">"{{ msg.payload }}"</span>
        </div>
      </template>

      <!-- 空状态 -->
      <div v-else class="text-muted-foreground/20 text-center py-8">
        <template v-if="!hasSubscriptions">
          {{ t('redis.pubsub.noSubscriptions') }}
        </template>
        <template v-else-if="messageCount === 0">
          {{ t('redis.pubsub.waitingMessages') }}
        </template>
        <template v-else>
          {{ t('redis.pubsub.noMatch') }}
        </template>
      </div>
    </div>

    <!-- 发布区域 -->
    <div class="flex items-center gap-1.5 px-3 py-2 border-t border-border/20 shrink-0">
      <Input
        v-model="publishChannel"
        :placeholder="t('redis.pubsub.publishChannelPlaceholder')"
        class="h-7 w-28 text-[11px] font-mono"
      />
      <Input
        v-model="publishMessage"
        :placeholder="t('redis.pubsub.publishMessagePlaceholder')"
        class="h-7 flex-1 text-[11px] font-mono"
        @keydown.enter="handlePublish"
      />
      <Button
        size="sm"
        class="h-7 px-2"
        :disabled="!publishChannel.trim() || !publishMessage.trim() || publishing"
        @click="handlePublish"
      >
        <Send class="h-3 w-3" />
      </Button>
    </div>
  </div>
</template>
