<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Cable, Plus, X, Loader2, ArrowRight } from 'lucide-vue-next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { tunnelOpen, tunnelClose, tunnelList } from '@/api/tunnel'
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

const tunnels = ref<TunnelInfo[]>([])
const loadingTunnels = ref(false)
const closingId = ref<string | null>(null)
const opening = ref(false)

const form = ref({
  sshHost: props.sshHost,
  sshPort: props.sshPort,
  sshUsername: props.sshUsername,
  sshPassword: '',
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

async function handleOpen() {
  opening.value = true
  try {
    const info = await tunnelOpen({
      sshHost: form.value.sshHost,
      sshPort: Number(form.value.sshPort),
      sshUsername: form.value.sshUsername,
      sshPassword: form.value.sshPassword,
      localPort: Number(form.value.localPort),
      remoteHost: form.value.remoteHost,
      remotePort: Number(form.value.remotePort),
    })
    tunnels.value = [...tunnels.value, info]
    form.value.sshPassword = ''
    toast.success(t('tunnel.open'))
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
    toast.success(t('tunnel.confirmClose'))
  } catch (e) {
    toast.error(String(e))
  } finally {
    closingId.value = null
  }
}

watch(() => props.open, (val) => {
  if (val) {
    form.value.sshHost = props.sshHost
    form.value.sshPort = props.sshPort
    form.value.sshUsername = props.sshUsername
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
        </ScrollArea>
      </div>

      <Separator class="bg-zinc-800" />

      <!-- New Tunnel Form -->
      <div class="space-y-3">
        <p class="text-xs font-medium text-zinc-400 uppercase tracking-wide flex items-center gap-1.5">
          <Plus class="h-3.5 w-3.5" />
          {{ t('tunnel.open') }}
        </p>

        <div class="grid grid-cols-2 gap-3">
          <div class="col-span-2 space-y-1.5">
            <Label class="text-xs text-zinc-400">{{ t('tunnel.sshHost') }}</Label>
            <Input
              v-model="form.sshHost"
              placeholder="ssh.example.com"
              class="h-8 text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-zinc-600"
            />
          </div>

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

          <div class="col-span-2 space-y-1.5">
            <Label class="text-xs text-zinc-400">{{ t('tunnel.sshPassword') }}</Label>
            <Input
              v-model="form.sshPassword"
              type="password"
              placeholder="••••••••"
              class="h-8 text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-zinc-600"
            />
          </div>

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

          <div class="space-y-1.5">
            <Label class="text-xs text-zinc-400">{{ t('tunnel.localPort') }}</Label>
            <Input
              v-model.number="form.localPort"
              type="number"
              placeholder="3306"
              class="h-8 text-sm bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-zinc-600"
            />
          </div>

          <div class="flex items-end">
            <Button
              class="w-full h-8 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-100"
              :disabled="opening || !form.sshHost || !form.sshUsername || !form.sshPassword"
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
