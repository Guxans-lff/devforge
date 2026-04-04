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
    <div class="flex items-center gap-2 mr-2">
      <div
        class="h-2 w-2 rounded-full transition-colors"
        :class="connected ? 'bg-df-success shadow-[0_0_6px_var(--df-success)]' : connecting ? 'bg-df-warning animate-pulse' : 'bg-muted-foreground/30'"
      />
      <span class="text-xs font-bold text-foreground truncate max-w-[160px]">{{ connectionName }}</span>
    </div>

    <div class="h-4 w-px bg-border/30" />

    <!-- 数据库选择（Cluster 模式隐藏） -->
    <div class="flex items-center gap-1.5" v-if="connected && !isCluster">
      <Database class="h-3.5 w-3.5 text-muted-foreground/50" />
      <Select
        :model-value="String(currentDb)"
        @update:model-value="emit('selectDb', Number($event))"
      >
        <SelectTrigger class="h-7 w-[90px] text-[11px] font-medium border-border/40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="db in dbOptions"
            :key="db"
            :value="String(db)"
            class="text-[11px]"
          >
            DB {{ db }}
          </SelectItem>
        </SelectContent>
      </Select>
      <span class="text-[10px] text-muted-foreground/50 font-mono">
        {{ dbSize }} {{ t('redis.keys') }}
      </span>
    </div>

    <div class="flex-1" />

    <!-- 操作按钮 -->
    <template v-if="connected">
      <Button variant="ghost" size="sm" class="h-7 px-2 text-[11px]" @click="emit('newKey')">
        <Plus class="h-3.5 w-3.5 mr-1" />
        {{ t('redis.newKey') }}
      </Button>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="emit('refresh')">
        <RefreshCw class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="emit('toggleInfo')">
        <Info class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="emit('toggleCli')">
        <TerminalSquare class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="emit('togglePubsub')">
        <Radio class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="emit('toggleSlowlog')" :title="t('redis.slowlog.title')">
        <Activity class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="emit('toggleMemory')" :title="t('redis.memory.title')">
        <MemoryStick class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="emit('toggleClientList')" :title="t('redis.clients.title')">
        <Users class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="emit('toggleMonitor')" :title="t('redis.monitor.title')">
        <Eye class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="emit('toggleLua')" :title="t('redis.lua.title')">
        <Code class="h-3.5 w-3.5" />
      </Button>
    </template>
    <Loader2 v-else-if="connecting" class="h-4 w-4 animate-spin text-muted-foreground" />
  </div>
</template>
