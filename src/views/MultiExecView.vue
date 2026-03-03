<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConnectionStore } from '@/stores/connections'
import TerminalPanel from '@/components/terminal/TerminalPanelLazy.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Send, Eraser, LayoutGrid, Rows2, Columns2, Check } from 'lucide-vue-next'

const { t } = useI18n()
const connectionStore = useConnectionStore()

const commandInput = ref('')
const selectedIds = ref<Set<string>>(new Set())
const terminalRefs = ref<Map<string, InstanceType<typeof TerminalPanel>>>(new Map())
const sessionStatuses = ref<Map<string, string>>(new Map())
const layout = ref<'grid' | 'vertical' | 'horizontal'>('grid')
const focusedId = ref<string | null>(null)

// 只显示 SSH 类型连接
const sshConnections = computed(() =>
  connectionStore.connectionList.filter((c) => c.record.type === 'ssh')
)

const selectedConnections = computed(() =>
  sshConnections.value.filter((c) => selectedIds.value.has(c.record.id))
)

const gridCols = computed(() => {
  const count = selectedConnections.value.length
  if (count <= 1) return 1
  if (count <= 4) return 2
  return 3
})

function toggleConnection(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedIds.value = next
}

function selectAll() {
  selectedIds.value = new Set(sshConnections.value.map((c) => c.record.id))
}

function deselectAll() {
  selectedIds.value = new Set()
}

function sendCommand() {
  const cmd = commandInput.value
  if (!cmd) return
  for (const conn of selectedConnections.value) {
    const panel = terminalRefs.value.get(conn.record.id)
    ;(panel as any)?.sendData(cmd + '\n')
  }
}

function clearInput() {
  commandInput.value = ''
}

function onStatusChange(connId: string, status: string) {
  sessionStatuses.value = new Map(sessionStatuses.value).set(connId, status)
}

function setTerminalRef(connId: string, el: any) {
  if (el) {
    terminalRefs.value.set(connId, el)
  } else {
    terminalRefs.value.delete(connId)
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    sendCommand()
  }
}

onMounted(() => {
  connectionStore.loadConnections()
})

onBeforeUnmount(() => {
  terminalRefs.value.clear()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶部：命令输入 + 服务器选择 -->
    <div class="border-b border-border p-3 space-y-2">
      <!-- 命令输入行 -->
      <div class="flex items-center gap-2">
        <Input
          v-model="commandInput"
          :placeholder="t('multiExec.inputPlaceholder')"
          class="flex-1 font-mono text-sm"
          @keydown="handleKeydown"
        />
        <TooltipProvider :delay-duration="300">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button size="sm" :disabled="!commandInput || selectedConnections.length === 0" @click="sendCommand">
                <Send class="h-3.5 w-3.5 mr-1.5" />
                {{ t('multiExec.send') }}
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>Ctrl+Enter</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button variant="ghost" size="icon" class="h-8 w-8" @click="clearInput">
          <Eraser class="h-3.5 w-3.5" />
        </Button>
      </div>

      <!-- 服务器选择行 -->
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-xs text-muted-foreground shrink-0">{{ t('multiExec.targets') }}:</span>
        <div class="flex items-center gap-1">
          <Button variant="link" size="sm" class="h-auto p-0 text-xs" @click="selectAll">
            {{ t('multiExec.selectAll') }}
          </Button>
          <span class="text-muted-foreground text-xs">/</span>
          <Button variant="link" size="sm" class="h-auto p-0 text-xs" @click="deselectAll">
            {{ t('multiExec.deselectAll') }}
          </Button>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button
            v-for="conn in sshConnections"
            :key="conn.record.id"
            class="flex items-center gap-1.5 cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors"
            :class="selectedIds.has(conn.record.id)
              ? 'border-primary bg-primary/5 text-foreground'
              : 'border-border text-muted-foreground hover:border-muted-foreground'"
            @click="toggleConnection(conn.record.id)"
          >
            <div
              class="h-3.5 w-3.5 rounded-sm border flex items-center justify-center transition-colors"
              :class="selectedIds.has(conn.record.id) ? 'bg-primary border-primary' : 'border-muted-foreground/40'"
            >
              <Check v-if="selectedIds.has(conn.record.id)" class="h-2.5 w-2.5 text-primary-foreground" />
            </div>
            <span>{{ conn.record.name }}</span>
          </button>
        </div>
        <div v-if="sshConnections.length === 0" class="text-xs text-muted-foreground">
          {{ t('multiExec.noSshConnections') }}
        </div>

        <!-- 布局切换 -->
        <div class="ml-auto flex items-center gap-1 shrink-0">
          <Button
            variant="ghost" size="icon" class="h-7 w-7"
            :class="layout === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground'"
            @click="layout = 'grid'"
          >
            <LayoutGrid class="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" class="h-7 w-7"
            :class="layout === 'vertical' ? 'bg-accent text-foreground' : 'text-muted-foreground'"
            @click="layout = 'vertical'"
          >
            <Columns2 class="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" class="h-7 w-7"
            :class="layout === 'horizontal' ? 'bg-accent text-foreground' : 'text-muted-foreground'"
            @click="layout = 'horizontal'"
          >
            <Rows2 class="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>

    <!-- 终端网格区域 -->
    <div
      v-if="selectedConnections.length > 0"
      class="flex-1 overflow-hidden p-1"
      :class="{
        'grid gap-1': layout === 'grid',
        'flex flex-row gap-1': layout === 'vertical',
        'flex flex-col gap-1': layout === 'horizontal',
      }"
      :style="layout === 'grid' ? { gridTemplateColumns: `repeat(${gridCols}, 1fr)` } : {}"
    >
      <div
        v-for="conn in selectedConnections"
        :key="conn.record.id"
        class="flex flex-col overflow-hidden rounded border"
        :class="focusedId === conn.record.id ? 'border-primary/50' : 'border-border'"
        :style="layout !== 'grid' ? { flex: '1 1 0' } : {}"
        @click="focusedId = conn.record.id"
      >
        <!-- 终端标题栏 -->
        <div class="flex items-center gap-2 px-2 py-0.5 bg-muted/50 border-b border-border">
          <div
            class="h-1.5 w-1.5 rounded-full"
            :class="{
              'bg-emerald-500': sessionStatuses.get(conn.record.id) === 'connected',
              'bg-amber-500 animate-pulse': sessionStatuses.get(conn.record.id) === 'connecting',
              'bg-destructive': sessionStatuses.get(conn.record.id) === 'error',
              'bg-muted-foreground/40': !sessionStatuses.get(conn.record.id) || sessionStatuses.get(conn.record.id) === 'disconnected',
            }"
          />
          <span class="text-xs text-muted-foreground truncate">{{ conn.record.name }}</span>
          <Badge variant="outline" class="ml-auto text-[10px] px-1 py-0">
            {{ conn.record.host }}:{{ conn.record.port }}
          </Badge>
        </div>
        <!-- 终端面板 -->
        <div class="flex-1 overflow-hidden">
          <TerminalPanel
            :ref="(el: any) => setTerminalRef(conn.record.id, el)"
            :connection-id="conn.record.id"
            :connection-name="conn.record.name"
            @status-change="(s: string) => onStatusChange(conn.record.id, s)"
          />
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="flex-1 flex items-center justify-center">
      <div class="text-center text-muted-foreground space-y-2">
        <LayoutGrid class="h-10 w-10 mx-auto opacity-30" />
        <p class="text-sm">{{ t('multiExec.emptyHint') }}</p>
      </div>
    </div>
  </div>
</template>
