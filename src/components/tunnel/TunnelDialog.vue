<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { useConnectionStore } from '@/stores/connections'
import { Cable, Plus, X, Loader2, ArrowRight, Copy, Check } from 'lucide-vue-next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
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

const props = withDefaults(defineProps<{
  open: boolean
  sshHost?: string
  sshPort?: number
  sshUsername?: string
}>(), {
  sshHost: '',
  sshPort: 22,
  sshUsername: '',
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
const toast = useToast()
const connectionStore = useConnectionStore()

const tunnels = ref<TunnelInfo[]>([])
const loadingTunnels = ref(false)
const closingId = ref<string | null>(null)
const opening = ref(false)
const selectedConnectionId = ref<string>('')
const copiedId = ref<string | null>(null)

// 筛选 SSH 类型的连接
const sshConnections = computed(() =>
  connectionStore.connectionList.filter((c) => c.record.type === 'ssh')
)

const form = ref({
  sshHost: props.sshHost,
  sshPort: props.sshPort,
  sshUsername: props.sshUsername,
  sshPassword: '',
  authMethod: 'password' as string,
  privateKeyPath: '',
  passphrase: '',
  localPort: 3306,
  remoteHost: '127.0.0.1',
  remotePort: 3306,
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
  // 解析 configJson 获取认证方式
  try {
    const config = JSON.parse(record.configJson || '{}')
    form.value.authMethod = config.authMethod || 'password'
    form.value.privateKeyPath = config.privateKeyPath || ''
  } catch {
    form.value.authMethod = 'password'
  }
  // 加载密码/密码短语
  try {
    const pwd = await getCredential(id)
    form.value.sshPassword = pwd || ''
  } catch {
    form.value.sshPassword = ''
  }
  if (form.value.authMethod === 'key') {
    try {
      const phrase = await getCredential(`${connId}:passphrase`)
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
    tunnels.value = tunnels.value.filter((t) => t.tunnelId !== tunnelId)
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

// 表单是否可提交
const canSubmit = computed(() => {
  if (!form.value.sshHost || !form.value.sshUsername) return false
  if (form.value.authMethod === 'key') return !!form.value.privateKeyPath
  return !!form.value.sshPassword
})

watch(() => props.open, (val) => {
  if (val) {
    form.value.sshHost = props.sshHost
    form.value.sshPort = props.sshPort
    form.value.sshUsername = props.sshUsername
    form.value.authMethod = 'password'
    form.value.privateKeyPath = ''
    form.value.passphrase = ''
    selectedConnectionId.value = ''
    connectionStore.loadConnections()
    loadTunnels()
  }
})

onMounted(() => {
  if (props.open) loadTunnels()
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[520px] bg-zinc-900 border-zinc-800 text-zinc-100">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 text-zinc-100">
          <Cable class="h-5 w-5 text-zinc-400" />
          {{ t('tunnel.title') }}
        </DialogTitle>
        <DialogDescription class="text-zinc-500">
          {{ t('tunnel.noTunnelsHint') }}
        </DialogDescription>
      </DialogHeader>

      <!-- Active Tunnels -->
      <div class="space-y-2">
        <p class="text-xs font-medium text-zinc-400 uppercase tracking-wide">
          {{ t('tunnel.status') }}
        </p>
        <ScrollArea class="max-h-40 rounded-md border border-zinc-800 bg-zinc-950">
          <div v-if="loadingTunnels" class="flex items-center justify-center py-6">
            <Loader2 class="h-4 w-4 animate-spin text-zinc-500" />
          </div>
          <div v-else-if="tunnels.length === 0" class="flex flex-col items-center justify-center py-6 gap-1">
            <Cable class="h-6 w-6 text-zinc-700" />
            <p class="text-xs text-zinc-600">{{ t('tunnel.noTunnels') }}</p>
          </div>
          <div v-else class="p-1 space-y-1">
            <div
              v-for="tunnel in tunnels"
              :key="tunnel.tunnelId"
              class="flex items-center justify-between px-3 py-2 rounded-md hover:bg-zinc-800/60 group"
            >
              <div class="flex items-center gap-2 min-w-0">
                <Badge
                  :variant="tunnel.status === 'active' ? 'default' : 'secondary'"
                  class="shrink-0 text-[10px] px-1.5 py-0"
                  :class="tunnel.status === 'active' ? 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30' : 'bg-zinc-700 text-zinc-400'"
                >
                  {{ t(`tunnel.${tunnel.status}`) }}
                </Badge>
                <span class="text-xs text-zinc-300 font-mono truncate flex items-center gap-1">
                  :{{ tunnel.localPort }}
                  <ArrowRight class="h-3 w-3 text-zinc-600 shrink-0" />
                  {{ tunnel.remoteHost }}:{{ tunnel.remotePort }}
                </span>
              </div>
              <div class="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50"
                  :title="t('tunnel.copyAddress')"
                  @click="copyLocalAddress(tunnel)"
                >
                  <Check v-if="copiedId === tunnel.tunnelId" class="h-3 w-3 text-emerald-400" />
                  <Copy v-else class="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 hover:bg-red-400/10"
                  :disabled="closingId === tunnel.tunnelId"
                  @click="handleClose(tunnel.tunnelId)"
                >
                  <Loader2 v-if="closingId === tunnel.tunnelId" class="h-3 w-3 animate-spin" />
                  <X v-else class="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      <Separator class="bg-zinc-800" />

      <!-- New Tunnel Form -->
      <div class="space-y-3">
        <p class="text-xs font-medium text-zinc-400 uppercase tracking-wide flex items-center gap-1.5">
          <Plus class="h-3.5 w-3.5" />
          {{ t('tunnel.newTunnel') }}
        </p>

        <div class="grid grid-cols-2 gap-3">
          <!-- 从已有连接选择 -->
          <div class="col-span-2 space-y-1.5">
            <Label class="text-xs text-zinc-400">{{ t('tunnel.selectConnection') }}</Label>
            <Select :model-value="selectedConnectionId" @update:model-value="handleSelectConnection">
              <SelectTrigger class="h-8 text-sm bg-zinc-950 border-zinc-700 text-zinc-100">
                <SelectValue :placeholder="t('tunnel.manualInput')" />
              </SelectTrigger>
              <SelectContent class="bg-zinc-900 border-zinc-700">
                <SelectItem value="" class="text-zinc-300">{{ t('tunnel.manualInput') }}</SelectItem>
                <SelectItem
                  v-for="conn in sshConnections"
                  :key="conn.record.id"
                  :value="conn.record.id"
                  class="text-zinc-300"
                >
                  {{ conn.record.name }} ({{ conn.record.host }})
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- SSH 主机 -->
          <div class="col-span-2 space-y-1.5">
            <Label class="text-xs text-zinc-400">{{ t('tunnel.sshHost') }}</Label>
            <Input
              v-model="form.sshHost"
              placeholder="ssh.example.com"
              class="h-8 text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-zinc-600"
            />
          </div>

          <!-- SSH 用户名 + 端口 -->
          <div class="space-y-1.5">
            <Label class="text-xs text-zinc-400">{{ t('tunnel.sshUsername') }}</Label>
            <Input
              v-model="form.sshUsername"
              placeholder="root"
              class="h-8 text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-zinc-600"
            />
          </div>

          <div class="space-y-1.5">
            <Label class="text-xs text-zinc-400">{{ t('tunnel.sshPort') }}</Label>
            <Input
              v-model.number="form.sshPort"
              type="number"
              placeholder="22"
              class="h-8 text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-zinc-600"
            />
          </div>

          <!-- 认证方式：密码 -->
          <div v-if="form.authMethod !== 'key'" class="col-span-2 space-y-1.5">
            <Label class="text-xs text-zinc-400">{{ t('tunnel.sshPassword') }}</Label>
            <Input
              v-model="form.sshPassword"
              type="password"
              placeholder="••••••••"
              class="h-8 text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-zinc-600"
            />
          </div>

          <!-- 认证方式：私钥 -->
          <template v-if="form.authMethod === 'key'">
            <div class="col-span-2 space-y-1.5">
              <Label class="text-xs text-zinc-400">{{ t('connection.privateKey') }}</Label>
              <Input
                v-model="form.privateKeyPath"
                :placeholder="t('connection.privateKeyPlaceholder')"
                class="h-8 text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-zinc-600"
              />
            </div>
            <div class="col-span-2 space-y-1.5">
              <Label class="text-xs text-zinc-400">{{ t('connection.passphrase') }}</Label>
              <Input
                v-model="form.passphrase"
                type="password"
                :placeholder="t('connection.passphrasePlaceholder')"
                class="h-8 text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-zinc-600"
              />
            </div>
          </template>

          <!-- 远程主机 + 端口 -->
          <div class="space-y-1.5">
            <Label class="text-xs text-zinc-400">{{ t('tunnel.remoteHost') }}</Label>
            <Input
              v-model="form.remoteHost"
              placeholder="127.0.0.1"
              class="h-8 text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-zinc-600"
            />
          </div>

          <div class="space-y-1.5">
            <Label class="text-xs text-zinc-400">{{ t('tunnel.remotePort') }}</Label>
            <Input
              v-model.number="form.remotePort"
              type="number"
              placeholder="3306"
              class="h-8 text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-zinc-600"
            />
          </div>

          <!-- 本地端口 + 提交按钮 -->
          <div class="space-y-1.5">
            <Label class="text-xs text-zinc-400">{{ t('tunnel.localPort') }}</Label>
            <Input
              v-model.number="form.localPort"
              type="number"
              placeholder="0"
              class="h-8 text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-zinc-600"
            />
            <p class="text-[10px] text-zinc-600">{{ t('tunnel.localPortHint') }}</p>
          </div>

          <div class="flex items-end">
            <Button
              class="w-full h-8 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-100"
              :disabled="opening || !canSubmit"
              @click="handleOpen"
            >
              <Loader2 v-if="opening" class="mr-2 h-3.5 w-3.5 animate-spin" />
              <Cable v-else class="mr-2 h-3.5 w-3.5" />
              {{ t('tunnel.open') }}
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
