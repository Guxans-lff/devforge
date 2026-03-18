<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConnectionStore } from '@/stores/connections'
import { useToast } from '@/composables/useToast'
import TerminalPanel from '@/components/terminal/TerminalPanelLazy.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Send, Eraser, LayoutGrid, Rows2, Columns2, Check, Monitor } from 'lucide-vue-next'

const { t } = useI18n()
const connectionStore = useConnectionStore()
const toast = useToast()

const commandInput = ref('')
const selectedIds = ref<Set<string>>(new Set())
const terminalRefs = ref<Map<string, InstanceType<typeof TerminalPanel>>>(new Map())
const sessionStatuses = ref<Map<string, string>>(new Map())
const layout = ref<'grid' | 'vertical' | 'horizontal'>('grid')
const focusedId = ref<string | null>(null)

// 命令历史（内存级，最近 20 条）
const commandHistory = ref<string[]>([])
const historyIndex = ref(-1)
const MAX_HISTORY = 20

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
  const cmd = commandInput.value.trim()
  if (!cmd || selectedConnections.value.length === 0) return
  for (const conn of selectedConnections.value) {
    const panel = terminalRefs.value.get(conn.record.id)
    ;(panel as any)?.sendData(cmd + '\n')
  }
  // 追加到历史（去重，最新在前）
  commandHistory.value = [cmd, ...commandHistory.value.filter(h => h !== cmd)].slice(0, MAX_HISTORY)
  historyIndex.value = -1
  commandInput.value = ''
  toast.success(t('multiExec.commandSent', { count: selectedConnections.value.length }))
}

function clearInput() {
  commandInput.value = ''
  historyIndex.value = -1
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
    return
  }
  // 上下箭头切换命令历史
  if (e.key === 'ArrowUp' && commandHistory.value.length > 0) {
    e.preventDefault()
    const next = Math.min(historyIndex.value + 1, commandHistory.value.length - 1)
    historyIndex.value = next
    commandInput.value = commandHistory.value[next]!
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (historyIndex.value <= 0) {
      historyIndex.value = -1
      commandInput.value = ''
    } else {
      historyIndex.value--
      commandInput.value = commandHistory.value[historyIndex.value]!
    }
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
  <div class="flex h-full flex-col bg-background">
    <!-- 顶部：命令输入 + 服务器选择 -->
    <div class="border-b border-border/80 p-3 bg-card/60 backdrop-blur-md z-10 space-y-3 shadow-sm relative">
      
      <!-- 紧凑型命令输入框 -->
      <div class="flex items-center gap-1.5 rounded-lg border border-input bg-background px-1 focus-within:ring-[2px] focus-within:ring-primary/20 focus-within:border-primary/50 transition-all duration-300 shadow-sm relative overflow-hidden">
        <Input
          v-model="commandInput"
          :placeholder="t('multiExec.inputPlaceholder') + ' (↑/↓ 历史, Ctrl+Enter 发送)'"
          class="flex-1 font-mono text-[13px] border-0 focus-visible:ring-0 shadow-none px-2 h-9 bg-transparent"
          @keydown="handleKeydown"
        />
        <div class="flex items-center gap-1 pr-1 shrink-0">
          <TooltipProvider :delay-duration="300">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded-md transition-colors" @click="clearInput" v-show="commandInput.length > 0">
                  <Eraser class="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{{ t('multiExec.clear') }}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button size="sm" class="h-7 rounded-md px-3 gap-1.5 bg-primary hover:bg-primary/90 transition-all disabled:opacity-50 font-medium" :disabled="!commandInput.trim() || selectedConnections.length === 0" @click="sendCommand">
            <Send class="h-3 w-3" />
            <span class="text-[12px]">{{ t('multiExec.send') }}</span>
          </Button>
        </div>
      </div>

      <!-- 服务器选择行 -->
      <div class="flex items-center gap-3">
        <!-- 基础操作组 -->
        <div class="flex items-center gap-0.5 bg-muted/60 p-1 rounded-lg border border-border/60 shrink-0">
           <Button variant="ghost" size="sm" class="h-6 px-2.5 text-[12px] font-medium hover:bg-background hover:shadow-sm transition-all rounded-md" @click="selectAll">{{ t('multiExec.selectAll') }}</Button>
           <div class="w-px h-3 bg-border/80 mx-0.5"></div>
           <Button variant="ghost" size="sm" class="h-6 px-2.5 text-[12px] font-medium hover:bg-background hover:shadow-sm transition-all rounded-md text-muted-foreground hover:text-foreground" @click="deselectAll">{{ t('multiExec.deselectAll') }}</Button>
        </div>
        
        <div class="w-px h-5 bg-border/60 shrink-0"></div>
        
        <!-- 服务器列表组 -->
        <div class="flex-1 overflow-x-auto pb-1 -mb-1 hide-scrollbar flex items-center gap-2">
          <button
            v-for="conn in sshConnections"
            :key="conn.record.id"
            class="group relative flex items-center gap-1.5 cursor-pointer rounded-full border px-3 py-1 text-[11px] font-medium transition-all duration-300 overflow-hidden shrink-0"
            :class="selectedIds.has(conn.record.id)
              ? 'border-primary/40 bg-primary/10 text-primary shadow-sm hover:bg-primary/20 hover:border-primary/50'
              : 'border-border bg-muted/30 text-muted-foreground hover:border-muted-foreground/50 hover:bg-muted/60 hover:text-foreground'"
            @click="toggleConnection(conn.record.id)"
          >
            <div class="relative flex items-center gap-1 z-10 w-full">
              <div class="relative flex items-center justify-center">
                <Monitor class="h-3 w-3 transition-all duration-300" :class="selectedIds.has(conn.record.id) ? 'text-primary scale-0 opacity-0 absolute' : 'text-muted-foreground/70 group-hover:text-foreground scale-100 opacity-100'" />
                <Check class="h-3 w-3 text-primary transition-all duration-300" :class="selectedIds.has(conn.record.id) ? 'scale-100 opacity-100' : 'scale-50 opacity-0 absolute'" />
              </div>
              <span class="truncate max-w-[120px]">{{ conn.record.name }}</span>
            </div>
          </button>
          
          <div v-if="sshConnections.length === 0" class="text-[12px] text-muted-foreground italic px-2">
            {{ t('multiExec.noSshConnections') }}
          </div>
        </div>

        <!-- 布局切换 -->
        <div class="ml-auto flex items-center gap-0.5 shrink-0 bg-muted/60 p-1 rounded-lg border border-border/60">
          <Button
            variant="ghost" size="icon" class="h-6 w-6 rounded-md transition-all"
            :class="layout === 'grid' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'"
            @click="layout = 'grid'"
          >
            <LayoutGrid class="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" class="h-6 w-6 rounded-md transition-all"
            :class="layout === 'vertical' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'"
            @click="layout = 'vertical'"
          >
            <Columns2 class="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" class="h-6 w-6 rounded-md transition-all"
            :class="layout === 'horizontal' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'"
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
      class="flex-1 overflow-hidden p-3 bg-muted/10 relative"
      :class="{
        'grid gap-3': layout === 'grid',
        'flex flex-row gap-3': layout === 'vertical',
        'flex flex-col gap-3': layout === 'horizontal',
      }"
      :style="layout === 'grid' ? { gridTemplateColumns: `repeat(${gridCols}, 1fr)` } : {}"
    >
      <div
        v-for="conn in selectedConnections"
        :key="conn.record.id"
        class="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow duration-300 hover:shadow-md"
        :class="focusedId === conn.record.id ? 'border-primary/50 ring-2 ring-primary/10' : 'border-border/60'"
        :style="layout !== 'grid' ? { flex: '1 1 0' } : {}"
        @click="focusedId = conn.record.id"
      >
        <!-- 终端标题栏 -->
        <TooltipProvider :delay-duration="300">
          <Tooltip>
            <TooltipTrigger as-child>
              <div class="flex items-center gap-2.5 px-3 py-2 bg-muted/30 border-b border-border/50 cursor-default select-none group/term transition-colors hover:bg-muted/50">
                <div class="relative flex h-2 w-2 items-center justify-center shrink-0">
                  <div class="absolute inline-flex h-full w-full rounded-full opacity-30"
                       :class="{
                         'bg-emerald-500 animate-ping': sessionStatuses.get(conn.record.id) === 'connected',
                         'bg-amber-500 animate-pulse': sessionStatuses.get(conn.record.id) === 'connecting',
                         'bg-destructive': sessionStatuses.get(conn.record.id) === 'error',
                         'hidden': !sessionStatuses.get(conn.record.id) || sessionStatuses.get(conn.record.id) === 'disconnected',
                       }"></div>
                  <div
                    class="relative inline-flex h-2 w-2 rounded-full"
                    :class="{
                      'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]': sessionStatuses.get(conn.record.id) === 'connected',
                      'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)]': sessionStatuses.get(conn.record.id) === 'connecting',
                      'bg-destructive shadow-[0_0_6px_rgba(239,68,68,0.6)]': sessionStatuses.get(conn.record.id) === 'error',
                      'bg-muted-foreground/40': !sessionStatuses.get(conn.record.id) || sessionStatuses.get(conn.record.id) === 'disconnected',
                    }"
                  />
                </div>
                <span class="text-[13px] font-semibold text-foreground/80 truncate">{{ conn.record.name }}</span>
                <span class="ml-auto text-[11px] font-mono text-muted-foreground/40 truncate max-w-[150px] opacity-0 group-hover/term:opacity-100 transition-opacity">{{ conn.record.host }}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{{ conn.record.host }}:{{ conn.record.port }}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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

    <!-- 空状态：引导卡片 -->
    <div v-else class="flex-1 overflow-y-auto p-4 sm:p-6 bg-muted/10 flex items-center justify-center relative">
      <div class="max-w-5xl w-full text-center animate-in fade-in zoom-in-[0.98] duration-700 bg-background/50 backdrop-blur-3xl border border-border/50 shadow-2xl rounded-[2.5rem] p-6 sm:p-10 mb-4 relative overflow-hidden">
        
        <!-- 背景装饰圈 -->
        <div class="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-primary/10 rounded-full blur-[100px] pointer-events-none opacity-50"></div>
        
        <div class="relative space-y-4 z-10 mb-8 mt-2">
          <div class="relative h-20 w-20 mx-auto group">
            <div class="absolute inset-0 bg-primary/20 rounded-2xl blur-xl animate-pulse group-hover:bg-primary/30 transition-colors duration-700"></div>
            <div class="relative h-full w-full rounded-xl bg-card border border-border/80 shadow-xl flex items-center justify-center ring-1 ring-primary/10 group-hover:-translate-y-1.5 group-hover:shadow-primary/20 transition-all duration-500">
              <Monitor class="h-10 w-10 text-primary drop-shadow-md" />
            </div>
          </div>
          <div class="space-y-1.5">
            <h3 class="text-2xl font-bold tracking-tight text-foreground">{{ t('multiExec.emptyGuide') }}</h3>
            <p class="text-[14px] text-muted-foreground max-w-sm mx-auto leading-relaxed">{{ t('multiExec.emptyGuideDesc') }}</p>
          </div>
        </div>

        <!-- 服务器快速选择卡片网格 -->
        <div v-if="sshConnections.length > 0" class="relative z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 text-left w-full mx-auto">
          <button
            v-for="conn in sshConnections"
            :key="conn.record.id"
            class="group relative flex overflow-hidden rounded-xl border transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 text-left bg-background/60 backdrop-blur-sm"
            :class="selectedIds.has(conn.record.id) ? 'border-primary/60 ring-2 ring-primary/10 bg-primary/[0.03] shadow-md -translate-y-1' : 'border-border/80 hover:border-primary/50 hover:shadow-lg hover:-translate-y-1 hover:bg-card'"
            @click="toggleConnection(conn.record.id)"
          >
            <!-- 左侧动态状态条 -->
            <div class="w-1.5 shrink-0 transition-colors duration-300" :class="selectedIds.has(conn.record.id) ? 'bg-primary shadow-[0_0_8px_rgba(var(--primary),0.8)]' : 'bg-muted-foreground/10 group-hover:bg-primary/40'"></div>
            
            <div class="p-3.5 flex flex-col gap-2 relative w-full overflow-hidden">
              <div class="flex items-start justify-between gap-2.5">
                <div class="h-9 w-9 shrink-0 rounded-[8px] flex items-center justify-center transition-all duration-300 border"
                     :class="selectedIds.has(conn.record.id) ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-muted text-muted-foreground border-border/50 group-hover:bg-primary/10 group-hover:text-primary group-hover:border-primary/30 group-hover:scale-105 shadow-sm'">
                  <Monitor class="h-4 w-4" />
                </div>
                
                <div class="flex-1 min-w-0 flex flex-col justify-center pl-0.5">
                  <!-- 加粗 Server Name -->
                  <div class="font-bold text-[13.5px] text-foreground transition-colors truncate group-hover:text-primary mb-0.5 leading-tight" :title="conn.record.name">{{ conn.record.name }}</div>
                  
                  <!-- IP with Glowing dot -->
                  <div class="text-[10.5px] text-muted-foreground font-mono flex items-center gap-1.5 whitespace-nowrap opacity-80" :title="conn.record.host">
                    <span class="inline-block w-1.5 h-1.5 rounded-full shrink-0 transition-all duration-300" 
                          :class="selectedIds.has(conn.record.id) ? 'bg-primary shadow-[0_0_4px_rgba(var(--primary),0.8)]' : 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]'"></span>
                    <span class="tracking-tighter">{{ conn.record.host }}</span>
                  </div>
                </div>

                <!-- Checkbox Mock -->
                <div class="h-4 w-4 shrink-0 rounded-[4px] border flex items-center justify-center transition-all duration-300 shadow-sm mt-0.5"
                     :class="selectedIds.has(conn.record.id) ? 'bg-primary border-primary' : 'bg-background border-border group-hover:border-primary/40'">
                   <Check class="h-[10px] w-[10px] text-primary-foreground transform transition-transform duration-300" :class="selectedIds.has(conn.record.id) ? 'scale-100' : 'scale-0'" />
                </div>
              </div>
            </div>
            
            <!-- 底层环境光 -->
            <div class="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
          </button>
        </div>
        
        <div v-else class="text-sm text-muted-foreground bg-card/40 rounded-2xl p-8 border border-dashed border-border/80 max-w-lg mx-auto flex flex-col items-center justify-center gap-4 shadow-sm relative z-10 backdrop-blur-sm">
          <div class="h-12 w-12 rounded-xl bg-muted flex items-center justify-center ring-1 ring-border/50 shadow-inner">
            <Monitor class="h-6 w-6 text-muted-foreground/40" />
          </div>
          <p class="text-[14px] font-medium">{{ t('multiExec.noSshConnections') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
