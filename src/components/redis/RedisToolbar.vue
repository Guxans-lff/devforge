<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RefreshCw, Plus, Info, TerminalSquare, Database, Loader2, Radio, Activity, MemoryStick, Users, Eye, Code } from 'lucide-vue-next'

const props = defineProps<{
  connectionId: string
  connectionName: string
  connected: boolean
  connecting: boolean
  currentDb: number
  dbSize: number
  isCluster?: boolean
  /** 各面板激活状态（用于按钮高亮） */
  activeInfo?: boolean
  activeCli?: boolean
  activePubsub?: boolean
  activeSlowlog?: boolean
  activeMemory?: boolean
  activeClientList?: boolean
  activeMonitor?: boolean
  activeLua?: boolean
}>()

const emit = defineEmits<{
  selectDb: [db: number]
  refresh: []
  newKey: []
  toggleInfo: []
  toggleCli: []
  togglePubsub: []
  toggleSlowlog: []
  toggleMemory: []
  toggleClientList: []
  toggleMonitor: []
  toggleLua: []
}>()

const { t } = useI18n()

/** 数据库选项 0-15 */
const dbOptions = Array.from({ length: 16 }, (_, i) => i)
</script>

<template>
  <div class="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/10 shrink-0">
    <!-- 连接名称 -->
    <div class="flex items-center gap-2 mr-1">
      <div
        class="h-2.5 w-2.5 rounded-full transition-colors"
        :class="connected ? 'bg-df-success shadow-[0_0_6px_var(--df-success)]' : connecting ? 'bg-df-warning animate-pulse' : 'bg-muted-foreground/30'"
      />
      <span class="text-xs font-bold text-foreground truncate max-w-[160px]">{{ connectionName }}</span>
    </div>

    <div class="h-4 w-px bg-border/40" />

    <!-- 数据库选择（Cluster 模式隐藏） -->
    <div class="flex items-center gap-1.5" v-if="connected && !isCluster">
      <Database class="h-3.5 w-3.5 text-muted-foreground/50" />
      <Select
        :model-value="String(currentDb)"
        @update:model-value="emit('selectDb', Number($event))"
      >
        <SelectTrigger class="h-7 w-[90px] text-xs font-medium border-border/40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="db in dbOptions"
            :key="db"
            :value="String(db)"
            class="text-xs"
          >
            DB {{ db }}
          </SelectItem>
        </SelectContent>
      </Select>
      <span class="text-xs text-muted-foreground/60 font-mono tabular-nums">
        {{ dbSize }} {{ t('redis.keys') }}
      </span>
    </div>

    <div class="flex-1" />

    <!-- 操作按钮 -->
    <template v-if="connected">
      <!-- 新建 + 刷新 -->
      <Button variant="ghost" size="sm" class="h-7 px-2 text-xs" @click="emit('newKey')">
        <Plus class="h-3.5 w-3.5 mr-1" />
        {{ t('redis.newKey') }}
      </Button>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" :title="t('redis.refresh')" @click="emit('refresh')">
        <RefreshCw class="h-3.5 w-3.5" />
      </Button>

      <div class="h-4 w-px bg-border/30" />

      <!-- 面板切换按钮（带激活态高亮） -->
      <Button
        variant="ghost" size="sm"
        class="h-7 w-7 p-0 transition-colors"
        :class="activeInfo ? 'bg-accent text-accent-foreground' : ''"
        :title="t('redis.serverInfo')"
        @click="emit('toggleInfo')"
      >
        <Info class="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost" size="sm"
        class="h-7 w-7 p-0 transition-colors"
        :class="activeCli ? 'bg-accent text-accent-foreground' : ''"
        :title="t('redis.cli')"
        @click="emit('toggleCli')"
      >
        <TerminalSquare class="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost" size="sm"
        class="h-7 w-7 p-0 transition-colors"
        :class="activePubsub ? 'bg-accent text-accent-foreground' : ''"
        :title="t('redis.pubsub.title')"
        @click="emit('togglePubsub')"
      >
        <Radio class="h-3.5 w-3.5" />
      </Button>

      <div class="h-4 w-px bg-border/30" />

      <Button
        variant="ghost" size="sm"
        class="h-7 w-7 p-0 transition-colors"
        :class="activeSlowlog ? 'bg-accent text-accent-foreground' : ''"
        :title="t('redis.slowlog.title')"
        @click="emit('toggleSlowlog')"
      >
        <Activity class="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost" size="sm"
        class="h-7 w-7 p-0 transition-colors"
        :class="activeMemory ? 'bg-accent text-accent-foreground' : ''"
        :title="t('redis.memory.title')"
        @click="emit('toggleMemory')"
      >
        <MemoryStick class="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost" size="sm"
        class="h-7 w-7 p-0 transition-colors"
        :class="activeClientList ? 'bg-accent text-accent-foreground' : ''"
        :title="t('redis.clients.title')"
        @click="emit('toggleClientList')"
      >
        <Users class="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost" size="sm"
        class="h-7 w-7 p-0 transition-colors"
        :class="activeMonitor ? 'bg-accent text-accent-foreground' : ''"
        :title="t('redis.monitor.title')"
        @click="emit('toggleMonitor')"
      >
        <Eye class="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost" size="sm"
        class="h-7 w-7 p-0 transition-colors"
        :class="activeLua ? 'bg-accent text-accent-foreground' : ''"
        :title="t('redis.lua.title')"
        @click="emit('toggleLua')"
      >
        <Code class="h-3.5 w-3.5" />
      </Button>
    </template>
    <Loader2 v-else-if="connecting" class="h-4 w-4 animate-spin text-muted-foreground" />
  </div>
</template>
