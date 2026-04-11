<script setup lang="ts">
/**
 * 端口转发可视化管理面板
 * 全面板视图：活跃隧道卡片 + 快速创建表单
 */
import { ref, computed, onMounted, onActivated } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { useConnectionStore } from '@/stores/connections'
import {
  Cable, Plus, X, Loader2, ArrowRight, Copy, Check,
  RefreshCw, Zap, Globe,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { tunnelOpen, tunnelClose, tunnelList } from '@/api/tunnel'
import { getCredential } from '@/api/connection'
import type { TunnelInfo } from '@/types/tunnel'

const { t } = useI18n()
const toast = useToast()
const connectionStore = useConnectionStore()

const tunnels = ref<TunnelInfo[]>([])
const loadingTunnels = ref(false)
const closingId = ref<string | null>(null)
const opening = ref(false)
const selectedConnectionId = ref<string>('')
const copiedId = ref<string | null>(null)
const showForm = ref(false)

const sshConnections = computed(() =>
  connectionStore.connectionList.filter((c) => c.record.type === 'ssh'),
)

const form = ref({
  sshHost: '',
  sshPort: 22,
  sshUsername: '',
  sshPassword: '',
  authMethod: 'password' as string,
  privateKeyPath: '',
  passphrase: '',
  localPort: 3306,
  remoteHost: '127.0.0.1',
  remotePort: 3306,
})

const canSubmit = computed(() => {
  if (!form.value.sshHost || !form.value.sshUsername) return false
  if (form.value.authMethod === 'key') return !!form.value.privateKeyPath
  return !!form.value.sshPassword
})

async function loadTunnels() {
  loadingTunnels.value = true
  try {
    tunnels.value = await tunnelList()
  } catch (e) {
    toast.error(String(e))
  } finally {
    loadingTunnels.value = false
  }
}

async function handleSelectConnection(connId: string | number | boolean | bigint | Record<string, any> | null | undefined) {
  const id = String(connId ?? '')
  selectedConnectionId.value = id
  if (!id) return
  const state = connectionStore.connectionList.find((c) => c.record.id === id)
  if (!state) return
  const record = state.record
  form.value.sshHost = record.host
  form.value.sshPort = record.port
  form.value.sshUsername = record.username
  try {
    const config = JSON.parse(record.configJson || '{}')
    form.value.authMethod = config.authMethod || 'password'
    form.value.privateKeyPath = config.privateKeyPath || ''
  } catch {
    form.value.authMethod = 'password'
  }
  try {
    const pwd = await getCredential(id)
    form.value.sshPassword = pwd || ''
  } catch {
    form.value.sshPassword = ''
  }
  if (form.value.authMethod === 'key') {
    try {
      const phrase = await getCredential(`${id}:passphrase`)
      form.value.passphrase = phrase || ''
    } catch {
      form.value.passphrase = ''
    }
  }
}

async function handleOpen() {
  opening.value = true
  try {
    const info = await tunnelOpen({
      sshHost: form.value.sshHost,
      sshPort: Number(form.value.sshPort),
      sshUsername: form.value.sshUsername,
      sshPassword: form.value.sshPassword || undefined,
      authMethod: form.value.authMethod,
      privateKeyPath: form.value.privateKeyPath || undefined,
      passphrase: form.value.passphrase || undefined,
      localPort: Number(form.value.localPort),
      remoteHost: form.value.remoteHost,
      remotePort: Number(form.value.remotePort),
    })
    tunnels.value = [...tunnels.value, info]
    form.value.sshPassword = ''
    form.value.passphrase = ''
    showForm.value = false
    toast.success(t('tunnel.openSuccess'))
  } catch (e) {
    toast.error(String(e))
  } finally {
    opening.value = false
  }
}

async function handleClose(tunnelId: string) {
  closingId.value = tunnelId
  try {
    await tunnelClose(tunnelId)
    tunnels.value = tunnels.value.filter((tun) => tun.tunnelId !== tunnelId)
    toast.success(t('tunnel.closeSuccess'))
  } catch (e) {
    toast.error(String(e))
  } finally {
    closingId.value = null
  }
}

function copyLocalAddress(tunnel: TunnelInfo) {
  const addr = `127.0.0.1:${tunnel.localPort}`
  navigator.clipboard.writeText(addr)
  copiedId.value = tunnel.tunnelId
  setTimeout(() => { copiedId.value = null }, 1500)
}

function resetForm() {
  form.value = {
    sshHost: '',
    sshPort: 22,
    sshUsername: '',
    sshPassword: '',
    authMethod: 'password',
    privateKeyPath: '',
    passphrase: '',
    localPort: 3306,
    remoteHost: '127.0.0.1',
    remotePort: 3306,
  }
  selectedConnectionId.value = ''
}

onMounted(() => {
  connectionStore.loadConnections()
  loadTunnels()
})

onActivated(() => {
  loadTunnels()
})
</script>

<template>
  <div class="flex h-full w-full flex-col overflow-hidden bg-background">
    <!-- 顶部工具栏 -->
    <div class="flex h-10 shrink-0 items-center border-b border-border/10 bg-background/95 px-4 backdrop-blur-md">
      <div class="flex items-center gap-2 text-sm font-medium text-foreground">
        <Cable class="h-4 w-4 text-muted-foreground" />
        {{ t('tunnel.title') }}
      </div>
      <div class="flex-1" />
      <div class="flex items-center gap-1">
        <TooltipProvider :delay-duration="300">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7 text-muted-foreground hover:text-foreground"
                @click="loadTunnels"
              >
                <RefreshCw class="h-3.5 w-3.5" :class="loadingTunnels && 'animate-spin'" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{{ t('common.refresh') }}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 gap-1 px-2 text-xs"
                @click="showForm = !showForm; if (showForm) resetForm()"
              >
                <Plus class="h-3.5 w-3.5" />
                {{ t('tunnel.newTunnel') }}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{{ t('tunnel.newTunnel') }}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>

    <!-- 主内容区 -->
    <ScrollArea class="flex-1">
      <div class="p-4 space-y-4">
        <!-- 统计卡片 -->
        <div class="grid grid-cols-3 gap-3">
          <div class="rounded-lg border border-border/50 bg-card/50 p-3 backdrop-blur-sm">
            <div class="flex items-center gap-2 text-muted-foreground mb-1">
              <Cable class="h-3.5 w-3.5 text-primary" />
              <span class="text-[11px] font-medium">{{ t('tunnel.totalTunnels') }}</span>
            </div>
            <div class="text-2xl font-bold tabular-nums text-foreground">
              {{ tunnels.length }}
            </div>
          </div>
          <div class="rounded-lg border border-border/50 bg-card/50 p-3 backdrop-blur-sm">
            <div class="flex items-center gap-2 text-muted-foreground mb-1">
              <Zap class="h-3.5 w-3.5 text-df-success" />
              <span class="text-[11px] font-medium">{{ t('tunnel.activeTunnels') }}</span>
            </div>
            <div class="text-2xl font-bold tabular-nums text-df-success">
              {{ tunnels.filter(t => t.status === 'active').length }}
            </div>
          </div>
          <div class="rounded-lg border border-border/50 bg-card/50 p-3 backdrop-blur-sm">
            <div class="flex items-center gap-2 text-muted-foreground mb-1">
              <Globe class="h-3.5 w-3.5 text-df-info" />
              <span class="text-[11px] font-medium">{{ t('tunnel.portsForwarded') }}</span>
            </div>
            <div class="text-2xl font-bold tabular-nums text-foreground">
              {{ [...new Set(tunnels.filter(t => t.status === 'active').map(t => t.localPort))].length }}
            </div>
          </div>
        </div>

        <!-- 创建隧道表单（可折叠） -->
        <div
          v-if="showForm"
          class="rounded-lg border border-border/50 bg-card/50 p-4 backdrop-blur-sm space-y-3 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <div class="flex items-center justify-between">
            <p class="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Plus class="h-3.5 w-3.5" />
              {{ t('tunnel.newTunnel') }}
            </p>
            <Button variant="ghost" size="icon" class="h-6 w-6 text-muted-foreground" :aria-label="t('common.close')" @click="showForm = false">
              <X class="h-3.5 w-3.5" />
            </Button>
          </div>

          <div class="grid grid-cols-4 gap-3">
            <!-- 从已有连接选择 -->
            <div class="col-span-4 space-y-1.5">
              <Label class="text-xs text-muted-foreground">{{ t('tunnel.selectConnection') }}</Label>
              <Select :model-value="selectedConnectionId" @update:model-value="handleSelectConnection">
                <SelectTrigger class="h-8 text-sm">
                  <SelectValue :placeholder="t('tunnel.manualInput')" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{{ t('tunnel.manualInput') }}</SelectItem>
                  <SelectItem
                    v-for="conn in sshConnections"
                    :key="conn.record.id"
                    :value="conn.record.id"
                  >
                    {{ conn.record.name }} ({{ conn.record.host }})
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <!-- SSH 主机 -->
            <div class="col-span-2 space-y-1.5">
              <Label class="text-xs text-muted-foreground">{{ t('tunnel.sshHost') }}</Label>
              <Input v-model="form.sshHost" placeholder="ssh.example.com" class="h-8 text-sm" />
            </div>

            <!-- SSH 用户名 + 端口 -->
            <div class="space-y-1.5">
              <Label class="text-xs text-muted-foreground">{{ t('tunnel.sshUsername') }}</Label>
              <Input v-model="form.sshUsername" placeholder="root" class="h-8 text-sm" />
            </div>
            <div class="space-y-1.5">
              <Label class="text-xs text-muted-foreground">{{ t('tunnel.sshPort') }}</Label>
              <Input v-model.number="form.sshPort" type="number" placeholder="22" class="h-8 text-sm" />
            </div>

            <!-- 认证 -->
            <div v-if="form.authMethod !== 'key'" class="col-span-4 space-y-1.5">
              <Label class="text-xs text-muted-foreground">{{ t('tunnel.sshPassword') }}</Label>
              <Input v-model="form.sshPassword" type="password" placeholder="••••••••" class="h-8 text-sm" />
            </div>
            <template v-if="form.authMethod === 'key'">
              <div class="col-span-2 space-y-1.5">
                <Label class="text-xs text-muted-foreground">{{ t('connection.privateKey') }}</Label>
                <Input v-model="form.privateKeyPath" :placeholder="t('connection.privateKeyPlaceholder')" class="h-8 text-sm" />
              </div>
              <div class="col-span-2 space-y-1.5">
                <Label class="text-xs text-muted-foreground">{{ t('connection.passphrase') }}</Label>
                <Input v-model="form.passphrase" type="password" :placeholder="t('connection.passphrasePlaceholder')" class="h-8 text-sm" />
              </div>
            </template>

            <!-- 端口映射 -->
            <div class="space-y-1.5">
              <Label class="text-xs text-muted-foreground">{{ t('tunnel.localPort') }}</Label>
              <Input v-model.number="form.localPort" type="number" placeholder="0" class="h-8 text-sm" />
            </div>
            <div class="flex items-end justify-center pb-1">
              <ArrowRight class="h-4 w-4 text-muted-foreground" />
            </div>
            <div class="space-y-1.5">
              <Label class="text-xs text-muted-foreground">{{ t('tunnel.remoteHost') }}</Label>
              <Input v-model="form.remoteHost" placeholder="127.0.0.1" class="h-8 text-sm" />
            </div>
            <div class="space-y-1.5">
              <Label class="text-xs text-muted-foreground">{{ t('tunnel.remotePort') }}</Label>
              <Input v-model.number="form.remotePort" type="number" placeholder="3306" class="h-8 text-sm" />
            </div>

            <!-- 提交 -->
            <div class="col-span-4 flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" class="h-8 text-xs" @click="showForm = false">
                {{ t('common.cancel') }}
              </Button>
              <Button size="sm" class="h-8 text-xs" :disabled="opening || !canSubmit" @click="handleOpen">
                <Loader2 v-if="opening" class="mr-1.5 h-3.5 w-3.5 animate-spin" />
                <Cable v-else class="mr-1.5 h-3.5 w-3.5" />
                {{ t('tunnel.open') }}
              </Button>
            </div>
          </div>
        </div>

        <!-- 隧道卡片列表 -->
        <div v-if="loadingTunnels && tunnels.length === 0" class="flex items-center justify-center h-32 text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin mr-2" />
          <span class="text-sm">{{ t('common.loading') }}</span>
        </div>

        <div v-else-if="tunnels.length === 0" class="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
          <Cable class="h-10 w-10 text-muted-foreground/30" />
          <p class="text-sm">{{ t('tunnel.noTunnels') }}</p>
          <p class="text-xs text-muted-foreground/60">{{ t('tunnel.noTunnelsHint') }}</p>
          <Button variant="outline" size="sm" class="mt-2" @click="showForm = true; resetForm()">
            <Plus class="h-3.5 w-3.5 mr-1.5" />
            {{ t('tunnel.newTunnel') }}
          </Button>
        </div>

        <div v-else class="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div
            v-for="tunnel in tunnels"
            :key="tunnel.tunnelId"
            class="group rounded-lg border border-border/50 bg-card/50 p-4 backdrop-blur-sm transition-all hover:border-border hover:shadow-sm"
          >
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-2.5">
                <div
                  class="h-2 w-2 rounded-full shrink-0"
                  :class="tunnel.status === 'active'
                    ? 'bg-df-success shadow-[0_0_6px_var(--df-success)]'
                    : 'bg-muted-foreground/30'"
                />
                <Badge
                  :variant="tunnel.status === 'active' ? 'default' : 'secondary'"
                  class="text-[10px] px-1.5 py-0"
                  :class="tunnel.status === 'active'
                    ? 'bg-df-success/15 text-df-success border-df-success/30'
                    : 'bg-muted text-muted-foreground'"
                >
                  {{ t(`tunnel.${tunnel.status}`) }}
                </Badge>
              </div>
              <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <TooltipProvider :delay-duration="200">
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7 text-muted-foreground hover:text-foreground"
                        :aria-label="t('tunnel.copyAddress')"
                        @click="copyLocalAddress(tunnel)"
                      >
                        <Check v-if="copiedId === tunnel.tunnelId" class="h-3.5 w-3.5 text-df-success" />
                        <Copy v-else class="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>{{ t('tunnel.copyAddress') }}</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7 text-muted-foreground hover:text-destructive"
                        :aria-label="t('tunnel.close')"
                        :disabled="closingId === tunnel.tunnelId"
                        @click="handleClose(tunnel.tunnelId)"
                      >
                        <Loader2 v-if="closingId === tunnel.tunnelId" class="h-3.5 w-3.5 animate-spin" />
                        <X v-else class="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>{{ t('tunnel.close') }}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            <!-- 端口映射可视化 -->
            <div class="mt-3 flex items-center gap-3 font-mono text-sm">
              <div class="flex items-center gap-1.5">
                <div class="h-6 rounded bg-primary/10 border border-primary/20 px-2 flex items-center text-primary text-xs">
                  :{{ tunnel.localPort }}
                </div>
              </div>
              <div class="flex-1 border-t border-dashed border-muted-foreground/20 relative">
                <ArrowRight class="h-3.5 w-3.5 text-muted-foreground/40 absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card/50" />
              </div>
              <div class="flex items-center gap-1.5">
                <div class="h-6 rounded bg-df-success/10 border border-df-success/20 px-2 flex items-center text-df-success text-xs">
                  {{ tunnel.remoteHost }}:{{ tunnel.remotePort }}
                </div>
              </div>
            </div>

            <!-- 隧道 ID（缩短） -->
            <div class="mt-2 text-[10px] text-muted-foreground/40 font-mono truncate">
              {{ tunnel.tunnelId }}
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
