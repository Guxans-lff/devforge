<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import KeyBrowser from '@/components/redis/KeyBrowser.vue'
import KeyValueEditor from '@/components/redis/KeyValueEditor.vue'
import RedisToolbar from '@/components/redis/RedisToolbar.vue'
import RedisCli from '@/components/redis/RedisCli.vue'
import ServerInfoPanel from '@/components/redis/ServerInfoPanel.vue'
import NewKeyDialog from '@/components/redis/NewKeyDialog.vue'
import PubSubPanel from '@/components/redis/PubSubPanel.vue'
import SlowLogPanel from '@/components/redis/SlowLogPanel.vue'
import { useConnectionStore } from '@/stores/connections'
import { useToast } from '@/composables/useToast'
import { redisConnect, redisDisconnect, redisDbsize, redisCurrentDb, redisSelectDb, redisPing, redisConnectCluster } from '@/api/redis'
import { tunnelOpen, tunnelClose } from '@/api/tunnel'
import { getCredential } from '@/api/connection'
import type { RedisKeyInfo } from '@/types/redis'

const props = defineProps<{
  connectionId: string
  connectionName: string
}>()

const { t } = useI18n()
const connectionStore = useConnectionStore()
const toast = useToast()

// 连接状态
const connected = ref(false)
const connecting = ref(false)
const isCluster = ref(false)

// 当前数据库
const currentDb = ref(0)
const dbSize = ref(0)

// 选中的键
const selectedKey = ref<string | null>(null)
const selectedKeyInfo = ref<RedisKeyInfo | null>(null)

// 面板切换
const showServerInfo = ref(false)
const showCli = ref(false)
const showNewKeyDialog = ref(false)
const showPubSub = ref(false)
const showSlowLog = ref(false)

// 刷新触发
const refreshTrigger = ref(0)

// 心跳检测
const heartbeatTimer = ref<number | null>(null)
const heartbeatFailures = ref(0)
const HEARTBEAT_INTERVAL = 5_000  // 5 秒
const MAX_FAILURES = 2            // 连续 2 次失败判定断开
const disconnectError = ref('')

// SSH 隧道
const activeTunnelId = ref<string | null>(null)

/** 连接 Redis */
async function connectRedis() {
  connecting.value = true
  connectionStore.updateConnectionStatus(props.connectionId, 'connecting')
  try {
    const conn = connectionStore.connections.get(props.connectionId)
    if (!conn) throw new Error('连接记录不存在')
    const record = conn.record
    const config = JSON.parse(record.configJson || '{}')

    // 获取 Redis 密码
    let password: string | null = null
    try {
      const stored = await getCredential(record.id)
      password = stored || null
    } catch { /* 无密码 */ }

    let connectHost = record.host
    let connectPort = record.port

    // 检查是否为 Cluster 模式
    const clusterMode = config.isCluster === true
    isCluster.value = clusterMode

    if (clusterMode) {
      // Cluster 模式：直接连接集群
      const nodes = [...(config.clusterNodes || [])]
      const seedNode = `${record.host}:${record.port}`
      if (!nodes.includes(seedNode) && record.host) {
        nodes.unshift(seedNode)
      }
      await redisConnectCluster({
        connectionId: record.id,
        nodes,
        password,
        useTls: config.useTls ?? false,
        timeoutSecs: config.timeoutSecs ?? 10,
      })
    } else {
      // Standalone 模式
      // SSH 隧道
      if (config.sshTunnel?.enabled) {
        // 获取 SSH 凭据
        let sshPassword: string | undefined
        let sshPassphrase: string | undefined
        try { sshPassword = (await getCredential(`${record.id}:sshPassword`)) || undefined } catch { /* */ }
        try { sshPassphrase = (await getCredential(`${record.id}:sshPassphrase`)) || undefined } catch { /* */ }

        const tunnel = await tunnelOpen({
          sshHost: config.sshTunnel.sshHost,
          sshPort: config.sshTunnel.sshPort ?? 22,
          sshUsername: config.sshTunnel.sshUsername,
          sshPassword,
          authMethod: config.sshTunnel.authMethod ?? 'password',
          privateKeyPath: config.sshTunnel.privateKeyPath || undefined,
          passphrase: sshPassphrase,
          localPort: 0,
          remoteHost: record.host,
          remotePort: record.port,
        })
        activeTunnelId.value = tunnel.tunnelId
        connectHost = '127.0.0.1'
        connectPort = tunnel.localPort
      }

      await redisConnect({
        connectionId: record.id,
        host: connectHost,
        port: connectPort,
        password,
        database: config.database ?? 0,
        useTls: config.useTls ?? false,
        timeoutSecs: config.timeoutSecs ?? 10,
      })
    }

    connected.value = true
    connectionStore.updateConnectionStatus(props.connectionId, 'connected')
    currentDb.value = await redisCurrentDb(props.connectionId)
    dbSize.value = await redisDbsize(props.connectionId)
    heartbeatFailures.value = 0
    startHeartbeat()
  } catch (e) {
    // 连接失败时清理隧道
    if (activeTunnelId.value) {
      await tunnelClose(activeTunnelId.value).catch(() => {})
      activeTunnelId.value = null
    }
    connectionStore.updateConnectionStatus(props.connectionId, 'error')
    toast.error('Redis 连接失败', (e as any)?.message ?? String(e))
  } finally {
    connecting.value = false
  }
}

/** 切换数据库 */
async function handleSelectDb(db: number) {
  try {
    await redisSelectDb(props.connectionId, db)
    currentDb.value = db
    dbSize.value = await redisDbsize(props.connectionId)
    selectedKey.value = null
    selectedKeyInfo.value = null
    refreshTrigger.value++
  } catch (e) {
    toast.error('切换数据库失败', (e as any)?.message ?? String(e))
  }
}

/** 选中键 */
function handleSelectKey(key: string, info: RedisKeyInfo) {
  selectedKey.value = key
  selectedKeyInfo.value = info
  showServerInfo.value = false
}

/** 刷新键列表 */
function handleRefresh() {
  refreshTrigger.value++
  redisDbsize(props.connectionId).then(s => { dbSize.value = s }).catch(() => {})
}

/** 键被删除后清除选中 */
function handleKeyDeleted() {
  selectedKey.value = null
  selectedKeyInfo.value = null
  handleRefresh()
}

/** 键被重命名 */
function handleKeyRenamed(newKey: string) {
  selectedKey.value = newKey
  handleRefresh()
}

/** 新建键完成 */
function handleKeyCreated(key: string) {
  handleRefresh()
  // 选中新键
  selectedKey.value = key
}

/** 启动心跳检测 */
function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer.value = window.setInterval(async () => {
    if (!connected.value) return
    try {
      await redisPing(props.connectionId)
      heartbeatFailures.value = 0
    } catch (e) {
      heartbeatFailures.value++
      if (heartbeatFailures.value >= MAX_FAILURES) {
        const msg = (e as any)?.message ?? String(e)
        connected.value = false
        disconnectError.value = msg
        connectionStore.updateConnectionStatus(props.connectionId, 'disconnected', msg)
        stopHeartbeat()
      }
    }
  }, HEARTBEAT_INTERVAL)
}

/** 停止心跳检测 */
function stopHeartbeat() {
  if (heartbeatTimer.value !== null) {
    clearInterval(heartbeatTimer.value)
    heartbeatTimer.value = null
  }
}

/** 重新连接 */
async function handleReconnect() {
  disconnectError.value = ''
  heartbeatFailures.value = 0
  // 清理旧隧道
  if (activeTunnelId.value) {
    await tunnelClose(activeTunnelId.value).catch(() => {})
    activeTunnelId.value = null
  }
  await connectRedis()
}

onMounted(() => {
  connectRedis()
})

onBeforeUnmount(() => {
  stopHeartbeat()
  if (connected.value) {
    redisDisconnect(props.connectionId).catch(() => {})
    connectionStore.updateConnectionStatus(props.connectionId, 'disconnected')
  }
  // 清理 SSH 隧道
  if (activeTunnelId.value) {
    tunnelClose(activeTunnelId.value).catch(() => {})
    activeTunnelId.value = null
  }
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 工具栏 -->
    <RedisToolbar
      :connection-id="connectionId"
      :connection-name="connectionName"
      :connected="connected"
      :connecting="connecting"
      :current-db="currentDb"
      :db-size="dbSize"
      :is-cluster="isCluster"
      @select-db="handleSelectDb"
      @refresh="handleRefresh"
      @new-key="showNewKeyDialog = true"
      @toggle-info="showServerInfo = !showServerInfo"
      @toggle-cli="showCli = !showCli"
      @toggle-pubsub="showPubSub = !showPubSub"
      @toggle-slowlog="showSlowLog = !showSlowLog"
    />

    <!-- 主内容区 -->
    <div class="flex-1 min-h-0 relative">
      <!-- 断开连接 Overlay -->
      <div
        v-if="!connected && !connecting"
        class="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      >
        <div class="bg-card border border-border rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
          <div class="flex flex-col items-center gap-4">
            <div class="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <svg class="h-6 w-6 text-destructive" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div class="text-center space-y-1">
              <h3 class="text-base font-semibold text-foreground">{{ t('redis.connectionLost') }}</h3>
              <p class="text-sm text-muted-foreground">{{ t('redis.connectionLostHint') }}</p>
            </div>
            <div
              v-if="disconnectError"
              class="w-full p-2.5 bg-destructive/5 border border-destructive/20 rounded text-xs text-destructive/80 font-mono break-all"
            >
              {{ disconnectError }}
            </div>
            <button
              @click="handleReconnect"
              :disabled="connecting"
              class="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              {{ t('redis.reconnect') }}
            </button>
          </div>
        </div>
      </div>

      <template v-if="connected">
        <Splitpanes class="h-full">
          <!-- 键浏览器 -->
          <Pane :size="25" :min-size="15" :max-size="45">
            <KeyBrowser
              :connection-id="connectionId"
              :refresh-trigger="refreshTrigger"
              :selected-key="selectedKey"
              @select="handleSelectKey"
              @delete="handleKeyDeleted"
            />
          </Pane>

          <!-- 编辑器 / 服务器信息 -->
          <Pane :size="(showCli || showPubSub || showSlowLog) ? 55 : 75">
            <div class="h-full flex flex-col">
              <template v-if="showServerInfo">
                <ServerInfoPanel :connection-id="connectionId" :is-cluster="isCluster" />
              </template>
              <template v-else-if="selectedKey && selectedKeyInfo">
                <KeyValueEditor
                  :connection-id="connectionId"
                  :redis-key="selectedKey"
                  :key-info="selectedKeyInfo"
                  @deleted="handleKeyDeleted"
                  @renamed="handleKeyRenamed"
                  @refresh="handleRefresh"
                />
              </template>
              <template v-else>
                <div class="flex h-full items-center justify-center text-muted-foreground/40">
                  <div class="text-center space-y-2">
                    <p class="text-sm font-medium">{{ t('redis.selectKeyHint') }}</p>
                    <p class="text-xs">{{ t('redis.keyCountHint', { count: dbSize }) }}</p>
                  </div>
                </div>
              </template>
            </div>
          </Pane>

          <!-- CLI 控制台 -->
          <Pane v-if="showCli" :size="20" :min-size="15">
            <RedisCli :connection-id="connectionId" />
          </Pane>

          <!-- PubSub 面板 -->
          <Pane v-if="showPubSub" :size="20" :min-size="15">
            <PubSubPanel :connection-id="connectionId" />
          </Pane>

          <!-- 慢查询面板 -->
          <Pane v-if="showSlowLog" :size="20" :min-size="15">
            <SlowLogPanel :connection-id="connectionId" />
          </Pane>
        </Splitpanes>
      </template>

      <!-- 连接中状态 -->
      <div v-else class="flex h-full items-center justify-center">
        <div class="text-center space-y-3">
          <div v-if="connecting" class="flex items-center gap-2 text-muted-foreground">
            <div class="h-4 w-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span class="text-sm">{{ t('redis.connecting') }}</span>
          </div>
          <p v-else class="text-sm text-muted-foreground/50">{{ t('redis.disconnected') }}</p>
        </div>
      </div>
    </div>

    <!-- 新建键对话框 -->
    <NewKeyDialog
      :open="showNewKeyDialog"
      :connection-id="connectionId"
      @update:open="showNewKeyDialog = $event"
      @created="handleKeyCreated"
    />
  </div>
</template>
