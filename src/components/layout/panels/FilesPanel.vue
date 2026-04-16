<script setup lang="ts">
/**
 * Files Panel — 文件管理快捷入口
 *
 * V1 MVP：SFTP 连接列表（点击打开文件管理器 Tab）。
 * 上下文感知：当前 Tab 有 connectionId 时高亮对应条目。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useConnectionStore } from '@/stores/connections'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  FolderOpen,
  HardDrive,
  Wifi,
  WifiOff,
} from 'lucide-vue-next'

const { t } = useI18n()
const workspace = useWorkspaceStore()
const connectionStore = useConnectionStore()

/** 所有 SFTP 类型连接 */
const sftpConnections = computed(() =>
  connectionStore.connectionList.filter(c => c.record.type === 'sftp')
)

/** 当前活跃 Tab 对应的 connectionId */
const activeConnectionId = computed(() => workspace.activeTab?.connectionId ?? null)

function openSftp(connId: string, connName: string) {
  workspace.addTab({
    id: `file-manager-${connId}`,
    type: 'file-manager',
    title: connName,
    connectionId: connId,
    closable: true,
  })
}
</script>

<template>
  <div class="flex h-full flex-col">
    <ScrollArea class="flex-1 min-h-0">
      <!-- 空状态 -->
      <div
        v-if="sftpConnections.length === 0"
        class="flex flex-col items-center justify-center py-10 text-center"
      >
        <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted/30">
          <FolderOpen class="h-5 w-5 text-muted-foreground/30" />
        </div>
        <p class="text-xs text-muted-foreground/60">{{ t('sidebar.noConnections') }}</p>
        <p class="text-[10px] text-muted-foreground/40 mt-1 px-4">添加 SFTP 连接后可在此快速访问远程文件</p>
      </div>

      <!-- SFTP 连接列表 -->
      <div v-else class="px-1 py-2">
        <div class="px-3 py-1 text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-1">SFTP</div>
        <button
          v-for="conn in sftpConnections"
          :key="conn.record.id"
          class="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left hover:bg-muted/50 transition-colors"
          :class="{
            'bg-primary/5 ring-1 ring-primary/20': activeConnectionId === conn.record.id,
          }"
          @click="openSftp(conn.record.id, conn.record.name)"
        >
          <div class="relative">
            <HardDrive class="h-4 w-4 text-muted-foreground" />
            <component
              :is="conn.status === 'connected' ? Wifi : WifiOff"
              class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5"
              :class="conn.status === 'connected' ? 'text-df-success' : 'text-muted-foreground/40'"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs font-medium truncate">{{ conn.record.name }}</div>
            <div class="text-[10px] text-muted-foreground/50 truncate">{{ conn.record.host }}</div>
          </div>
        </button>
      </div>
    </ScrollArea>
  </div>
</template>
