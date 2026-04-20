<script setup lang="ts">
/**
 * Status Bar — 底部状态栏（24px）
 *
 * 显示：当前连接状态 | 在线连接数。
 * 各区域条件渲染，空状态不占空间。
 */
import { computed } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useConnectionStore } from '@/stores/connections'
import {
  Wifi,
  Circle,
} from 'lucide-vue-next'

const workspace = useWorkspaceStore()
const connectionStore = useConnectionStore()

/** 当前 Tab 对应的连接信息 */
const currentConnection = computed(() => {
  const tab = workspace.activeTab
  if (!tab?.connectionId) return null
  const conn = connectionStore.connections.get(tab.connectionId)
  if (!conn) return null
  return {
    name: conn.record.name,
    status: conn.status,
    type: conn.record.type,
  }
})

/** 在线连接数 */
const onlineCount = computed(() =>
  connectionStore.connectionList.filter(c => c.status === 'connected').length
)

/** 状态颜色 */
const statusColor = computed(() => {
  switch (currentConnection.value?.status) {
    case 'connected': return 'text-df-success'
    case 'connecting': return 'text-df-warning animate-pulse'
    case 'error': return 'text-destructive'
    default: return 'text-muted-foreground/40'
  }
})

function focusConnections() {
  workspace.setActiveSidePanel('connections')
}
</script>

<template>
  <div class="flex h-6 shrink-0 items-center justify-between border-t border-border/30 bg-muted/20 dark:bg-df-shell-bg px-3 text-[11px] text-muted-foreground select-none">
    <!-- 左侧：当前连接 -->
    <div class="flex items-center gap-3">
      <button
        v-if="currentConnection"
        class="flex items-center gap-1.5 hover:text-foreground transition-colors"
        @click="focusConnections"
      >
        <Circle class="h-2 w-2 fill-current" :class="statusColor" />
        <span>{{ currentConnection.name }}</span>
      </button>
    </div>

    <!-- 右侧：在线连接数 -->
    <div class="flex items-center gap-3">
      <button
        v-if="onlineCount > 0"
        class="flex items-center gap-1.5 hover:text-foreground transition-colors"
        @click="focusConnections"
      >
        <Wifi class="h-3 w-3" />
        <span>{{ onlineCount }} 在线</span>
      </button>
    </div>
  </div>
</template>
