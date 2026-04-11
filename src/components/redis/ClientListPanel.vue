<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Users, RefreshCw, Loader2, Copy, X } from 'lucide-vue-next'
import { redisClientList, redisClientKill } from '@/api/redis'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'
import type { RedisClientInfo } from '@/types/redis'

const props = defineProps<{
  connectionId: string
}>()

const { t } = useI18n()
const toast = useToast()

const clients = ref<RedisClientInfo[]>([])
const loading = ref(false)
const showKillConfirm = ref(false)
const killTarget = ref('')

/** 加载客户端列表 */
async function loadClients() {
  loading.value = true
  try {
    clients.value = await redisClientList(props.connectionId)
  } catch (e) {
    toast.error(t('redis.clients.loadFailed'), parseBackendError(e).message)
  } finally {
    loading.value = false
  }
}

/** Kill 客户端 — 打开确认弹窗 */
function handleKill(addr: string) {
  killTarget.value = addr
  showKillConfirm.value = true
}

/** 确认 Kill */
async function confirmKill() {
  try {
    await redisClientKill(props.connectionId, killTarget.value)
    toast.success(t('redis.clients.killed'))
    showKillConfirm.value = false
    await loadClients()
  } catch (e) {
    toast.error(t('redis.clients.killFailed'), parseBackendError(e).message)
  }
}

/** 复制地址 */
async function copyAddr(addr: string) {
  await navigator.clipboard.writeText(addr)
  toast.success(t('common.copied'))
}

/** 格式化时长 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

/** 标志 badge 语义着色 */
function flagColor(flags: string): string {
  if (flags.includes('M')) return 'text-primary bg-primary/10'
  if (flags.includes('S')) return 'text-df-warning bg-df-warning/10'
  if (flags.includes('N')) return 'text-muted-foreground bg-muted/20'
  return 'text-muted-foreground bg-muted/10'
}

// 初始加载
loadClients()
</script>

<template>
  <div class="flex h-full flex-col border-l border-border/40 bg-background/50">
    <!-- 头部 -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 shrink-0">
      <Users class="h-3.5 w-3.5 text-muted-foreground/50" />
      <span class="text-xs font-bold text-muted-foreground/50 uppercase tracking-wider">{{ t('redis.clients.title') }}</span>
      <span class="text-[10px] font-mono text-primary/50">{{ clients.length }}</span>
      <div class="flex-1" />
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="loadClients" :disabled="loading">
        <RefreshCw class="h-3.5 w-3.5" :class="loading && 'animate-spin'" />
      </Button>
    </div>

    <!-- 列表 -->
    <div class="flex-1 overflow-auto">
      <div v-if="clients.length > 0" class="divide-y divide-border/10">
        <div
          v-for="client in clients"
          :key="client.id"
          class="flex items-center gap-2 px-3 py-2 hover:bg-muted/10 text-xs"
        >
          <span class="text-muted-foreground/30 w-8 shrink-0 tabular-nums">#{{ client.id }}</span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="font-mono text-foreground/80 truncate" :title="client.addr">{{ client.addr }}</span>
              <button class="text-muted-foreground/20 hover:text-muted-foreground/60" @click="copyAddr(client.addr)">
                <Copy class="h-2.5 w-2.5" />
              </button>
            </div>
            <div class="flex items-center gap-2 mt-0.5">
              <span :class="['text-[10px] px-1 py-0.5 rounded', flagColor(client.flags)]">{{ client.flags }}</span>
              <span class="text-[10px] text-muted-foreground/40">DB{{ client.db }}</span>
              <span v-if="client.cmd" class="text-[10px] font-mono text-primary/50">{{ client.cmd }}</span>
            </div>
          </div>
          <div class="text-right shrink-0 text-[10px] text-muted-foreground/40 space-y-0.5">
            <div>{{ t('redis.clients.age') }}: {{ formatDuration(client.age) }}</div>
            <div>{{ t('redis.clients.idle') }}: {{ formatDuration(client.idle) }}</div>
          </div>
          <button
            class="h-7 w-7 flex items-center justify-center rounded text-muted-foreground/20 hover:text-destructive hover:bg-destructive/10 shrink-0"
            :title="t('redis.clients.kill')"
            @click="handleKill(client.addr)"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div v-else-if="!loading" class="text-muted-foreground/20 text-center py-8 text-xs">
        {{ t('redis.clients.noClients') }}
      </div>
      <div v-else class="flex items-center justify-center py-8">
        <Loader2 class="h-4 w-4 animate-spin text-muted-foreground/30" />
      </div>
    </div>

    <!-- Kill 确认弹窗 -->
    <Dialog :open="showKillConfirm" @update:open="showKillConfirm = $event">
      <DialogContent class="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>{{ t('redis.clients.kill') }}</DialogTitle>
          <DialogDescription>{{ t('redis.clients.killConfirm', { addr: killTarget }) }}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" @click="showKillConfirm = false">{{ t('common.cancel') }}</Button>
          <Button variant="destructive" size="sm" @click="confirmKill">{{ t('common.confirm') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
